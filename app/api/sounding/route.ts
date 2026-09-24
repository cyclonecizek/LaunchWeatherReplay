import { readLimited } from '@/lib/archive';
import { fetchNearestSounding } from '@/lib/sounding';
export async function GET(req:Request){try{
 const target=Number(new URL(req.url).searchParams.get('time'));
 if(!Number.isFinite(target))throw Error('Missing or invalid sounding target time.');
 const sounding=await fetchNearestSounding(target,async url=>{
  const r=await fetch(url,{headers:{Accept:'text/html,*/*'},signal:AbortSignal.timeout(15000)});
  if(!r.ok){
   const body=await readLimited(r,2000).catch(()=>'');
   throw Error(`HTTP ${r.status} for ${url}${body?`: ${body.replace(/\s+/g,' ').trim().slice(0,200)}`:''}`);
  }
  return readLimited(r,3_000_000);
 });
 return Response.json({sounding},{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
}catch(e){return Response.json({error:e instanceof Error?e.message:'Sounding retrieval failed.'},{status:502,headers:{'Access-Control-Allow-Origin':'*'}});}}
