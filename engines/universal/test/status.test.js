'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {StatusStore,readStatus,target}=require('../lib/status');
const {state}=require('../homebridge-ui/public/status');
const {device}=require('./fixtures');
async function storage(t){const base=path.resolve(__dirname,'../.preview');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'status-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('status follows successful data, failure and shutdown without storing credentials',async t=>{
  const dir=await storage(t),d={...device(),password:'never-save-this'},store=new StatusStore(dir,[d],10);
  await store.save();assert.equal(state(await readStatus(dir),d),'unknown');
  await store.update(d.id,true,1000);let data=await readStatus(dir);assert.equal(state(data,d,1001),'online');assert.ok(!JSON.stringify(data).includes(d.password));
  await store.update(d.id,false,2000);data=await readStatus(dir);assert.equal(state(data,d,2001),'offline');assert.equal(data.devices[0].lastSuccessAt,1000);
  await store.update(d.id,true);await store.stop();assert.equal(state(await readStatus(dir),d),'offline');
});
test('missing, corrupt, stale and changed-target statuses cannot show green',async t=>{
  const dir=await storage(t),d=device();assert.equal(state(await readStatus(dir),d),'unknown');
  await fs.writeFile(path.join(dir,'shelly-universal-status.json'),'broken');assert.equal(state(await readStatus(dir),d),'unknown');
  const data={maxAge:30000,devices:[{target:target(d),online:true,checkedAt:1000}]};
  assert.equal(state(data,d,31001),'offline');assert.equal(state(data,{...d,host:'192.0.2.99'},1001),'unknown');assert.equal(state(data,{...d,shellyDeviceId:'112233445566'},1001),'unknown');assert.equal(state(data,{...d,name:'new name'},1001),'online');
});
test('serialized writes preserve all device states during simultaneous polling',async t=>{
  const dir=await storage(t),d=device(),other={...d,id:'second'},store=new StatusStore(dir,[d,other],300);
  await Promise.all([store.update(d.id,true,1000),store.update(other.id,false,1001)]);const data=await readStatus(dir);assert.equal(data.devices.length,2);assert.equal(state(data,d,1002),'online');assert.equal(state(data,other,1002),'offline');assert.ok(data.maxAge>300000);
});
test('status write failure is contained and warned once until recovery',async t=>{
  const dir=await storage(t),d=device();let errors=0;const store=new StatusStore(path.join(dir,'missing'),[d],10,()=>errors++);
  await store.update(d.id,true);await store.update(d.id,false);assert.equal(errors,1);
  await fs.mkdir(path.join(dir,'missing'));await store.update(d.id,true);assert.equal(state(await readStatus(path.join(dir,'missing')),d),'online');
});
test('real plugin UI server reads runtime status over Homebridge IPC',async t=>{
  const dir=await storage(t),d=device(),store=new StatusStore(dir,[d],10);await store.update(d.id,true);
  const child=require('node:child_process').fork(path.resolve(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:dir},stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>child.kill());
  function message(predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('UI response timeout'));},5000);const onMessage=m=>{if(predicate(m)){cleanup();resolve(m);}};const onExit=()=>{cleanup();reject(Error('UI server stopped'));};function cleanup(){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);}child.on('message',onMessage);child.on('exit',onExit);});}
  await message(m=>m.action==='ready');const response=message(m=>m.action==='response');child.send({action:'request',path:'/status',requestId:'test'});const r=await response;
  assert.equal(r.payload.success,true);assert.equal(state(r.payload.data,d),'online');
});

test('status endpoint exposes sanitized power and channel states and drops values on outage',async t=>{
 const dir=await storage(t),d={...device(),connection:'cloud',cloudServer:'https://shelly-123-eu.shelly.cloud',cloudDeviceId:'aabbccddeeff',cloudKey:'never-expose'},store=new StatusStore(dir,[d],10);
 await store.update(d.id,true,1000,[{component:'switch:0',name:'Küche',values:{Power:0,Energy:1.2,Frequency:50,cloudKey:d.cloudKey}}],[{component:'switch:0',name:'Küche',values:{On:false,Brightness:35,cloudKey:d.cloudKey}}]);const data=await readStatus(dir);assert.equal(state(data,d,1001),'online');assert.equal(data.devices[0].measurements[0].values.Power,0);assert.equal(data.devices[0].readings[0].values.On,false);assert.ok(!JSON.stringify(data).includes(d.cloudKey));
 await store.update(d.id,false,2000);const failed=await readStatus(dir);assert.deepEqual(failed.devices[0].readings,[]);assert.deepEqual(failed.devices[0].measurements,[]);
});


test('analog status retains numeric values and units but drops faulted and offline values',async t=>{
 const dir=await storage(t),d=device(),store=new StatusStore(dir,[d],10);
 await store.update(d.id,true,1000,[],[{component:'input:101',name:'Water level',unit:'%',values:{AnalogValue:0,secret:'hidden'}},{component:'voltmeter:100',name:'Voltage',unit:'V',values:{AnalogValue:4.25}},{component:'input:102',unit:'%',fault:true,values:{AnalogValue:99}}]);
 let data=await readStatus(dir);assert.equal(data.devices[0].readings[0].unit,'%');assert.equal(data.devices[0].readings[0].values.AnalogValue,0);assert.equal(data.devices[0].readings[1].unit,'V');assert.equal(data.devices[0].readings[1].values.AnalogValue,4.25);assert.deepEqual(data.devices[0].readings[2].values,{});assert.ok(!JSON.stringify(data).includes('hidden'));
 await store.update(d.id,false,2000);data=await readStatus(dir);assert.deepEqual(data.devices[0].readings,[]);
});
