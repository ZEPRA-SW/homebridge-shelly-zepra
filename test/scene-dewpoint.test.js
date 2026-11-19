"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/scene-model'),{evaluate}=require('../lib/scene-condition'),{SceneEngine,SceneStore}=require('../lib/scenes'),{SceneReset}=require('../lib/scene-reset'),R=require('../lib/scene-runtime');
const temperatureSource={area:'devices',deviceId:'temperature',component:'temperature:100',metric:'CurrentTemperature'},humiditySource={area:'devices',deviceId:'humidity',sensorId:'indoor',component:'bthomesensor:203',metric:'CurrentRelativeHumidity'};
const condition={kind:'dewpoint',temperatureSource,humiditySource,operator:'gt',value:12},action={area:'devices',deviceId:'actuator',component:'switch:0',property:'On',value:true};
const config={devices:[{id:'temperature',name:'Temperature',channels:[]},{id:'humidity',name:'Humidity',channels:[],bthome:[{id:'indoor',deviceComponent:'bthomedevice:200'}]},{id:'actuator',name:'Fan',channels:[{component:'switch:0',type:'switch'}]}],shading:{timeZone:'Europe/Berlin',devices:[]}};
const rule=extra=>({id:'dewpoint',name:'Dew point',mode:'on',cooldownSeconds:5,condition,actions:[action],...extra});
function fixture(extra={}){let now=100000,temperature=20,humidity=50,tempAt=now,humAt=now,tempAvailable=true,humAvailable=true;const calls=[],store=new SceneStore(),observe=ref=>ref===temperatureSource?tempAvailable?{value:temperature,observedAt:tempAt}:null:ref===humiditySource?humAvailable?{value:humidity,observedAt:humAt}:null:null;
 const engine=new SceneEngine({config:{...config,scenes:[rule(extra.rule)]},store,observe,execute:async(a,allowed)=>{assert.ok(allowed());calls.push(a);},now:()=>now,log:{info(){},warn(){},error:assert.fail},...extra.engine});engine.running=true;
 return {engine,calls,store,observe,now:()=>now,advance(ms){now+=ms;},sample(t,h){temperature=t;humidity=h;tempAt=humAt=now;},temperature(t){temperature=t;tempAt=now;},humidity(h){humidity=h;humAt=now;},available(t,h){tempAvailable=t;humAvailable=h;}};
}
test('Magnus dew point matches known examples, saturation and defined input range without coercion',()=>{
 for(const [t,rh,expected]of [[20,50,9.255],[25,10,-8.774],[50,90,47.897]])assert.ok(Math.abs(M.dewPoint(t,rh)-expected)<0.025,t+' C / '+rh+'%');
 for(const t of [-45,-10,0,20,60])assert.equal(M.dewPoint(t,100),t);
 for(const [t,rh]of [[-46,50],[61,50],[NaN,50],[20,0],[20,-1],[20,101],[20,Infinity],[20,'50'],['20',50],[20,null]])assert.equal(M.dewPoint(t,rh),null);
});
test('dew-point validation requires two correctly typed configured sources and a numeric comparison',()=>{
 assert.doesNotThrow(()=>M.validate([rule()],config));
 for(const patch of [{temperatureSource:undefined},{humiditySource:temperatureSource},{temperatureSource:{...temperatureSource,deviceId:'missing'}},{humiditySource:{...humiditySource,metric:'BatteryLevel'}},{value:true},{hysteresis:-1},{holdSeconds:0.5}])assert.throws(()=>M.validate([rule({condition:{...condition,...patch}})],config));
 assert.deepEqual(M.conditionSources(condition),[temperatureSource,humiditySource]);
 const targetTemperature={...temperatureSource,component:'switch:0'},targetHumidity={...humiditySource,deviceId:'actuator',component:'switch:0'};
 assert.throws(()=>M.validate([rule({condition:{...condition,temperatureSource:{...targetTemperature,deviceId:'actuator'}}})],config),/Regelschleife/);
 assert.throws(()=>M.validate([rule({condition:{...condition,humiditySource:targetHumidity}})],config),/Regelschleife/);
});
test('derived observations retain the older sample timestamp and respect BTHome identity, faults and freshness',()=>{
 let now=100000;const records=new Map([['temperature',{online:true,checkedAt:99900,readings:[{component:'temperature:100',values:{CurrentTemperature:20}}]}],['humidity',{online:true,checkedAt:99800,bthome:[{id:'outdoor',readings:[{component:'bthomesensor:203',values:{CurrentRelativeHumidity:1}}]},{id:'indoor',readings:[{component:'bthomesensor:203',values:{CurrentRelativeHumidity:50}}]}]}]]),platform={devices:{statusStore:{maxAge:1000,devices:records}}};
 const observe=ref=>R.observe(platform,ref,now),sample=M.observation(condition,observe,now);assert.equal(sample.observedAt,99800);assert.ok(Math.abs(sample.value-9.255)<0.025);
 records.get('humidity').bthome[1].fault=true;assert.equal(M.observation(condition,observe,now),null);delete records.get('humidity').bthome[1].fault;
 records.get('temperature').readings[0].fault=true;assert.equal(M.observation(condition,observe,now),null);delete records.get('temperature').readings[0].fault;
 now=100901;assert.equal(M.observation(condition,observe,now),null);now=100000;records.get('humidity').online=false;assert.equal(M.observation(condition,observe,now),null);
});
test('a direct dew-point threshold uses edge semantics and unavailable-data recovery does not fabricate a trigger',async()=>{
 const f=fixture();await f.engine.tick();f.sample(20,80);await f.engine.tick();assert.equal(f.calls.length,1);await f.engine.tick();assert.equal(f.calls.length,1);
 f.advance(6000);f.available(true,false);await f.engine.tick();f.available(true,true);await f.engine.tick();assert.equal(f.calls.length,1);f.sample(20,50);await f.engine.tick();f.sample(20,80);await f.engine.tick();assert.equal(f.calls.length,2);f.engine.stop();
});
test('confirmation duration requires fresh confirming samples from BOTH sources',async()=>{
 const f=fixture({rule:{condition:{...condition,holdSeconds:10}}});f.sample(20,80);await f.engine.tick();assert.equal(f.calls.length,0);f.advance(10000);f.temperature(20);await f.engine.tick();assert.equal(f.calls.length,0);f.humidity(80);await f.engine.tick();assert.equal(f.calls.length,1);f.engine.stop();
});
test('nested dew-point conditions remain unknown on invalid readings and cannot reset an accepted action',()=>{
 const f=fixture(),tree={kind:'group',operator:'and',children:[condition]},local={};f.sample(20,80);assert.equal(evaluate(tree,{},f.now(),f.observe,local).value,true);
 const reset=new SceneReset(f.engine,config),scene=rule({condition:tree}),context={nodes:{}};assert.equal(reset.truth(scene,context),true);f.humidity(0);assert.equal(evaluate(tree,{},f.now(),f.observe,local).value,null);assert.equal(reset.truth(scene,context),null);f.humidity(50);assert.equal(reset.truth(scene,context),false);f.engine.stop();
});
test('queued commands recheck both dew-point sources before sending',async()=>{
 let allowed;const f=fixture({engine:{execute:async(_a,guard)=>{allowed=guard;}}});await f.engine.tick();f.sample(20,80);await f.engine.tick();assert.equal(allowed(),true);f.available(false,true);assert.equal(allowed(),false);f.available(true,true);f.humidity(50);assert.equal(allowed(),false);f.engine.stop();
});
test('dew-point stage gates wait for two post-entry samples and time out without later actions',async()=>{
 let f;f=fixture({rule:{condition:{kind:'time',time:'01:01',days:[4]},actions:[action,{...action,value:false,condition:{...condition,value:5},conditionTimeoutSeconds:4}]},engine:{delay:async(ms,allowed)=>{assert.ok(allowed());f.advance(ms);if(f.now()===101001)f.temperature(20);if(f.now()===102001)f.humidity(50);}}});
 const execute=f.engine.execute;f.engine.execute=async(a,allowed)=>{await execute(a,allowed);if(a.value)f.advance(1);};
 await f.engine.tick();assert.equal(f.calls.length,2);assert.equal(f.now(),102001);assert.equal(f.store.states.dewpoint.phase,'done');f.engine.stop();
 const blocked=fixture({rule:{condition:{kind:'time',time:'01:01',days:[4]},actions:[action,{...action,value:false,condition,conditionTimeoutSeconds:2}]}});blocked.engine.delay=async ms=>blocked.advance(ms);await blocked.engine.tick();assert.equal(blocked.calls.length,1);assert.equal(blocked.store.states.dewpoint.phase,'aborted');assert.match(blocked.store.states.dewpoint.status,/Bedingungswartezeit/);blocked.engine.stop();
});

test('published JSON schema accepts nested and intermediate dew-point conditions and typed sensor sources',()=>{
 const Ajv=require('ajv'),schema=require('../config.schema.json').schema,ajv=new Ajv({strict:false});const validate=ajv.compile({type:'object',properties:{scenes:schema.properties.scenes},definitions:schema.definitions}),document={platform:'ShellyZepra',devices:config.devices,shading:config.shading,scenes:[rule({condition:{kind:'group',operator:'and',children:[condition]},actions:[{...action,condition}]})]};
 assert.equal(validate(document),true,JSON.stringify(validate.errors));document.scenes[0].condition.children[0]={...condition,humiditySource:temperatureSource};assert.equal(validate(document),false);
});
