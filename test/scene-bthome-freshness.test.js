'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/scene-runtime'),M=require('../homebridge-ui/public/scene-model'),{evaluate}=require('../lib/scene-condition'),{SceneEngine,SceneStore}=require('../lib/scenes');
const stamp=Date.parse('2026-11-20T12:00:00Z');
function fixture(station={}){
 const sensor={id:'weather',name:'Weather',deviceComponent:'bthomedevice:200',sensorType:'ws90',...station},host={id:'host',name:'Host',host:'192.0.2.40',shellyDeviceId:'aabbccddeeff',bthome:[sensor]},config={pollInterval:20,devices:[host,{id:'fan',name:'Fan',channels:[{component:'switch:0',type:'switch'}]}],shading:{devices:[],timeZone:'Europe/Berlin'}};
 const reading={component:'bthomesensor:203',observedAt:stamp,values:{WindSpeed:25,RainDetected:false,BatteryLevel:0}},group={id:sensor.id,deviceComponent:sensor.deviceComponent,fault:false,readings:[reading]},record={target:JSON.stringify([host.id,host.host,host.shellyDeviceId]),online:true,checkedAt:stamp,bthome:[group],readings:[{component:'switch:0',values:{On:false,Brightness:0}}]},store={maxAge:75000,devices:new Map([[host.id,record]])},platform={config,devices:{config:{devices:[host]},statusStore:store}};
 let now=stamp;const source=metric=>({area:'devices',deviceId:host.id,sensorId:sensor.id,component:reading.component,metric});
 return {sensor,host,config,reading,group,record,store,platform,source,now:()=>now,age(ms){now=stamp+ms;record.checkedAt=now;},read(metric='WindSpeed'){return R.observe(platform,source(metric),now);},preview(metric='WindSpeed'){return M.sourceReading(config,{devices:[record],devicesMaxAge:store.maxAge},source(metric),now);}};
}
test('a cached WS90 sample expires exactly after its limit even when the host record is newly polled',()=>{
 const f=fixture();f.age(120000);assert.deepEqual(f.read(),{value:25,observedAt:stamp});assert.equal(f.preview().value,25);
 f.age(120001);assert.equal(f.read(),null);assert.equal(f.preview(),null);
 f.age(121000);assert.equal(f.read(),null,'a new host timestamp cannot renew an expired sensor measurement');
 f.reading.observedAt=f.now();assert.deepEqual(f.read(),{value:25,observedAt:f.now()});
});
test('custom BTHome expiry and the generic default use the configured limit on every observation',()=>{
 const custom=fixture({staleAfter:180});custom.age(180000);assert.equal(custom.read().value,25);custom.age(180001);assert.equal(custom.read(),null);
 const generic=fixture({sensorType:'bthome'});generic.age(86400000);assert.equal(generic.read().value,25);generic.age(86400001);assert.equal(generic.read(),null);
 for(const staleAfter of [0,-1,NaN,Infinity,'120']){const f=fixture({staleAfter});assert.equal(f.read(),null);}
});
test('false and zero remain real readings while their actual timestamp is current',()=>{
 const f=fixture();assert.deepEqual(f.read('RainDetected'),{value:false,observedAt:stamp});assert.deepEqual(f.read('BatteryLevel'),{value:0,observedAt:stamp});
 f.age(121000);assert.equal(f.read('RainDetected'),null);assert.equal(f.read('BatteryLevel'),null);
});
test('BTHome groups must match the configured permanent ID and component, not just a cached name',()=>{
 for(const change of [f=>f.sensor.id='changed',f=>f.sensor.deviceComponent='bthomedevice:201',f=>delete f.sensor.deviceComponent,f=>f.group.deviceComponent='bthomedevice:201',f=>delete f.group.deviceComponent,f=>f.platform.config.devices=[]]){const f=fixture();change(f);assert.equal(f.read(),null);}
 const f=fixture();delete f.platform.config;assert.equal(f.read().value,25,'a real DevicePlatform config remains a valid source of mapping metadata');
});
test('missing, invalid or future sensor timestamps never fall back to the host poll time',()=>{
 for(const value of [undefined,null,0,-1,NaN,Infinity,'1770000000000',stamp+5001]){const f=fixture();f.reading.observedAt=value;assert.equal(f.read(),null);assert.equal(f.preview(),null);}
 const f=fixture();delete f.reading.observedAt;assert.equal(f.read(),null);assert.equal(f.preview(),null);
 f.reading.observedAt=stamp+5000;assert.equal(f.read().observedAt,stamp+5000,'existing clock tolerance is retained');
});
test('host and sensor failures stay unavailable; native component feedback keeps its compatible timestamp behavior',()=>{
 for(const change of [f=>f.record.online=false,f=>f.record.checkedAt=stamp-75001,f=>f.record.checkedAt=stamp+5001,f=>f.group.fault=true,f=>f.reading.fault=true]){const f=fixture();change(f);assert.equal(f.read(),null);}
 const f=fixture();f.age(121000);const native=metric=>({area:'devices',deviceId:'host',component:'switch:0',metric});
 assert.deepEqual(R.observe(f.platform,native('On'),f.now()),{value:false,observedAt:f.now()});assert.deepEqual(R.observe(f.platform,native('Brightness'),f.now()),{value:0,observedAt:f.now()});
});
test('a clock or another true condition cannot combine with an expired BTHome sample',()=>{
 const f=fixture(),value={kind:'value',source:f.source('WindSpeed'),operator:'gt',value:10},clock={kind:'time',time:'13:02',days:[5]},native={kind:'status',source:{area:'devices',deviceId:'host',component:'switch:0',metric:'On'},operator:'eq',value:true};f.record.readings[0].values.On=true;f.age(121000);
 const observe=(ref,now)=>R.observe(f.platform,ref,now),local={time:'13:02',weekday:5};
 for(const other of [clock,native]){
  const tree={kind:'group',operator:'and',children:[other,value]};assert.equal(evaluate(tree,{},f.now(),observe,local).value,null);
  assert.equal(evaluate(tree,{},f.now(),observe,local,{notBefore:stamp-1000}).value,null,'an intermediate gate cannot accept an expired post-entry sample');
 }
});
test('expiring during a confirmation duration clears the hold until new sensor samples confirm it',()=>{
 const f=fixture(),tree={kind:'value',source:f.source('WindSpeed'),operator:'gt',value:10,holdSeconds:5},nodes={},observe=(ref,now)=>R.observe(f.platform,ref,now),local={time:'13:02',weekday:5};
 f.age(119000);assert.equal(evaluate(tree,nodes,f.now(),observe,local).value,false);
 f.age(125000);assert.equal(evaluate(tree,nodes,f.now(),observe,local).value,null);
 f.reading.observedAt=f.now();assert.equal(evaluate(tree,nodes,f.now(),observe,local).value,false);
 f.age(130000);assert.equal(evaluate(tree,nodes,f.now(),observe,local).value,false,'another host poll cannot provide the confirming sample');
 f.reading.observedAt=f.now();assert.equal(evaluate(tree,nodes,f.now(),observe,local).value,true);
});
test('a timed Scene cannot dispatch an action from an expired cached BTHome reading',async()=>{
 const f=fixture();f.age(121000);const calls=[],scene={id:'weather-time',name:'Weather time',mode:'on',cooldownSeconds:5,condition:{kind:'group',operator:'and',children:[{kind:'time',time:'13:02',days:[5]},{kind:'value',source:f.source('WindSpeed'),operator:'gt',value:10}]},actions:[{area:'devices',deviceId:'fan',component:'switch:0',property:'On',value:true}]};
 const engine=new SceneEngine({config:{...f.config,scenes:[scene]},store:new SceneStore(),now:f.now,observe:(ref,now)=>R.observe(f.platform,ref,now),execute:async action=>calls.push(action),log:{info(){},warn(){},error:assert.fail}});engine.running=true;
 await engine.tick();assert.equal(calls.length,0);assert.equal(engine.store.states[scene.id].conditionState,'unknown');engine.stop();
});
