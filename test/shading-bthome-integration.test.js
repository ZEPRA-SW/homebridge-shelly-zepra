'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
const {HomebridgeAPI}=require(apiModule),{CombinedPlatform}=require('../index');
const {ws90Fixture}=require('../engines/universal/test/ws90-fixture');
const R=require('../lib/scene-runtime'),{SceneEngine,SceneStore}=require('../lib/scenes');
const cover={id:'weather-blind',name:'Weather Blind',host:'192.0.2.77',shellyDeviceId:'aabbccddeeff',deviceType:'raffstore'};
const immediate=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};

function harness(t,{hidden=false,deviceOverrides={},now=Date.now()}={}){
 const f=ws90Fixture(now/1000);f.snap.components[0].status.paired=false;
 const device={...cover,bthome:[f.station],homekitEnabled:!hidden,...deviceOverrides};
 const api=new HomebridgeAPI(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'zepra-shading-bthome-'));
 const storage=api.user.storagePath,fetcher=global.fetch,registered=[],updated=[],removed=[],requests=[],logs=[];
 const state={coverError:false,bthomeError:false,beforeComponents:null};
 api.user.storagePath=()=>folder;
 api.registerPlatformAccessories=(plugin,platform,list)=>registered.push(...list.map(a=>({plugin,platform,a})));
 api.updatePlatformAccessories=list=>updated.push(...list);
 api.unregisterPlatformAccessories=(plugin,platform,list)=>removed.push(...list.map(a=>({plugin,platform,a})));
 global.fetch=async(url,options)=>{
  const frame=JSON.parse(options.body);requests.push({method:frame.method,params:frame.params});
  let result;
  if(frame.method==='Shelly.GetDeviceInfo')result={...f.snap.info,profile:'cover'};
  else if(frame.method==='Cover.GetConfig')result={slat:{enable:true}};
  else if(frame.method==='Cover.GetStatus'){
   if(state.coverError)return Response.json({id:frame.id,error:{code:-103,message:'Synthetic cover read failed'}});
   result={pos_control:true,current_pos:55,slat_pos:35,state:'stopped'};
  }else if(frame.method==='Shelly.GetComponents'){
   if(state.beforeComponents)await state.beforeComponents();
   if(state.bthomeError)return Response.json({id:frame.id,error:{code:-103,message:'Synthetic component read failed'}});
   const offset=frame.params.offset;
   result={total:f.snap.components.length,components:structuredClone(f.snap.components.slice(offset,offset+7))};
  }else throw Error('Unexpected or mutating RPC: '+frame.method);
  return Response.json({id:frame.id,result});
 };
 const log=Object.fromEntries(['info','warn','error','debug'].map(level=>[level,message=>logs.push({level,message})]));
 const p=new CombinedPlatform(log,{pollInterval:20,devices:[],shading:{globalControls:false,devices:[device]}},api);
 let closed=false;
 async function close(){
  if(!closed){closed=true;api.emit('shutdown');}
  await p.shading?.statusStore.close();await p.devices?.statusStore?.tail;
 }
 t.after(async()=>{await close();global.fetch=fetcher;api.user.storagePath=storage;fs.rmSync(folder,{recursive:true,force:true});});
 function cached(name,uuid,context={}){
  const accessory=new api.platformAccessory(name,uuid);accessory.context=context;p.configureAccessory(accessory);return accessory;
 }
 async function launch(){
  api.emit('didFinishLaunching');const runtime=p.shading.devices[0];if(runtime)await runtime.initialPoll;await immediate();return runtime;
 }
 const ref=metric=>({area:'shading',deviceId:device.id,sensorId:f.station.id,component:f.keys[metric],metric});
 return {p,api,f,device,folder,state,registered,updated,removed,requests,logs,cached,launch,close,ref};
}

test('shading-host sensor cache is routed separately, retains the cover UUID and never creates an empty host accessory',async t=>{
 const h=harness(t),coverUuid=h.api.hap.uuid.generate('homebridge-shelly-raffstore:'+cover.id);
 const cachedCover=h.cached('Existing blind',coverUuid,{deviceId:cover.id,combinedEngine:'shading',sunState:{enabled:false}});
 const sensorUuid=h.p.shadingBthome.uuid(h.device,h.f.station);
 const cachedSensor=h.cached('Existing WS90',sensorUuid,{deviceId:cover.id,bthomeId:h.f.station.id,bthomeHostArea:'shading',combinedEngine:'shading-bthome'});
 assert.equal(h.p.shading.cached[0],cachedCover);assert.equal(h.p.shadingBthome.cache.get(sensorUuid),cachedSensor);assert.equal(h.p.devices.cache.size,0);
 const runtime=await h.launch(),unit=h.p.shadingBthome.units.get(cover.id);
 assert.equal(runtime.client,unit.client);assert.equal(h.p.devices.units.size,0);assert.equal(unit.accessories.length,1);
 assert.equal(unit.accessories[0].accessory,cachedSensor);assert.equal(h.p.shadingBthome.cache.size,1);assert.equal(h.removed.length,0);
 assert.equal(h.p.shading.devices.length,1);assert.ok(h.updated.includes(cachedCover));assert.ok(h.updated.includes(cachedSensor));
 assert.ok(!h.registered.some(row=>row.a.UUID===sensorUuid));assert.ok(!h.registered.some(row=>row.a.UUID===h.api.hap.uuid.generate('homebridge-shelly-universal:'+cover.id)));
 const record=h.p.shading.statusStore.records.get(cover.id);
 assert.equal(record.online,true);assert.equal(record.bthomeOnline,true);assert.equal(record.bthome[0].fault,false);assert.equal(record.bthome[0].readings.length,13);
 assert.equal(R.observe(h.p,h.ref('WindSpeed')).value,3.21*3.6);assert.equal(R.observe(h.p,h.ref('RainDetected')).value,false);
 assert.ok(h.requests.every(r=>['Shelly.GetDeviceInfo','Cover.GetConfig','Cover.GetStatus','Shelly.GetComponents'].includes(r.method)));
});

test('fresh shading-host WS90 publishes only the cover and sensor accessories through the combined platform',async t=>{
 const h=harness(t);await h.launch();
 assert.equal(h.registered.length,2);
 assert.ok(h.registered.every(row=>row.plugin==='homebridge-shelly-zepra'&&row.platform==='ShellyZepra'));
 const sensors=h.registered.filter(row=>row.a.context.bthomeHostArea==='shading');assert.equal(sensors.length,1);
 assert.equal(sensors[0].a.context.combinedEngine,'shading-bthome');
 assert.ok(sensors[0].a.services.some(service=>service.subtype==='su:'+h.f.keys.WindSpeed));
});

test('hidden shading-host sensors remain available to status and Scenes without publishing HomeKit accessories',async t=>{
 const h=harness(t,{hidden:true});await h.launch();
 assert.equal(h.registered.length,0);assert.equal(h.p.shadingBthome.units.get(cover.id).accessories.length,0);
 assert.equal(h.p.shading.statusStore.records.get(cover.id).bthomeOnline,true);
 assert.equal(R.observe(h.p,h.ref('CurrentTemperature')).value,10);
});

test('cover and BTHome transport failures have independent status and Scene availability',async t=>{
 const h=harness(t);h.state.coverError=true;const runtime=await h.launch();
 let record=h.p.shading.statusStore.records.get(cover.id);
 assert.equal(record.online,false);assert.equal(record.bthomeOnline,true);assert.equal(R.observe(h.p,{area:'shading',deviceId:cover.id,metric:'position'}),null);
 assert.equal(R.observe(h.p,h.ref('WindSpeed')).value,3.21*3.6);
 h.state.coverError=false;h.state.bthomeError=true;clearTimeout(runtime.timer);await runtime.poll();
 record=h.p.shading.statusStore.records.get(cover.id);
 assert.equal(record.online,true);assert.equal(record.bthomeOnline,false);assert.equal(R.observe(h.p,{area:'shading',deviceId:cover.id,metric:'position'}).value,55);
 assert.equal(R.observe(h.p,h.ref('WindSpeed')),null);
 assert.ok(record.bthome[0].readings.every(r=>r.fault&&Object.keys(r.values).length===0));
 h.state.bthomeError=false;clearTimeout(runtime.timer);await runtime.poll();assert.equal(R.observe(h.p,h.ref('WindSpeed')).value,3.21*3.6);
});

test('passive beacons are accepted but decryption errors and invalid values cannot trigger shading-host Scenes',async t=>{
 const h=harness(t),runtime=await h.launch();assert.equal(h.f.snap.components[0].status.paired,false);
 assert.equal(R.observe(h.p,h.ref('GustSpeed')).value,27);
 const wind=h.f.snap.components.find(c=>c.key===h.f.keys.WindSpeed);wind.status.is_valid=false;
 clearTimeout(runtime.timer);await runtime.poll();assert.equal(R.observe(h.p,h.ref('WindSpeed')),null);assert.equal(R.observe(h.p,h.ref('GustSpeed')).value,27);
 delete wind.status.is_valid;h.f.snap.components[0].status.errors=['decrypt_failed'];
 clearTimeout(runtime.timer);await runtime.poll();assert.equal(R.observe(h.p,h.ref('GustSpeed')),null);
 assert.ok(h.p.shading.statusStore.records.get(cover.id).bthome[0].readings.every(r=>r.fault&&Object.keys(r.values).length===0));
 h.f.snap.components[0].status.errors=[];clearTimeout(runtime.timer);await runtime.poll();assert.equal(R.observe(h.p,h.ref('GustSpeed')).value,27);
});

test('new host polls cannot satisfy a Scene hold without a new WS90 observation',async t=>{
 let now=Date.parse('2026-11-19T12:00:00Z');t.mock.method(Date,'now',()=>now);
 const h=harness(t,{now}),wind=h.f.snap.components.find(c=>c.key===h.f.keys.WindSpeed);wind.status.value=0;
 const runtime=await h.launch(),source=h.ref('WindSpeed'),calls=[],scene={id:'held-weather',name:'Held weather',mode:'on',cooldownSeconds:5,condition:{kind:'value',source,operator:'gt',value:10,holdSeconds:30},actions:[{area:'shading',deviceId:cover.id,property:'position',value:10}]};
 const engine=new SceneEngine({config:{...h.p.config,scenes:[scene]},store:new SceneStore(),now:()=>now,observe:(ref,at)=>R.observe(h.p,ref,at),execute:async action=>calls.push(action),log:{info(){},warn(){},error:assert.fail}});engine.running=true;t.after(()=>engine.stop());
 await engine.tick();wind.status.value=3.21;now+=1000;wind.status.last_updated_ts=now/1000;
 clearTimeout(runtime.timer);await runtime.poll();await engine.tick();assert.equal(calls.length,0);
 const observedAt=R.observe(h.p,source,now).observedAt;now+=31000;
 clearTimeout(runtime.timer);await runtime.poll();assert.equal(R.observe(h.p,source,now).observedAt,observedAt);await engine.tick();assert.equal(calls.length,0);
 wind.status.last_updated_ts=now/1000;clearTimeout(runtime.timer);await runtime.poll();await engine.tick();assert.equal(calls.length,1);
 now+=121000;h.p.shading.statusStore.records.get(cover.id).bthomeCheckedAt=now;assert.equal(R.observe(h.p,source,now),null);
});

test('shutdown ignores a late BTHome response and never starts a second polling client',async t=>{
 const h=harness(t),entered=deferred(),release=deferred();let first=true;
 h.state.beforeComponents=async()=>{if(first){first=false;entered.resolve();await release.promise;}};
 h.api.emit('didFinishLaunching');const runtime=h.p.shading.devices[0];await entered.promise;
 assert.equal(h.p.shadingBthome.units.get(cover.id).client,runtime.client);h.api.emit('shutdown');release.resolve();await runtime.initialPoll;await immediate();
 assert.equal(h.p.shadingBthome.running,false);assert.equal(runtime.controller.disposed,true);
 assert.equal(h.registered.filter(row=>row.a.context.bthomeHostArea==='shading').length,0);
 assert.equal(runtime.bthomeStatus.bthomeOnline,false);const before=h.requests.length;await h.p.shadingBthome.poll(runtime);assert.equal(h.requests.length,before);
});

test('partial shading configuration failure preserves existing cover and sensor caches for correction',async t=>{
 const h=harness(t,{deviceOverrides:{dailyReboot:{enabled:true,time:'not-a-time'}}});
 const coverUuid=h.api.hap.uuid.generate('homebridge-shelly-raffstore:'+cover.id);
 const existing=h.cached('Existing blind',coverUuid,{deviceId:cover.id,combinedEngine:'shading',savedValue:42});
 const priorStation={...h.f.station,id:'previous-weather'},sensorUuid=h.p.shadingBthome.uuid(h.device,priorStation);
 const sensor=h.cached('Existing weather',sensorUuid,{deviceId:cover.id,bthomeId:priorStation.id,bthomeHostArea:'shading',combinedEngine:'shading-bthome'});
 await h.launch();assert.equal(h.p.shading.devices.length,0);assert.equal(h.requests.length,0);assert.equal(h.removed.length,0);
 assert.equal(h.p.shading.cached[0],existing);assert.equal(h.p.shadingBthome.cache.get(sensorUuid),sensor);
});

test('removed shading-host sensor is pruned without removing its cover accessory',async t=>{
 const h=harness(t),uuid=h.p.shadingBthome.uuid(h.device,{...h.f.station,id:'removed-weather'});
 h.cached('Removed weather',uuid,{deviceId:cover.id,bthomeId:'removed-weather',bthomeHostArea:'shading',combinedEngine:'shading-bthome'});
 await h.launch();assert.deepEqual(h.removed.map(row=>row.a.UUID),[uuid]);
 assert.equal(h.p.shading.devices.length,1);assert.equal(h.p.shadingBthome.cache.size,1);
});

for(const [name,bthome,extra]of [
 ['malformed BTHome list',{},{}],
 ['null sensor entry',[null],{}],
 ['duplicate sensor identity',[{id:'same',deviceComponent:'bthomedevice:200'},{id:'same',deviceComponent:'bthomedevice:201'}],{}],
 ['cloud BTHome host',[{id:'weather',deviceComponent:'bthomedevice:200'}],{connection:'cloud'}],
])test('invalid shading-host '+name+' stays inactive and preserves cached state',async t=>{
 const h=harness(t,{deviceOverrides:{bthome,...extra}});assert.equal(h.p.configurationError,true);
 const before={deviceId:cover.id,bthomeHostArea:'shading',combinedEngine:'shading-bthome',savedValue:42};
 const sensor=h.cached('Existing sensor',h.api.hap.uuid.generate('existing-weather'),structuredClone(before));
 h.api.emit('didFinishLaunching');await immediate();assert.deepEqual(sensor.context,before);
 assert.equal(h.requests.length,0);assert.equal(h.registered.length,0);assert.equal(h.removed.length,0);assert.deepEqual(fs.readdirSync(h.folder),[]);
});
