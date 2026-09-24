export const SOUNDING_STATION='74794';
export const SOUNDING_ARCHIVE='https://weather.uwyo.edu/cgi-bin/sounding';
export const LLCC_THRESHOLDS_C=[5,0,-5,-10,-15,-20];
const MIN=60000,HOUR=3600000;
export type SoundingLevel={presHpa:number;hghtM:number;tempC:number};
export type Sounding={time:number;levels:SoundingLevel[]};
export type QuerySpec={year:number;month:number;fromDDHH:string;toDDHH:string};
export type CriticalAltitude={thresholdC:number;altitudeM:number|null;altitudeFt:number|null};
const pad2=(n:number)=>String(n).padStart(2,'0');

// UWyo's FROM/TO are day+hour within one explicit YEAR/MONTH; split a wider
// window into one query per calendar month it touches.
export function soundingQuerySpecs(targetTime:number,windowHours=24):QuerySpec[] {
 const from=targetTime-windowHours*HOUR,to=targetTime+windowHours*HOUR;
 const specs:QuerySpec[]=[];
 let cursor=Date.UTC(new Date(from).getUTCFullYear(),new Date(from).getUTCMonth(),1);
 while(cursor<=to){
  const year=new Date(cursor).getUTCFullYear(),month=new Date(cursor).getUTCMonth();
  const monthStart=cursor,monthEnd=Date.UTC(year,month+1,1)-MIN;
  const segStart=Math.max(from,monthStart),segEnd=Math.min(to,monthEnd);
  if(segStart<=segEnd){
   const s=new Date(segStart),e=new Date(segEnd);
   specs.push({year,month:month+1,fromDDHH:pad2(s.getUTCDate())+pad2(s.getUTCHours()),toDDHH:pad2(e.getUTCDate())+pad2(e.getUTCHours())});
  }
  cursor=Date.UTC(year,month+1,1);
 }
 return specs;
}
export function soundingURL(spec:QuerySpec) {
 const p=new URLSearchParams({region:'naconf','TYPE':'TEXT:LIST',YEAR:String(spec.year),MONTH:pad2(spec.month),FROM:spec.fromDDHH,TO:spec.toDDHH,STNM:SOUNDING_STATION});
 return `${SOUNDING_ARCHIVE}?${p}`;
}

// Each sounding in a TEXT:LIST page is one <H2>...</H2> title followed by a
// fixed-width data <PRE> (7-char PRES/HGHT/TEMP/... columns) and a second
// <PRE> with station indices, including "Observation time: YYMMDD/HHMM".
export function parseSoundingPage(html:string,spec:QuerySpec):Sounding[] {
 const out:Sounding[]=[];
 for(const block of html.split(/<H2>/i).slice(1)){
  const pre=/<PRE>([\s\S]*?)<\/PRE>/i.exec(block);
  const obs=/Observation time:\s*\d{2}(\d{2})(\d{2})\/(\d{2})(\d{2})/.exec(block);
  if(!pre||!obs)continue;
  const [,,dd,hh,mi]=obs;
  const time=Date.UTC(spec.year,spec.month-1,Number(dd),Number(hh),Number(mi));
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
export async function fetchNearestSounding(targetTime:number,fetchText:(url:string)=>Promise<string>):Promise<Sounding> {
 const specs=soundingQuerySpecs(targetTime);
 const pages=await Promise.all(specs.map(async s=>parseSoundingPage(await fetchText(soundingURL(s)),s)));
 const sounding=nearestSounding(pages.flat(),targetTime);
 if(!sounding)throw Error(`No ${SOUNDING_STATION} (KXMR) sounding was found within 24 hours of the requested time.`);
 return sounding;
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
