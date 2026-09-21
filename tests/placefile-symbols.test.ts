import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, type Config, type Observation } from '../lib/replay';
import { ccParts, DensityWindow } from '../lib/merlin';

const start=Date.parse('2024-06-25T21:00Z'), MIN=60000;
const config:Config={name:'symbols',start:new Date(start).toISOString().replace('.000Z','Z'),end:new Date(start+30*MIN).toISOString().replace('.000Z','Z'),radar:'KMLB',layers:['fieldmills'],windHeight:'54',lightningMinutes:15,profilerHeight:1000};
const reading=(minute:number,value:number,site='FM01'):Observation=>({time:start+minute*MIN,value,site,lat:site==='FM01'?28.5:28.6,lon:-80.6});
function frames(obs:Observation[]){
 const text=generate('fieldmills',obs,config).entry.text;
 assert(!text.includes('Text:')); assert(text.includes('Polygon:'));
 return text.split('TimeRange: ').slice(1).map(part=>{
  const [a,b]=part.split('\n',1)[0].split(' ');
  return {a:Date.parse(a+'Z'),b:Date.parse(b+'Z'),color:/Color: ([^\n]+)/.exec(part)![1],part};
 });
}
const RED='255 65 65',YELLOW='255 205 35',GREEN='55 230 100';
const colorsAt=(f:ReturnType<typeof frames>,minute:number)=>f.filter(x=>x.a<=start+minute*MIN&&x.b>start+minute*MIN).map(x=>x.color);

test('field circles use magnitude, include pre-start history, and split at exact recovery expiry',()=>{
 const f=frames([reading(-14.5,-1200),reading(0,800),reading(1,-999),reading(2,1000),reading(3,0),reading(4,-1000),reading(5,400)]);
 assert.deepEqual(colorsAt(f,0),[YELLOW]);
 assert.deepEqual(colorsAt(f,0.5),[GREEN]); // No new observation needed to end recovery.
 assert.deepEqual(colorsAt(f,1),[GREEN]);
 assert.deepEqual(colorsAt(f,2),[RED]);
 assert.deepEqual(colorsAt(f,3),[YELLOW]);
 assert.deepEqual(colorsAt(f,4),[RED]);
 assert.deepEqual(colorsAt(f,5),[YELLOW]);
 assert.deepEqual(colorsAt(f,7),[]); // Recovery never prolongs stale measurements.
 assert(f.some(x=>x.part.includes('1-min mean: -1000 V/m'))); // Signed values remain on hover.
 assert(f.every(x=>x.part.includes('Line: 1, 0, "FM01')));
});

test('recovery is station-local, renewed by later exceedances, and excludes future readings',()=>{
 const obs=[reading(-1,1200),reading(0,100),reading(0,800,'FM02'),reading(13,100),reading(14,100),reading(15,1200),reading(16,100),reading(29,100),reading(30,9000)];
 const f=frames(obs);
 assert.deepEqual(colorsAt(f,0).sort(),[YELLOW,GREEN].sort());
 assert.deepEqual(colorsAt(f,13.9),[YELLOW]);
 assert.deepEqual(colorsAt(f,14),[GREEN]);
 assert.deepEqual(colorsAt(f,15),[RED]);
 assert.deepEqual(colorsAt(f,29),[YELLOW]);
 assert(!f.some(x=>x.part.includes('9000 V/m')));
 assert.deepEqual(colorsAt(frames([reading(-16,2000),reading(0,999)]),0),[GREEN]);
});

test('CC uses one opaque, outlined dot per cell with density colors and no map text',()=>{
 const w=new DensityWindow();
 const counts=[1,5,20,50,100,250];
 counts.forEach((n,i)=>w.add(Array.from({length:n},()=>({time:start-MIN,lat:28.5,lon:-80.6+i*0.02,signal:'0'}))));
 // Exact frame time is not yet included in an end-exclusive window.
 w.add([{time:start,lat:29,lon:-81,signal:'0'}]);
 const text=Array.from(ccParts({...config,end:new Date(start+MIN).toISOString().replace('.000Z','Z')},w)).join('');
 assert.equal((text.match(/^Object:/gm)||[]).length,6);
 assert.equal((text.match(/^Polygon:/gm)||[]).length,6);
 assert.equal((text.match(/^Line: 1, 0/gm)||[]).length,6);
 assert(!text.includes('Triangles:')); assert(!text.includes('Text:')); assert(!text.includes('CC density 21:'));
 for(const color of ['50 120 240','30 205 230','115 225 100','245 220 60','250 145 35','240 60 80'])assert(text.includes('Color: '+color));
 assert(text.includes('250 CC detection records')); assert(text.includes('255\nEnd:'));
 const empty=Array.from(ccParts({...config,start:new Date(start+15*MIN).toISOString().replace('.000Z','Z'),end:new Date(start+16*MIN).toISOString().replace('.000Z','Z')},new DensityWindow())).join('');
 assert(!empty.includes('Object:')); assert(!empty.includes('Text:'));
});
