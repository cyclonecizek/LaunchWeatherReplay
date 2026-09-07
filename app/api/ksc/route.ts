import { kscURL, readLimited } from '@/lib/archive';
export async function GET(req:Request){try{
 const p=new URL(req.url).searchParams,u=kscURL(p.get('kind')||'',Number(p.get('group')),p.get('start')||'',p.get('end')||'');
 const r=await fetch(u,{headers:{Accept:'text/csv,text/plain,*/*'},redirect:'manual',signal:AbortSignal.timeout(50000)});
 if(!r.ok)throw Error(`KSC archive returned HTTP ${r.status}. Automatic retrieval did not complete. Retry the request.`);
 const text=await readLimited(r);if(/^\s*</.test(text)||!text.includes('Date'))throw Error('KSC returned a page instead of an observation CSV. Automatic retrieval did not receive observation data.');
 return Response.json({text,url:u},{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
}catch(e){return Response.json({error:e instanceof Error?e.message:'KSC could not be reached. Import an exported CSV.'},{status:502,headers:{'Access-Control-Allow-Origin':'*'}});}}
