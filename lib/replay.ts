import coordinates from './sites-data.json';
export type Kind='winds'|'fieldmills'|'lightning'|'profilers';
export type Config={name:string;start:string;end:string;radar:string;layers:Kind[];windHeight:string;lightningMinutes:number;profilerHeight:number};
export type Entry={name:string;text:string};
export type Observation={time:number;site:string;lat:number;lon:number;value?:number;dir?:number;speed?:number;peak?:number;temp?:number;dew?:number;height?:number;side?:number;type?:string};
export type Report={kind:string;records:number;plotted:number;first:string|null;last:string|null;notes:string[];intervals:[number,number][];sites:number};
export type RadarFile={key:string;size:number;time:string};
const MIN=60000;
export const iso=(t:number)=>new Date(t).toISOString();
export const grtime=(t:number)=>iso(t).slice(0,19);
export function validate(c:Config){
 const a=Date.parse(c.start),b=Date.parse(c.end);
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?Z$/.test(c.start)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?Z$/.test(c.end)||!Number.isFinite(a+b)||b<=a||b-a>12*3600000)throw Error('Choose a valid UTC window between 1 minute and 12 hours.');
 if(new Date(a).toISOString().slice(0,19)!==(c.start.length===17?c.start.slice(0,16)+':00':c.start.slice(0,19))||new Date(b).toISOString().slice(0,19)!==(c.end.length===17?c.end.slice(0,16)+':00':c.end.slice(0,19)))throw Error('Invalid calendar date or time.');
 if(a<Date.UTC(1991,0,1)||b>Date.now()+MIN)throw Error('Choose an archived date, from 1991 through the present.');
 if(!/^[A-Z][A-Z0-9]{3}$/.test(c.radar))throw Error('Enter a four-character radar identifier.');
 if(!Array.isArray(c.layers)||c.layers.some(k=>!['winds','fieldmills','lightning','profilers'].includes(k)))throw Error('Invalid data layer.');
 if(!['surface','lowest','54','200plus'].includes(c.windHeight)||![1,5,10,15,30,45,60].includes(c.lightningMinutes)||![500,1000,2000,3000,5000].includes(c.profilerHeight))throw Error('Invalid display setting.');
 return {a,b};
}
export function csv(text:string):Record<string,string>[] {
 if(text.length>15_000_000)throw Error('CSV exceeds the 15 MB import limit. Split it into shorter windows.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const s=text.replace(/^\uFEFF/,'');
 for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell.trim());cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quoted)throw Error('CSV contains an unterminated quoted field.');
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const heads=rows.shift();if(!heads?.length)throw Error('CSV is empty.');
 if(new Set(heads).size!==heads.length)throw Error('CSV contains duplicate column names.');
 return rows.map((r,i)=>{if(r.length!==heads.length)throw Error(`CSV row ${i+2} has ${r.length} fields; expected ${heads.length}.`);return Object.fromEntries(heads.map((h,j)=>[h,r[j]]));});
}
const num=(s:string|undefined)=>s?.trim()!==''&&s!==undefined&&Number.isFinite(Number(s))?Number(s):undefined;
export function utc(date:string,time:string){
 const m=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(date),n=/^(\d{1,2}):(\d\d)(?::(\d\d)(?:\.(\d+))?)?$/.exec(time);
 if(!m||!n)return NaN;const y=+m[3]<100?2000+(+m[3]):+m[3];const t=Date.UTC(y,+m[1]-1,+m[2],+n[1],+n[2],+(n[3]||0),+(('0.'+(n[4]||0)))*1000),d=new Date(t);
 return d.getUTCFullYear()===y&&d.getUTCMonth()===+m[1]-1&&d.getUTCDate()===+m[2]&&d.getUTCHours()===+n[1]&&d.getUTCMinutes()===+n[2]&&d.getUTCSeconds()===+(n[3]||0)?t:NaN;
}
const required:Record<Kind,string[]>={winds:['Date','Time','SiteName','Height','Average Wind Direction','Average Wind Speed'],fieldmills:['Date','Time','MillNo','OneMinuteMean'],lightning:['time_utc','latitude','longitude','type','quality'],profilers:['time_utc','site','latitude','longitude','height_m_agl','wind_direction_deg','wind_speed_kt','quality']};
export function parse(kind:Kind,text:string):{obs:Observation[];notes:string[];total:number}{
 const rows=csv(text);if(!rows.length)throw Error('CSV has a header but no observations.');
 const missing=required[kind].filter(h=>!(h in rows[0]));if(missing.length)throw Error('Missing columns: '+missing.join(', '));
 const obs:Observation[]=[];let rejected=0;const unknown=new Set<string>();
 for(const r of rows){let o:Observation;
 if(kind==='winds'||kind==='fieldmills'){
  const fields=(r.SiteName||'').split(/\s+/),match=/^(\d{1,4})/.exec(fields[0]);
  const mill=/^(?:FM)?(\d{1,2})(?:\.0+)?$/i.exec(r.MillNo||'');
  const site=kind==='winds'?(match?match[1].padStart(4,'0'):fields[0]):(mill?'FM'+mill[1].padStart(2,'0'):'');
  const loc=(coordinates[kind] as Record<string,number[]>)[site];if(!loc){unknown.add(site||'(blank)');rejected++;continue;}
  o={time:utc(r.Date,r.Time),site,lat:loc[0],lon:loc[1]};
  if(kind==='fieldmills')o.value=num(r.OneMinuteMean);
  else {const compass=new Set(['N','NE','E','SE','S','SW','W','NW']);const sides=fields.slice(1).filter(f=>compass.has(f));Object.assign(o,{height:num(r.Height),dir:num(r['Average Wind Direction']),speed:num(r['Average Wind Speed']),peak:num(r['Peak Wind Speed']),temp:num(r.Temperature),dew:num(r['Dew Point']),side:sides.length>=2?(sides[0]===sides[1]?2:0):1});}
 }else{
  const validISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(r.time_utc);
  o={time:validISO?Date.parse(r.time_utc):NaN,site:r.site||r.type,lat:num(r.latitude)??NaN,lon:num(r.longitude)??NaN};
  if(r.quality.toLowerCase()!=='good'){rejected++;continue;}
  if(kind==='lightning'){o.type=r.type.toUpperCase();o.value=num(r.peak_current_ka);if(!['CG','CC'].includes(o.type)){rejected++;continue;}}
  else Object.assign(o,{height:num(r.height_m_agl),dir:num(r.wind_direction_deg),speed:num(r.wind_speed_kt)});
 }
 if((kind==='lightning'||kind==='profilers')&&Number.isFinite(o.time)&&iso(o.time).slice(0,19)!==r.time_utc.slice(0,19)){rejected++;continue;}
 const badWind=(kind==='winds'||kind==='profilers')&&(o.height===undefined||o.height<0||o.dir===undefined||o.dir<0||o.dir>360||o.speed===undefined||o.speed<0||o.speed>300);
 if(!Number.isFinite(o.time)||!Number.isFinite(o.lat+o.lon)||Math.abs(o.lat)>90||Math.abs(o.lon)>180||badWind||(kind==='fieldmills'&&(o.value===undefined||Math.abs(o.value)>100000))){rejected++;continue;}
 // Preserve signed field values; no interpolation or clipping of accepted measurements.
 obs.push(o);
 }
 const seen=new Set<string>();const unique=obs.filter(o=>{const k=JSON.stringify(o);if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.time-b.time);
 const notes=[];if(rejected)notes.push(`${rejected} invalid, unlocated, or non-good-quality rows excluded.`);if(unknown.size)notes.push('No coordinate match for: '+[...unknown].join(', '));if(unique.length<obs.length)notes.push(`${obs.length-unique.length} exact duplicate rows removed.`);
 if(kind==='winds')notes.push('Tower units follow your existing exporter: ft, knots, and °F. Missing or invalid wind rows are excluded.');
 if(kind==='fieldmills')notes.push('Signed one-minute mean, V/m. Colors are display categories, not launch criteria.');
 if(kind==='lightning')notes.push('Counts are imported detection records, not independently clustered flashes.');
 if(kind==='profilers')notes.push('Imported heights must be meters AGL; only quality=good is accepted.');
 return {obs:unique,notes,total:rows.length};
}
const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'').replace(/\n/g,'\\n');
function header(title:string,barbs=false){return [`Title: ${title}`,'Threshold: 999','Font: 1, 13, 1, "Arial"','; UTC TimeRange. Requires GR placefile v1.5 support; verify in GR2Analyst.',...(barbs?['IconFile: 1, 96, 96, 48, 48, "wind_barb.png"']:[])];}
function display(o:Observation,kind:Kind){
 let hover=`${o.site}\nObservation: ${iso(o.time)}\n`;const out=[`Object: ${o.lat}, ${o.lon}`];
 if(kind==='winds'||kind==='profilers'){
  hover+=`Height: ${o.height} ${kind==='winds'?'ft':'m AGL'}\nWind: ${o.dir} deg at ${o.speed} kt`;
  if(o.peak!==undefined)hover+=`\nPeak: ${o.peak} kt`;
  const h=esc(hover),idx=1+Math.round(Math.min(60,o.speed!)/5);
  out.push('Color: 255 255 255',`Icon: 0, 0, ${o.dir}, 1, ${idx}, "${h}"`,`Text: 0, -23, 1, "${esc(o.site)} ${o.height}${kind==='winds'?'ft':'m'}", "${h}"`);
  if(kind==='profilers')out.push(`Text: 30, 0, 1, "${o.speed?.toFixed(0)}", "${h}"`);
  if(o.temp!==undefined&&o.temp>-100&&o.temp<150)out.push('Color: 255 90 80',`Text: -30, 18, 1, "${o.temp.toFixed(0)}", "${h}"`);
  if(o.dew!==undefined&&o.dew>-100&&o.dew<150)out.push('Color: 70 245 120',`Text: -30, -10, 1, "${o.dew.toFixed(0)}", "${h}"`);
  if(o.peak!==undefined&&o.peak>=0&&o.peak<300)out.push('Color: 255 255 255',`Text: 31, -10, 1, "${o.peak.toFixed(0)}", "${h}"`);
 } else if(kind==='fieldmills'){
  const v=o.value!,color=Math.abs(v)>=1000?'255 65 65':Math.abs(v)>=500?'255 205 35':'55 230 100';
  out.push(`Color: ${color}`,`Text: 0, 0, 1, "${o.site} ${v>=0?'+':''}${v.toFixed(0)}", "${esc(hover+`1-min mean: ${v} V/m`)}"`);
 }else out.push(`Color: ${o.type==='CG'?'255 210 80':'120 210 255'}`,`Text: 0, 0, 1, "${o.type==='CG'?'+':'x'}", "${esc(hover+o.type+(o.value!==undefined?`\nPeak current: ${o.value} kA`:''))}"`);
 out.push('End:');return out;
}
export function generate(kind:Kind,obs:Observation[],c:Config,notes:string[]=[]){
 const {a,b}=validate(c);const hold=kind==='winds'?7*MIN:kind==='fieldmills'?2*MIN:kind==='profilers'?10*MIN:c.lightningMinutes*MIN;
 const candidates=obs.filter(o=>o.time<b&&o.time+hold>a);
 const groups=new Map<string,Observation[]>();
 for(const o of candidates){const key=kind==='lightning'?`${groups.size}`:`${o.site}|${o.time}`;groups.set(key,[...(groups.get(key)||[]),o]);}
 const selected:Observation[]=[];
 for(const group of groups.values()){
  if(kind==='winds'){
   let pool=group;
   if(c.windHeight==='surface')pool=pool.filter(o=>o.height!<=20);
   if(c.windHeight==='54')pool=pool.filter(o=>o.height===54);
   if(c.windHeight==='200plus')pool=pool.filter(o=>o.height!>=200);
   pool.sort((x,y)=>x.height!-y.height!||(y.side||0)-(x.side||0));if(pool[0])selected.push(pool[0]);
  }else if(kind==='profilers'){
   group.sort((x,y)=>Math.abs(x.height!-c.profilerHeight)-Math.abs(y.height!-c.profilerHeight));if(Math.abs(group[0].height!-c.profilerHeight)<=250)selected.push(group[0]);
  }else selected.push(group[group.length-1]);
 }
 const bySite=new Map<string,Observation[]>();for(const o of selected){const k=kind==='lightning'?`${bySite.size}`:o.site;bySite.set(k,[...(bySite.get(k)||[]),o]);}
 const frames:{o:Observation;start:number;end:number}[]=[];
 for(const group of bySite.values()){group.sort((x,y)=>x.time-y.time);for(let i=0;i<group.length;i++){const o=group[i],start=Math.ceil(Math.max(a,o.time)/1000)*1000,end=Math.floor(Math.min(b,o.time+hold,group[i+1]?.time??Infinity)/1000)*1000;if(end>start)frames.push({o,start,end});}}
 frames.sort((x,y)=>x.start-y.start);
 const lines=header(`Replay / ${kind}${kind==='winds'?' / '+c.windHeight:kind==='profilers'?' / '+c.profilerHeight+'m AGL':''}`,kind==='winds'||kind==='profilers');
 const intervals:[number,number][]=[];for(const f of frames){lines.push(`TimeRange: ${grtime(f.start)} ${grtime(f.end)}`,...display(f.o,kind));const last=intervals[intervals.length-1];if(last&&f.start<=last[1])last[1]=Math.max(last[1],f.end);else intervals.push([f.start,f.end]);}
 const report:Report={kind,records:obs.length,plotted:frames.length,first:frames.length?iso(frames.reduce((m,f)=>Math.min(m,f.o.time),Infinity)):null,last:frames.length?iso(frames.reduce((m,f)=>Math.max(m,f.o.time),-Infinity)):null,sites:new Set(frames.map(f=>f.o.site)).size,notes:[...notes,`Maximum display age: ${hold/MIN} minutes; no future observations and no interpolation.`],intervals};
 if(kind==='profilers')report.notes.push(`Nearest height to ${c.profilerHeight} m AGL within 250 m; the actual height is labeled.`);
 if(!frames.length)report.notes.push('No plottable data overlaps this window and layer selection.');
 return {entry:{name:`placefiles/${kind}.txt`,text:lines.join('\n')+'\n'},report};
}
export function probe(files:RadarFile[],c:Config):Entry{
 const {b}=validate(c),lines=header('REPLAY CLOCK CHECK');
 files.forEach((f,i)=>{const t=Date.parse(f.time),end=Math.min(b,files[i+1]?Date.parse(files[i+1].time):b);if(end>t)lines.push(`TimeRange: ${grtime(t)} ${grtime(end)}`,'Color: 255 255 255',`Text: 28.45, -80.55, 1, "REPLAY ${grtime(t).slice(11)} UTC", "Confirm this label changes with the selected radar time."`);});
 return {name:'placefiles/replay_clock_check.txt',text:lines.join('\n')+'\n'};
}
export const templates:Record<string,string>={lightning:'time_utc,latitude,longitude,type,peak_current_ka,quality\n',profilers:'time_utc,site,latitude,longitude,height_m_agl,wind_direction_deg,wind_speed_kt,quality\n'};
