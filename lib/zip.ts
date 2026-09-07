// Streaming ZIP, STORE method with data descriptors. No full radar volume buffering.
export type ZipFile={name:string;data:()=>Promise<ReadableStream<Uint8Array>|Uint8Array>};
const enc=new TextEncoder();const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
const header=(length:number)=>{const a=new Uint8Array(length);return {a,v:new DataView(a.buffer)};};
export function zipStream(files:ZipFile[],signal?:AbortSignal){
 async function* chunks(){let offset=0;const central:Uint8Array[]=[];
 for(const file of files){if(signal?.aborted)throw Error('Download cancelled.');if(!/^[a-zA-Z0-9_./-]+$/.test(file.name)||file.name.includes('..')||file.name.startsWith('/'))throw Error('Unsafe ZIP entry path.');
 const source=await file.data(),name=enc.encode(file.name),local=header(30+name.length),at=offset;local.v.setUint32(0,0x04034b50,true);local.v.setUint16(4,20,true);local.v.setUint16(6,0x808,true);local.v.setUint16(12,0x21,true);local.v.setUint16(26,name.length,true);local.a.set(name,30);yield local.a;offset+=local.a.length;
 let crc=0xffffffff,size=0;const reader=source instanceof Uint8Array?null:source.getReader();
 const emit=(part:Uint8Array)=>{for(const byte of part)crc=table[(crc^byte)&255]^(crc>>>8);size+=part.length;offset+=part.length;if(size>=0xffffffff||offset>=0xffff0000)throw Error('ZIP exceeds the 4 GB format limit.');};
 if(source instanceof Uint8Array){emit(source);yield source;}else if(reader){try{while(true){if(signal?.aborted)throw Error('Download cancelled.');const {value,done}=await reader.read();if(done)break;emit(value);yield value;}}finally{await reader.cancel().catch(()=>{});}}
 crc=(crc^0xffffffff)>>>0;const desc=header(16);desc.v.setUint32(0,0x08074b50,true);desc.v.setUint32(4,crc,true);desc.v.setUint32(8,size,true);desc.v.setUint32(12,size,true);yield desc.a;offset+=16;
 const c=header(46+name.length);c.v.setUint32(0,0x02014b50,true);c.v.setUint16(4,20,true);c.v.setUint16(6,20,true);c.v.setUint16(8,0x808,true);c.v.setUint16(14,0x21,true);c.v.setUint32(16,crc,true);c.v.setUint32(20,size,true);c.v.setUint32(24,size,true);c.v.setUint16(28,name.length,true);c.v.setUint32(42,at,true);c.a.set(name,46);central.push(c.a);
 }
 const start=offset;for(const c of central){yield c;offset+=c.length;}const end=header(22);end.v.setUint32(0,0x06054b50,true);end.v.setUint16(8,central.length,true);end.v.setUint16(10,central.length,true);end.v.setUint32(12,offset-start,true);end.v.setUint32(16,start,true);yield end.a;
 }
 const iterator=chunks();return new ReadableStream<Uint8Array>({async pull(controller){try{const r=await iterator.next();if(r.done)controller.close();else controller.enqueue(r.value);}catch(e){controller.error(e);await iterator.return(undefined);}},async cancel(){await iterator.return(undefined);}});
}
