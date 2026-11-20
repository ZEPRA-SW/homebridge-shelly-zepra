'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/scene-model');
const now=1000000;
function fixture(){
 const local={id:'host',name:'Local host',host:'192.0.2.20',shellyDeviceId:'shellypro3-AABBCCDDEEFF',bthome:[{id:'weather',name:'Weather',deviceComponent:'bthomedevice:200',sensorType:'ws90'},{id:'contact',name:'Window',deviceComponent:'bthomedevice:201',staleAfter:300}]},cloud={id:'cloud',name:'Cloud host',connection:'cloud',cloudServer:'https://shelly-a.shelly.cloud',cloudDeviceId:'001122334455'},cover={id:'cover',name:'Cover',connection:'local',bthome:[{id:'weather',name:'Cover weather',deviceComponent:'bthomedevice:200',sensorType:'ws90'}]};
 const config={pollInterval:20,devices:[local,cloud],shading:{devices:[cover]}},readings=[{component:'switch:0',values:{On:false}},{component:'light:0',values:{On:true,Brightness:0}},{component:'input:100',values:{ContactSensorState:0}},{component:'temperature:100',values:{CurrentTemperature:10.3}},{component:'voltmeter:101',unit:'V',values:{AnalogValue:0}}];
 const bthome=[{id:'weather',deviceComponent:'bthomedevice:200',fault:false,readings:[{component:'bthomesensor:203',type:'weather',metric:'RainDetected',values:{RainDetected:false},observedAt:now-10000},{component:'bthomesensor:204',type:'weather',metric:'WindSpeed',unit:'km/h',values:{WindSpeed:0},observedAt:now-9000},{component:'bthomesensor:210',type:'humidity',values:{CurrentRelativeHumidity:85},observedAt:now-8000},{component:'bthomesensor:211',type:'temperature',values:{CurrentTemperature:10},observedAt:now-7000}]},{id:'contact',deviceComponent:'bthomedevice:201',readings:[{component:'bthomesensor:202',values:{ContactSensorState:0},observedAt:now-5000}]}];
 const record={target:JSON.stringify(['host','192.0.2.20','aabbccddeeff']),online:true,checkedAt:now-1000,readings,measurements:[{component:'meter:0',values:{Power:0,Energy:12.5,Voltage:230,Current:0.2}}],bthome};
 const shade={id:'cover',online:true,checkedAt:now-2000,updatedAt:now-1000,position:0,slatPosition:100,automationEnabled:false,manualPaused:false,windAlarm:true,bthomeOnline:true,bthomeCheckedAt:now-1000,bthomeMaxAge:75000,bthome:structuredClone(bthome.slice(0,1))};
 return {config,data:{devicesMaxAge:30000,devices:[record,{target:JSON.stringify(['cloud','cloud:https://shelly-a.shelly.cloud','001122334455']),online:true,checkedAt:now-3000,readings:[{component:'switch:0',values:{On:false}}]}],shading:[shade]},local,cloud,cover,record,shade};
}
const native=(metric,component)=>({area:'devices',deviceId:'host',component,metric});
const weather=(metric,component,area='devices')=>({area,deviceId:area==='shading'?'cover':'host',sensorId:'weather',component,metric});
const cover=metric=>({area:'shading',deviceId:'cover',metric});
const read=(f,source,at=now)=>M.sourceReading(f.config,f.data,source,at);

test('current source readings preserve false, zero, dimmer level, contact state and finite temperature',()=>{
 const f=fixture();
 for(const [metric,component,value]of [['On','switch:0',false],['Brightness','light:0',0],['ContactSensorState','input:100',0],['CurrentTemperature','temperature:100',10.3]])assert.deepEqual(read(f,native(metric,component)),{value,observedAt:now-1000});
 assert.deepEqual(read(f,native('AnalogValue','voltmeter:101')),{value:0,observedAt:now-1000,unit:'V'});
 f.record.readings.find(r=>r.component==='light:0').values.Brightness=48.5;assert.equal(read(f,native('Brightness','light:0')).value,48.5);
});
test('current source readings enforce metric types and bounded contact, percentage and cover values without coercion',()=>{
 const f=fixture(),temp=f.record.readings.find(r=>r.component==='temperature:100'),state=f.record.readings[0],contact=f.record.readings.find(r=>r.component==='input:100'),dimmer=f.record.readings.find(r=>r.component==='light:0');
 for(const value of [null,undefined,NaN,Infinity,'10',true,false,{},[]]){temp.values.CurrentTemperature=value;assert.equal(read(f,native('CurrentTemperature','temperature:100')),null);}
 for(const value of [0,1,42,'false',null,NaN]){state.values.On=value;assert.equal(read(f,native('On','switch:0')),null);}
 state.values.On=false;assert.equal(read(f,native('On','switch:0')).value,false);
 for(const value of [-1,2,false,'0',NaN]){contact.values.ContactSensorState=value;assert.equal(read(f,native('ContactSensorState','input:100')),null);}
 contact.values.ContactSensorState=1;assert.equal(read(f,native('ContactSensorState','input:100')).value,1);
 for(const value of [-1,101,Infinity]){dimmer.values.Brightness=value;assert.equal(read(f,native('Brightness','light:0')),null);f.shade.position=value;assert.equal(read(f,cover('position')),null);}
});
test('read-only energy and power feedback is found in measurements without any actuator commands',()=>{
 const f=fixture();for(const [metric,value]of [['Power',0],['Energy',12.5],['Voltage',230],['Current',0.2]])assert.deepEqual(read(f,native(metric,'meter:0')),{value,observedAt:now-1000});
 assert.equal(read(f,native('Power','missing')),null);f.record.measurements[0].fault=true;assert.equal(read(f,native('Power','meter:0')),null);
});
test('cached feedback requires the exact configured host, hardware and cloud-server binding',()=>{
 const f=fixture(),source=native('On','switch:0');assert.equal(read(f,source).value,false);
 for(const target of [JSON.stringify(['host']),JSON.stringify(['host','192.0.2.21','aabbccddeeff']),JSON.stringify(['host','192.0.2.20','112233445566'])]){f.record.target=target;assert.equal(read(f,source),null);}
 const cloudSource={...source,deviceId:'cloud'};assert.equal(read(f,cloudSource).value,false);f.config.devices[1].cloudServer='https://shelly-b.shelly.cloud';assert.equal(read(f,cloudSource),null);
});
test('missing, offline, faulted, stale or future host feedback stays unavailable',()=>{
 const source=native('CurrentTemperature','temperature:100');
 for(const patch of [{online:false},{fault:true},{identityMismatch:true},{checkedAt:0},{checkedAt:null},{checkedAt:now-30001},{checkedAt:now+5001}]){const f=fixture();Object.assign(f.record,patch);assert.equal(read(f,source),null,JSON.stringify(patch));}
 const f=fixture();f.record.readings.find(r=>r.component===source.component).fault=true;assert.equal(read(f,source),null);
 assert.equal(M.sourceReading(f.config,null,source,now),null);assert.equal(M.sourceReading(null,f.data,source,now),null);assert.equal(M.sourceReading(f.config,{devices:{}},source,now),null);assert.equal(M.sourceReading(f.config,f.data,null,now),null);
 assert.equal(read(f,{...source,deviceId:'not-configured'}),null);assert.equal(read(f,{...source,metric:'unsupported'}),null);
});
test('WS90 rain false and weather zero retain the original sensor measurement timestamp',()=>{
 const f=fixture(),rain=weather('RainDetected','bthomesensor:203'),wind=weather('WindSpeed','bthomesensor:204');
 assert.deepEqual(read(f,rain),{value:false,observedAt:now-10000});assert.deepEqual(read(f,wind),{value:0,observedAt:now-9000,unit:'km/h'});
 f.record.checkedAt=now+1000;assert.equal(read(f,rain,now+1000).observedAt,now-10000,'new host polling never refreshes old measurement time');
 assert.equal(read(f,weather('CurrentTemperature','bthomesensor:211')).value,10);
});
test('BTHome source feedback verifies the configured group component, sensor fault and expiry independently',()=>{
 const source=weather('WindSpeed','bthomesensor:204');
 for(const change of [f=>f.record.bthome[0].fault=true,f=>delete f.config.devices[0].bthome[0].deviceComponent,f=>f.record.bthome[0].deviceComponent='bthomedevice:299',f=>f.config.devices[0].bthome[0].deviceComponent='bthomedevice:299',f=>f.record.bthome[0].readings[1].fault=true,f=>f.record.bthome[0].readings[1].observedAt=now-120001,f=>f.record.bthome[0].readings[1].observedAt=now+5001,f=>f.record.bthome[0].readings[1].observedAt=null]){const f=fixture();change(f);assert.equal(read(f,source),null);}
 const f=fixture();assert.equal(read(f,{...source,sensorId:'contact'}),null);f.record.bthome[0].readings[1].observedAt=now-60001;f.local.bthome[0].staleAfter=60;assert.equal(read(f,source),null);
});
test('native timestamp feedback is checked without changing the compatible absent-timestamp fallback',()=>{
 const f=fixture(),source=native('CurrentTemperature','temperature:100'),temperature=f.record.readings.find(r=>r.component===source.component);
 assert.equal(read(f,source).observedAt,f.record.checkedAt);temperature.observedAt=now-10000;assert.equal(read(f,source).observedAt,now-10000);
 for(const value of [null,undefined,0,NaN,Infinity,now+5001,now-30001]){temperature.observedAt=value;assert.equal(read(f,source),null);}
 const wind=weather('WindSpeed','bthomesensor:204');delete f.record.bthome[0].readings[1].observedAt;assert.equal(read(f,wind),null,'BTHome feedback without a sensor timestamp stays unavailable until a new sample');f.record.bthome[0].readings[1].observedAt=now;assert.equal(read(f,wind).observedAt,now,'a newly timestamped sensor sample restores the reading');
});
test('cover feedback supports positions and boolean controls with its own freshness envelope',()=>{
 const f=fixture();for(const [metric,value]of [['position',0],['slatPosition',100],['automationEnabled',false],['manualPaused',false],['windAlarm',true]])assert.deepEqual(read(f,cover(metric)),{value,observedAt:now-2000});
 f.shade.position=42;delete f.shade.checkedAt;assert.equal(read(f,cover('position')).observedAt,f.shade.updatedAt);
 f.shade.updatedAt=now-75001;assert.equal(read(f,cover('position')),null);f.shade.updatedAt=now-1000;f.shade.online=false;assert.equal(read(f,cover('position')),null);
 assert.equal(read(f,cover('Power')),null);
});
test('shading BTHome feedback stays independent of cover status and rejects missing sensor timestamps',()=>{
 const f=fixture(),rain=weather('RainDetected','bthomesensor:203','shading');f.shade.online=false;f.shade.checkedAt=now-900000;assert.equal(read(f,rain).value,false);
 for(const change of [s=>s.bthomeOnline=false,s=>s.bthomeCheckedAt=now-75001,s=>s.bthomeCheckedAt=now+5001,s=>s.bthomeMaxAge=0,s=>delete s.bthome[0].readings[0].observedAt,s=>s.bthome[0].readings[0].observedAt=now-120001]){const other=fixture();other.shade.online=false;change(other.shade);assert.equal(read(other,rain),null);}
});
test('only known measurement-compatible units are returned and cached source/config data remains untouched',()=>{
 const f=fixture(),source=native('AnalogValue','voltmeter:101'),row=f.record.readings.find(r=>r.component===source.component);assert.equal(read(f,source).unit,'V');row.unit='private text';assert.equal(read(f,source).unit,undefined);delete row.unit;assert.equal(read(f,{...source,unit:'%'}).unit,'%');
 const before=structuredClone(f),freeze=o=>{if(o&&typeof o==='object'){Object.freeze(o);for(const v of Object.values(o))freeze(v);}};freeze(f);
 assert.doesNotThrow(()=>read(f,source));assert.deepEqual(f,before);
});
