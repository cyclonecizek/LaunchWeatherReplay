import { KSC, encodeKscDate, readLimited } from './archive';
import { csv, utc, grtime, validate, type Config, type Entry } from './replay';
export type MerlinType='CG'|'CC';
export type MerlinSource={type:MerlinType;start:string;end:string;sha256:string;records:number;rejected:number;url:string};
export type MerlinChunk={source:MerlinSource;text:string};
const MIN=60000, STEP=5*MIN;
export function merlinURL(type:MerlinType,start:string,end:string){
 const a=new Date(start),b=new Date(end);
 if(!['CG','CC'].includes(type)||!Number.isFinite(+a+ +b)||+b<=+a||+b- +a>STEP||+a%MIN||+b%MIN)throw Error('MERLIN requests require whole UTC minutes, up to five minutes per request.');
 return `${KSC}MerlinCloudTo${type==='CG'?'Ground':'Cloud'}/Export/${encodeKscDate(a)}A${encodeKscDate(b)}${type==='CG'?'AAAAABaAAA':'AAA'}`;
}
export function merlinRequests(c:Config){const {a,b}=validate(c);if(a%MIN||b%MIN)throw Error('MERLIN scenarios must start and end on whole UTC minutes.');const out:{type:MerlinType;start:string;end:string}[]=[];for(const type of ['CG','CC'] as const)for(let t=a-c.lightningMinutes*MIN;t<b;t+=STEP)out.push({type,start:new Date(t).toISOString(),end:new Date(Math.min(t+STEP,b)).toISOString()});return out;}
export function coordinate(s:string){if(!s?.trim())return NaN;if(!s.includes(':'))return Number(s);const m=/^(-?\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(s);if(!m||+m[2]>=60||+m[3]>=60)return NaN;return (s.startsWith('-')?-1:1)*(Math.abs(+m[1])+(+m[2])/60+(+m[3])/3600);}
export type Detection={time:number;lat:number;lon:number;signal:string;subsecond?:boolean};
export function parseMerlin(text:string,start:number,end:number){
 const rows=csv(text);const first=rows[0];if(first&&!['Date','Time','Latitude','Longitude','Signal Strength'].every(k=>k in first))throw Error('Unexpected MERLIN columns.');
 if(!first&&!['Date','Time','Latitude','Longitude'].every(k=>text.includes(k)))throw Error('Unexpected MERLIN response.');
 const events:Detection[]=[];let rejected=0;
 for(const r of rows){const time=utc(r.Date,r.Time),lat=coordinate(r.Latitude),lon=coordinate(r.Longitude);if(!Number.isFinite(time+lat+lon)||Math.abs(lat)>90||Math.abs(lon)>180){rejected++;continue;}if(time>=start&&time<end)events.push({time,lat,lon,signal:r['Signal Strength'],subsecond:/\.[0-9]*[1-9]/.test(r.Time)});}
 return {events,rejected};
}
export async function fetchMerlin(s:{type:MerlinType;start:string;end:string;sha256?:string},signal?:AbortSignal){
 const url=merlinURL(s.type,s.start,s.end);let r:Response|undefined;
 for(let attempt=0;attempt<2;attempt++){r=await fetch(url,{redirect:'manual',headers:{Accept:'text/csv,text/plain,*/*'},signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(50000)])});if(r.ok||r.status<500)break;await r.body?.cancel();}
 if(!r?.ok)throw Error(`MERLIN ${s.type} archive returned HTTP ${r?.status}. Retry coverage.`);
 const text=await readLimited(r,6_000_000);if(/^\s*</.test(text))throw Error('MERLIN returned a web page instead of CSV.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
 if(s.sha256&&s.sha256!==sha256)throw Error('MERLIN archive changed since coverage was checked. Refresh coverage and download again.');
 const {events,rejected}=parseMerlin(text,Date.parse(s.start),Date.parse(s.end));
 return {text,events,source:{type:s.type,start:s.start,end:s.end,sha256,records:events.length,rejected,url} satisfies MerlinSource};
}
export function checkedSources(c:Config,sources:MerlinSource[]){const expected=merlinRequests(c);if(!Array.isArray(sources)||sources.length!==expected.length)throw Error('MERLIN coverage is incomplete. Check coverage again.');return expected.map((e,i)=>{const s=sources[i];if(!s||s.type!==e.type||s.start!==e.start||s.end!==e.end||!/^[a-f0-9]{64}$/.test(s.sha256))throw Error('Invalid MERLIN coverage selection.');return {...e,sha256:s.sha256};});}
const KM_LAT=111.195,KM_LON=KM_LAT*Math.cos(28.5*Math.PI/180);
export const cellKey=(lat:number,lon:number)=>`${Math.floor((lon+80.6)*KM_LON)},${Math.floor((lat-28.5)*KM_LAT)}`;
const colors=['50, 120, 240','30, 205, 230','115, 225, 100','245, 220, 60','250, 145, 35','240, 60, 80'];
const color=(n:number)=>colors[n<5?0:n<20?1:n<50?2:n<100?3:n<250?4:5];
export class DensityWindow{
 minutes=new Map<number,Map<string,number>>();
 add(events:Detection[]){for(const e of events){const minute=Math.floor(e.time/MIN)*MIN;let bin=this.minutes.get(minute);if(!bin){bin=new Map();this.minutes.set(minute,bin);}const key=cellKey(e.lat,e.lon);bin.set(key,(bin.get(key)||0)+1);}}
 counts(t:number,trail:number){const counts=new Map<string,number>();for(const [minute,bin] of this.minutes){if(minute<t-trail){this.minutes.delete(minute);continue;}if(minute>=t)continue;for(const [key,n] of bin)counts.set(key,(counts.get(key)||0)+n);}return counts;}
}
export const merlinRawName=(s:Pick<MerlinSource,'type'>,i:number)=>`raw/merlin_${s.type.toLowerCase()}_${String(i+1).padStart(3,'0')}.csv`;
export const cgHeader=(c:Config)=>`Title: MERLIN CG / trailing ${c.lightningMinutes} min\nThreshold: 999\nFont: 1, 13, 1, "Arial"\n`;
export function* cgParts(c:Config,events:Detection[]){
 const {a,b}=validate(c),trail=c.lightningMinutes*MIN;
 for(const e of events){const start=Math.max(a,Math.floor(e.time/1000)*1000+(e.subsecond?1000:0)),end=Math.floor(Math.min(b,e.time+trail)/1000)*1000;if(end<=start)continue;const signalText=e.signal.replace(/[^0-9.+-]/g,'');yield `TimeRange: ${grtime(start)} ${grtime(end)}\nColor: 255 210 80\nText: ${e.lat}, ${e.lon}, 1, "+", "CG detection / ${new Date(e.time).toISOString()} / signal strength ${signalText} (source units)"\n`;}
}
export function* ccParts(c:Config,window:DensityWindow){
 const {a,b}=validate(c),trail=c.lightningMinutes*MIN;
 yield `Title: MERLIN CC density / approximately 1 km / trailing ${c.lightningMinutes} min\nThreshold: 999\nFont: 1, 12, 1, "Arial"\n; Counts are detection records, not flashes. Each minute T counts [T-trail,T).\n; Density colors: blue 1-4, cyan 5-19, green 20-49, yellow 50-99, orange 100-249, red 250+.\n`;
 for(let t=a;t<b;t+=MIN){
  const counts=window.counts(t,trail);yield `TimeRange: ${grtime(t)} ${grtime(Math.min(t+MIN,b))}\n`;let total=0;
  if(counts.size)yield 'Triangles:\n';
  for(const [key,n] of counts){total+=n;const [i,j]=key.split(',').map(Number);let cell='';for(const [x,y] of [[i,j],[i+1,j],[i+1,j+1],[i,j],[i+1,j+1],[i,j+1]])cell+=`${(28.5+y/KM_LAT).toFixed(7)}, ${(-80.6+x/KM_LON).toFixed(7)}, ${color(n)}, 90\n`;yield cell;}
  if(counts.size)yield 'End:\n';
  yield `Color: 255 255 255\nText: 28.36, -80.46, 1, "CC density ${grtime(t).slice(11,16)}Z / ${c.lightningMinutes} min / 1 km", "${total} detection records in ${counts.size} occupied cells. End-exclusive window."\n`;
 }
}
export function merlinEntries(c:Config,chunks:MerlinChunk[],includeRaw=true):Entry[]{
 const checked=checkedSources(c,chunks.map(x=>x.source)),window=new DensityWindow();
 let cg=cgHeader(c);
 for(const [i,chunk] of chunks.entries()){
  const s=checked[i],events=parseMerlin(chunk.text,Date.parse(s.start),Date.parse(s.end)).events;
  if(s.type==='CG')cg+=Array.from(cgParts(c,events)).join('');else window.add(events);
 }
 return [{name:'placefiles/merlin_cg.txt',text:cg},{name:'placefiles/merlin_cc_density.txt',text:Array.from(ccParts(c,window)).join('')},...(includeRaw?chunks.map((x,i)=>({name:merlinRawName(x.source,i),text:x.text})):[])];
}
