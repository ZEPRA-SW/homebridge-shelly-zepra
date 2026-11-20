"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ws90Fixture}=require('../engines/universal/test/ws90-fixture'),{model}=require('../engines/universal/lib/model'),{bthomeStatus}=require('../engines/universal/lib/bthome-status');
const M=require('../homebridge-ui/public/scene-model'),I=require('../homebridge-ui/public/devices/i18n'),R=require('../lib/scene-runtime'),{SceneEngine,SceneStore}=require('../lib/scenes');
function fixture(now=1000){const f=ws90Fixture(now),modeled=model(f.snap,f.host,now),groups=bthomeStatus(f.snap,modeled);return {...f,groups};}
for(const file of ['../homebridge-ui/public/devices/overview','../engines/universal/homebridge-ui/public/overview'])test(file+': WS90 values retain identity, legitimate zero/false and distinct wind/gust',()=>{
 const O=require(file),f=fixture(),data={bthome:f.groups},rows=O.rows(f.host,data,true);assert.equal(rows.length,13);assert.ok(rows.every(r=>!r.fault));
 const wind=rows.find(r=>r.component===f.keys.WindSpeed),gust=rows.find(r=>r.component===f.keys.GustSpeed),rain=rows.find(r=>r.component===f.keys.RainDetected);assert.ok(Math.abs(wind.values.WindSpeed-11.556)<1e-9);assert.equal(gust.values.GustSpeed,27);assert.equal(wind.unit,'km/h');assert.equal(gust.unit,'km/h');assert.equal(O.signal(rain,true).label,'Kein Regen');assert.equal(O.signal(rain,true).state,'inactive');
 assert.ok(rows.every(r=>r.sensorId===f.station.id&&r.deviceComponent===f.station.deviceComponent));assert.equal(rows.find(r=>r.component===f.keys.CurrentAmbientLightLevel).values.CurrentAmbientLightLevel,.0001);
 const sample=f.groups[0].readings.find(r=>r.component===f.keys.WindSpeed);sample.fault=true;sample.values={WindSpeed:999};const stale=O.rows(f.host,data,true).find(r=>r.component===f.keys.WindSpeed);assert.deepEqual(stale.values,{});assert.equal(stale.metric,'WindSpeed');assert.equal(O.signal(stale,true).label,'Unbekannt');assert.ok(O.rows(f.host,data,false).every(r=>!Object.keys(r.values).length));
});
test('WS90 Scene choices include weather readings and preserve unavailable sensor identity',()=>{
 const f=fixture(),config={devices:[f.host],shading:{devices:[]}},data={devices:[{target:JSON.stringify([f.host.id]),bthome:f.groups}]},sources=M.sources(config,data);
 for(const metric of ['WindSpeed','GustSpeed','WindDirection','RainDetected','UVIndex','AirPressure','DewPoint','Precipitation','CapacitorVoltage']){const s=sources.find(s=>s.metric===metric);assert.ok(s,metric);assert.equal(s.sensorId,f.station.id);assert.equal(s.type,metric==='RainDetected'?'boolean':'number');assert.ok(s.label.includes(f.station.name+' ['+f.station.id+'] / '+f.keys[metric]));}
 assert.ok(sources.find(s=>s.metric==='WindSpeed').label.endsWith('Windgeschwindigkeit (km/h)'));f.groups[0].readings.find(r=>r.metric==='WindSpeed').values={};f.groups[0].readings.find(r=>r.metric==='WindSpeed').fault=true;assert.ok(M.sources(config,data).some(s=>s.metric==='WindSpeed'));
});
test('weather text is translated in every language without rewriting configured names',()=>{
 for(const language of ['en','fr','es'])for(const text of ['Windgeschwindigkeit','Böen','Windrichtung','Regenstatus','Regen','Kein Regen','UV-Index','Luftdruck','Taupunkt','Niederschlag','Kondensatorspannung'])assert.notEqual(I.translate(text,language),text,language+': '+text);
 for(const language of ['de','en','fr','es'])assert.equal(I.translate('My WS90: {name}',language),'My WS90: {name}');
});
test('weather Scene thresholds and rain status honor actual snapshot freshness and faults',async()=>{
 const f=fixture(100),nowRef={value:100000},store={maxAge:30000,devices:new Map()},platform={config:{devices:[f.host]},devices:{statusStore:store}},calls=[],config={devices:[f.host,{id:'actuator',channels:[{component:'switch:0',type:'switch'}]}],shading:{devices:[]}};
 const ref={area:'devices',deviceId:f.host.id,sensorId:f.station.id,component:f.keys.RainDetected,metric:'RainDetected'},scene={id:'weather-scene',name:'Rain test',mode:'on',cooldownSeconds:5,condition:{kind:'status',source:ref,operator:'eq',value:true},actions:[{area:'devices',deviceId:'actuator',component:'switch:0',property:'On',value:false}]};
 assert.doesNotThrow(()=>M.validate([scene],config));assert.throws(()=>M.validate([{...scene,condition:{...scene.condition,operator:'gt'}}],config),/Schaltzustände/);
 const engine=new SceneEngine({config:{...config,scenes:[scene]},store:new SceneStore(),now:()=>nowRef.value,observe:r=>R.observe(platform,r,nowRef.value),execute:async a=>calls.push(a),log:{info(){},warn(){},error:assert.fail}});engine.running=true;
 const record={online:true,checkedAt:nowRef.value,bthome:f.groups};store.devices.set(f.host.id,record);await engine.tick();const rain=f.groups[0].readings.find(r=>r.metric==='RainDetected');rain.values.RainDetected=true;rain.fault=true;await engine.tick();assert.equal(calls.length,0);rain.fault=false;await engine.tick();assert.equal(calls.length,0);rain.values.RainDetected=false;await engine.tick();rain.values.RainDetected=true;nowRef.value+=6000;record.checkedAt=nowRef.value;await engine.tick();assert.equal(calls.length,1);rain.values.RainDetected=false;await engine.tick();rain.values.RainDetected=true;nowRef.value+=30001;await engine.tick();assert.equal(calls.length,1);engine.stop();
});
