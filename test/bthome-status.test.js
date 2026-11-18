'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const{model}=require('../engines/universal/lib/model'),{bthomeStatus}=require('../engines/universal/lib/bthome-status'),{device,rpc,bthome}=require('../engines/universal/test/fixtures');
const{StatusStore,readStatus}=require('../engines/universal/lib/status'),{rows,signal}=require('../homebridge-ui/public/devices/overview');
test('BTHome dashboard collection keeps configured IDs, stale sensors and unmapped components without mixing hardware',()=>{
 const b=bthome(),d={...device(),bthome:[{...b.config,id:'Office',name:'Büro'},{id:'Missing',name:'Fehlt',deviceComponent:'bthomedevice:201'}]},s=rpc();s.components=b.components;
 s.components.push({key:'bthomesensor:210',config:{addr:'aa:bb:11:22:33:44',obj_id:999},status:{value:7}});
 s.components.find(c=>c.key==='bthomesensor:209').status.last_update_ts=1;d.bthome[0].staleAfter=60;
 const groups=bthomeStatus(s,model(s,d,1000000));assert.equal(groups.length,2);assert.equal(groups[0].id,'Office');assert.equal(groups[0].name,'Büro');assert.equal(groups[0].readings.find(r=>r.component==='bthomesensor:209').fault,true);assert.ok(groups[0].readings.some(r=>r.component==='bthomesensor:210'&&r.fault));assert.ok(!groups[0].readings.some(r=>r.component==='bthomesensor:200'));assert.equal(groups[1].readings.length,0);
});
test('BTHome status file preserves identities while stripping stale data and credentials',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zepra-bthome-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const d=device(),store=new StatusStore(dir,[d],20);
 await store.update(d.id,true,1000,[],[],[{id:'Office',name:'Büro',deviceComponent:'bthomedevice:200',cloudKey:'SECRET-NOT-PUBLIC',readings:[{component:'bthomesensor:207',name:'Temperatur',type:'temperature',values:{CurrentTemperature:22,cloudKey:'SECRET-NOT-PUBLIC'}},{component:'bthomesensor:209',fault:true,type:'humidity',values:{CurrentRelativeHumidity:51}}]}]);
 let data=(await readStatus(dir)).devices[0];assert.equal(data.bthome[0].id,'Office');assert.equal(data.bthome[0].readings[0].values.CurrentTemperature,22);assert.deepEqual(data.bthome[0].readings[1].values,{});assert.ok(!JSON.stringify(data).includes('SECRET-NOT-PUBLIC'));
 await store.update(d.id,false,2000);data=(await readStatus(dir)).devices[0];assert.equal(data.bthome[0].id,'Office');assert.ok(data.bthome[0].readings.every(r=>r.fault&&Object.keys(r.values).length===0));
});
test('dashboard retains configured missing sensors, stale values and buttons as separate identified groups',()=>{
 const d={bthome:[{id:'Door',name:'Tür',deviceComponent:'bthomedevice:200'},{id:'Missing',name:'Fehlt',deviceComponent:'bthomedevice:201'}]},data={bthome:[{id:'Door',deviceComponent:'bthomedevice:200',readings:[{component:'bthomesensor:202',type:'contact',values:{ContactSensorState:0}},{component:'bthomesensor:203',type:'motion',fault:true,values:{MotionDetected:true}},{component:'button:0',type:'button',values:{}}]}]};
 const r=rows(d,data,true);assert.equal(r.length,4);assert.equal(r[0].sensorId,'Door');assert.equal(signal(r[0],true).label,'Geschlossen');assert.equal(signal(r[1],true).state,'unknown');assert.deepEqual(r[1].values,{});assert.equal(signal(r[2],true).label,'Taster');assert.equal(r[3].sensorId,'Missing');assert.equal(signal(r[3],true).state,'unknown');assert.ok(rows(d,data,false).every(r=>signal(r,false).state==='unknown'&&Object.keys(r.values).length===0));
});

test('runtime poll carries every BTHome group identity into the status store even when hidden in HomeKit',async t=>{
 const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api';const{HomebridgeAPI}=require(apiModule),{Platform}=require('../engines/universal');
 const b=bthome(),d={...device(),homekitEnabled:false,bthome:[{...b.config,id:'OfficeSensor',name:'Büro Sensor'}]},snap=rpc();snap.components=b.components;
 const p=new Platform({info(){},warn(){},error:assert.fail},{devices:[d]},new HomebridgeAPI()),updates=[];p.running=true;p.statusStore={update:(...args)=>updates.push(args),stop(){}};
 const unit={config:d,client:{snapshot:async()=>snap},accessories:[],counters:new Map(),failures:0};t.after(()=>{p.running=false;clearTimeout(unit.timer);});await p.poll(unit);
 assert.equal(updates.at(-1)[5][0].id,'OfficeSensor');assert.equal(updates.at(-1)[5][0].name,'Büro Sensor');assert.deepEqual(updates.at(-1)[5][0].readings.map(r=>r.component),['bthomesensor:207','bthomesensor:209','battery']);assert.ok(!updates.at(-1)[4].some(r=>r.component.startsWith('bthomesensor:')));
});
