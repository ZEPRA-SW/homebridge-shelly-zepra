'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {merge}=require('../scripts/merge-config.cjs');const {validateGroups,CombinedPlatform}=require('../index');
const d={id:'light',name:'Light',host:'192.0.2.1',shellyDeviceId:'aabbccddeeff',channels:[{component:'switch:0',type:'switch'}]};
const cover={id:'blind',name:'Blind',host:'192.0.2.2',shellyDeviceId:'112233445566',deviceType:'raffstore'};
test('migration preserves both groups, locations and credentials without changing originals or old bridge IDs',()=>{
 const shading={platform:'ShellyRaffstore',devices:[cover],latitude:48,longitude:2,_bridge:{username:'0E:00:00:00:00:01'}},general={platform:'ShellyUniversal',devices:[{...d,password:'PRIVATE-EXAMPLE'}],_bridge:{username:'0E:00:00:00:00:02'}};
 const result=merge(shading,general);assert.equal(result.platform,'ShellyZepra');assert.equal(result.shading.latitude,48);assert.equal(result.devices[0].id,'light');assert.equal(result.shading.devices[0].id,'blind');assert.equal(result.devices[0].password,'PRIVATE-EXAMPLE');assert.equal(result._bridge,undefined);assert.equal(result.shading._bridge,undefined);assert.ok(shading._bridge);assert.equal(general.devices.length,1);
});
test('the same physical Shelly in both areas is rejected, but dual cover channels are valid',()=>{
 assert.throws(()=>validateGroups({devices:[d],shading:{devices:[{...cover,shellyDeviceId:d.shellyDeviceId}]}}),/zugleich/);
 assert.doesNotThrow(()=>validateGroups({devices:[],shading:{devices:[{...cover,coverId:0},{...cover,id:'blind-two',coverId:1}]}}));
 assert.throws(()=>validateGroups({devices:[],shading:{devices:[cover,{...cover,id:'duplicate'}]}}),/doppelt/);
});
test('combined schema compiles and validates the public example with separate shading settings',()=>{
 const Ajv=require('ajv'),ajv=new Ajv({strict:false});ajv.addFormat('password',()=>true);ajv.addFormat('time',()=>true);
 const schema=require('../config.schema.json'),check=ajv.compile(schema.schema);assert.equal(schema.pluginAlias,'ShellyZepra');assert.ok(check(require('../config.example.json')),JSON.stringify(check.errors));
});
test('new package registers only one platform and keeps original UUID namespaces behind it',async()=>{
 const path=require('node:path');const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
 const{HomebridgeAPI}=require(apiModule);const api=new HomebridgeAPI();
 const log={info(){},warn(){},error(message){throw Error(message);}};
 const p=new CombinedPlatform(log,{devices:[d],shading:{devices:[cover]}},api);
 const uuid=api.hap.uuid.generate('homebridge-shelly-raffstore:'+cover.id),accessory=new api.platformAccessory('Blind',uuid);
 accessory.context={deviceId:cover.id};p.configureAccessory(accessory);assert.equal(p.shading.cached[0],accessory);assert.equal(p.devices.cache.size,0);
 const lightUuid=api.hap.uuid.generate('homebridge-shelly-universal:'+d.id),light=new api.platformAccessory('Light',lightUuid);light.context={deviceId:d.id};p.configureAccessory(light);assert.equal(p.devices.cache.get(lightUuid),light);
 let registration;require('../index')({registerPlatform:(...args)=>registration=args});assert.deepEqual(registration.slice(0,2),['homebridge-shelly-zepra','ShellyZepra']);
 await p.shading.statusStore.close();
});
test('both cloud engine defaults use the same account scheduler',async()=>{
 const shared=require('../lib/cloud-queue').shared();shared.interval=0;
 const {ShellyCloudClient}=require('../engines/shading/lib/cloud-client'),{CloudClient}=require('../engines/universal/lib/cloud');
 const cfg={cloudServer:'https://shelly-a.shelly.cloud',cloudKey:'PRIVATE-TEST-KEY',cloudDeviceId:'aabbccddeeff'};
 const a=new ShellyCloudClient(cfg),b=new CloudClient(cfg);
 await a.queue.run(()=>1);await b.limiter.run(()=>2);assert.equal(shared.accounts.size,1);
 a.queue.defer(30000);assert.ok(b.limiter.next>Date.now());shared.close();
});

test('both runtime engines launch with real storage and publish through the one ZEPRA platform without device writes',async()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';
 const{HomebridgeAPI}=require(apiModule),api=new HomebridgeAPI(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'shelly-suite-test-'));
 const storage=api.user.storagePath;api.user.storagePath=()=>folder;
 const original=global.fetch,registered=[],methods=[];
 api.registerPlatformAccessories=(plugin,platform,list)=>registered.push(...list.map(a=>({plugin,platform,a})));
 api.updatePlatformAccessories=()=>{};api.unregisterPlatformAccessories=()=>{};
 global.fetch=async(url,options)=>{const frame=JSON.parse(options.body);methods.push(frame.method);return Response.json({id:frame.id,result:frame.method==='Shelly.GetDeviceInfo'?{mac:cover.shellyDeviceId}:frame.method==='Cover.GetConfig'?{slat:{enable:true}}:{pos_control:true,current_pos:50,slat_pos:50,state:'stopped'}});};
 try{
  const p=new CombinedPlatform({info(){},warn(){},error:assert.fail},{globalControls:false,devices:[d],shading:{globalControls:false,devices:[cover]}},api);
  assert.equal(p.devices.api.user,api.user);assert.equal(p.shading.api.user,api.user);
  assert.equal(p.devices.api.platformAccessory,api.platformAccessory);assert.equal(p.devices.api.hap,api.hap);
  p.devices.makeClient=()=>({snapshot:async()=>require('../engines/universal/test/fixtures').rpc()});
  api.emit('didFinishLaunching');await p.shading.devices[0].initialPoll;await new Promise(resolve=>setTimeout(resolve,30));
  assert.ok(registered.some(x=>x.a.context.combinedEngine==='universal'));assert.ok(registered.some(x=>x.a.context.combinedEngine==='shading'));
  assert.ok(registered.every(x=>x.plugin==='homebridge-shelly-zepra'&&x.platform==='ShellyZepra'));
  assert.ok(methods.every(method=>['Shelly.GetDeviceInfo','Cover.GetConfig','Cover.GetStatus'].includes(method)));
  await p.devices.statusStore.tail;
  const stored=JSON.parse(fs.readFileSync(path.join(folder,'shelly-universal-status.json'),'utf8'));assert.equal(stored.devices.length,1);
  api.emit('shutdown');await p.shading.statusStore.close();await p.devices.statusStore.tail;
 }finally{global.fetch=original;api.user.storagePath=storage;}
});

test('cloud import omits unused empty local fields without dropping cloud binding',()=>{
 const shade={platform:'ShellyRaffstore',devices:[]};const cloud={id:'c',name:'Cloud',connection:'cloud',cloudServer:'https://shelly-a.shelly.cloud',cloudKey:'PRIVATE-EXAMPLE',cloudDeviceId:'aabbccddeeff',host:'',shellyDeviceId:'',channels:[]};
 const result=merge(shade,{platform:'ShellyUniversal',devices:[cloud]});assert.equal(result.devices[0].host,undefined);assert.equal(result.devices[0].shellyDeviceId,undefined);assert.equal(result.devices[0].cloudDeviceId,cloud.cloudDeviceId);assert.equal(cloud.host,'');
});
