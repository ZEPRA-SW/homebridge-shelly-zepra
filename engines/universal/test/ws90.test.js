'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ws90Fixture}=require('./ws90-fixture'),{model}=require('../lib/model'),{bthomeStatus}=require('../lib/bthome-status'),{StatusStore}=require('../lib/status');
const path=require('node:path'),apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
const {HomebridgeAPI}=require(apiModule),{Platform}=require('..'),{WEATHER_METRICS}=require('../lib/bthome-weather');
const group=f=>model(f.snap,f.host,f.now).bluetooth[0],reading=(f,metric)=>group(f).descriptors.find(d=>d.key===f.keys[metric]),raw=(f,metric)=>f.snap.components.find(c=>c.key===f.keys[metric]);
function setup(t,f){const api=new HomebridgeAPI(),calls=[],p=new Platform({info(){},warn(){},error:assert.fail},{devices:[f.host]},api);api.registerPlatformAccessories=()=>{};api.updatePlatformAccessories=()=>{};api.unregisterPlatformAccessories=()=>{};p.makeStatusStore=()=>({save(){},update(){},stop(){}});t.after(()=>p.stop());const unit={config:f.host,accessories:[],counters:new Map(),writeTail:Promise.resolve(),client:{write:async()=>calls.push('write')},failures:0};return {p,api,unit,calls};}
test('the 13 WS90 objects map by sensor metadata, retaining component identity and decoded values',()=>{
 const f=ws90Fixture(1000),g=group(f);assert.equal(g.fault,false);assert.equal(g.descriptors.length,13);assert.deepEqual(g.descriptors.map(d=>d.key),Object.values(f.keys));
 for(const [metric,value]of Object.entries({BatteryLevel:100,CurrentAmbientLightLevel:0.0001,RainDetected:false,WindSpeed:11.556,GustSpeed:27,UVIndex:1.2,WindDirection:245.25,AirPressure:1013.25,DewPoint:6.586,CapacitorVoltage:2.735,CurrentRelativeHumidity:89,CurrentTemperature:10,Precipitation:12.3}))assert.ok(Math.abs(Number(reading(f,metric).values[metric])-Number(value))<1e-9,metric);
 for(const metric of WEATHER_METRICS){const d=reading(f,metric);assert.equal(d.type,'weather');assert.equal(d.metric,metric);assert.equal(d.fault,false);}
 assert.equal(reading(f,'WindSpeed').unit,'km/h');assert.equal(reading(f,'AirPressure').unit,'hPa');assert.equal(reading(f,'Precipitation').unit,'mm');
 f.station.sensorType='bthome';assert.equal(group(f).descriptors.length,13,'existing generic entries gain the weather mappings');
});
test('wind and gusts use object index independently from component ordering and aliases',()=>{
 const f=ws90Fixture(1000);f.snap.components.reverse();assert.ok(Math.abs(reading(f,'WindSpeed').values.WindSpeed-11.556)<1e-9);assert.equal(reading(f,'GustSpeed').values.GustSpeed,27);
 delete raw(f,'WindSpeed').config.idx;assert.equal(reading(f,'WindSpeed').metric,'WindSpeed');raw(f,'WindSpeed').config.idx=2;assert.equal(reading(f,'WindSpeed'),undefined);assert.equal(reading(f,'GustSpeed').metric,'GustSpeed');
 raw(f,'WindSpeed').config.idx=0;f.snap.components.push({...structuredClone(raw(f,'WindSpeed')),key:'bthomesensor:299',status:{value:1,last_updated_ts:1000}});const winds=group(f).descriptors.filter(d=>d.metric==='WindSpeed');assert.equal(winds.length,2);assert.ok(winds.some(d=>d.key==='bthomesensor:299'&&d.values.WindSpeed===3.6));assert.ok(winds.some(d=>d.key===f.keys.WindSpeed&&Math.abs(d.values.WindSpeed-11.556)<1e-9));
});
test('WS90 readings are associated with the normalized physical station address, never a neighbouring station',()=>{
 const f=ws90Fixture(1000);f.snap.components[0].config.addr='AABB11223344';for(const sensor of f.snap.components.slice(1))sensor.config.addr='aa-bb-11-22-33-44';f.snap.components.push({key:'bthomesensor:299',config:{addr:'11:22:33:44:55:66',obj_id:68,idx:0},status:{value:100,last_updated_ts:1000}});
 assert.equal(group(f).descriptors.length,13);assert.ok(!group(f).descriptors.some(d=>d.key==='bthomesensor:299'));assert.equal(bthomeStatus(f.snap,model(f.snap,f.host,f.now))[0].readings.length,13);
 f.snap.components[0].config.addr='invalid';assert.equal(group(f).fault,true);assert.deepEqual(group(f).descriptors,[]);
});
test('zero measurements and false rain remain real readings; invalid values remain faulted without coercion',()=>{
 const f=ws90Fixture(1000);for(const metric of WEATHER_METRICS){raw(f,metric).status.value=0;const d=reading(f,metric);assert.equal(d.fault,false);assert.equal(d.values[metric],metric==='RainDetected'?false:0);}
 for(const metric of WEATHER_METRICS)for(const invalid of [null,undefined,NaN,Infinity,'1',{},[],...(metric==='DewPoint'?[-328]:[-1])]){raw(f,metric).status.value=invalid;const d=reading(f,metric);assert.equal(d.fault,true,metric+' / '+String(invalid));assert.deepEqual(d.values,{});assert.deepEqual(d.missingValues,[metric]);assert.equal(d.metric,metric);}
 for(const value of [true,1,false,0]){raw(f,'RainDetected').status.value=value;assert.equal(reading(f,'RainDetected').values.RainDetected,!!value);}raw(f,'RainDetected').status.value=2;assert.equal(reading(f,'RainDetected').fault,true);
 raw(f,'WindDirection').status.value=361;assert.equal(reading(f,'WindDirection').fault,true);
});
test('freshness and device faults are tracked per quantity; WS90 default is 120 seconds',()=>{
 const f=ws90Fixture(1000);delete f.station.staleAfter;f.now=1121;assert.ok(group(f).descriptors.every(d=>d.fault));f.station.sensorType='bthome';assert.ok(group(f).descriptors.every(d=>!d.fault));f.station.staleAfter=60;f.now=1000;
 for(const patch of [{last_updated_ts:0},{last_updated_ts:939},{last_updated_ts:1006},{last_updated_ts:null},{errors:['read_error']},{is_valid:false}]){raw(f,'WindSpeed').status={value:3,...patch};assert.equal(reading(f,'WindSpeed').fault,true);assert.equal(reading(f,'GustSpeed').fault,false);}
 raw(f,'WindSpeed').status={value:0,last_update_ts:1000};assert.equal(reading(f,'WindSpeed').fault,false);assert.equal(reading(f,'WindSpeed').values.WindSpeed,0);
 f.snap.components[0].status.paired=false;assert.equal(group(f).fault,false,'passive BTHome beacons do not require a paired connection');assert.ok(group(f).descriptors.every(d=>!d.fault));f.snap.components[0].status.errors=['device_error'];assert.equal(group(f).fault,true);
});
test('weather HAP characteristics are read-only, report faults and recover on the same service',async t=>{
 const f=ws90Fixture(1000),{p,api,unit,calls}=setup(t,f),r=p.getRecord(unit,f.station,f.snap.info);p.reconcile(unit,r,group(f).descriptors,false);
 for(const metric of WEATHER_METRICS){const s=r.accessory.getServiceById(p.types.services.weather,'su:'+f.keys[metric]);assert.ok(s,metric);const ch=s.getCharacteristic(p.types.chars[metric]);const expected=reading(f,metric).values[metric],actual=await ch.handleGetRequest();if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<1e-8,metric);else assert.equal(actual,expected);assert.ok(!ch.props.perms.includes(api.hap.Perms.PAIRED_WRITE));assert.equal(ch.props.format,metric==='RainDetected'?'bool':'float');}
 const s=r.accessory.getServiceById(p.types.services.weather,'su:'+f.keys.WindSpeed),ch=s.getCharacteristic(p.types.chars.WindSpeed);raw(f,'WindSpeed').status.value=null;p.reconcile(unit,r,group(f).descriptors,false);await assert.rejects(ch.handleGetRequest());assert.equal(s.getCharacteristic(api.hap.Characteristic.StatusFault).value,1);
 raw(f,'WindSpeed').status.value=0;p.reconcile(unit,r,group(f).descriptors,false);assert.equal(await ch.handleGetRequest(),0);assert.equal(r.accessory.getServiceById(p.types.services.weather,'su:'+f.keys.WindSpeed),s);assert.deepEqual(calls,[]);assert.ok(!r.accessory.getService(api.hap.Service.LeakSensor));
});
test('weather status metadata and Scene observations survive the complete poll path, with no additional device requests',async t=>{
 const f=ws90Fixture(),{p,unit}=setup(t,f),R=require('../../../lib/scene-runtime');let requests=0;p.running=true;unit.client.snapshot=async()=>{requests++;return f.snap;};p.statusStore=new StatusStore('',[f.host],10);p.statusStore.save=()=>Promise.resolve();t.after(()=>clearTimeout(unit.timer));
 await p.poll(unit);assert.equal(requests,1);const stored=p.statusStore.devices.get(f.host.id).bthome[0];assert.equal(stored.readings.length,13);assert.equal(stored.id,f.station.id);assert.equal(stored.readings.find(r=>r.component===f.keys.WindSpeed).unit,'km/h');assert.equal(stored.readings.find(r=>r.component===f.keys.WindSpeed).metric,'WindSpeed');assert.equal(stored.readings.find(r=>r.component===f.keys.WindSpeed).observedAt,raw(f,'WindSpeed').status.last_updated_ts*1000);
 const ref=metric=>({area:'devices',deviceId:f.host.id,sensorId:f.station.id,component:f.keys[metric],metric});for(const metric of WEATHER_METRICS)assert.equal(R.observe({devices:p},ref(metric)).value,reading(f,metric).values[metric]);
 raw(f,'WindSpeed').status.errors=['read_error'];await p.poll(unit);assert.equal(requests,2);assert.equal(R.observe({devices:p},ref('WindSpeed')),null);assert.equal(R.observe({devices:p},ref('GustSpeed')).value,27);const failed=p.statusStore.devices.get(f.host.id).bthome[0].readings.find(r=>r.metric==='WindSpeed');assert.equal(failed.fault,true);assert.deepEqual(failed.values,{});assert.equal(failed.unit,'km/h');
 f.snap.components[0].status.paired=false;await p.poll(unit);assert.equal(R.observe({devices:p},ref('GustSpeed')).value,27);assert.equal(p.statusStore.devices.get(f.host.id).bthome[0].readings.find(r=>r.metric==='GustSpeed').fault,false);
 f.snap.components[0].status.errors=['device_error'];await p.poll(unit);assert.ok(p.statusStore.devices.get(f.host.id).bthome[0].readings.every(r=>r.fault&&Object.keys(r.values).length===0));assert.equal(R.observe({devices:p},ref('GustSpeed')),null);
});

test('weather confirmation holds and intermediate gates require a new station sample, not just a host poll',async()=>{
 const f=ws90Fixture(1000),store=new StatusStore('',[f.host],10),R=require('../../../lib/scene-runtime'),{evaluate}=require('../../../lib/scene-condition');store.save=()=>Promise.resolve();let now=1000000;
 const platform={config:{devices:[f.host]},devices:{statusStore:store}},observe=(ref,time)=>R.observe(platform,ref,time),ref=metric=>({area:'devices',deviceId:f.host.id,sensorId:f.station.id,component:f.keys[metric],metric}),local={time:'00:00',weekday:0};
 const update=()=>store.update(f.host.id,true,now,[],[],bthomeStatus(f.snap,model(f.snap,f.host,now/1000)));
 const tree={kind:'value',source:ref('WindSpeed'),operator:'gt',value:10,holdSeconds:5},nodes={};await update();assert.equal(evaluate(tree,nodes,now,observe,local).value,false);
 now+=5000;await update();assert.equal(observe(ref('WindSpeed'),now).observedAt,1000000);assert.equal(evaluate(tree,nodes,now,observe,local).value,false,'host polling must not confirm a held weather condition');
 raw(f,'WindSpeed').status.last_updated_ts=now/1000;await update();assert.equal(evaluate(tree,nodes,now,observe,local).value,true);
 const gate={kind:'group',operator:'and',children:[{...tree,holdSeconds:0},{kind:'value',source:ref('GustSpeed'),operator:'gt',value:20}]},entry=now+1000;now=entry;await update();assert.equal(evaluate(gate,{},now,observe,local,{notBefore:entry}).value,null);
 raw(f,'WindSpeed').status.last_updated_ts=now/1000;await update();assert.equal(evaluate(gate,{},now,observe,local,{notBefore:entry}).value,null,'both configured weather quantities must update after stage entry');
 raw(f,'GustSpeed').status.last_updated_ts=now/1000;await update();assert.equal(evaluate(gate,{},now,observe,local,{notBefore:entry}).value,true);
});
