'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{SceneEngine,SceneStore}=require('../lib/scenes'),M=require('../homebridge-ui/public/scene-model'),R=require('../lib/scene-runtime');
const config={devices:['a','b'].map(id=>({id,name:id,channels:[{component:'switch:0',type:'switch'}]})),shading:{timeZone:'Europe/Berlin',devices:[{id:'shade',name:'Shade',deviceType:'raffstore',windProtection:true,sunAutomation:{enabled:true}}]}};
const source={area:'devices',deviceId:'a',component:'switch:0',metric:'On'},action={area:'devices',deviceId:'b',component:'switch:0',property:'On',value:true};
const rule=(extra={})=>({id:'test',name:'Test',mode:'on',condition:{kind:'status',source,operator:'eq',value:true},action,cooldownSeconds:5,...extra});
function setup(rules=[rule()],extra={}){let now=Date.parse('2026-11-12T12:00:00Z'),value=false;const calls=[],logs=[];const store=extra.store||new SceneStore();const engine=new SceneEngine({config:{...config,scenes:rules},store,observe:()=>value===null?null:{value},execute:async a=>calls.push(a),log:Object.fromEntries(['info','warn','error'].map(k=>[k,s=>logs.push(s)])),now:()=>now,...extra});engine.running=true;return {engine,store,calls,logs,set(v){value=v;},time(v){now=typeof v==='string'?Date.parse(v):v;},advance(ms){now+=ms;}};}
test('Scene drafts are disabled; active references, types and actuator loops are validated',()=>{
 assert.doesNotThrow(()=>M.validate([{id:'draft',name:'Draft',mode:'off'}],config));assert.throws(()=>M.validate([rule({action:{...action,deviceId:'missing'}})],config),/Ziel/);
 assert.throws(()=>M.validate([rule({action:{...action,deviceId:'a'}})],config),/Regelschleife/);
 const reverse=rule({id:'reverse',condition:{kind:'status',source:{...source,deviceId:'b'},operator:'eq',value:true},action:{...action,deviceId:'a'}});assert.throws(()=>M.validate([rule(),reverse],config),/Regelschleife/);
 assert.throws(()=>M.validate([rule({condition:{kind:'status',source,operator:'gt',value:1}})],config),/Schaltzustände/);
});
test('status Scenes use a startup baseline, react on the edge once and enforce cooldown',async()=>{
 const s=setup();s.set(true);await s.engine.tick();assert.equal(s.calls.length,0);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);await s.engine.tick();assert.equal(s.calls.length,1);
 s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);s.advance(6000);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,2);
});
test('missing or stale data resets the baseline and cannot create a recovery action',async()=>{
 const s=setup();await s.engine.tick();s.set(null);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,0);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('numeric hysteresis keeps a threshold latched until its reset boundary',async()=>{
 const s=setup([rule({condition:{kind:'value',source:{...source,metric:'Power'},operator:'gt',value:100,hysteresis:10}})]);s.set(95);await s.engine.tick();s.set(101);await s.engine.tick();s.advance(6000);s.set(95);await s.engine.tick();s.set(102);await s.engine.tick();assert.equal(s.calls.length,1);s.set(89);await s.engine.tick();s.set(101);await s.engine.tick();assert.equal(s.calls.length,2);
});
test('activation windows support weekdays and midnight; inactive rules do not queue catch-up actions',async()=>{
 assert.equal(M.scheduleActive({days:[4],start:'22:00',end:'06:00'},5,'02:00'),true);assert.equal(M.scheduleActive({days:[4],start:'22:00',end:'06:00'},5,'07:00'),false);
 const s=setup([rule({mode:'schedule',schedule:{days:[4],start:'14:00',end:'16:00'}})]);s.time('2026-11-12T12:59:00Z');await s.engine.tick();s.set(true);await s.engine.tick();s.time('2026-11-12T13:00:00Z');await s.engine.tick();assert.equal(s.calls.length,0);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('daily time execution is persisted across restarts and a repeated DST hour',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scene-clock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const r=rule({condition:{kind:'time',time:'02:30',days:[0]}}),s=setup([r],{store:new SceneStore(dir)});s.time('2026-10-25T00:30:00Z');await s.engine.tick();assert.equal(s.calls.length,1);const next=setup([r],{store:new SceneStore(dir)});next.time('2026-10-25T01:30:00Z');await next.engine.tick();assert.equal(next.calls.length,0);next.time('2026-11-01T01:30:00Z');await next.engine.tick();assert.equal(next.calls.length,1);
});
test('failed or unconfirmed actions are recorded and never retried automatically',async()=>{
 let attempts=0;const s=setup([rule({condition:{kind:'time',time:'13:00',days:[4]}})],{execute:async()=>{attempts++;throw Error('timeout');}});await s.engine.tick();await s.engine.tick();assert.equal(attempts,1);assert.equal(s.store.states.test.status,'Aktion fehlgeschlagen');
});
test('a failed state write prevents execution; stopping prevents new actions',async()=>{
 const s=setup([rule({condition:{kind:'time',time:'13:00',days:[4]}})],{store:{states:{},save(){throw Error('disk');}}});await s.engine.tick();assert.equal(s.calls.length,0);s.engine.stop();await s.engine.tick();assert.equal(s.calls.length,0);
});
test('global Scene action budget consumes excess time events without retry storms',async()=>{
 const s=setup(Array.from({length:31},(_,i)=>rule({id:'r'+i,condition:{kind:'time',time:'13:00',days:[4]}})));await s.engine.tick();assert.equal(s.calls.length,30);const count=s.logs.length;await s.engine.tick();assert.equal(s.calls.length,30);assert.equal(s.logs.length,count);
});
test('observations honor device freshness and BTHome identity rather than battery component names',()=>{
 const now=100000,p={config:{devices:[{id:'a',bthome:[{id:'one',deviceComponent:'bthomedevice:200'},{id:'two',deviceComponent:'bthomedevice:201'}]}]},devices:{statusStore:{maxAge:30000,devices:new Map([['a',{online:true,checkedAt:now,bthome:[{id:'one',deviceComponent:'bthomedevice:200',readings:[{component:'battery',observedAt:now,values:{BatteryLevel:10}}]},{id:'two',deviceComponent:'bthomedevice:201',readings:[{component:'battery',observedAt:now,values:{BatteryLevel:90}}]}]}]])}}};
 const ref={area:'devices',deviceId:'a',sensorId:'two',component:'battery',metric:'BatteryLevel'};assert.equal(R.observe(p,ref,now).value,90);assert.equal(R.observe(p,ref,now+30001),null);p.devices.statusStore.devices.get('a').bthome[1].fault=true;assert.equal(R.observe(p,ref,now),null);
});
test('shading actions obey wind and recovery locks and route height/tilt through the movement queue',async()=>{
 const calls=[],runtime={config:{id:'shade'},controller:{move:async(...a)=>calls.push(a)},automation:{},setPause:v=>calls.push(v)},p={config:{pollInterval:20,shading:{devices:[{id:'shade'}]}},shading:{devices:[runtime],statusStore:{records:new Map([['shade',{online:true,checkedAt:Date.now(),position:50}]])}}};
 runtime.controller.windAlarm=true;await assert.rejects(R.execute(p,{area:'shading',deviceId:'shade',property:'position',value:80},()=>true),/Windalarm/);assert.equal(calls.length,0);runtime.controller.windAlarm=false;
 await R.execute(p,{area:'shading',deviceId:'shade',property:'position',value:80},()=>true);assert.equal(calls[0],true);assert.deepEqual(calls[1][0],{pos:80});calls.length=0;await R.execute(p,{area:'shading',deviceId:'shade',property:'slatPosition',value:40},()=>true);assert.deepEqual(calls[1][0],{slat_pos:40});
});

test('a slow actuator does not block another Scene and in-flight events are not queued repeatedly',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),calls=[];const r1=rule({condition:{kind:'time',time:'13:00',days:[4]}}),r2=rule({id:'wind',condition:{kind:'time',time:'13:00',days:[4]},action:{area:'shading',deviceId:'shade',property:'wind',value:true}});
 const s=setup([r1,r2],{execute:async a=>{calls.push(a.property);if(a.property==='On')await gate;}});const pending=s.engine.tick();await Promise.resolve();assert.deepEqual(calls,['On','wind']);await s.engine.tick();assert.equal(calls.length,2);release();await pending;
});
test('queued work loses permission after its activation window or shutdown',async()=>{
 let permitted;const s=setup([rule({mode:'schedule',schedule:{days:[4],start:'12:00',end:'14:00'},condition:{kind:'time',time:'13:00',days:[4]}})],{execute:async(_a,allowed)=>{permitted=allowed;}});await s.engine.tick();assert.equal(permitted(),true);s.time('2026-11-12T13:00:00Z');assert.equal(permitted(),false);s.time('2026-11-12T12:00:00Z');s.engine.stop();assert.equal(permitted(),false);
});
test('general output actions work without HomeKit tiles, check freshness and reuse the write queue',async()=>{
 const {Platform}=require('../engines/universal'),calls=[];const descriptor={key:'switch:0',output:true,gen:2,values:{On:true},options:{}};
 const unit={config:{id:'b',homekitEnabled:false},sceneModel:{descriptors:[descriptor]},sceneOnline:true,sceneCheckedAt:Date.now(),writeTail:Promise.resolve(),client:{write:async(...a)=>calls.push(a)}},p={running:true,config:{pollInterval:20},units:new Map([['b',unit]]),poll(){}};
 await Platform.prototype.sceneAction.call(p,action,()=>true);assert.deepEqual(calls[0].slice(0,2),['switch:0',{on:true}]);await Platform.prototype.sceneAction.call(p,{...action,value:false},()=>true);assert.deepEqual(calls[1].slice(0,2),['switch:0',{on:false}]);assert.equal(typeof calls[1][2],'function');unit.sceneCheckedAt=0;await assert.rejects(Platform.prototype.sceneAction.call(p,{...action,value:false},()=>true),/Zieldaten/);assert.equal(calls.length,2);
});
test('cloud and local clients recheck Scene permission before sending mutations',async()=>{
 const{CloudClient}=require('../engines/universal/lib/cloud'),{Client}=require('../engines/universal/lib/client');let valid=true,fetches=0,guard;
 const cloud=new CloudClient({cloudServer:'https://shelly-example.shelly.cloud',cloudKey:'EXAMPLE',cloudDeviceId:'aabbccddeeff'},async()=>{fetches++;}, {run:async(work,meta)=>{guard=meta.allowed;valid=false;return work();}});
 await assert.rejects(cloud.request('set/switch',{},false,()=>valid),/Freigabe/);assert.equal(fetches,0);assert.equal(guard(),false);
 valid=true;const client=new Client({host:'192.0.2.1',shellyDeviceId:'aabbccddeeff'});client.identify=async()=>{valid=false;return{profile:'switch'};};client.rpc=async()=>{fetches++;};await assert.rejects(client.write('switch:0',{on:true},()=>valid),/Freigabe/);assert.equal(fetches,0);
});

test('queued state actions lose permission when their source becomes stale or no longer matches',async()=>{
 let permitted;const s=setup([rule()],{execute:async(_a,allowed)=>{permitted=allowed;}});await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(permitted(),true);s.set(false);assert.equal(permitted(),false);s.set(null);assert.equal(permitted(),false);
});

test('combined Homebridge runtime starts Scenes and routes a real status transition to a hidden actuator',async()=>{
 const apiModule=process.env.SHELLY_HOMEBRIDGE_VERSION==='2'?path.join(path.dirname(require.resolve('homebridge-v2')),'api.js'):'homebridge/lib/api', {HomebridgeAPI}=require(apiModule),{CombinedPlatform}=require('../index'),fixtures=require('../engines/universal/test/fixtures');
 const api=new HomebridgeAPI(),savedStorage=api.user.storagePath,dir=fs.mkdtempSync(path.join(os.tmpdir(),'scene-runtime-')),calls=[],state={a:false,b:false};api.user.storagePath=()=>dir;api.registerPlatformAccessories=()=>{};api.updatePlatformAccessories=()=>{};api.unregisterPlatformAccessories=()=>{};
 let platform;
 try{platform=new CombinedPlatform({info(){},warn(){},error:assert.fail},{devices:[{...fixtures.device(),id:'a',host:'192.0.2.1'},{...fixtures.device(),id:'b',host:'192.0.2.2',shellyDeviceId:'112233445566',homekitEnabled:false}],shading:{devices:[]},scenes:[rule()]},api);
  platform.devices.makeClient=d=>({snapshot:async()=>{const snap=fixtures.rpc();snap.status['switch:0'].output=state[d.id];return snap;},write:async(component,values,allowed)=>{assert.ok(allowed());calls.push({device:d.id,component,values});state[d.id]=values.on;}});
  api.emit('didFinishLaunching');await new Promise(resolve=>setTimeout(resolve,30));assert.ok(platform.scenes);await platform.scenes.tick();assert.equal(calls.length,0);state.a=true;await platform.devices.poll(platform.devices.units.get('a'));await platform.scenes.tick();assert.deepEqual(calls,[{device:'b',component:'switch:0',values:{on:true}}]);assert.equal(platform.devices.units.get('b').accessories.length,0);await platform.scenes.tick();assert.equal(calls.length,1);
 }finally{if(platform){api.emit('shutdown');await platform.shading.statusStore.close();await platform.devices.statusStore.tail;}api.user.storagePath=savedStorage;fs.rmSync(dir,{recursive:true,force:true});}
});

test('legacy single actions migrate losslessly and every sequence target participates in cycle checks',()=>{
 const old=rule();assert.deepEqual(M.actions(old),[{...action,delaySeconds:0}]);assert.equal(old.actions,undefined);
 const invalid=rule({actions:[action,{...action,deviceId:'a',delaySeconds:10}]});assert.throws(()=>M.validate([invalid],config),/Regelschleife/);
 assert.throws(()=>M.validate([rule({actions:[{...action,delaySeconds:-1}]})],config),/Wartezeit/);assert.throws(()=>M.validate([rule({actions:[{...action,delaySeconds:0.5}]})],config),/Wartezeit/);assert.throws(()=>M.validate([rule({actions:[{...action,delaySeconds:86400},{...action,delaySeconds:1}]})],config),/24 Stunden/);
});
test('action sequences preserve order and wait after acceptance; trigger reset does not cancel cleanup steps',async()=>{
 const calls=[],waits=[];let s;s=setup([rule({actions:[{...action,value:true},{...action,value:false,delaySeconds:30}]})],{execute:async(a,allowed)=>{assert.equal(allowed(),true);calls.push(a.value);if(a.value)s.set(false);},delay:async(ms,allowed)=>{assert.equal(allowed(),true);waits.push(ms);s.advance(ms);}});
 await s.engine.tick();s.set(true);await s.engine.tick();assert.deepEqual(calls,[true,false]);assert.deepEqual(waits,[30000]);assert.equal(s.store.states.test.phase,'done');assert.equal(s.store.states.test.step,2);
});
test('explicit long waits are allowed in time-triggered sequences without expiring at the original trigger minute',async()=>{
 let s;const calls=[];s=setup([rule({condition:{kind:'time',time:'13:00',days:[4]},actions:[{...action,delaySeconds:120},{...action,value:false,delaySeconds:180}]})],{execute:async(a,allowed)=>{assert.ok(allowed());calls.push(a.value);},delay:async(ms,allowed)=>{assert.ok(allowed());s.advance(ms);}});await s.engine.tick();assert.deepEqual(calls,[true,false]);assert.equal(s.store.states.test.phase,'done');
});
test('shutdown cancels an actual pending delay and discards remaining actions',async()=>{
 const calls=[],s=setup([rule({condition:{kind:'time',time:'13:00',days:[4]},actions:[action,{...action,value:false,delaySeconds:3600}]})],{execute:async a=>calls.push(a.value)});const pending=s.engine.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.engine.waiters.size,1);s.engine.stop();await pending;assert.deepEqual(calls,[true]);assert.equal(s.engine.waiters.size,0);assert.equal(s.store.states.test.phase,'aborted');
});
test('activation window expiry aborts a delayed sequence before the next action',async()=>{
 let s;const calls=[];s=setup([rule({mode:'schedule',schedule:{start:'13:00',end:'14:00',days:[4]},condition:{kind:'time',time:'13:59',days:[4]},actions:[action,{...action,value:false,delaySeconds:120}]})],{execute:async a=>calls.push(a.value),delay:async ms=>s.advance(ms)});s.time('2026-11-12T12:59:00Z');await s.engine.tick();assert.deepEqual(calls,[true]);assert.equal(s.store.states.test.phase,'aborted');
});
test('an action failure aborts the sequence, never runs later steps and is not retried',async()=>{
 const calls=[],s=setup([rule({condition:{kind:'time',time:'13:00',days:[4]},actions:[action,{...action,value:false},action]})],{execute:async a=>{calls.push(a.value);if(!a.value)throw Error('timeout');}});await s.engine.tick();await s.engine.tick();assert.deepEqual(calls,[true,false]);assert.equal(s.store.states.test.step,2);assert.equal(s.store.states.test.phase,'aborted');
});
test('persisted waiting sequences are marked aborted on restart rather than resumed',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scene-sequence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new SceneStore(dir);store.states={test:{lastRun:123,lastDay:'2026-11-12',phase:'wait',step:2,total:3,waitUntil:99999,status:'waiting'}};store.save();const restarted=new SceneStore(dir);assert.equal(restarted.states.test.phase,'aborted');assert.equal(restarted.states.test.status,'Nach Neustart abgebrochen');assert.equal(restarted.states.test.lastRun,123);assert.equal(restarted.states.test.waitUntil,undefined);
});
test('every command in a sequence counts against the global action budget',async()=>{
 const actions=Array.from({length:20},()=>({...action})),s=setup([rule({id:'first',condition:{kind:'time',time:'13:00',days:[4]},actions}),rule({id:'second',condition:{kind:'time',time:'13:00',days:[4]},actions})]);await s.engine.tick();assert.equal(s.calls.length,30);await s.engine.tick();assert.equal(s.calls.length,30);assert.ok(Object.values(s.store.states).some(x=>x.phase==='aborted'));
});

test('a matching condition must stay true for the configured duration and triggers only once',async()=>{
 const s=setup([rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:10}})]);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,0);s.advance(9999);await s.engine.tick();assert.equal(s.calls.length,0);s.advance(1);await s.engine.tick();assert.equal(s.calls.length,1);s.advance(60000);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('a positive hold begins on the first fresh matching reading after startup',async()=>{
 const s=setup([rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:5}})]);s.set(true);await s.engine.tick();assert.equal(s.calls.length,0);s.advance(5000);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('interruptions and unavailable readings reset the entire hold duration',async()=>{
 const s=setup([rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:10}})]);s.set(true);await s.engine.tick();s.advance(9000);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();s.advance(9000);await s.engine.tick();assert.equal(s.calls.length,0);s.set(null);await s.engine.tick();s.set(true);await s.engine.tick();s.advance(9999);await s.engine.tick();assert.equal(s.calls.length,0);s.advance(1);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('duration completion requires a confirming source sample rather than only the cached initial reading',async()=>{
 let observedAt=Date.parse('2026-11-12T12:00:00Z');const s=setup([rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:5}})],{observe:()=>({value:true,observedAt})});await s.engine.tick();s.advance(10000);await s.engine.tick();assert.equal(s.calls.length,0);observedAt+=10000;await s.engine.tick();assert.equal(s.calls.length,1);
});
test('numeric holds reset when the comparison becomes false',async()=>{
 const s=setup([rule({condition:{kind:'value',source:{...source,metric:'Power'},operator:'gt',value:100,holdSeconds:5}})]);s.set(101);await s.engine.tick();s.advance(4000);s.set(99);await s.engine.tick();s.set(101);await s.engine.tick();s.advance(5000);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('a hold cannot accumulate across inactive schedule windows',async()=>{
 const s=setup([rule({mode:'schedule',schedule:{days:[4,5],start:'13:00',end:'14:00'},condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:120}})]);s.time('2026-11-12T12:59:00Z');s.set(true);await s.engine.tick();s.advance(60000);await s.engine.tick();assert.equal(s.calls.length,0);s.time('2026-11-13T12:00:00Z');await s.engine.tick();s.advance(119999);await s.engine.tick();assert.equal(s.calls.length,0);s.advance(1);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('invalid hold durations and a mismatched selected Shelly are rejected',()=>{
 for(const holdSeconds of [-1,0.5,86401])assert.throws(()=>M.validate([rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds}})],config),/Bedingungsdauer/);
 assert.throws(()=>M.validate([rule({condition:{kind:'status',source,sourceDevice:{area:'devices',deviceId:'b'},operator:'eq',value:true}})],config),/passen nicht/);
});
test('a restarted Scene starts its hold from fresh observations instead of restoring elapsed time',async()=>{
 const r=rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:10}}),s=setup([r]);s.set(true);await s.engine.tick();s.advance(9000);await s.engine.tick();const next=setup([r],{store:s.store});next.set(true);await next.engine.tick();next.advance(9999);await next.engine.tick();assert.equal(next.calls.length,0);next.advance(1);await next.engine.tick();assert.equal(next.calls.length,1);
});

test('choosing a Shelly before its metric produces a readable validation error',()=>{
 assert.throws(()=>M.validate([rule({condition:{kind:'status',sourceDevice:{area:'devices',deviceId:'a'},operator:'eq',value:true}})],config),/Quelle nicht verfügbar/);
});
test('a held condition rejected by the action budget is consumed instead of retried every tick',async()=>{
 const s=setup([rule({condition:{kind:'status',source,operator:'eq',value:true,holdSeconds:1}})]);s.set(true);await s.engine.tick();s.engine.budget=Array(30).fill(Date.parse('2026-11-12T12:00:00Z'));s.advance(1000);await s.engine.tick();const logs=s.logs.length;await s.engine.tick();assert.equal(s.calls.length,0);assert.equal(s.logs.length,logs);s.advance(60000);await s.engine.tick();assert.equal(s.calls.length,0);
});

const group=(operator,...children)=>({kind:'group',operator,children});
const leaf=(id='a',extra={})=>({kind:'status',source:{...source,deviceId:id},operator:'eq',value:true,...extra});
const clock=(time='13:00')=>({kind:'time',time,days:[4]});
test('nested AND/OR groups validate every leaf, reject empty groups, deep trees and cycles',()=>{
 const valid=group('and',leaf(),group('or',leaf(),clock()));assert.doesNotThrow(()=>M.validate([rule({condition:valid})],config));
 assert.throws(()=>M.validate([rule({condition:group('or')})],config),/Gruppe/);
 assert.throws(()=>M.validate([rule({condition:group('xor',leaf())})],config),/Gruppe/);
 assert.throws(()=>M.validate([rule({condition:group('or',leaf(),leaf('missing'))})],config),/Quelle/);
 assert.throws(()=>M.validate([rule({condition:group('or',leaf(),leaf('b'))})],config),/Regelschleife/);
 let deep=leaf();for(let i=0;i<7;i++)deep=group('and',deep);assert.throws(()=>M.validate([rule({condition:deep})],config),/baum/);
 const cyclic=group('and');cyclic.children.push(cyclic);assert.throws(()=>M.validate([rule({condition:cyclic})],config),/baum/);
});
test('nested groups trigger only on an overall rising edge and require all AND witnesses',async()=>{
 let first=false,second=false;const s=setup([rule({condition:group('and',leaf(),group('or',leaf('shade',{source:{area:'shading',deviceId:'shade',metric:'manualPaused'}}),leaf('a',{value:false})))})],{observe:r=>({value:r.area==='shading'?second:first})});
 await s.engine.tick();first=true;await s.engine.tick();assert.equal(s.calls.length,0);second=true;await s.engine.tick();assert.equal(s.calls.length,1);s.advance(6000);await s.engine.tick();assert.equal(s.calls.length,1);second=false;await s.engine.tick();second=true;await s.engine.tick();assert.equal(s.calls.length,2);
});
test('unknown AND branches block execution, while a verified OR branch remains usable',async()=>{
 let a=false,b=null;const observe=r=>r.area==='shading'?b===null?null:{value:b}:{value:a};const other=leaf('shade',{source:{area:'shading',deviceId:'shade',metric:'manualPaused'}});
 const and=setup([rule({condition:group('and',leaf(),other)})],{observe});await and.engine.tick();a=true;await and.engine.tick();assert.equal(and.calls.length,0);
 a=false;const or=setup([rule({condition:group('or',leaf(),other)})],{observe});await or.engine.tick();a=true;await or.engine.tick();assert.equal(or.calls.length,1);
});
test('group holds need a fresh confirming sample and do not retrigger while true',async()=>{
 let stamp=Date.parse('2026-11-12T12:00:00Z');const s=setup([rule({condition:group('and',leaf('a',{holdSeconds:5}))})],{observe:()=>({value:true,observedAt:stamp})});await s.engine.tick();s.advance(6000);await s.engine.tick();assert.equal(s.calls.length,0);stamp+=6000;await s.engine.tick();assert.equal(s.calls.length,1);s.advance(6000);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('group startup and unknown-data recovery cannot fabricate zero-hold edges',async()=>{
 const s=setup([rule({condition:group('and',leaf())})]);s.set(true);await s.engine.tick();assert.equal(s.calls.length,0);s.set(null);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,0);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('time branches persist their day across restarts and condition reordering',async()=>{
 const r=rule({condition:group('or',clock(),leaf())}),s=setup([r]);await s.engine.tick();assert.equal(s.calls.length,1);const restarted=setup([rule({condition:group('or',leaf(),clock())})],{store:s.store});await restarted.engine.tick();assert.equal(restarted.calls.length,0);
});
test('an unsatisfied time AND branch is not consumed until its other conditions match',async()=>{
 const s=setup([rule({condition:group('and',clock(),leaf())})]);await s.engine.tick();assert.equal(s.calls.length,0);s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);s.advance(6000);s.set(false);await s.engine.tick();s.set(true);await s.engine.tick();assert.equal(s.calls.length,1);
});
test('intermediate condition waits after the first command and permits only the next stage',async()=>{
 let ready=false,s;const calls=[];s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:group('and',leaf('b')),conditionTimeoutSeconds:10}]})],{observe:()=>({value:ready}),execute:async a=>calls.push(a.value),delay:async(ms,allowed)=>{assert.ok(allowed());assert.deepEqual(calls,[true]);s.advance(ms);ready=true;}});await s.engine.tick();assert.deepEqual(calls,[true,false]);assert.equal(s.store.states.test.phase,'done');assert.ok(s.store.states.test.events.some(e=>e.type==='condition-met'));
});
test('intermediate hold starts at that stage and requires a confirming observation',async()=>{
 let s,waits=0;const calls=[];s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:group('and',leaf('b',{holdSeconds:3})),conditionTimeoutSeconds:10}]})],{observe:()=>({value:true,observedAt:s.engine.now()}),execute:async a=>calls.push(a.value),delay:async ms=>{waits++;s.advance(ms);}});await s.engine.tick();assert.equal(waits,3);assert.deepEqual(calls,[true,false]);
});
test('intermediate timeout aborts the remaining steps and records its reason once',async()=>{
 let s;const calls=[];s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:group('and',leaf('b')),conditionTimeoutSeconds:2},action]})],{observe:()=>null,execute:async a=>calls.push(a.value),delay:async ms=>s.advance(ms)});await s.engine.tick();await s.engine.tick();assert.deepEqual(calls,[true]);assert.equal(s.store.states.test.status,'Maximale Bedingungswartezeit abgelaufen');assert.equal(s.store.states.test.events.filter(e=>e.type==='condition-wait').length,1);assert.equal(s.store.states.test.events.at(-1).type,'aborted');
});
test('shutdown cancels a live intermediate-condition wait',async()=>{
 const s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:leaf('b'),conditionTimeoutSeconds:30}]})],{observe:()=>({value:false})});const pending=s.engine.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.length,1);assert.equal(s.store.states.test.phase,'condition');s.engine.stop();await pending;assert.equal(s.calls.length,1);assert.equal(s.store.states.test.phase,'aborted');
});
test('activation window expiry cancels a condition wait before its next command',async()=>{
 let s;const calls=[];s=setup([rule({mode:'schedule',schedule:{start:'13:00',end:'14:00',days:[4]},condition:clock('13:59'),actions:[action,{...action,value:false,condition:leaf('b'),conditionTimeoutSeconds:120}]})],{observe:()=>({value:false}),execute:async a=>calls.push(a.value),delay:async()=>s.advance(60000)});s.time('2026-11-12T12:59:30Z');await s.engine.tick();assert.deepEqual(calls,[true]);assert.equal(s.store.states.test.phase,'aborted');
});
test('queued stage commands recheck their own gate, independent from the initial trigger',async()=>{
 let allowed,ready=true;const s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:leaf('b')}]})],{observe:()=>({value:ready}),execute:async(a,guard)=>{if(a.value===false)allowed=guard;}});await s.engine.tick();assert.equal(allowed(),true);ready=false;assert.equal(allowed(),false);
});
test('stage conditions validate missing references and maximum waits without making harmless confirmation gates actuator cycles',()=>{
 assert.doesNotThrow(()=>M.validate([rule({actions:[action,{...action,value:false,condition:leaf('b')}]})],config));
 assert.throws(()=>M.validate([rule({actions:[{...action,condition:leaf('missing')}]})],config),/Quelle/);
 for(const conditionTimeoutSeconds of [0,0.5,86401])assert.throws(()=>M.validate([rule({actions:[{...action,condition:leaf('b'),conditionTimeoutSeconds}]})],config),/Bedingungswartezeit/);
});
test('per-Scene protocol retains the last ten events across runs and restarts',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scene-protocol-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new SceneStore(dir),s=setup([rule()],{store});store.states.test={events:Array.from({length:14},(_,i)=>({timestamp:i,type:'test',message:'event '+i})),phase:'condition',step:2};store.save();const restarted=new SceneStore(dir);assert.equal(restarted.states.test.events.length,10);assert.equal(restarted.states.test.events.at(-1).message,'Nach Neustart abgebrochen');assert.equal(restarted.states.test.phase,'aborted');
});
test('a completed multi-step Scene protocol is bounded and does not claim device arrival',async()=>{
 const s=setup([rule({condition:clock(),actions:[action,{...action,value:false},action]})]);await s.engine.tick();const events=s.store.states.test.events;assert.equal(events.length,10);assert.equal(events.at(-1).type,'done');assert.equal(events.filter(e=>e.type==='accepted').length,3);assert.ok(events.filter(e=>e.type==='accepted').every(e=>e.message.includes('nicht bestätigt')));s.advance(86400000);await s.engine.tick();assert.equal(s.store.states.test.events.length,10);
});

test('wrapping a legacy daily clock in a group does not repeat its already recorded day',async()=>{
 const s=setup([rule({condition:clock()})]);await s.engine.tick();assert.equal(s.calls.length,1);const next=setup([rule({condition:group('and',clock())})],{store:s.store});await next.engine.tick();assert.equal(next.calls.length,0);
});
test('an OR condition does not retrigger when a second branch becomes true while the group stays true',async()=>{
 let a=false,b=false;const s=setup([rule({condition:group('or',leaf(),leaf('shade',{source:{area:'shading',deviceId:'shade',metric:'manualPaused'}}))})],{observe:r=>({value:r.area==='shading'?b:a})});await s.engine.tick();a=true;await s.engine.tick();s.advance(6000);b=true;await s.engine.tick();assert.equal(s.calls.length,1);
});
test('fresh confirming source loss before a queued stage command revokes its permission',async()=>{
 let fresh=true,guard;const s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:leaf('b')}]})],{observe:()=>fresh?{value:true}:null,execute:async(a,allowed)=>{if(!a.value)guard=allowed;}});await s.engine.tick();assert.equal(guard(),true);fresh=false;assert.equal(guard(),false);
});

test('intermediate gates require an observation after gate entry rather than an old cached target value',async()=>{
 let s,stamp=0,waits=0;const calls=[];s=setup([rule({condition:clock(),actions:[action,{...action,value:false,condition:leaf('b'),conditionTimeoutSeconds:5}]})],{observe:()=>({value:true,observedAt:stamp}),execute:async a=>calls.push(a.value),delay:async ms=>{assert.deepEqual(calls,[true]);waits++;s.advance(ms);stamp=s.engine.now();}});await s.engine.tick();assert.equal(waits,1);assert.deepEqual(calls,[true,false]);
});
test('queued commands triggered by a time branch in a group expire after a minute',async()=>{
 let guard;const s=setup([rule({condition:group('and',clock())})],{execute:async(_a,allowed)=>guard=allowed});await s.engine.tick();assert.equal(guard(),true);s.advance(60000);assert.equal(guard(),false);
});
