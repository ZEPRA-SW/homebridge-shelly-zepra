'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CloudScheduler}=require('../lib/cloud-queue');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){let now=0,id=0;const timers=new Map();const scheduler=new CloudScheduler({now:()=>now,setTimer:(fn,ms)=>{const n=++id;timers.set(n,{fn,at:now+ms});return n;},clearTimer:n=>timers.delete(n)});
 return{scheduler,async advance(ms){now+=ms;for(let i=0;i<10;i++){const due=[...timers].filter(([,v])=>v.at<=now);for(const[n,v]of due){timers.delete(n);v.fn();}await turn();}},now:()=>now};}
test('same account shares spacing while another cloud server has its own budget',async()=>{
 const f=fixture(),a=f.scheduler.limiter('https://shelly-a.shelly.cloud','one-key'),same=f.scheduler.limiter('https://shelly-a.shelly.cloud','one-key'),b=f.scheduler.limiter('https://shelly-b.shelly.cloud','one-key');const times=[];
 const p1=a.run(()=>times.push(['a',f.now()]));const p2=same.run(()=>times.push(['a2',f.now()]));const p3=b.run(()=>times.push(['b',f.now()]));await turn();await turn();assert.deepEqual(times,[['a',0],['b',0]]);
 await f.advance(2000);await Promise.all([p1,p2,p3]);assert.deepEqual(times,[['a',0],['b',0],['a2',2000]]);f.scheduler.close();
});
test('different keys on the same server remain distinct and keys never appear in state',async()=>{
 const f=fixture(),a=f.scheduler.limiter('https://shelly-a.shelly.cloud','SENTINEL-SECRET-A'),b=f.scheduler.limiter('https://shelly-a.shelly.cloud','SENTINEL-SECRET-B');await Promise.all([a.run(()=>1),b.run(()=>2)]);assert.equal(f.scheduler.accounts.size,2);assert.doesNotMatch(JSON.stringify([...f.scheduler.accounts]),/SENTINEL/);f.scheduler.close();
});
test('equivalent pending reads are coalesced and priority stop goes before polling',async()=>{
 const f=fixture(),q=f.scheduler.limiter('server','key'),calls=[];await q.run(()=>calls.push('first'));
 const a=q.run(()=>{calls.push('read');return 7;},{kind:'read',coalesceKey:'device'});const b=q.run(()=>{throw Error('duplicate');},{kind:'read',coalesceKey:'device'});assert.equal(a,b);
 const stop=q.run(()=>calls.push('stop'),{priority:100});await f.advance(2000);await stop;assert.deepEqual(calls,['first','stop']);await f.advance(2000);assert.equal(await a,7);f.scheduler.close();
});
test('repeated 429 pauses increase and do not block another cloud server',async()=>{
 const f=fixture(),a=f.scheduler.limiter('a','key'),b=f.scheduler.limiter('b','key');a.defer(30000);const events=[];const p=a.run(()=>events.push('a'));await b.run(()=>events.push('b'));assert.deepEqual(events,['b']);await f.advance(30000);await p;a.defer(30000);const p2=a.run(()=>events.push('a2'));await f.advance(30000);assert.deepEqual(events,['b','a']);await f.advance(30000);await p2;assert.deepEqual(events,['b','a','a2']);f.scheduler.close();
});
test('failed writes are not replayed and shutdown rejects unsent jobs',async()=>{
 const f=fixture(),q=f.scheduler.limiter('a','key');let writes=0;await assert.rejects(q.run(()=>{writes++;throw Error('write failed');}));assert.equal(writes,1);const pending=q.run(()=>{writes++;});const check=assert.rejects(pending,/beendet/);f.scheduler.close();await check;await f.advance(10000);assert.equal(writes,1);
});

test('cancelled buffered command is discarded during backoff without consuming another slot',async()=>{
 const f=fixture(),q=f.scheduler.limiter('a','key');q.defer(30000);let allowed=true,writes=0;
 const p=q.run(()=>{writes++;},{allowed:()=>allowed});const rejected=assert.rejects(p,{code:'COMMAND_CANCELLED'});
 allowed=false;q.wake();await rejected;await f.advance(30000);assert.equal(writes,0);f.scheduler.close();
});
test('cancellation is rechecked when a waiting timer expires',async()=>{
 const f=fixture(),q=f.scheduler.limiter('a','key');await q.run(()=>1);let allowed=true,writes=0;
 const p=q.run(()=>{writes++;},{allowed:()=>allowed});const rejected=assert.rejects(p,{code:'COMMAND_CANCELLED'});
 allowed=false;await f.advance(2000);await rejected;assert.equal(writes,0);f.scheduler.close();
});

test('server cooldown header supports seconds and HTTP dates',()=>{
 const {retryDelay}=require('../lib/cloud-queue'),now=Date.parse('2026-11-12T10:00:00Z');
 assert.equal(retryDelay('120',now),120000);assert.equal(retryDelay('Thu, 12 Nov 2026 10:03:00 GMT',now),180000);assert.equal(retryDelay(null,now),30000);
});
