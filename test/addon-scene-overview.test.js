"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/scene-model'),R=require('../lib/scene-runtime'),{SceneEngine,SceneStore}=require('../lib/scenes');
const config={devices:[{id:'sensor',name:'Water level: Küche',channels:[],inputs:[{component:'input:101',mode:'analog',name:'Tank',enabled:true},{component:'voltmeter:100',mode:'analog',name:'Pressure',enabled:true},{component:'input:100',mode:'state',name:'Door',enabled:true},{component:'voltmeter:101',mode:'analog',enabled:false}]},{id:'actuator',name:'Pump',channels:[{component:'switch:0',type:'switch'}]}],shading:{devices:[]}};
for(const file of ['../homebridge-ui/public/devices/overview','../engines/universal/homebridge-ui/public/overview'])test(file+': analog overview keeps units, hides disabled inputs and does not display faulted or offline values',()=>{
 const {rows,signal}=require(file),data={readings:[{component:'input:101',unit:'%',values:{AnalogValue:0}},{component:'voltmeter:100',unit:'V',values:{AnalogValue:2.75}},{component:'voltmeter:101',unit:'V',values:{AnalogValue:8}},{component:'voltmeter:102',unit:'V',values:{AnalogValue:9}}]};
 let result=rows(config.devices[0],data,true);assert.deepEqual(result.map(r=>r.component),['input:101','voltmeter:100','input:100']);assert.equal(result[0].unit,'%');assert.equal(result[1].unit,'V');assert.equal(result[1].values.AnalogValue,2.75);assert.deepEqual(signal(result[0],true),{state:'reading',label:'Analogwert'});
 data.readings[1].fault=true;result=rows(config.devices[0],data,true);assert.deepEqual(result[1].values,{});assert.equal(signal(result[1],true).state,'unknown');assert.ok(rows(config.devices[0],data,false).every(r=>!Object.keys(r.values).length));
});
test('Scene source choices distinguish numeric Add-on readings and units from digital contacts',()=>{
 const sources=M.sources(config,{devices:[{target:JSON.stringify(['sensor']),readings:[{component:'voltmeter:101',unit:'V',values:{AnalogValue:8}}]}]}),analogs=sources.filter(s=>s.metric==='AnalogValue');assert.equal(analogs.length,2);assert.ok(analogs.every(s=>s.type==='number'));assert.ok(analogs[0].label.includes('Water level: Küche [sensor] / Tank'));assert.ok(analogs[0].label.endsWith('Analogwert (%)'));assert.ok(analogs[1].label.endsWith('Analogwert (V)'));assert.equal(sources.filter(s=>s.metric==='ContactSensorState').length,1);assert.equal(sources.find(s=>s.metric==='ContactSensorState').component,'input:100');
});
test('an analog Scene threshold only triggers on fresh valid measurements and never on fault recovery alone',async()=>{
 let now=100000,value=20,online=true,fault=false,checkedAt=now;const calls=[],ref={area:'devices',deviceId:'sensor',component:'input:101',metric:'AnalogValue'};
 const store={maxAge:30000,devices:new Map()},platform={devices:{statusStore:store}};
 const scene={id:'threshold',name:'Tank limit',mode:'on',cooldownSeconds:5,condition:{kind:'value',source:ref,operator:'gt',value:50},actions:[{area:'devices',deviceId:'actuator',component:'switch:0',property:'On',value:true}]};
 assert.doesNotThrow(()=>M.validate([scene],config));assert.throws(()=>M.validate([{...scene,condition:{...scene.condition,value:true}}],config),/Zahlenwert/);
 const engine=new SceneEngine({config:{...config,scenes:[scene]},store:new SceneStore(),now:()=>now,observe:r=>R.observe(platform,r,now),execute:async a=>calls.push(a),log:{info(){},warn(){},error:assert.fail}});engine.running=true;
 const tick=async()=>{store.devices.set('sensor',{online,checkedAt,readings:[{component:'input:101',fault,values:{AnalogValue:value}}]});await engine.tick();};
 await tick();value=60;fault=true;await tick();assert.equal(calls.length,0);fault=false;await tick();assert.equal(calls.length,0);value=20;await tick();value=60;now+=6000;checkedAt=now;await tick();assert.equal(calls.length,1);
 value=20;await tick();now+=30001;value=60;await tick();assert.equal(calls.length,1);checkedAt=now;await tick();assert.equal(calls.length,1);value=20;await tick();value=60;await tick();assert.equal(calls.length,2);engine.stop();
});
