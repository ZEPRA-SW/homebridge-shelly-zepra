'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CloudClient,CloudQueue,cloudURL}=require('../lib/cloud'),{validate}=require('../lib/config'),{model,command}=require('../lib/model'),M=require('../homebridge-ui/public/models'),{device,rpc}=require('./fixtures');
const config=()=>({...device(),connection:'cloud',cloudDeviceId:'aabbccddeeff',cloudKey:'secret-never-log',cloudServer:'https://shelly-123-eu.shelly.cloud'});
const row=()=>({id:'aabbccddeeff',gen:'G2',code:'SNSW-002P16EU',online:1,status:rpc().status,settings:{}});
const instant={run:fn=>fn(),now:()=>0,next:0};
function mock(value=row()){const calls=[],c=new CloudClient(config(),async(u,o)=>{const b=JSON.parse(o.body);calls.push({url:new URL(u),body:b,options:o});return new Response(new URL(u).pathname.endsWith('/get')?JSON.stringify([value]):'',{status:200});},instant);return {c,calls};}
test('cloud configuration needs credentials and explicit cloud transport, never a local IP',()=>{
  const d=config();delete d.host;delete d.shellyDeviceId;assert.doesNotThrow(()=>validate({devices:[d]}));
  for(const patch of [{cloudKey:''},{cloudServer:'https://attacker.example'},{cloudDeviceId:'bad-id'},{rebootEnabled:true,rebootTime:'04:30'},{thermostat:true},{inputs:[{component:'input:0',mode:'button',enabled:true}]}])assert.throws(()=>validate({devices:[{...d,...patch}]}));
  assert.throws(()=>validate({devices:[d,{...device(),id:'duplicate'}]}),/doppelt/);
});
test('cloud URL rejects credentials, arbitrary hosts, paths, HTTP and redirects by policy',()=>{
  for(const u of ['http://shelly-123-eu.shelly.cloud','https://shelly-123-eu.shelly.cloud.evil.example','https://admin@ \nshelly-123-eu.shelly.cloud','https://shelly-123-eu.shelly.cloud/rpc','https://shelly-123-eu.shelly.cloud:8443','http://127.0.0.1'])assert.throws(()=>cloudURL(u));
  assert.equal(cloudURL('shelly-123-eu.shelly.cloud').protocol,'https:');
});
test('all clients share serialized one-per-second cloud slots including failed jobs',async()=>{
  let now=0;const queue=new CloudQueue(()=>now,async ms=>{now+=ms;}),starts=[];
  const jobs=[1,2,3,4].map(i=>queue.run(()=>{starts.push(now);if(i===2)throw Error('expected');return i;}));const r=await Promise.allSettled(jobs);assert.equal(r[1].status,'rejected');assert.deepEqual(starts,[0,1050,2100,3150]);
});
test('cloud reads bind only exact requested ID and require online matching generation and complete data',async()=>{
  const {c,calls}=mock();const snap=await c.snapshot();assert.equal(snap.gen,2);assert.equal(snap.cloud,true);assert.deepEqual(calls[0].body,{ids:['aabbccddeeff'],select:['status','settings']});assert.equal(calls[0].options.redirect,'error');
  for(const patch of [{id:'112233445566'},{online:0},{gen:'G9'},{status:null},{settings:null},{status:{sys:{mac:'112233445566'}}},{status:{'cover:0':{current_pos:50}}}])await assert.rejects(mock({...row(),...patch}).c.snapshot());
  c.config.generation='gen1';await assert.rejects(c.snapshot(),/generation/);
});
test('cloud switch write verifies status before exact channel command, accepts empty success body',async()=>{
  const {c,calls}=mock();await c.write('switch:0',{on:false});assert.equal(calls.length,2);assert.ok(calls[1].url.pathname.endsWith('/set/switch'));assert.deepEqual(calls[1].body,{id:'aabbccddeeff',channel:0,on:false});
  const off=mock({...row(),online:0});await assert.rejects(off.c.write('switch:0',{on:true}));assert.equal(off.calls.length,1);
  for(const component of ['switch:1','cover:0','boolean:200','thermostat:0'])await assert.rejects(c.write(component,{on:true}));assert.equal(calls.length,2);
});
test('cloud dimmers keep explicit brightness, RGB and Kelvin use documented parameters',async()=>{
  const r={...row(),status:{'light:0':{output:true,brightness:50},'rgb:0':{output:true,rgb:[0,0,0],brightness:50}}};const {c,calls}=mock(r);c.config.channels=[{component:'light:0',type:'light',onBrightness:35},{component:'rgb:0',type:'light'}];
  const descriptor=model(await c.snapshot(),c.config).descriptors.find(d=>d.key==='light:0');await c.write('light:0',command(descriptor,'Brightness',80));assert.equal(calls.at(-1).body.brightness,80);
  await c.write('rgb:0',{rgb:[1,2,3],brightness:40});assert.deepEqual(calls.at(-1).body,{id:'aabbccddeeff',channel:0,red:1,green:2,blue:3,gain:40});
  await c.write('light:0',{ct:4000});assert.equal(calls.at(-1).body.temperature,4000);
  for(const v of [{ct:10000},{brightness:101},{rgb:[-1,2,3]},{config:{enable:true}},{transition_duration:3}])await assert.rejects(c.write('light:0',v));
});
test('Gen1 cloud IDs can be short; relay mapping never calls a LAN endpoint',async()=>{
  const r={id:'ddeeff',gen:'G1',online:1,code:'SHPLG-S',status:{mac:'AABBCCDDEEFF',relays:[{ison:false}]},settings:{mode:'relay'}};const {c,calls}=mock(r);c.config.cloudDeviceId='ddeeff';c.config.channels=[{component:'relay:0',type:'outlet'}];await c.write('relay:0',{on:true});assert.ok(calls.every(call=>call.url.protocol==='https:'));assert.equal(calls.at(-1).body.channel,0);
});
test('transport errors never reveal cloud keys, do not retry commands, and shutdown cancels queued work',async()=>{
  let requests=0;const c=new CloudClient(config(),async()=>{requests++;throw Error('https://secret-never-log');},instant);
  await assert.rejects(c.snapshot(),e=>!e.message.includes(c.config.cloudKey));assert.equal(requests,1);c.stop();await assert.rejects(c.snapshot(),/beendet/);assert.equal(requests,1);await assert.rejects(c.reboot(),/nicht verfügbar/);
  let n=0;const failing=new CloudClient(config(),async()=>{n++;return n===1?new Response(JSON.stringify([row()])):new Response('secret-never-log',{status:500});},instant);await assert.rejects(failing.write('switch:0',{on:true}),/500/);assert.equal(n,2);
});
test('standalone cloud sensors and Wall Display values use existing HAP descriptors; XL climate stays absent',async()=>{
  const d=config();M.select(d,'cloud-sensor');const snap={...rpc(),cloud:true,status:{'temperature:0':{tC:22},'humidity:0':{rh:45},'devicepower:0':{battery:{percent:80}},'motion:0':{motion:false}}};const m=model(snap,d);assert.equal(m.descriptors.find(d=>d.type==='temperature').values.CurrentTemperature,22);assert.ok(m.descriptors.some(d=>d.type==='battery'));assert.equal(m.descriptors.find(d=>d.type==='motion').values.MotionDetected,false);
  M.select(d,'wall-xl');d.wallTemperature=true;d.wallHumidity=true;d.wallMotion=true;d.wallIlluminance=true;assert.ok(!model(snap,d).descriptors.some(d=>['temperature','humidity'].includes(d.type)));
  M.select(d,'wall');d.wallTemperature=true;d.wallHumidity=true;assert.ok(model(snap,d).descriptors.some(d=>d.type==='humidity'));
});
test('Gen1 Door/Window cloud state maps documented open/close without turning unknown into closed',()=>{
  const d=config();M.select(d,'cloud-sensor');const snap={gen:1,cloud:true,info:{},status:{sensor:{state:'open',is_valid:true},bat:{value:90}},settings:{}};
  assert.equal(model(snap,d).descriptors.find(d=>d.type==='contact').values.ContactSensorState,1);
  snap.status.sensor.state='close';assert.equal(model(snap,d).descriptors.find(d=>d.type==='contact').values.ContactSensorState,0);
  snap.status.sensor.state='unknown';assert.ok(!model(snap,d).descriptors.some(d=>d.type==='contact'));
});
