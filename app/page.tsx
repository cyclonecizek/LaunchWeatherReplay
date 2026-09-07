"use client";
import { useRef, useState } from 'react';
import { Radar, Wind, Zap, Layers, Download, FileArchive, Clock3, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { generate, parse, probe, templates, validate, type Config, type Entry, type Kind, type Observation, type RadarFile, type Report } from '@/lib/replay';
import { merlinRequests, type MerlinSource } from '@/lib/merlin';
const layers:{key:Kind;name:string;detail:string;icon:typeof Wind;mode:string}[]=[
 {key:'winds',name:'Wind towers',detail:'Surface, 54 ft, lowest available, or 200+ ft.',icon:Wind,mode:'AUTO · 2024/2026'},
 {key:'fieldmills',name:'Field mills',detail:'Signed one-minute electric field, V/m.',icon:Zap,mode:'AUTO · 2024/2026'},
 {key:'lightning',name:'MERLIN lightning',detail:'Individual CG detections and grouped CC density, with up to a one-hour trail.',icon:Zap,mode:'AUTO · 2024/2026'},
];
type Source={kind:string;source:string};
type Prepared={config:Config;entries:Entry[];radar:RadarFile[];reports:Report[];missing:string[];sources:Source[];merlin?:MerlinSource[]};
const BACKEND=typeof window!=='undefined'&&window.location.hostname.endsWith('.github.io')?'https://launch-weather-replay.bciz392.chatgpt.site':'';
const mb=(n:number)=>n>=1e9?(n/1e9).toFixed(2)+' GB':(n/1e6).toFixed(1)+' MB';
const fmt=(s:string|null)=>s?new Date(s).toISOString().slice(11,19)+' UTC':'No data';
const addMinutes=(value:string,minutes:number)=>new Date(Date.parse(value+'Z')+minutes*60000).toISOString().slice(0,16);
function Choice({value,change,items,label}:{value:string;change:(s:string)=>void;items:[string,string][];label:string}){return <Select value={value} onValueChange={change}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{items.map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>;}
function DateTime24({id,label,value,change}:{id:string;label:string;value:string;change:(s:string)=>void}){
 const [date='',clock='00:00']=value.split('T'),[hour='00',minute='00']=clock.split(':');
 const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,'0')),minutes=Array.from({length:60},(_,i)=>String(i).padStart(2,'0'));
 return <div className="date-time-field" role="group" aria-labelledby={`${id}-label`}><span id={`${id}-label`}>{label} · UTC (24-hour)</span><div className="date-time-row"><Input aria-label={`${label} date`} type="date" value={date} onChange={e=>change(`${e.target.value}T${hour}:${minute}`)}/><div className="clock24"><select aria-label={`${label} hour, 00 through 23`} value={hour} onChange={e=>change(`${date}T${e.target.value}:${minute}`)}>{hours.map(v=><option key={v} value={v}>{v}</option>)}</select><span aria-hidden="true">:</span><select aria-label={`${label} minute`} value={minute} onChange={e=>change(`${date}T${hour}:${e.target.value}`)}>{minutes.map(v=><option key={v} value={v}>{v}</option>)}</select><span className="utc-mark">Z</span></div></div></div>;
}
export default function Home(){
 const [name,setName]=useState('Cape weather scenario'),[start,setStart]=useState('2024-06-25T21:00'),[end,setEnd]=useState('2024-06-25T23:00'),[radar,setRadar]=useState('KMLB');
 const [selected,setSelected]=useState<Kind[]>(['winds','fieldmills','lightning']);
 const [windHeight,setWindHeight]=useState('54'),[lightningMinutes,setLightningMinutes]=useState('60'),[profilerHeight,setProfilerHeight]=useState('1000');
 const [uploads,setUploads]=useState<Partial<Record<Kind,File[]>>>({}),[prepared,setPrepared]=useState<Prepared|null>(null),[errors,setErrors]=useState<string[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[progress,setProgress]=useState(0),[partial,setPartial]=useState(false),[submitted,setSubmitted]=useState(false);
 const abort=useRef<AbortController|null>(null);
 const reset=()=>{setPrepared(null);setErrors([]);setPartial(false);setSubmitted(false);setStatus('');};
 const update=(fn:()=>void)=>{reset();fn();};
 const changeStart=(value:string)=>update(()=>{setStart(value);if(value&&end&&Date.parse(end+'Z')<=Date.parse(value+'Z'))setEnd(addMinutes(value,60));});
 const changeEnd=(value:string)=>update(()=>setEnd(value&&start&&Date.parse(value+'Z')<=Date.parse(start+'Z')?addMinutes(start,60):value));
 async function api(path:string,params:Record<string,string>,signal:AbortSignal){const r=await fetch(BACKEND+path+'?'+new URLSearchParams(params),{signal});const data=await r.json();if(!r.ok||data.error)throw Error(data.error||'Source request failed.');return data;}
 async function prepare(){
  reset();setBusy(true);setProgress(0);const controller=new AbortController();abort.current=controller;
  const c:Config={name,start:start+'Z',end:end+'Z',radar:radar.toUpperCase(),layers:selected,windHeight,lightningMinutes:Number(lightningMinutes),profilerHeight:Number(profilerHeight)};
  const result:Prepared={config:c,entries:[],radar:[],reports:[],missing:[],sources:[]},issues:string[]=[];
  try{
   const {a,b}=validate(c);setStatus('Finding archived Level II volumes…');
   result.radar=(await api('/api/radar',{start:c.start,end:c.end,radar:c.radar},controller.signal)).files;
   if(!result.radar.length)throw Error('No radar volumes found for this site and time window. Check the radar identifier and dates.');
   const size=result.radar.reduce((s,f)=>s+f.size,0);if(size>2e9)throw Error('Radar alone exceeds 2 GB. Choose a shorter time window.');
   result.sources.push({kind:'radar',source:'https://registry.opendata.aws/noaa-nexrad/'});
   setProgress(15);
   for(let i=0;i<c.layers.length;i++){
    const kind=c.layers[i],label=layers.find(l=>l.key===kind)!.name,files=uploads[kind]||[];let obs:Observation[]=[],notes:string[]=[],failed=false;
    try{
     if(files.length){
      for(let j=0;j<files.length;j++){
       if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');setStatus(`Reading ${label}: ${files[j].name}`);
       if(files[j].size>5_000_000)throw Error('Each uploaded CSV must be under 5 MB.');
       const text=await files[j].text(),parsed=parse(kind,text);obs.push(...parsed.obs);notes.push(...parsed.notes);
       result.entries.push({name:`raw/${kind}-import-${j+1}.csv`,text});result.sources.push({kind,source:'Imported file: '+files[j].name});
      }
     }else if(kind==='winds'||kind==='fieldmills'){
      if(![2024,2026].includes(new Date(a).getUTCFullYear())||![2024,2026].includes(new Date(b).getUTCFullYear()))throw Error('Automatic KSC date encoding is currently checked for 2024 and 2026.');
      const lookback=kind==='winds'?7*60000:2*60000;let chunk=0;
      // Include antecedent observations at the start, splitting at UTC New Year.
      const begin=Math.max(a-lookback,Date.UTC(new Date(a).getUTCFullYear(),0,1));
      for(let t=begin;t<b;t+=3600000){
       chunk++;setStatus(`Fetching ${label}, hour ${chunk} of ${Math.ceil((b-begin)/3600000)}…`);
       const responses=await Promise.allSettled(Array.from({length:kind==='winds'?4:1},(_,g)=>api('/api/ksc',{kind,group:String(g),start:new Date(t).toISOString(),end:new Date(Math.min(b,t+3600000)).toISOString()},controller.signal)));
       let good=0;
       for(let g=0;g<responses.length;g++){
        const response=responses[g];if(response.status==='rejected'){failed=true;notes.push(`Hour ${chunk}, group ${g+1}: ${response.reason instanceof Error?response.reason.message:'Fetch failed'}`);continue;}
        const parsed=parse(kind,response.value.text);obs.push(...parsed.obs);notes.push(...parsed.notes);good++;
        result.entries.push({name:`raw/${kind}-hour-${chunk}-group-${g+1}.csv`,text:response.value.text});result.sources.push({kind,source:response.value.url});
       }
       if(!good){failed=true;break;}
      }
     }else if(kind==='lightning'){
      const requests=merlinRequests(c),sources:MerlinSource[]=[];
      for(let j=0;j<requests.length;j++){
       const request=requests[j];setStatus(`Fetching MERLIN ${request.type}, interval ${j+1} of ${requests.length}…`);
       sources.push(await api('/api/merlin',request,controller.signal));
       setProgress(15+80*(i+(j+1)/requests.length)/c.layers.length);
      }
      const count=sources.reduce((n,s)=>n+s.records,0),rejected=sources.reduce((n,s)=>n+s.rejected,0);
      result.merlin=sources;result.sources.push(...sources.map(s=>({kind:'lightning',source:s.url})));
      result.reports.push({kind,records:count,plotted:count,first:requests[0].start,last:c.end,sites:2,intervals:[],notes:[`Retrieved ${sources.filter(s=>s.type==='CG').reduce((n,s)=>n+s.records,0).toLocaleString()} CG and ${sources.filter(s=>s.type==='CC').reduce((n,s)=>n+s.records,0).toLocaleString()} CC records, including the ${c.lightningMinutes}-minute lookback.`,`${rejected} invalid records excluded. No invented quality flag or flash identification.`,`CC: approximately 1 km cells, refreshed every minute, counting [frame time minus trail, frame time). Colors show record density; observations may take up to one minute to appear or expire.`,`CG: individual markers, expiring after ${c.lightningMinutes} minutes.`,`All archive intervals responded. Empty results do not establish sensor uptime. ZIP generation rechecks the source hashes and stops if data change.`]});
      setProgress(15+80*(i+1)/c.layers.length);continue;
     }else throw Error('Unsupported source.');
     const seen=new Set<string>();obs=obs.filter(o=>{const key=JSON.stringify(o);if(seen.has(key))return false;seen.add(key);return true;});
     const generated=generate(kind,obs,c,[...new Set(notes)]);result.reports.push(generated.report);
     if(generated.report.plotted)result.entries.push(generated.entry);else failed=true;
     if(failed){result.missing.push(label);issues.push(`${label}: incomplete or unavailable. ${notes.find(n=>n.includes('HTTP')||n.includes('failed'))||'Review the coverage notes.'}`);}
    }catch(e){if(controller.signal.aborted)throw e;result.missing.push(label);issues.push(`${label}: ${e instanceof Error?e.message:'Unable to prepare source.'}`);}
    setProgress(15+80*(i+1)/Math.max(1,c.layers.length));
   }
   if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
   result.entries.push(probe(result.radar,c));
   if(result.entries.reduce((n,e)=>n+e.text.length,0)>20e6)throw Error('Observation files exceed 20 MB. Choose a shorter window.');
   setPrepared(result);setErrors(issues);setStatus(result.missing.length?'Coverage checked. Some selected sources are missing or incomplete.':'Selected sources prepared. Review coverage before downloading.');setProgress(100);
  }catch(e){setErrors([controller.signal.aborted?'Preparation cancelled.':e instanceof Error?e.message:'Unable to prepare scenario.']);setStatus('');}
  finally{setBusy(false);abort.current=null;}
 }
 function download(){if(!prepared)return;const form=document.createElement('form');form.method='POST';form.action=BACKEND+'/api/bundle';form.target='_blank';const input=document.createElement('input');input.type='hidden';input.name='payload';input.value=JSON.stringify(prepared);form.append(input);document.body.append(form);form.submit();form.remove();setSubmitted(true);}
 function template(kind:string){const url=URL.createObjectURL(new Blob([templates[kind]],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=kind+'-import-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 const duration=(Date.parse(end+'Z')-Date.parse(start+'Z'))/3600000;
 const ordered=Number.isFinite(duration)&&duration>0;
 const bytes=prepared?.radar.reduce((s,f)=>s+f.size,0)||0;
 return <main className="workspace">
  <header><div className="brand"><Radar size={25}/><span>LAUNCH WEATHER / REPLAY</span></div><span className="tag">GR2Analyst · archive mode</span></header>
  <div className="title-row"><p className="eyebrow">SCENARIO BUILDER</p><h1>Bring the countdown back.</h1><p className="intro">Archived radar and local observations, on one UTC timeline.</p></div>
  <div className="work-grid"><div className="stack"><fieldset disabled={busy} className="panel" style={{minWidth:0}}>
   <h2><span className="step">01</span> Define the scenario</h2>
   <label>Scenario name<Input maxLength={100} value={name} onChange={e=>update(()=>setName(e.target.value))}/></label>
   <div className="two-col"><DateTime24 id="start" label="Start" value={start} change={changeStart}/><DateTime24 id="end" label="End" value={end} change={changeEnd}/></div>
   <label>Radar identifier<Input maxLength={4} value={radar} onChange={e=>update(()=>setRadar(e.target.value.toUpperCase()))} placeholder="KMLB" spellCheck={false}/></label>
   <p className="note">KMLB is Melbourne NEXRAD. Times use 24-hour UTC. If the start moves to or beyond the end, the end automatically moves one hour later. Windows may be up to 12 hours and 2 GB per package.</p>
   <h2 style={{marginTop:28}}><span className="step">02</span> Choose local observations</h2>
   <div className="notice">Radar, towers, and field mills request archive data automatically. KSC requests support 2024 and 2026; source availability is checked below. MERLIN CG and CC are retrieved automatically, including the selected lookback. GR playback needs validation.</div>
   {layers.map(layer=>{const checked=selected.includes(layer.key);return <div className="source" key={layer.key}><div className="source-head"><Checkbox id={layer.key} checked={checked} onCheckedChange={v=>update(()=>setSelected(v?[...selected,layer.key]:selected.filter(k=>k!==layer.key)))}/><layer.icon size={18}/><label htmlFor={layer.key}>{layer.name}</label><span className="status">{uploads[layer.key]?.length?'FILE IMPORT':layer.mode}</span></div><p>{layer.detail}</p>{checked&&<>
    {layer.key==='winds'&&<div className="source-settings"><label>Wind height<Choice label="Wind height" value={windHeight} change={v=>update(()=>setWindHeight(v))} items={[["surface","Surface · ≤20 ft"],["lowest","Lowest available"],["54","54 ft"],["200plus","Lowest ≥200 ft"]]}/></label></div>}
    {layer.key==='lightning'&&<div className="source-settings"><label>Detection trail<Choice label="Lightning trail" value={lightningMinutes} change={v=>update(()=>setLightningMinutes(v))} items={['1','5','10','15','30','45','60'].map(v=>[v,v+' minutes'])}/></label></div>}
    {layer.key==='profilers'&&<div className="source-settings"><label>Target height · AGL<Choice label="Profiler height" value={profilerHeight} change={v=>update(()=>setProfilerHeight(v))} items={['500','1000','2000','3000','5000'].map(v=>[v,v+' meters'])}/></label></div>}
    <input type="file" multiple accept=".csv,text/csv" aria-label={`Import ${layer.name} CSV files`} onChange={e=>update(()=>setUploads({...uploads,[layer.key]:Array.from(e.target.files||[])}))}/>
    <p>{layer.key==='winds'||layer.key==='fieldmills'?'Optional: upload KSC export CSVs to use instead of automatic retrieval.':layer.key==='lightning'?'Automatic retrieval is the default. Optional normalized CSV imports use individual detection markers.':<><button type="button" onClick={()=>template(layer.key)} style={{textDecoration:'underline',color:'#8cdafa'}}>Download CSV header template</button> · Map your archive export to these columns before importing.</>}</p>
    {uploads[layer.key]?.length?<p>{uploads[layer.key]!.length} file(s) selected · <button type="button" onClick={()=>update(()=>setUploads({...uploads,[layer.key]:[]}))} style={{textDecoration:'underline'}}>Use default source</button></p>:null}
    {layer.key==='lightning'&&<details><summary>Lightning import requirements</summary><p>UTC ISO timestamps ending in Z; decimal latitude/longitude; type CG or CC; quality good for accepted rows. Optional peak_current_ka. These are detection records. The importer does not identify or combine flashes.</p></details>}
    {layer.key==='profilers'&&<details><summary>Profiler import requirements</summary><p>UTC ISO timestamps ending in Z; site, latitude, longitude, height_m_agl, wind_direction_deg, wind_speed_kt, quality. Accepted rows require quality good. Nearest level within 250 m of the target is shown; no vertical interpolation. Do not relabel MSL heights as AGL.</p></details>}
   </>}</div>;})}
  </fieldset></div>
  <div className="stack"><section className="panel">
   <h2><span className="step">03</span> Check coverage & download</h2>
   <div className="metrics"><div><p className="small-title">REQUESTED WINDOW</p><div className="summary" style={{margin:0}}><div className="big">{Number.isFinite(duration)&&duration>0?duration.toFixed(1):'—'} <span style={{fontSize:18}}>hours</span></div><div className="metric-label">All timestamps in UTC</div></div></div><div><p className="small-title">RADAR SOURCE</p><div className="summary" style={{margin:0}}><div className="big">{radar||'—'}</div><div className="metric-label">Archived Level II volumes</div></div></div></div>
   <Button className="action" onClick={prepare} disabled={busy||!ordered}>{busy?'Checking sources…':prepared?'Refresh coverage':'Check coverage'}<ArrowRight size={18}/></Button>
   {!ordered&&<p className="error" role="alert" style={{marginTop:18}}>End time must be after the start time.</p>}
   {busy&&<Button variant="outline" className="secondary-action" onClick={()=>abort.current?.abort()}>Cancel</Button>}
   <div aria-live="polite">{status&&<p className="log">{status}</p>}{busy&&<Progress value={progress} aria-label="Source preparation progress" style={{marginTop:12}}/>}</div>
   {!!errors.length&&<div className="error" role="alert" style={{marginTop:18}}>{errors.join('\n\n')}</div>}
   {prepared&&<><div className="summary"><div className="metrics"><div><div className="big">{prepared.radar.length}</div><div className="metric-label">Radar volumes found</div></div><div><div className="big">{mb(bytes)}</div><div className="metric-label">Radar size, before observations</div></div></div><div className="timeline" aria-label="Radar volume start times within the requested interval">{prepared.radar.map(f=><div key={f.key} style={{left:100*(Date.parse(f.time)-Date.parse(prepared.config.start))/(Date.parse(prepared.config.end)-Date.parse(prepared.config.start))+'%',width:2}}/>)}</div><p className="note">First {fmt(prepared.radar[0]?.time)} · Last {fmt(prepared.radar.at(-1)?.time||null)}</p><p className="note">Ticks mark volume starts. Radar volumes span several minutes.</p></div>
   {prepared.reports.map(r=><div className="result" key={r.kind}><b>{layers.find(l=>l.key===r.kind)?.name}</b><p>{r.plotted.toLocaleString()} {r.kind==='lightning'&&prepared.merlin?'retrieved records, including lookback':'plotted records'} · {r.sites} {r.kind==='lightning'?'detection types':'sites'}<br/>{fmt(r.first)} to {fmt(r.last)}</p><details><summary>Coverage and time rules</summary>{r.notes.map((n,i)=><p key={i}>{n}</p>)}<p>Intervals with at least one displayed record: {r.intervals.length}. This does not establish complete network coverage.</p></details></div>)}
   {!!prepared.missing.length&&<label style={{display:'flex',alignItems:'flex-start',gap:10,marginTop:20}}><Checkbox checked={partial} onCheckedChange={v=>setPartial(v===true)}/>Download the available data as a partial scenario; list missing sources in the package.</label>}
   <Button className="action" disabled={prepared.missing.length>0&&!partial} onClick={download}><Download size={18}/>{prepared.missing.length?'Download partial scenario':'Download scenario ZIP'}</Button>
   {submitted&&<p className="note" role="status">Download requested in a new tab. Radar and automatic MERLIN placefiles stream into the ZIP. Large lightning scenarios can take several minutes. After it finishes, extract it and confirm manifest.json is present. If a source error appears, refresh coverage and retry.</p>}
   </>}
   {!prepared&&<div className="summary"><div className="zip-list"><FileArchive size={24}/><div><p style={{margin:0,color:'#e0eef9'}}>One folder for the replay</p><p className="note">Radar volumes, time-windowed placefiles, raw observations, and a coverage manifest.</p></div></div><ul className="files"><li><span>radar/</span> original Level II files</li><li><span>placefiles/</span> selected layers + clock check</li><li><span>raw/</span> source observations</li><li><span>manifest.json</span> time rules & missing data</li><li><span>README.txt</span> GR loading instructions</li></ul></div>}
  </section><section className="panel"><h2><Clock3 size={19} color="#88d8f5"/> One replay clock</h2><p>Each observation receives a UTC validity window. The intended behavior is for GR to select the appropriate observations as you play, pause, or step through archived radar.</p><p className="note">Towers expire after 7 minutes, mills after 2, or sooner when replaced. Lightning uses your selected trail. Future observations are excluded, and gaps remain visible.</p><div className="notice">Start with replay_clock_check.txt in GR. It is included to verify time matching on your installed version before relying on synchronized playback.</div><p className="note">After downloading: extract the ZIP, run FIX_ICON_PATHS.cmd once, open the radar files, and add the local placefiles in GR’s Placefile Manager.</p></section></div>
  </div>
  <footer className="footer">Sources: <a href="https://registry.opendata.aws/noaa-nexrad/" target="_blank" rel="noreferrer">Unidata NEXRAD archive</a> · <a href="https://kscweather.ksc.nasa.gov/wxarchive/" target="_blank" rel="noreferrer">KSC Spaceport Weather Archive</a><br/>Station locations and wind icons reuse your existing placefile assets. Imported files are processed in this page and included in the requested download; scenarios are not saved as a server-side catalog.</footer>
 </main>;
}
