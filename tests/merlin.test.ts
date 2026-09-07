import assert from 'node:assert/strict';
import { merlinURL,parseMerlin,coordinate,DensityWindow,cellKey,merlinRequests,merlinEntries,fetchMerlin, type MerlinChunk } from '../lib/merlin';
import type { Config } from '../lib/replay';
const c:Config={name:'test',start:'2024-06-25T21:00Z',end:'2024-06-25T21:02Z',radar:'KMLB',layers:['lightning'],windHeight:'54',lightningMinutes:1,profilerHeight:1000};
assert(merlinURL('CC','2024-06-25T20:00Z','2024-06-25T20:05Z').endsWith('BYGZUAABYGZUFAAA'));
assert(merlinURL('CG','2024-06-25T20:00Z','2024-06-25T20:05Z').endsWith('BYGZUAABYGZUFAAAAABaAAA'));
assert(merlinURL('CC','2010-01-02T03:04Z','2010-01-02T03:05Z').endsWith('BKBCDEABKBCDFAAA'));
assert.throws(()=>merlinURL('CC','2024-06-25T20:00Z','2024-06-25T20:06Z'));
assert.equal(coordinate('-81:25:37'),-(81+25/60+37/3600));assert(Number.isNaN(coordinate('28:61:00')));
const header='Date,Time,Latitude,Longitude,Signal Strength\n';
const body=header+'06/25/2024,20:59:00.0000000,28.5,-80.6,0\n06/25/2024,21:00:00.0000001,28.5,-80.6,0\n06/25/2024,21:01:59.9999999,28.5,-80.6,0\n06/25/2024,21:02:00.0000000,28.5,-80.6,0\n';
const parsed=parseMerlin(body,Date.parse('2024-06-25T20:59Z'),Date.parse(c.end));assert.equal(parsed.events.length,3);
const w=new DensityWindow();w.add(parsed.events);assert.equal(w.counts(Date.parse(c.start),60000).get(cellKey(28.5,-80.6)),1);assert.equal(w.counts(Date.parse('2024-06-25T21:01Z'),60000).get(cellKey(28.5,-80.6)),1);
const original=globalThis.fetch;globalThis.fetch=async()=>new Response(body);
try{
 const chunks:MerlinChunk[]=[];for(const r of merlinRequests(c)){const fetched=await fetchMerlin(r);chunks.push({source:fetched.source,text:fetched.text});}
 const entries=merlinEntries(c,chunks),cg=entries.find(x=>x.name==='placefiles/merlin_cg.txt')!.text;assert(cg.includes('TimeRange: 2024-06-25T21:00:01 2024-06-25T21:01:00'));assert(!cg.includes('21:02:01'));
 const cc=entries.find(x=>x.name==='placefiles/merlin_cc_density.txt')!.text;assert.equal((cc.match(/1 detection records in 1 occupied cells/g)||[]).length,2);
 globalThis.fetch=async()=>new Response(body+'\n');await assert.rejects(()=>fetchMerlin(chunks[0].source),/changed/);
}finally{globalThis.fetch=original;}
console.log('PASS: MERLIN tokens, DMS, half-open chunk boundaries, minute trail expiry, future exclusion, submillisecond CG rounding, cached CC cells, source hash consistency.');
