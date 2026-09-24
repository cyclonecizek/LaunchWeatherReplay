import { readLimited } from '@/lib/archive';
import { soundingQuerySpecs, soundingURL, parseSoundingPage, nearestSounding } from '@/lib/sounding';
export async function GET(req:Request){try{
 const target=Number(new URL(req.url).searchParams.get('time'));
 if(!Number.isFinite(target))throw Error('Missing or invalid sounding target time.');
 const specs=soundingQuerySpecs(target);
 const pages=await Promise.all(specs.map(async s=>{
  const r=await fetch(soundingURL(s),{headers:{Accept:'text/html,*/*'},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`Sounding archive returned HTTP ${r.status}. Automatic retrieval did not complete.`);
  return parseSoundingPage(await readLimited(r,3_000_000),s);
 }));
 const sounding=nearestSounding(pages.flat(),target);
 if(!sounding)throw Error('No KXMR (74794) sounding was found within 24 hours of the requested time.');
 return Response.json({sounding},{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
}catch(e){return Response.json({error:e instanceof Error?e.message:'Sounding retrieval failed.'},{status:502,headers:{'Access-Control-Allow-Origin':'*'}});}}
