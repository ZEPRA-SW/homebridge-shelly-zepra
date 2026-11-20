'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
const {HomebridgeAPI}=require(apiModule),{ShadingBthome}=require('../lib/shading-bthome'),{ws90Fixture}=require('../engines/universal/test/ws90-fixture');
const {ShellyClient}=require('../engines/shading/lib/client'),{ShellyPlatform}=require('../engines/shading');
function setup(t,{hidden=false}={}) {
 const f=ws90Fixture(),api=new HomebridgeAPI(),calls={registered:[],updated:[],removed:[],reads:0,writes:0},warnings=[];
 const d={id:'shade-weather-host',name:'South shade',host:f.host.host,shellyDeviceId:f.host.shellyDeviceId,deviceType:'roller',homekitEnabled:!hidden,bthome:[f.station]};
 api.registerPlatformAccessories=(p,n,a)=>calls.registered.push(...a);api.updatePlatformAccessories=a=>calls.updated.push(...a);api.unregisterPlatformAccessories=(p,n,a)=>calls.removed.push(...a);
 const log={info(){},warn:m=>warnings.push(m),error:assert.fail},config={language:'en',pollInterval:20,shading:{devices:[d]}},bridge=new ShadingBthome(log,config,api);
 const runtime={config:d,client:{snapshotComponents:async()=>{calls.reads++;return f.snap;},write:async()=>{calls.writes++;}},controller:{disposed:false}};
 bridge.attach(runtime);t.after(()=>bridge.stop());return {f,api,d,calls,warnings,log,config,bridge,runtime};
}
test('shading-host WS90 uses the existing client, namespaced stable sensors and readonly HAP',async t=>{
 const s=setup(t),{f,api,d,bridge,runtime,calls}=s;f.snap.components[0].status.paired=false;
 await bridge.poll(runtime);assert.equal(calls.reads,1);assert.equal(calls.writes,0);assert.equal(runtime.bthomeStatus.bthomeOnline,true);assert.equal(runtime.bthomeStatus.bthomeMaxAge,75000);
 const group=runtime.bthomeStatus.bthome[0];assert.equal(group.id,f.station.id);assert.equal(group.readings.length,13);assert.ok(group.readings.every(r=>!r.fault));const wind=group.readings.find(r=>r.metric==='WindSpeed');assert.equal(wind.unit,'km/h');assert.equal(wind.observedAt,f.now*1000);
 const unit=bridge.units.get(d.id),record=unit.accessories[0],uuid=record.accessory.UUID;assert.equal(calls.registered.length,1);assert.equal(record.accessory.context.bthomeHostArea,'shading');
 assert.notEqual(uuid,api.hap.uuid.generate('homebridge-shelly-raffstore:'+d.id));assert.notEqual(uuid,api.hap.uuid.generate('homebridge-shelly-universal:'+d.id+':bthome:'+f.station.id));
 const ch=record.accessory.getServiceById(bridge.types.services.weather,'su:'+f.keys.WindSpeed).getCharacteristic(bridge.types.chars.WindSpeed);assert.ok(Math.abs(await ch.handleGetRequest()-11.556)<1e-8);assert.ok(!ch.props.perms.includes(api.hap.Perms.PAIRED_WRITE));
 const second=new ShadingBthome(s.log,s.config,api);t.after(()=>second.stop());second.configureAccessory(record.accessory);const resumed={...runtime};second.attach(resumed);await second.poll(resumed);assert.equal(second.units.get(d.id).accessories[0].accessory,record.accessory);assert.equal(calls.registered.length,1);
 second.hosts=[];second.prune();assert.equal(calls.removed[0].UUID,uuid);
});
test('sensor failures retain typed unknown rows, preserve cover state, then recover without replacing HAP services',async t=>{
 const {f,d,bridge,runtime,warnings}=setup(t);runtime.coverOnline=true;await bridge.poll(runtime);const record=bridge.units.get(d.id).accessories[0],service=record.accessory.getServiceById(bridge.types.services.weather,'su:'+f.keys.WindSpeed);
 runtime.client.snapshotComponents=async()=>{throw Error('sensor read unavailable');};await bridge.poll(runtime);assert.equal(runtime.coverOnline,true);assert.equal(runtime.bthomeStatus.bthomeOnline,false);assert.equal(runtime.bthomeStatus.bthome[0].readings.length,13);assert.ok(runtime.bthomeStatus.bthome[0].readings.every(r=>r.fault&&!Object.keys(r.values).length));assert.equal(runtime.bthomeStatus.bthome[0].readings.find(r=>r.metric==='WindSpeed').unit,'km/h');await assert.rejects(service.getCharacteristic(bridge.types.chars.WindSpeed).handleGetRequest());
 await bridge.poll(runtime);assert.equal(warnings.length,1,'unchanged poll failure is not logged repeatedly');
 runtime.client.snapshotComponents=async()=>f.snap;await bridge.poll(runtime);assert.equal(runtime.bthomeStatus.bthomeOnline,true);assert.equal(record.accessory.getServiceById(bridge.types.services.weather,'su:'+f.keys.WindSpeed),service);
 for(const c of f.snap.components.slice(1))c.status.last_updated_ts-=121;await bridge.poll(runtime);assert.ok(runtime.bthomeStatus.bthome[0].readings.every(r=>r.fault&&!Object.keys(r.values).length));
});
test('shading visibility hides sensor accessories while status stays available; an unconfigured host sends no sensor requests',async t=>{
 const {runtime,bridge,calls}=setup(t,{hidden:true});await bridge.poll(runtime);assert.equal(calls.registered.length,0);assert.equal(runtime.bthomeStatus.bthomeOnline,true);assert.equal(runtime.bthomeStatus.bthome[0].readings.length,13);
 const empty={config:{...runtime.config,id:'no-sensors',bthome:[]},client:runtime.client};bridge.attach(empty);await bridge.poll(empty);assert.equal(calls.reads,1);assert.equal(Object.hasOwn(empty,'bthomeStatus'),false);
});
test('the real shading poll keeps cover and BTHome failure domains independent',async t=>{
 const s=setup(t),{api,d,f,bridge}=s,p=new ShellyPlatform(s.log,{devices:[d],pollInterval:20},api),states=new Map();p.statusStore={update:(id,state)=>states.set(id,state),close(){}};p.bthomeBridge=bridge;
 const client={call:async method=>method==='Cover.GetConfig'?{}:{pos_control:true,current_pos:50,state:'stopped'},snapshotComponents:async()=>f.snap};
 const a=new api.platformAccessory(d.name,api.hap.uuid.generate('test-cover')),runtime=p.setup(a,d,client);runtime.config=d;runtime.client=client;bridge.attach(runtime);t.after(()=>{clearTimeout(runtime.timer);runtime.controller.dispose();});
 await runtime.poll();clearTimeout(runtime.timer);assert.equal(states.get(d.id).online,true);assert.equal(states.get(d.id).bthomeOnline,true);
 client.snapshotComponents=async()=>{throw Error('sensor failed');};await runtime.poll();clearTimeout(runtime.timer);assert.equal(states.get(d.id).online,true);assert.equal(states.get(d.id).bthomeOnline,false);
 client.call=async()=>{throw Error('cover failed');};client.snapshotComponents=async()=>f.snap;await runtime.poll();clearTimeout(runtime.timer);assert.equal(states.get(d.id).online,false);assert.equal(states.get(d.id).bthomeOnline,true);
});
test('an in-flight sensor read cannot publish or register accessories after shutdown',async t=>{
 for(const reject of [false,true]) {
  const {runtime,bridge,calls,warnings}=setup(t);let finish;
  runtime.client.snapshotComponents=()=>new Promise((resolve,fail)=>{finish=reject?fail:resolve;});
  const before=runtime.bthomeStatus,pending=bridge.poll(runtime);bridge.stop();finish(reject?Error('late failure'):ws90Fixture().snap);await pending;
  assert.equal(runtime.bthomeStatus,before);assert.equal(calls.registered.length,0);assert.equal(calls.updated.length,0);assert.equal(warnings.length,0);
 }
});
function clientWith(responder) {
 const calls=[],client=new ShellyClient({host:'192.0.2.25',shellyDeviceId:'aabbccddeeff'},async(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);return new Response(JSON.stringify({id:request.id,result:await responder(request)}),{status:200,headers:{'content-type':'application/json'}});
 });return {client,calls};
}
test('component snapshots serialize identity, all pages and commands on the existing shading queue',async()=>{
 const f=ws90Fixture(),{client,calls}=clientWith(async r=>{
  if(r.method==='Shelly.GetDeviceInfo')return {id:'shellyplus2pm-aabbccddeeff',mac:'AA:BB:CC:DD:EE:FF',profile:'cover'};
  if(r.method==='Shelly.GetComponents')return {total:f.snap.components.length,components:r.params.offset===0?f.snap.components.slice(0,7):f.snap.components.slice(7)};
  return {};
 });
 const snapshot=client.snapshotComponents([f.station]),command=client.call('Cover.GoToPosition',{id:0,pos:60});const snap=await snapshot;await command;
 assert.equal(snap.components.length,14);assert.deepEqual(calls.map(r=>r.method),['Shelly.GetDeviceInfo','Shelly.GetComponents','Shelly.GetComponents','Shelly.GetDeviceInfo','Cover.GoToPosition']);assert.deepEqual(calls.filter(r=>r.method==='Shelly.GetComponents').map(r=>r.params),[{offset:0,include:['config','status'],dynamic_only:true},{offset:7,include:['config','status'],dynamic_only:true}]);
});
test('component snapshots reject a different host and incomplete or duplicate pages',async()=>{
 const wrong=clientWith(async()=>({id:'shellyplus2pm-112233445566',mac:'112233445566'}));await assert.rejects(wrong.client.snapshotComponents(),e=>e.code==='SHELLY_ID_MISMATCH');assert.deepEqual(wrong.calls.map(r=>r.method),['Shelly.GetDeviceInfo']);
 for(const pages of [
  [{components:[],total:1}],
  [{components:[{key:'bthomedevice:200'}],total:2},{components:[{key:'bthomedevice:200'}],total:2}],
  [{components:[{key:'bthomedevice:200'}],total:2},{components:[],total:2}]
 ]){const setup=clientWith(async r=>r.method==='Shelly.GetDeviceInfo'?{mac:'aabbccddeeff'}:pages.shift());await assert.rejects(setup.client.snapshotComponents());}
});
