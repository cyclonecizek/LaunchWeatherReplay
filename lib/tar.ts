export type TarFile={name:string;size:number;data:()=>Promise<ReadableStream<Uint8Array>|Uint8Array>};
const enc=new TextEncoder();
const octal=(value:number,length:number)=>value.toString(8).padStart(length-1,'0').slice(-(length-1))+'\0';
const put=(header:Uint8Array,offset:number,length:number,value:string)=>header.set(enc.encode(value).subarray(0,length),offset);
function pathParts(path:string){
 const bytes=enc.encode(path);if(bytes.length<=100)return {name:path,prefix:''};
 for(let i=path.lastIndexOf('/');i>0;i=path.lastIndexOf('/',i-1)){const prefix=path.slice(0,i),name=path.slice(i+1);if(enc.encode(prefix).length<=155&&enc.encode(name).length<=100)return {name,prefix};}
 throw Error(`TAR path is too long: ${path}`);
}
function tarHeader(file:TarFile){
 if(!/^[a-zA-Z0-9_./-]+$/.test(file.name)||file.name.includes('..')||file.name.startsWith('/'))throw Error('Unsafe TAR entry path.');
 if(!Number.isSafeInteger(file.size)||file.size<0)throw Error('Invalid TAR entry size.');
 const h=new Uint8Array(512),{name,prefix}=pathParts(file.name);put(h,0,100,name);put(h,100,8,'0000644\0');put(h,108,8,'0000000\0');put(h,116,8,'0000000\0');put(h,124,12,octal(file.size,12));put(h,136,12,'00000000000\0');h.fill(32,148,156);h[156]=48;put(h,257,6,'ustar\0');put(h,263,2,'00');put(h,345,155,prefix);const sum=h.reduce((n,v)=>n+v,0);put(h,148,8,sum.toString(8).padStart(6,'0')+'\0 ');return h;
}
export function tarStream(files:TarFile[],signal?:AbortSignal){
 async function* chunks(){for(const file of files){signal?.throwIfAborted();yield tarHeader(file);const source=await file.data();let count=0;if(source instanceof Uint8Array){count=source.length;yield source;}else{const reader=source.getReader();try{while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;count+=value.length;if(count>file.size)throw Error(`TAR entry exceeded its declared size: ${file.name}`);yield value;}}finally{await reader.cancel().catch(()=>{});}}if(count!==file.size)throw Error(`Incomplete TAR entry: ${file.name}`);const padding=(512-count%512)%512;if(padding)yield new Uint8Array(padding);}yield new Uint8Array(1024);}
 const iterator=chunks();return new ReadableStream<Uint8Array>({async pull(controller){try{const r=await iterator.next();if(r.done)controller.close();else controller.enqueue(r.value);}catch(e){controller.error(e);await iterator.return(undefined);}},async cancel(){await iterator.return(undefined);}});
}
