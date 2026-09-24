export const SOUNDING_STATION='74794';
export const SOUNDING_ARCHIVE='https://weather.uwyo.edu/wsgi/sounding';
export const LLCC_THRESHOLDS_C=[5,0,-5,-10,-15,-20];
// A default (or absent) server-side User-Agent is a common trigger for a
// university host's bot protection to return a decoy 404 instead of the
// real page. A browser-shaped one avoids that without misrepresenting the
// request beyond what any visitor's browser would already send.
export const SOUNDING_HEADERS={
 Accept:'text/html,*/*',
 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
} as const;
const HOUR=3600000;
export type SoundingLevel={presHpa:number;hghtM:number;tempC:number};
export type Sounding={time:number;levels:SoundingLevel[]};
// UWyo's cgi-bin/sounding archive was retired; the wsgi/sounding replacement
// takes one exact synoptic launch time per request instead of a FROM/TO range.
export type QuerySpec={time:number};
export type CriticalAltitude={thresholdC:number;altitudeM:number|null;altitudeFt:number|null};

// KXMR doesn't fly on a clean, fixed schedule, and the new endpoint 404s on
// any datetime without an exact sounding, so search backward hour by hour
// from the target instead of guessing specific launch hours. Ordered
// nearest-first and capped to a short lookback, so callers stop at the
// first hit without hammering the archive: the soonest sounding at or
// before the target time, and if nothing turns up within the window, stop.
export function soundingQuerySpecs(targetTime:number,lookbackHours=12):QuerySpec[] {
 const start=Math.floor(targetTime/HOUR)*HOUR;
 const specs:QuerySpec[]=[];
 for(let h=0;h<=lookbackHours;h++)specs.push({time:start-h*HOUR});
 return specs;
}
export function soundingURL(spec:QuerySpec) {
 const iso=new Date(spec.time).toISOString();
 // Built to match a confirmed-working URL byte for byte - literal colons in
 // "datetime" and "type", not percent-encoded (%3A). This WSGI endpoint
 // appears to 404 on the standard-encoded form, so don't route this through
 // URLSearchParams/encodeURIComponent, which would encode those colons.
 const datetime=`${iso.slice(0,10)}%20${iso.slice(11,19)}`;
 return `${SOUNDING_ARCHIVE}?src=FM35&datetime=${datetime}&id=${SOUNDING_STATION}&type=TEXT:LIST`;
}

const num=(s:string)=>s.trim()===''?NaN:Number(s);
function parseLevels(text:string):SoundingLevel[] {
 const fixed:SoundingLevel[]=[],loose:SoundingLevel[]=[];
 for(const line of text.split('\n')){
  if(line.length>=21){
   const presHpa=num(line.slice(0,7)),hghtM=num(line.slice(7,14)),tempC=num(line.slice(14,21));
   if(Number.isFinite(presHpa)&&Number.isFinite(hghtM)&&Number.isFinite(tempC))fixed.push({presHpa,hghtM,tempC});
  }
  const [p,h,t]=line.trim().split(/[\s,]+/).map(Number);
  if(Number.isFinite(p)&&Number.isFinite(h)&&Number.isFinite(t)&&p>0&&p<1100)loose.push({presHpa:p,hghtM:h,tempC:t});
 }
 // Fixed 7-char columns keep rows with a blank field aligned; whitespace
 // splitting is the fallback in case the new endpoint changed the layout.
 return fixed.length>=5?fixed:loose;
}

// The legacy TEXT:LIST page was one <H2> title per sounding, a fixed-width
// data <PRE>, and an indices <PRE> with "Observation time: YYMMDD/HHMM". The
// wsgi replacement returns one sounding per exact-datetime request, so when
// the page lacks those markers, fall back to the whole page and the time
// that was requested.
export function parseSoundingPage(html:string,requestedTime?:number):Sounding[] {
 const out:Sounding[]=[];
 const blocks=/<H2>/i.test(html)?html.split(/<H2>/i).slice(1):[html];
 for(const block of blocks){
  const obs=/Observation time:\s*(\d{2})(\d{2})(\d{2})\/(\d{2})(\d{2})/.exec(block);
  let time=requestedTime;
  if(obs){
   const [,yy,mm,dd,hh,mi]=obs;
   time=Date.UTC((Number(yy)>=70?1900:2000)+Number(yy),Number(mm)-1,Number(dd),Number(hh),Number(mi));
  }
  if(time===undefined)continue;
  const pre=/<PRE>([\s\S]*?)<\/PRE>/i.exec(block);
  const levels=parseLevels(pre?pre[1]:block.replace(/<[^>]+>/g,'\n'));
  // A handful of stray numeric-looking header/separator rows aren't a usable sounding.
  if(levels.length>=5)out.push({time,levels:levels.sort((a,b)=>a.hghtM-b.hghtM)});
 }
 return out;
}
export function nearestSounding(soundings:Sounding[],targetTime:number):Sounding|undefined {
 return soundings.slice().sort((a,b)=>Math.abs(a.time-targetTime)-Math.abs(b.time-targetTime))[0];
}
// Tries each hourly slot from the target backward. A failed request on most
// hours is normal (the station only flies a few times a day), so those are
// kept only for the final report. A page that loaded but couldn't be parsed
// is different - it means the data is there and the parser is wrong - so it
// takes priority over the trailing 404s in the error.
export async function fetchNearestSounding(targetTime:number,fetchText:(url:string)=>Promise<string>,lookbackHours=12):Promise<Sounding> {
 let lastError:unknown,unreadable:string|undefined;
 for(const spec of soundingQuerySpecs(targetTime,lookbackHours)){
  const url=soundingURL(spec);
  let html:string;
  try{html=await fetchText(url);}
  catch(e){lastError=e;continue;}
  const sounding=nearestSounding(parseSoundingPage(html,spec.time),targetTime);
  if(sounding)return sounding;
  unreadable??=`${url} loaded but had no readable sounding. Page begins: ${html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,300)}`;
 }
 const detail=unreadable??(lastError instanceof Error?`Last attempt: ${lastError.message}`:undefined);
 throw Error(`No ${SOUNDING_STATION} (KXMR) sounding was found in the ${lookbackHours} hours before the requested time.${detail?` ${detail}`:''}`);
}

// First bottom-up crossing of each threshold, linearly interpolated between
// the bracketing reported levels. Ambiguous with a low-level inversion, but
// matches how these isotherm altitudes are normally read off a sounding.
export function criticalAltitudes(levels:SoundingLevel[],thresholds:number[]=LLCC_THRESHOLDS_C):CriticalAltitude[] {
 return thresholds.map(thresholdC=>{
  for(let i=0;i<levels.length-1;i++){
   const t0=levels[i].tempC,t1=levels[i+1].tempC;
   if((t0-thresholdC)*(t1-thresholdC)>0)continue;
   const altitudeM=t0===t1?levels[i].hghtM:levels[i].hghtM+(thresholdC-t0)/(t1-t0)*(levels[i+1].hghtM-levels[i].hghtM);
   return {thresholdC,altitudeM,altitudeFt:altitudeM*3.28084};
  }
  return {thresholdC,altitudeM:null,altitudeFt:null};
 });
}
export function soundingReportText(sounding:Sounding,requestedTime:number,thresholds:number[]=LLCC_THRESHOLDS_C):string {
 const rows=criticalAltitudes(sounding.levels,thresholds);
 const stamp=(t:number)=>new Date(t).toISOString().slice(0,16).replace('T',' ')+'Z';
 const line=(c:string,m:string,f:string)=>`${c.padEnd(11)}${m.padEnd(19)}${f}`;
 const lines=[
  'KXMR (74794) LLCC CRITICAL TEMPERATURE ALTITUDES',
  `Sounding time: ${stamp(sounding.time)} (nearest available to requested ${stamp(requestedTime)})`,
  'Source: University of Wyoming upper-air sounding archive (weather.uwyo.edu/upperair). Not an official range product; verify independently.',
  '',
  line('Temp (C)','Altitude (m MSL)','Altitude (ft MSL)'),
  ...rows.map(r=>line(String(r.thresholdC),r.altitudeM===null?'not reached':String(Math.round(r.altitudeM)),r.altitudeFt===null?'not reached':String(Math.round(r.altitudeFt/10)*10))),
  '',
  'Altitudes are linearly interpolated between the sounding\'s reported levels, taking the first crossing above the surface.',
  '"not reached" means the sounding never reaches that temperature within its reported levels (too warm throughout, or the balloon burst before getting that cold).',
 ];
 return lines.join('\r\n')+'\r\n';
}
