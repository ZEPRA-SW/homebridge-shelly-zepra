'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
const {HomebridgeAPI}=require(apiModule),{CombinedPlatform}=require('../index');
const general={id:'test-light',name:'Test Light',host:'192.0.2.31',shellyDeviceId:'aabbccddeeff',channels:[{component:'switch:0',type:'switch'}]};
const shading={id:'test-blind',name:'Test Blind',host:'192.0.2.32',shellyDeviceId:'112233445566',deviceType:'raffstore'};

function harness(t){
 const api=new HomebridgeAPI(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'zepra-invalid-config-')),storage=api.user.storagePath,network=[],changes=[],logs=[],cleanup=[];
 api.user.storagePath=()=>folder;
 for(const method of ['registerPlatformAccessories','updatePlatformAccessories','unregisterPlatformAccessories'])api[method]=(...args)=>changes.push({method,args});
 const originalFetch=global.fetch;global.fetch=async()=>{network.push(true);throw Error('Unexpected test network request');};
 const log=Object.assign(()=>{},Object.fromEntries(['error','warn','info','debug'].map(level=>[level,message=>logs.push({level,message})])));
 t.after(async()=>{api.emit('shutdown');await Promise.all(cleanup.map(fn=>fn()));global.fetch=originalFetch;api.user.storagePath=storage;fs.rmSync(folder,{recursive:true,force:true});});
 return {api,folder,network,changes,logs,log,cleanup};
}
async function rejectSafely(t,config){
 const h=harness(t);let platform;
 assert.doesNotThrow(()=>{platform=new CombinedPlatform(h.log,config,h.api);},'invalid configuration must not escape the platform constructor');
 assert.equal(h.logs.filter(row=>row.level==='error').length,1,'the plugin reports its configuration failure once');
 assert.equal(typeof h.logs[0].message,'string');
 assert.equal(h.api.listenerCount('didFinishLaunching'),0,'invalid configuration must not attach a launch callback');
 const uuid=h.api.hap.uuid.generate('homebridge-shelly-raffstore:'+shading.id),cached=new h.api.platformAccessory('Existing Blind',uuid);
 cached.context={deviceId:shading.id,combinedEngine:'shading',sunState:{enabled:true},savedValue:37};const before=JSON.stringify(cached.context);
 assert.doesNotThrow(()=>platform.configureAccessory(cached),'cached accessories must be accepted without mutating or deleting them');
 assert.equal(JSON.stringify(cached.context),before);
 assert.doesNotThrow(()=>h.api.emit('didFinishLaunching'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.network,[],'invalid configuration must never start a device request');
 assert.deepEqual(h.changes,[],'invalid configuration must not publish, update or remove cached accessories');
 assert.deepEqual(fs.readdirSync(h.folder),[],'invalid configuration must not overwrite persisted state');
 return h;
}

for(const [name,config] of [
 ['non-array general device list',{devices:'invalid',shading:{devices:[shading]}}],
 ['null general device list',{devices:null,shading:{devices:[]}}],
 ['null shading device list',{devices:[],shading:{devices:null}}],
 ['object instead of general device list',{devices:{id:'bad'},shading:{devices:[]}}],
 ['non-array shading device list',{devices:[general],shading:{devices:'invalid'}}],
 ['array instead of shading settings',{devices:[general],shading:[]}],
 ['null general device entry',{devices:[null],shading:{devices:[]}}],
 ['array general device entry',{devices:[[]],shading:{devices:[]}}],
 ['null shading device entry',{devices:[general],shading:{devices:[null]}}],
 ['array shading device entry',{devices:[],shading:{devices:[[]]}}],
])test('configuration rejection is inert for '+name,async t=>{await rejectSafely(t,config);});

test('invalid general-device fields are rejected before either area is initialized',async t=>{
 const h=await rejectSafely(t,{devices:[{...general,host:''}],shading:{devices:[shading]}});
 assert.match(h.logs[0].message,/host|IP|Pflichtangabe/i);
});

test('shared validation failures preserve configuration values and do not expose credentials',async t=>{
 const config={devices:[{...general,password:'PRIVATE-SYNTHETIC-CONFIG-SECRET',generation:'unsupported'}],shading:{devices:[shading]}},before=structuredClone(config);
 const h=await rejectSafely(t,config);assert.deepEqual(config,before);
 assert.ok(!JSON.stringify(h.logs).includes('PRIVATE-SYNTHETIC-CONFIG-SECRET'),'configuration values must not be dumped into a log');
});

for(const [language,prefix,inactive]of [
 ['de',/Konfiguration ungültig/i,/inaktiv/i],
 ['en',/(invalid configuration|configuration (?:is )?invalid)/i,/inactive/i],
 ['fr',/configuration (?:non valide|invalide|incorrecte)/i,/inactif|inactive|désactiv/i],
 ['es',/configuración (?:no válida|inválida|incorrecta)/i,/inactiv|desactiv/i],
])test('configuration rejection is reported in '+language,async t=>{
 const h=await rejectSafely(t,{language,devices:'invalid',shading:{devices:[]}});
 assert.match(h.logs[0].message,prefix);assert.match(h.logs[0].message,inactive);
 if(language!=='de')assert.ok(!h.logs[0].message.includes('Beide Gerätelisten müssen Listen sein.'),'the detailed reason is translated too');
});


test('correcting configuration in a fresh platform instance restores the normal empty startup path',async t=>{
 const h=harness(t);assert.doesNotThrow(()=>new CombinedPlatform(h.log,{devices:'invalid'},h.api));
 assert.equal(h.api.listenerCount('didFinishLaunching'),0);h.logs.length=0;
 let platform;assert.doesNotThrow(()=>{platform=new CombinedPlatform(h.log,{devices:[],shading:{devices:[],globalControls:false}},h.api);});
 h.cleanup.push(()=>Promise.all([platform.shading.statusStore.tail,platform.devices.statusStore?.tail]));
 assert.ok(h.api.listenerCount('didFinishLaunching')>0,'a corrected configuration registers its normal lifecycle');
 assert.doesNotThrow(()=>h.api.emit('didFinishLaunching'));await platform.devices.statusStore.tail;
 assert.deepEqual(h.network,[]);assert.deepEqual(h.changes,[]);
 assert.equal(platform.devices.running,true);assert.equal(h.logs.filter(row=>row.level==='error').length,0);
});


for(const [name,timeZone,devices]of [
 ['an unknown zone with an enabled reboot plan','Invalid/TimeZone',[{...shading,dailyReboot:{enabled:true,time:'03:00'}}]],
 ['an unknown zone without devices','Invalid/TimeZone',[]],
 ['an empty zone','',[]],
 ['a non-string zone',42,[]],
])test('invalid global time zone rejects startup for '+name,async t=>{
 const h=await rejectSafely(t,{devices:[],shading:{timeZone,devices}});
 assert.match(h.logs[0].message,/Ungültige Zeitzone/);
});

for(const timeZone of ['UTC','Europe/Berlin',null])test('valid or default global time zone permits empty startup: '+timeZone,async t=>{
 const h=harness(t);let platform;
 assert.doesNotThrow(()=>{platform=new CombinedPlatform(h.log,{devices:[],shading:{timeZone,devices:[],globalControls:false}},h.api);});
 assert.equal(h.logs.filter(row=>row.level==='error').length,0);
 assert.ok(h.api.listenerCount('didFinishLaunching')>0);
 h.cleanup.push(()=>Promise.all([platform.shading.statusStore.tail,platform.devices.statusStore?.tail]));
 assert.doesNotThrow(()=>h.api.emit('didFinishLaunching'));await platform.devices.statusStore.tail;
 assert.equal(platform.devices.running,true);assert.deepEqual(h.network,[]);assert.deepEqual(h.changes,[]);
});
