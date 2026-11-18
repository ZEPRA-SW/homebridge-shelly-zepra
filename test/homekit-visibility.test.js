'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
const{HomebridgeAPI}=require(apiModule),{Platform}=require('../engines/universal'),{device,rpc}=require('../engines/universal/test/fixtures');
test('hidden general device removes all cached tiles but still polls and publishes plugin status; re-enable uses same IDs',async t=>{
 const api=new HomebridgeAPI(),registered=[],removed=[],status=[];api.registerPlatformAccessories=(_p,_n,a)=>registered.push(...a);api.unregisterPlatformAccessories=(_p,_n,a)=>removed.push(...a);api.updatePlatformAccessories=()=>{};
 const d={...device(),homekitEnabled:false,inputs:[{component:'input:0',enabled:true,mode:'button'}],virtualComponents:[{component:'boolean:200',name:'Virtual',enabled:true,mode:'switch'}]},p=new Platform({info(){},warn(){},error:assert.fail},{devices:[d]},api);
 t.after(()=>p.stop());p.makeStatusStore=()=>({save(){},update(...args){status.push(args);},stop(){}});p.makeClient=()=>({snapshot:async()=>rpc()});
 const uuids=[p.uuid(d),p.channelUuid(d,'switch:0'),p.thermostatUuid(d,'thermostat:0'),p.virtualUuid(d,'boolean:200'),p.uuid(d,{id:'blu'})];
 for(const uuid of uuids){const a=new api.platformAccessory('Cached',uuid);a.context={deviceId:d.id};p.configureAccessory(a);}
 p.launch();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(removed.length,5);assert.equal(registered.length,0);assert.equal(p.units.get(d.id).accessories.length,0);assert.equal(p.units.get(d.id).events,undefined);assert.equal(status.at(-1)[1],true);assert.ok(status.at(-1)[3].some(r=>r.values.Power===50));
 const baseline=uuids[1];d.homekitEnabled=true;d.inputs=[];const unit=p.units.get(d.id);await p.poll(unit);assert.ok(registered.some(a=>a.UUID===baseline));assert.ok(registered.length>0);assert.equal(p.channelUuid(d,'switch:0'),baseline);
});
test('HomeKit visibility requires a boolean and defaults to visible',()=>{
 const{validate}=require('../engines/universal/lib/config');assert.throws(()=>validate({devices:[{...device(),homekitEnabled:'false'}]}),/Apple Home/);
 const api=new HomebridgeAPI(),p=new Platform({},{devices:[]},api);assert.ok(p.accessorySpecs(device()).length>0);
});

test('hidden shading keeps its runtime and persisted state through hidden restarts and re-exposure',async()=>{
 const fs=require('node:fs'),os=require('node:os'),{CombinedPlatform}=require('../index');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'zepra-hidden-'));
 const cover={id:'cover',name:'Cover',host:'192.0.2.20',shellyDeviceId:'112233445566',deviceType:'raffstore',separateSlatControl:true,sunAutomation:{enabled:true}};
 const api0=new HomebridgeAPI(),savedStorage=api0.user.storagePath,originalFetch=global.fetch;api0.user.storagePath=()=>folder;const methods=[];
 global.fetch=async(url,options)=>{const f=JSON.parse(options.body);methods.push(f.method);return Response.json({id:f.id,result:f.method==='Shelly.GetDeviceInfo'?{mac:cover.shellyDeviceId}:f.method==='Cover.GetConfig'?{slat:{enable:true}}:{pos_control:true,current_pos:50,slat_pos:50,state:'stopped'}});};
 const uuid=api0.hap.uuid.generate('homebridge-shelly-raffstore:'+cover.id);
 async function boot(hidden,seed){const api=new HomebridgeAPI(),registered=[],removed=[];api.registerPlatformAccessories=(_p,_n,a)=>registered.push(...a);api.updatePlatformAccessories=()=>{};api.unregisterPlatformAccessories=(_p,_n,a)=>removed.push(...a);
  const p=new CombinedPlatform({info(){},warn(){},error:assert.fail},{devices:[],shading:{globalControls:false,devices:[{...cover,homekitEnabled:!hidden}]}},api);
  if(seed){const a=new api.platformAccessory('Cover',uuid);a.context={deviceId:cover.id,combinedEngine:'shading',sunState:{enabled:false},dailyRebootState:{lastAttemptDay:'2026-11-12'}};p.configureAccessory(a);}
  api.emit('didFinishLaunching');await p.shading.devices[0].initialPoll;
  assert.ok(p.shading.devices[0].automation);assert.equal(p.shading.devices[0].automation.enabled,false);assert.equal(p.shading.devices.length,1);
  if(hidden)assert.equal(registered.length,0);else{assert.ok(registered.some(a=>a.UUID===uuid));assert.equal(registered.length,3);}
  api.emit('shutdown');await p.shading.statusStore.close();await p.devices.statusStore.tail;
  return {p,removed};
 }
 try{const first=await boot(true,true);assert.equal(first.removed.length,1);const state=JSON.parse(fs.readFileSync(path.join(folder,'shelly-zepra-hidden-shading.json'),'utf8'));assert.equal(state.records[uuid].context.sunState.enabled,false);assert.equal(state.records[uuid].context.dailyRebootState.lastAttemptDay,'2026-11-12');await boot(true,false);await boot(false,false);assert.ok(methods.every(m=>['Shelly.GetDeviceInfo','Cover.GetConfig','Cover.GetStatus'].includes(m)));}
 finally{global.fetch=originalFetch;api0.user.storagePath=savedStorage;}
});
