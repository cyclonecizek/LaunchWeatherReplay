export const SOUNDING_STATION='74794';
export const SOUNDING_ARCHIVE='https://weather.uwyo.edu/wsgi/sounding';
export const LLCC_THRESHOLDS_C=[5,0,-5,-10,-15,-20];
const HOUR=3600000;
export type SoundingLevel={presHpa:number;hghtM:number;tempC:number};
export type Sounding={time:number;levels:SoundingLevel[]};
// UWyo's cgi-bin/sounding archive was retired; the wsgi/sounding replacement
// takes one exact synoptic launch time per request instead of a FROM/TO range.
export type QuerySpec={time:number};
export type CriticalAltitude={thresholdC:number;altitudeM:number|null;altitudeFt:number|null};

// KXMR's actual launch schedule, not the standard 00Z/12Z synoptic hours;
// the new endpoint 404s on any datetime without an exact sounding, so only
// these known hours are worth trying. Ordered nearest-first, capped to a
// short lookback, so callers stop at the first hit without hammering the
// archive: the soonest sounding at or before the target time.
const KXMR_LAUNCH_HOURS_UTC=[18,15,12,9,0];
export function soundingQuerySpecs(targetTime:number,lookbackHours=12):QuerySpec[] {
 const start=Math.floor(targetTime/HOUR)*HOUR;
 const specs:QuerySpec[]=[];
 for(let h=0;h<=lookbackHours;h++){
  const t=start-h*HOUR;
  if(KXMR_LAUNCH_HOURS_UTC.includes(new Date(t).getUTCHours()))specs.push({time:t});
 }
 return specs;
}
export function soundingURL(spec:QuerySpec) {
 const iso=new Date(spec.time).toISOString();
 // src=FM35 (WMO TEMP report format) is required - without it the server
 // can't identify the sounding and 404s even when the archive has data.
 const p=new URLSearchParams({src:'FM35',datetime:`${iso.slice(0,10)} ${iso.slice(11,19)}`,id:SOUNDING_STATION,type:'TEXT:LIST'});
 return `${SOUNDING_ARCHIVE}?${p}`;
}

// Each sounding in a TEXT:LIST page is one <H2>...</H2> title followed by a
// fixed-width data <PRE> (7-char PRES/HGHT/TEMP/... columns) and a second
// <PRE> with station indices, including "Observation time: YYMMDD/HHMM" -
// parsed directly, so the result doesn't depend on which slot was requested.
export function parseSoundingPage(html:string):Sounding[] {
 const out:Sounding[]=[];
 for(const block of html.split(/<H2>/i).slice(1)){
  const pre=/<PRE>([\s\S]*?)<\/PRE>/i.exec(block);
  const obs=/Observation time:\s*(\d{2})(\d{2})(\d{2})\/(\d{2})(\d{2})/.exec(block);
  if(!pre||!obs)continue;
  const [,yy,mm,dd,hh,mi]=obs;
  const year=(Number(yy)>=70?1900:2000)+Number(yy);
  const time=Date.UTC(year,Number(mm)-1,Number(dd),Number(hh),Number(mi));
  const levels:SoundingLevel[]=[];
  for(const line of pre[1].split('\n')){
   if(line.length<21)continue;
   const presHpa=Number(line.slice(0,7).trim()),hghtM=Number(line.slice(7,14).trim()),tempC=Number(line.slice(14,21).trim());
   if(Number.isFinite(presHpa)&&Number.isFinite(hghtM)&&Number.isFinite(tempC))levels.push({presHpa,hghtM,tempC});
  }
  // A handful of stray numeric-looking header/separator rows aren't a usable sounding.
  if(levels.length>=5)out.push({time,levels:levels.sort((a,b)=>a.hghtM-b.hghtM)});
 }
 return out;
}
export function nearestSounding(soundings:Sounding[],targetTime:number):Sounding|undefined {
 return soundings.slice().sort((a,b)=>Math.abs(a.time-targetTime)-Math.abs(b.time-targetTime))[0];
}
// Tries each hourly slot from the target backward, oldest attempt's error
// kept only for the final report: a miss on most hours is normal (the
// station only actually flies once or twice a day), not a failure.
export async function fetchNearestSounding(targetTime:number,fetchText:(url:string)=>Promise<string>,lookbackHours=12):Promise<Sounding> {
 let lastError:unknown;
 for(const spec of soundingQuerySpecs(targetTime,lookbackHours)){
  let soundings:Sounding[];
  try{soundings=parseSoundingPage(await fetchText(soundingURL(spec)));}
  catch(e){lastError=e;continue;}
  const sounding=nearestSounding(soundings,targetTime);
  if(sounding)return sounding;
 }
 const detail=lastError instanceof Error?lastError.message:undefined;
 throw Error(`No ${SOUNDING_STATION} (KXMR) sounding was found in the ${lookbackHours} hours before the requested time.${detail?` Last attempt: ${detail}`:''}`);
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
