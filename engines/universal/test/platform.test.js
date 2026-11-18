'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
const {HomebridgeAPI}=require(apiModule);const {Platform}=require('..');const {model}=require('../lib/model');const {device,rpc,bthome}=require('./fixtures');
function setup(t,config={devices:[device()]}) {
  const api=new HomebridgeAPI(),records={registered:[],updated:[],removed:[],logs:[]};
  for(const [method,key] of [['registerPlatformAccessories','registered'],['unregisterPlatformAccessories','removed']])api[method]=(_p,_a,accessories)=>records[key].push(...accessories);
  api.updatePlatformAccessories=accessories=>records.updated.push(...accessories);
  const log=Object.fromEntries(['info','warn','error'].map(k=>[k,s=>records.logs.push(s)]));
  const p=new Platform(log,config,api);p.makeStatusStore=()=>({save(){},update(){},stop(){}});t.after(()=>p.stop());
  const unit={config:config.devices[0],accessories:[],counters:new Map(),writeTail:Promise.resolve(),client:{write:async()=>{}},failures:0};
  return {p,api,records,unit};
}
test('real Homebridge registration exports correct platform name',()=>{let registered;require('..')({registerPlatform:(...args)=>registered=args});assert.equal(registered[0],'homebridge-shelly-universal');assert.equal(registered[1],'ShellyUniversal');assert.equal(registered[2],Platform);});
test('stable HomeKit UUID survives IP/name changes and differs for BTHome devices',t=>{
  const {p}=setup(t),d=device();assert.equal(p.uuid(d),p.uuid({...d,host:'192.0.2.20',name:'Renamed'}));assert.notEqual(p.uuid(d),p.uuid({...d,id:'new'}));assert.notEqual(p.uuid(d),p.uuid(d,bthome().config));
});
test('real HAP services register with only supported characteristics and no credentials in cache',async t=>{
  const {p,api,records,unit}=setup(t),snap=rpc(),record=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,record,model(snap,unit.config).descriptors);
  assert.equal(records.registered.length,1);const service=record.accessory.getServiceById(api.hap.Service.Outlet,'su:switch:0');assert.equal(await service.getCharacteristic(api.hap.Characteristic.On).handleGetRequest(),true);
  assert.ok(!JSON.stringify(record.accessory.context).includes('password'));assert.ok(!record.accessory.services.some(s=>s.UUID===api.hap.Service.WindowCovering.UUID));
  const energy=record.accessory.getServiceById(p.types.services.energy,'su:switch:0:energy');assert.equal(await energy.getCharacteristic(p.types.chars.Energy).handleGetRequest(),1.234);
});
test('offline and missing sensor reads fail instead of returning cached success',async t=>{
  const {p,api,unit}=setup(t),snap=rpc(),record=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,record,model(snap,unit.config).descriptors);
  unit.config.addons=[{type:'plus-addon'}];p.reconcile(unit,record,model(snap,unit.config).descriptors);
  const ch=record.accessory.getServiceById(api.hap.Service.TemperatureSensor,'su:temperature:100').getCharacteristic(api.hap.Characteristic.CurrentTemperature);
  assert.equal(await ch.handleGetRequest(),21.5);delete snap.status['temperature:100'];p.reconcile(unit,record,model(snap,unit.config).descriptors);await assert.rejects(ch.handleGetRequest());record.offline=true;await assert.rejects(record.accessory.getService(api.hap.Service.Outlet).getCharacteristic(api.hap.Characteristic.On).handleGetRequest());
});
test('per-channel service type changes remove obsolete service and disabling channels removes controls',t=>{
  const {p,api,unit}=setup(t),snap=rpc(),record=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,record,model(snap,unit.config).descriptors);unit.config.channels[0].type='light';p.reconcile(unit,record,model(snap,unit.config).descriptors);
  assert.ok(!record.accessory.getService(api.hap.Service.Outlet));assert.ok(record.accessory.getService(api.hap.Service.Lightbulb));unit.config.channels=[];p.reconcile(unit,record,model(snap,unit.config).descriptors);assert.ok(!record.accessory.getService(api.hap.Service.Lightbulb));
});
test('writes use the actual channel and map HomeKit On without fabricated dimming',async t=>{
  const {p,api,unit}=setup(t),record=p.getRecord(unit,undefined,rpc().info);p.reconcile(unit,record,model(rpc(),unit.config).descriptors);let request;unit.client.write=async(...args)=>{request=args;};
  await record.accessory.getService(api.hap.Service.Outlet).getCharacteristic(api.hap.Characteristic.On).handleSetRequest(false);assert.deepEqual(request,['switch:0',{on:false}]);
});
test('RGB concurrent Hue/Saturation setters serialize using latest colour state',async t=>{
  const config={devices:[{...device(),channels:[{component:'rgb:0',type:'light'}]}]}, {p,api,unit}=setup(t,config),snap=rpc();snap.status={'rgb:0':{output:true,brightness:100,rgb:[255,0,0]}};const record=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,record,model(snap,unit.config).descriptors);const calls=[];unit.client.write=async(...args)=>{await new Promise(r=>setImmediate(r));calls.push(args);};const s=record.accessory.getService(api.hap.Service.Lightbulb);
  await Promise.all([s.getCharacteristic(api.hap.Characteristic.Hue).handleSetRequest(120),s.getCharacteristic(api.hap.Characteristic.Saturation).handleSetRequest(50)]);assert.deepEqual(calls.at(-1),['rgb:0',{rgb:[128,255,128]}]);
});
test('BTHome stale readings fail; only mapped sensors appear on separate accessory',async t=>{
  const b=bthome(),config={devices:[{...device(),bthome:[b.config]}]}, {p,api,unit}=setup(t,config),snap=rpc();snap.components=b.components;const m=model(snap,unit.config,1000000),record=p.getRecord(unit,b.config,snap.info);p.reconcile(unit,record,m.bluetooth[0].descriptors,m.bluetooth[0].fault);
  assert.ok(record.accessory.getServiceById(api.hap.Service.TemperatureSensor,'su:bthomesensor:207'));assert.ok(!record.accessory.getServiceById(api.hap.Service.TemperatureSensor,'su:bthomesensor:200'));await assert.rejects(record.accessory.getService(api.hap.Service.TemperatureSensor).getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest());
});
test('Gen1 event counters avoid startup replay and emit changed counters once',t=>{
  const {p,api,unit}=setup(t),r=p.getRecord(unit,undefined,rpc().info),d={key:'input:0',type:'button',name:'Button',values:{},counter:9,event:'S'};p.reconcile(unit,r,[d]);const ch=r.accessory.getService(api.hap.Service.StatelessProgrammableSwitch).getCharacteristic(api.hap.Characteristic.ProgrammableSwitchEvent);const events=[];ch.on('change',e=>events.push(e.newValue));p.reconcile(unit,r,[d]);p.reconcile(unit,r,[{...d,counter:10,event:'SS'}]);p.reconcile(unit,r,[{...d,counter:10,event:'SS'}]);assert.deepEqual(events,[1]);
});
test('RPC input events route only to configured stateless services',t=>{
  const {p,api,unit}=setup(t),r=p.getRecord(unit,undefined,rpc().info);p.reconcile(unit,r,[{key:'input:0',type:'button',name:'Button',values:{}}]);const ch=r.accessory.getService(api.hap.Service.StatelessProgrammableSwitch).getCharacteristic(api.hap.Characteristic.ProgrammableSwitchEvent),events=[];ch.on('change',e=>events.push(e.newValue));p.event(unit,{component:'input:1'},0);p.event(unit,{component:'input:0'},2);assert.deepEqual(events,[2]);
});
test('no network access when device list is empty; removed accessories unregister on launch',t=>{
  const {p,api,records}=setup(t,{devices:[]});const a=new api.platformAccessory('Old',api.hap.uuid.generate('old'));p.configureAccessory(a);p.launch();assert.equal(p.units.size,0);assert.deepEqual(records.removed,[a]);
});
test('cached accessories stay present when a configured host is offline at restart',async t=>{
  const {p,api,records,unit}=setup(t),record=p.getRecord(unit,undefined,rpc().info);p.reconcile(unit,record,model(rpc(),unit.config).descriptors);record.offline=true;p.running=true;unit.client.snapshot=async()=>{throw Error('offline');};await p.poll(unit);assert.ok(record.offline);assert.equal(records.removed.length,0);assert.ok(records.logs.some(s=>s.includes('offline')));assert.equal(await record.accessory.getService(api.hap.Service.Outlet).getCharacteristic(api.hap.Characteristic.On).handleGetRequest().then(()=>false,()=>true),true);
});
test('disabling an individual channel meter removes its service without removing other meters',t=>{
  const {p,unit}=setup(t),snap=rpc();snap.status['switch:1']={output:false,apower:5};unit.config.channels.push({component:'switch:1',type:'switch'});const r=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,r,model(snap,unit.config).descriptors);unit.config.channels[0].showEnergy=false;p.reconcile(unit,r,model(snap,unit.config).descriptors);assert.ok(!r.accessory.getServiceById(p.types.services.energy,'su:switch:0:energy'));assert.ok(r.accessory.getServiceById(p.types.services.energy,'su:switch:1:energy'));
});
test('configured dimmer power-on brightness is reflected in subsequent HomeKit reads',async t=>{
  const {p,api,unit}=setup(t),snap=rpc();unit.config.channels=[{component:'light:0',type:'light',onBrightness:40,transitionSeconds:2}];snap.status['light:0']={output:false,brightness:10};const r=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,r,model(snap,unit.config).descriptors);let request;unit.client.write=async(...args)=>request=args;const s=r.accessory.getService(api.hap.Service.Lightbulb);await s.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.deepEqual(request,['light:0',{on:true,brightness:40,transition_duration:2}]);assert.equal(await s.getCharacteristic(api.hap.Characteristic.Brightness).handleGetRequest(),40);
});
test('disabling all services unregisters an empty accessory and can re-enable the same UUID',t=>{
  const {p,unit,records}=setup(t),snap=rpc();unit.config.nativeSensors=false;unit.config.energy=false;const r=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,r,model(snap,unit.config).descriptors);const uuid=r.accessory.UUID;unit.config.channels[0].enabled=false;p.reconcile(unit,r,model(snap,unit.config).descriptors);assert.deepEqual(records.removed,[r.accessory]);assert.ok(r.new);unit.config.channels[0].enabled=true;p.reconcile(unit,r,model(snap,unit.config).descriptors);assert.equal(records.registered.length,2);assert.equal(r.accessory.UUID,uuid);assert.ok(!r.new);
});
function fourChannel(t) {
  const d=device();require('../homebridge-ui/public/models').select(d,'pro4pm');d.nativeSensors=false;
  const setupResult=setup(t,{devices:[d]}),snap=rpc();snap.status={};
  for(let id=0;id<4;id++)snap.status['switch:'+id]={output:id%2===0,apower:10+id,voltage:230+id,current:.1+id,aenergy:{total:1000*(id+1)}};
  return {...setupResult,snap,d};
}
test('Pro 4PM registers four independent HomeKit accessories, each with one primary output',t=>{
  const {p,api,unit,snap,records}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,unit.config));
  assert.equal(records.registered.length,4);assert.equal(new Set(records.registered.map(a=>a.UUID)).size,4);
  for(const a of records.registered){assert.equal(a.services.filter(s=>/^su:switch:\d+$/.test(s.subtype)).length,1);assert.ok(a.getService(api.hap.Service.Switch).isPrimaryService);assert.ok(a.context.channelComponent);assert.ok(!a.services.some(s=>s.UUID===api.hap.Service.WindowCovering.UUID));}
});
test('per-channel meters are read-only custom characteristics on their own output service',async t=>{
  const {p,api,unit,snap}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,unit.config));
  for(let id=0;id<4;id++){
    const r=unit.accessories.find(r=>r.channel==='switch:'+id),s=r.accessory.getService(api.hap.Service.Switch);
    assert.equal(await s.getCharacteristic(p.types.chars.Power).handleGetRequest(),10+id);assert.equal(await s.getCharacteristic(p.types.chars.Energy).handleGetRequest(),id+1);assert.equal(await s.getCharacteristic(p.types.chars.Voltage).handleGetRequest(),230+id);assert.ok(!s.getCharacteristic(p.types.chars.Power).props.perms.includes(api.hap.Perms.PAIRED_WRITE));assert.ok(!s.getCharacteristic(p.types.chars.Power).setHandler);
  }
});
test('Pro Dimmer 2PM produces two independently controlled dimmer accessories with their own meters',async t=>{
  const d=device();require('../homebridge-ui/public/models').select(d,'pro-dimmer2pm');d.nativeSensors=false;const {p,api,unit,records}=setup(t,{devices:[d]}),snap=rpc();snap.status={'light:0':{output:true,brightness:20,apower:8},'light:1':{output:false,brightness:60,apower:0}};
  p.syncAccessories(unit,snap,model(snap,d));assert.equal(records.registered.length,2);const writes=[];unit.client.write=async(...args)=>writes.push(args);
  for(const [id,brightness] of [[0,30],[1,70]]){const r=unit.accessories.find(r=>r.channel==='light:'+id);await r.accessory.getService(api.hap.Service.Lightbulb).getCharacteristic(api.hap.Characteristic.Brightness).handleSetRequest(brightness);}
  assert.deepEqual(writes,[['light:0',{brightness:30}],['light:1',{brightness:70}]]);
});
test('channel UUIDs survive IP/name/type and config order changes and never alias another output',t=>{
  const {p,unit,snap,d}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,d));const ids=new Map(unit.accessories.filter(r=>r.channel).map(r=>[r.channel,r.accessory.UUID]));
  d.host='192.0.2.99';d.name='Renamed host';d.channels[0].type='outlet';d.channels[0].name='Desk';d.channels.reverse();p.syncAccessories(unit,snap,model(snap,d));
  for(const r of unit.accessories.filter(r=>r.channel))assert.equal(r.accessory.UUID,ids.get(r.channel));assert.equal(unit.accessories.find(r=>r.channel==='switch:0').accessory.displayName,'Desk');assert.notEqual(p.channelUuid(d,'switch:0'),p.channelUuid(d,'switch:1'));
});
test('legacy combined output services migrate to separate accessories without leaving a four-way switch',t=>{
  const {p,api,unit,snap,records}=fourChannel(t),old=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,old,model(snap,unit.config).descriptors);assert.equal(old.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID).length,4);records.registered.length=0;
  p.syncAccessories(unit,snap,model(snap,unit.config));assert.ok(records.removed.includes(old.accessory));assert.equal(old.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID).length,0);assert.equal(records.registered.length,4);
});
test('disabling one separate output unregisters only that output and preserves remaining UUIDs',t=>{
  const {p,unit,snap,records,d}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,d));const old=unit.accessories.find(r=>r.channel==='switch:1'),remaining=unit.accessories.find(r=>r.channel==='switch:2').accessory.UUID;d.channels[1].enabled=false;p.syncAccessories(unit,snap,model(snap,d));assert.deepEqual(records.removed,[old.accessory]);assert.ok(!unit.accessories.some(r=>r.channel==='switch:1'));assert.equal(unit.accessories.find(r=>r.channel==='switch:2').accessory.UUID,remaining);
});
test('a single shared Gen1 meter stays on the host rather than being mislabelled as one channel',async t=>{
  const d={...device(),channels:[{component:'relay:0',type:'switch'},{component:'relay:1',type:'switch'}],nativeSensors:false};const {p,api,unit}=setup(t,{devices:[d]}),snap={gen:1,info:{mac:d.shellyDeviceId},settings:{mode:'relay'},status:{relays:[{ison:true},{ison:false}],meters:[{power:50,total:60000}]}};
  p.syncAccessories(unit,snap,model(snap,d));const root=unit.accessories.find(r=>!r.channel&&!r.bluetooth);assert.equal(await root.accessory.getService(p.types.services.energy).getCharacteristic(p.types.chars.Power).handleGetRequest(),50);for(const r of unit.accessories.filter(r=>r.channel))assert.ok(!r.accessory.getService(api.hap.Service.Switch).testCharacteristic(p.types.chars.Power));
});
test('channel cache is restored offline at launch without a successful host snapshot',async t=>{
  const {p,unit,snap,d}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,d));const saved=unit.accessories.filter(r=>r.channel).map(r=>r.accessory);
  const again=setup(t,{devices:[structuredClone(d)]});for(const a of saved)again.p.configureAccessory(a);again.p.makeClient=()=>({snapshot:async()=>{throw Error('offline');}});again.p.launch();await new Promise(r=>setImmediate(r));const restored=again.p.units.get(d.id).accessories.filter(r=>r.channel);assert.equal(restored.length,4);assert.equal(again.records.removed.length,0);assert.deepEqual(restored.map(r=>r.accessory.UUID).sort(),saved.map(a=>a.UUID).sort());assert.ok(restored.every(r=>r.offline));
});
test('one host poll updates all four channel accessories with one shared client request',async t=>{
  const {p,unit,snap,records}=fourChannel(t);let reads=0;unit.client.snapshot=async()=>{reads++;return snap;};p.running=true;await p.poll(unit);assert.equal(reads,1);assert.equal(records.registered.length,4);
});
test('grouped mode exposes one accessory with four independently controlled and metered services',async t=>{
  const {p,api,unit,snap,records,d}=fourChannel(t);d.tileMode='grouped';p.syncAccessories(unit,snap,model(snap,d));assert.equal(records.registered.length,1);assert.equal(unit.accessories.filter(r=>r.channel).length,0);const root=unit.accessories[0];assert.equal(root.accessory.UUID,p.uuid(d));assert.equal(root.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID).length,4);const calls=[];unit.client.write=async(...args)=>calls.push(args);
  for(let id=0;id<4;id++){const service=root.accessory.getServiceById(api.hap.Service.Switch,'su:switch:'+id);assert.equal(await service.getCharacteristic(p.types.chars.Power).handleGetRequest(),10+id);await service.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(false);}assert.deepEqual(calls.map(c=>c[0]),['switch:0','switch:1','switch:2','switch:3']);assert.ok(!root.accessory.getService(p.types.services.energy));
});
test('switching separate/grouped/back removes stale accessories and reuses deterministic identities',t=>{
  const {p,api,unit,snap,records,d}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,d));const ids=new Set(unit.accessories.filter(r=>r.channel).map(r=>r.accessory.UUID));d.tileMode='grouped';p.syncAccessories(unit,snap,model(snap,d));assert.equal(records.removed.length,4);assert.equal(records.registered.length,5);const root=unit.accessories.find(r=>!r.channel&&!r.bluetooth);assert.equal(root.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID).length,4);
  d.tileMode='separate';p.syncAccessories(unit,snap,model(snap,d));assert.equal(records.removed.length,5);assert.equal(records.registered.length,9);assert.deepEqual(new Set(unit.accessories.filter(r=>r.channel).map(r=>r.accessory.UUID)),ids);assert.equal(root.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID).length,0);
});
test('different physical devices can use grouped and separate modes independently',t=>{
  const {p,unit,snap,d}=fourChannel(t);d.tileMode='grouped';p.syncAccessories(unit,snap,model(snap,d));const other={...structuredClone(d),id:'second-device',shellyDeviceId:'112233445566',host:'192.0.2.11',tileMode:'separate'},second={...unit,config:other,accessories:[],counters:new Map()};p.syncAccessories(second,snap,model(snap,other));assert.equal(unit.accessories.filter(r=>r.channel).length,0);assert.equal(second.accessories.filter(r=>r.channel).length,4);assert.notEqual(p.uuid(d),p.uuid(other));
});
test('grouped mode cache restores offline without allowing old separate output caches',async t=>{
  const {p,unit,snap,d}=fourChannel(t);p.syncAccessories(unit,snap,model(snap,d));const separate=unit.accessories.filter(r=>r.channel).map(r=>r.accessory);d.tileMode='grouped';p.syncAccessories(unit,snap,model(snap,d));const grouped=unit.accessories.find(r=>!r.channel&&!r.bluetooth).accessory;const again=setup(t,{devices:[structuredClone(d)]});for(const a of [grouped,...separate])again.p.configureAccessory(a);again.p.makeClient=()=>({snapshot:async()=>{throw Error('offline');}});again.p.launch();await new Promise(r=>setImmediate(r));assert.equal(again.records.removed.length,4);const restored=again.p.units.get(d.id).accessories;assert.equal(restored.length,1);assert.equal(restored[0].accessory.UUID,grouped.UUID);assert.ok(restored[0].offline);
});
test('legacy grouped accessory keeps its identity and output services when grouped mode is selected',async t=>{
  const {p,api,unit,snap,records,d}=fourChannel(t);d.tileMode='grouped';const old=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,old,model(snap,d).descriptors);const uuid=old.accessory.UUID,services=old.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID);p.syncAccessories(unit,snap,model(snap,d));assert.equal(records.registered.length,1);assert.equal(records.removed.length,0);assert.equal(old.accessory.UUID,uuid);assert.deepEqual(old.accessory.services.filter(s=>s.UUID===api.hap.Service.Switch.UUID),services);assert.ok(!old.accessory.getService(p.types.services.energy));assert.equal(await services[2].getCharacteristic(p.types.chars.Power).handleGetRequest(),12);
});

test('update removes cached internal sensors and keeps add-on and output identity',t=>{
 const {p,api,unit}=setup(t),snap=rpc();unit.config.addons=[{type:'plus-addon'}];unit.config.nativeSensors=true;const r=p.getRecord(unit,undefined,snap.info);
 p.reconcile(unit,r,[...model(snap,unit.config).descriptors,{key:'switch:0:temperature',name:'Internal',type:'temperature',values:{CurrentTemperature:56}},{key:'motion:0',name:'Internal motion',type:'motion',values:{MotionDetected:false}}]);
 const uuid=r.accessory.UUID;p.reconcile(unit,r,model(snap,unit.config).descriptors);assert.equal(r.accessory.UUID,uuid);assert.ok(!r.accessory.getServiceById(api.hap.Service.TemperatureSensor,'su:switch:0:temperature'));assert.ok(!r.accessory.getService(api.hap.Service.MotionSensor));assert.ok(r.accessory.getServiceById(api.hap.Service.TemperatureSensor,'su:temperature:100'));assert.ok(r.accessory.getService(api.hap.Service.Outlet));
});

test('connection lamp reports completed polls, failures and recovery',async t=>{
 const {p,unit}=setup(t),updates=[];p.statusStore={update:(...args)=>updates.push(args),stop(){}};p.running=true;t.after(()=>clearTimeout(unit.timer));unit.client.snapshot=async()=>rpc();
 await p.poll(unit);assert.deepEqual(updates.at(-1).slice(0,2),[unit.config.id,true]);assert.equal(updates.at(-1)[3][0].values.Power,50);assert.equal(updates.at(-1)[4][0].values.On,true);
 unit.config.channels[0].enabled=false;await p.poll(unit);assert.equal(updates.at(-1)[4].find(r=>r.component==='switch:0').values.On,true);
 unit.client.snapshot=async()=>{throw Error('offline');};await p.poll(unit);assert.deepEqual(updates.at(-1),[unit.config.id,false]);
 unit.client.snapshot=async()=>rpc();await p.poll(unit);assert.deepEqual(updates.at(-1).slice(0,2),[unit.config.id,true]);assert.equal(updates.at(-1)[3][0].values.Power,50);assert.equal(updates.at(-1)[4][0].values.On,true);
});

test('optional Wall Display thermostat is a dedicated accessory with working controls',async t=>{
 const d={...device(),modelId:'wall-xl',generation:'rpc',thermostat:true,wallIlluminance:true},snap=structuredClone(require('./wall-display-fixtures').xl),{p,api,unit,records}=setup(t,{devices:[d]});let calls=[];unit.client.write=async(...args)=>calls.push(args);p.syncAccessories(unit,snap,model(snap,d));
 const host=unit.accessories.find(r=>!r.channel&&!r.bluetooth&&!r.thermostat),thermostat=unit.accessories.find(r=>r.thermostat==='thermostat:0'),service=thermostat.accessory.getService(api.hap.Service.Thermostat);assert.ok(service);assert.ok(!host.accessory.getService(api.hap.Service.Thermostat));assert.notEqual(host.accessory.UUID,thermostat.accessory.UUID);assert.equal(thermostat.accessory.category,api.hap.Categories.THERMOSTAT);
 assert.ok(Math.abs(await service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest()-21.9)<1e-6);assert.deepEqual(service.getCharacteristic(api.hap.Characteristic.TargetHeatingCoolingState).props.validValues,[0,1,2]);await service.getCharacteristic(api.hap.Characteristic.TargetTemperature).handleSetRequest(23);assert.deepEqual(calls.at(-1),['thermostat:0',{config:{target_C:23}}]);await service.getCharacteristic(api.hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(0);assert.deepEqual(calls.at(-1),['thermostat:0',{config:{enable:false}}]);
 await service.getCharacteristic(api.hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(2);assert.deepEqual(calls.at(-1),['thermostat:0',{config:{type:'cooling',enable:true}}]);await service.getCharacteristic(api.hap.Characteristic.TargetHeatingCoolingState).handleSetRequest(1);assert.deepEqual(calls.at(-1),['thermostat:0',{config:{type:'heating',enable:true}}]);
 const uuid=host.accessory.UUID;d.thermostat=false;p.syncAccessories(unit,snap,model(snap,d));assert.ok(records.removed.includes(thermostat.accessory));assert.ok(!unit.accessories.some(r=>r.thermostat));assert.equal(host.accessory.UUID,uuid);assert.ok(host.accessory.getService(api.hap.Service.LightSensor));d.wallIlluminance=false;p.syncAccessories(unit,snap,model(snap,d));assert.ok(!host.accessory.getService(api.hap.Service.LightSensor));
});

test('XL removes cached internal temperature and humidity even when legacy flags remain true',async t=>{
 const d={...device(),modelId:'wall-xl',generation:'rpc',thermostat:true,wallTemperature:true,wallHumidity:true,wallMotion:true,wallIlluminance:true},snap=structuredClone(require('./wall-display-fixtures').xl),{p,api,unit}=setup(t,{devices:[d]}),host=p.getRecord(unit,undefined,snap.info);
 p.reconcile(unit,host,[{key:'temperature:0',type:'temperature',name:'Old temperature',values:{CurrentTemperature:21}},{key:'humidity:0',type:'humidity',name:'Old humidity',values:{CurrentRelativeHumidity:45}}]);const uuid=host.accessory.UUID;p.syncAccessories(unit,snap,model(snap,d));assert.equal(host.accessory.UUID,uuid);assert.ok(!host.accessory.getService(api.hap.Service.TemperatureSensor));assert.ok(!host.accessory.getService(api.hap.Service.HumiditySensor));assert.ok(host.accessory.getService(api.hap.Service.MotionSensor));assert.ok(host.accessory.getService(api.hap.Service.LightSensor));const thermostat=unit.accessories.find(r=>r.thermostat);assert.ok(Number.isFinite(await thermostat.accessory.getService(api.hap.Service.Thermostat).getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest()));
 snap.status['temperature:0']={tC:22.5};snap.status['humidity:0']={rh:45};p.syncAccessories(unit,snap,model(snap,d));assert.ok(!host.accessory.getService(api.hap.Service.TemperatureSensor));assert.ok(!host.accessory.getService(api.hap.Service.HumiditySensor));
});

test('old combined Display thermostat migrates away from motion for both output modes',t=>{
 const d={...device(),modelId:'wall-xl',generation:'rpc',thermostat:true,wallMotion:true,inputs:[{component:'input:1',mode:'button'}]},snap=structuredClone(require('./wall-display-fixtures').xl),{p,api,unit}=setup(t,{devices:[d]}),old=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,old,model(snap,d).descriptors);const oldUuid=old.accessory.UUID;
 p.syncAccessories(unit,snap,model(snap,d));const record=unit.accessories.find(r=>r.thermostat),uuid=record.accessory.UUID;assert.ok(old.accessory.getService(api.hap.Service.MotionSensor));assert.ok(!old.accessory.getService(api.hap.Service.Thermostat));assert.equal(old.accessory.UUID,oldUuid);assert.ok(!record.accessory.getService(api.hap.Service.MotionSensor));
 d.tileMode='grouped';d.name='Renamed';d.host='192.0.2.99';p.syncAccessories(unit,snap,model(snap,d));assert.equal(unit.accessories.find(r=>r.thermostat).accessory.UUID,uuid);assert.equal(record.accessory.displayName,'Renamed Thermostat');assert.ok(!old.accessory.getService(api.hap.Service.Thermostat));
 const button=old.accessory.getService(api.hap.Service.StatelessProgrammableSwitch).getCharacteristic(api.hap.Characteristic.ProgrammableSwitchEvent),events=[];button.on('change',e=>events.push(e.newValue));p.event(unit,{component:'input:1'},1);assert.deepEqual(events,[1]);
 delete snap.status['thermostat:0'];p.syncAccessories(unit,snap,model(snap,d));assert.equal(record.accessory.UUID,uuid);assert.ok(record.offline);assert.ok(record.accessory.getService(api.hap.Service.Thermostat));
});

test('dedicated thermostat cache restores offline and disabling removes its registration',async t=>{
 const d={...device(),modelId:'wall-xl',generation:'rpc',thermostat:true},snap=structuredClone(require('./wall-display-fixtures').xl),{p,unit,api}=setup(t,{devices:[d]});p.syncAccessories(unit,snap,model(snap,d));const a=unit.accessories.find(r=>r.thermostat).accessory;
 const next=setup(t,{devices:[d]});next.p.configureAccessory(a);next.p.makeClient=()=>({snapshot:async()=>{throw Error('offline');}});next.p.launch();const restored=next.p.units.get(d.id).accessories.find(r=>r.thermostat);assert.equal(restored.accessory.UUID,a.UUID);await assert.rejects(restored.accessory.getService(api.hap.Service.Thermostat).getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest());
 const disabled=setup(t,{devices:[{...d,thermostat:false}]});disabled.p.configureAccessory(a);disabled.p.makeClient=()=>({snapshot:async()=>{throw Error('offline');}});disabled.p.launch();assert.ok(disabled.records.removed.includes(a));
});

test('virtual components are separate from physical channels and grouped output accessories',async t=>{
 const d={...device(),virtualComponents:[{component:'boolean:200',name:'Watchalarm',mode:'switch'},{component:'button:201',name:'Button',mode:'events'}]},snap=rpc(),{p,api,unit,records}=setup(t,{devices:[d]});snap.components=[{key:'boolean:200',status:{value:false}},{key:'button:201',status:{}}];p.syncAccessories(unit,snap,model(snap,d));const state=unit.accessories.find(r=>r.virtual==='boolean:200'),button=unit.accessories.find(r=>r.virtual==='button:201');assert.ok(state&&button);const uuid=state.accessory.UUID,calls=[];unit.client.write=async(...args)=>calls.push(args);await state.accessory.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.deepEqual(calls.at(-1),['boolean:200',{value:true}]);
 snap.components[0].attrs={access:'r'};p.syncAccessories(unit,snap,model(snap,d));const readOnly=state.accessory.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On);assert.ok(!readOnly.props.perms.includes(api.hap.Perms.PAIRED_WRITE));await assert.rejects(readOnly.handleSetRequest(false));assert.equal(calls.length,1);delete snap.components[0].attrs;
 const events=[],ch=button.accessory.getService(api.hap.Service.StatelessProgrammableSwitch).getCharacteristic(api.hap.Characteristic.ProgrammableSwitchEvent);ch.on('change',e=>events.push(e.newValue));p.event(unit,{component:'button:201'},1);assert.deepEqual(events,[1]);d.tileMode='grouped';d.virtualComponents[0].name='Renamed';p.syncAccessories(unit,snap,model(snap,d));assert.equal(state.accessory.UUID,uuid);assert.equal(state.accessory.displayName,'Renamed');assert.ok(!unit.accessories.find(r=>!r.channel&&!r.bluetooth&&!r.thermostat&&!r.virtual).accessory.getServiceById(api.hap.Service.Switch,'su:boolean:200'));
 snap.components=[];p.syncAccessories(unit,snap,model(snap,d));assert.ok(state.offline);await assert.rejects(state.accessory.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On).handleGetRequest());d.virtualComponents=[];p.syncAccessories(unit,snap,model(snap,d));assert.ok(records.removed.includes(state.accessory));assert.ok(records.removed.includes(button.accessory));
});
test('virtual trigger sends one configured push and resets without a reverse command',async t=>{
 const d={...device(),virtualComponents:[{component:'button:200',name:'Trigger',mode:'trigger',event:'long_push'}]},snap=rpc(),{p,api,unit}=setup(t,{devices:[d]});snap.components=[{key:'button:200',status:{}}];p.syncAccessories(unit,snap,model(snap,d));const r=unit.accessories.find(r=>r.virtual),calls=[];unit.client.write=async(...args)=>calls.push(args);const on=r.accessory.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On);await on.handleSetRequest(true);assert.deepEqual(calls,[['button:200',{event:'long_push'}]]);await new Promise(resolve=>setTimeout(resolve,400));assert.equal(on.value,false);await on.handleSetRequest(false);assert.equal(calls.length,1);
});
test('virtual cache restores offline and disabled components are pruned',async t=>{
 const d={...device(),virtualComponents:[{component:'boolean:200',name:'x',mode:'switch'}]},snap=rpc(),first=setup(t,{devices:[d]});snap.components=[{key:'boolean:200',status:{value:true}}];first.p.syncAccessories(first.unit,snap,model(snap,d));const a=first.unit.accessories.find(r=>r.virtual).accessory,next=setup(t,{devices:[d]});next.p.configureAccessory(a);next.p.makeClient=()=>({snapshot:async()=>{throw Error('offline');}});next.p.launch();const restored=next.p.units.get(d.id).accessories.find(r=>r.virtual);assert.ok(restored);await assert.rejects(restored.accessory.getService(next.api.hap.Service.Switch).getCharacteristic(next.api.hap.Characteristic.On).handleGetRequest());const removed=setup(t,{devices:[{...d,virtualComponents:[]}]});removed.p.configureAccessory(a);removed.p.makeClient=()=>({snapshot:async()=>{throw Error('offline');}});removed.p.launch();assert.ok(removed.records.removed.includes(a));
});

test('Siri On and Brightness writes preserve explicit levels in either order, on or off',async t=>{
 for(const initiallyOn of [false,true])for(const order of [['Brightness','On'],['On','Brightness']]){
  const {p,api,unit}=setup(t),snap=rpc();unit.config.channels=[{component:'light:0',type:'light',onBrightness:35}];snap.status={'light:0':{output:initiallyOn,brightness:15}};const r=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,r,model(snap,unit.config).descriptors);const writes=[];unit.client.write=async(_key,v)=>{writes.push(v);if(v.brightness!==undefined)snap.status['light:0'].brightness=v.brightness;if(v.on!==undefined)snap.status['light:0'].output=v.on;};const service=r.accessory.getService(api.hap.Service.Lightbulb);
  await Promise.all(order.map(key=>service.getCharacteristic(api.hap.Characteristic[key]).handleSetRequest(key==='On'?true:80)));assert.equal(snap.status['light:0'].brightness,80,'explicit level lost: '+initiallyOn+' / '+order);assert.equal(await service.getCharacteristic(api.hap.Characteristic.Brightness).handleGetRequest(),80);if(initiallyOn)assert.ok(writes.every(v=>v.brightness!==35));
 }
});
test('pending explicit brightness is per channel, survives a poll replacement and clears on Off',async t=>{
 const {p,api,unit}=setup(t),snap=rpc();unit.config.channels=[{component:'light:0',type:'light',onBrightness:35},{component:'light:1',type:'light',onBrightness:25}];snap.status={'light:0':{output:false,brightness:10},'light:1':{output:false,brightness:20}};const r=p.getRecord(unit,undefined,snap.info);p.reconcile(unit,r,model(snap,unit.config).descriptors);const writes=[];unit.client.write=async(key,v)=>{p.reconcile(unit,r,model(snap,unit.config).descriptors);writes.push([key,v]);if(v.brightness!==undefined)snap.status[key].brightness=v.brightness;if(v.on!==undefined)snap.status[key].output=v.on;};const a=r.accessory.getServiceById(api.hap.Service.Lightbulb,'su:light:0'),b=r.accessory.getServiceById(api.hap.Service.Lightbulb,'su:light:1');await a.getCharacteristic(api.hap.Characteristic.Brightness).handleSetRequest(80);await b.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.equal(snap.status['light:1'].brightness,25);await a.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.equal(snap.status['light:0'].brightness,80);assert.equal(await a.getCharacteristic(api.hap.Characteristic.Brightness).handleGetRequest(),80);
 await a.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(false);await a.getCharacteristic(api.hap.Characteristic.Brightness).handleSetRequest(70);await a.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(false);await a.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.equal(snap.status['light:0'].brightness,35);
});

test('confirmed external on/off cycles use the configured startup level instead of old dimming intents',async t=>{
 const {p,api,unit}=setup(t),snap=rpc();unit.config.channels=[{component:'light:0',type:'light',onBrightness:35}];snap.status={'light:0':{output:false,brightness:10}};p.syncAccessories(unit,snap,model(snap,unit.config));const r=unit.accessories.find(r=>r.channel==='light:0'),service=r.accessory.getService(api.hap.Service.Lightbulb);unit.client.write=async(_key,v)=>{if(v.brightness!==undefined)snap.status['light:0'].brightness=v.brightness;if(v.on!==undefined)snap.status['light:0'].output=v.on;};await service.getCharacteristic(api.hap.Characteristic.Brightness).handleSetRequest(80);snap.status['light:0'].output=true;p.syncAccessories(unit,snap,model(snap,unit.config));snap.status['light:0'].output=false;p.syncAccessories(unit,snap,model(snap,unit.config));await service.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.equal(snap.status['light:0'].brightness,35);
 await service.getCharacteristic(api.hap.Characteristic.Brightness).handleSetRequest(70);snap.status['light:0'].output=false;p.syncAccessories(unit,snap,model(snap,unit.config));await service.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);assert.equal(snap.status['light:0'].brightness,35);
});

 test('cloud transport preserves root and channel identities; real HomeKit channel receives cloud snapshot',t=>{
 const {p,unit,api}=setup(t);const d={...unit.config,connection:'cloud',cloudDeviceId:'aabbccddeeff',cloudKey:'never-cache',cloudServer:'https://shelly-123-eu.shelly.cloud'};
 assert.equal(p.uuid(d),p.uuid(unit.config));assert.equal(p.channelUuid(d,'switch:0'),p.channelUuid(unit.config,'switch:0'));assert.equal(p.makeClient(d).constructor.name,'CloudClient');
 unit.config=d;const snap={...rpc(),cloud:true};p.syncAccessories(unit,snap,model(snap,d));const r=unit.accessories.find(r=>r.channel==='switch:0');assert.ok(r);assert.equal(r.states.get('switch:0').cloud,true);assert.equal(r.accessory.getService(api.hap.Service.Outlet).getCharacteristic(api.hap.Characteristic.On).value,true);assert.ok(!JSON.stringify(r.accessory.context).includes('never-cache'));
});
