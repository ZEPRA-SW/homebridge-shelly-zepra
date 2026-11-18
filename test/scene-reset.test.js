'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SceneEngine,SceneStore}=require('../lib/scenes'),M=require('../homebridge-ui/public/scene-model'),{key,group}=require('../lib/scene-reset'),R=require('../lib/scene-runtime');
const config={devices:['a','b','c'].map(id=>({id,name:id,channels:[{component:'switch:0',type:'switch'},{component:'light:0',type:'light'}]})),shading:{timeZone:'Europe/Berlin',devices:[{id:'shade',name:'Shade',deviceType:'raffstore',sunAutomation:{enabled:true},windProtection:true}]}};
const source={area:'devices',deviceId:'a',component:'switch:0',metric:'On'},on={area:'devices',deviceId:'b',component:'switch:0',property:'On',value:true},condition={kind:'status',source,operator:'eq',value:true};
const rule=extra=>({id:'test',name:'Test',mode:'on',condition,actions:[on],restoreOnReset:true,cooldownSeconds:5,...extra});
function setup(rules=[rule()],options={}){
 let now=Date.parse('2026-11-18T12:00:00Z'),sourceValue=false,otherValue=false,sourceAvailable=true;
 const values=new Map(),revisions=new Map(),writers=new Map(),unavailable=new Set(),calls=[],logs=[],store=options.store||new SceneStore();
 function set(a,value){values.set(key(a),value);}
 set(on,false);set({...on,deviceId:'c'},true);set({...on,component:'light:0',property:'Brightness'},25);
 for(const [property,value]of Object.entries({position:80,slatPosition:35,pause:false,auto:true,wind:false}))set({area:'shading',deviceId:'shade',property},value);
 let engine;const inspect=(a,t=now)=>unavailable.has(key(a))?null:values.has(key(a))?{value:values.get(key(a)),observedAt:t,revision:revisions.get(group(a))||0,writer:writers.get(group(a))}:null;
 const execute=async(a,allowed)=>{assert.ok(allowed(),'command allowed before write');writers.set(group(a),a._sceneRestoreToken);revisions.set(group(a),(revisions.get(group(a))||0)+1);if(a._sceneRestoreToken)assert.ok(allowed(),'own revision must not revoke restore');calls.push({...a});set(a,a.value);if(a.area==='shading'&&['position','slatPosition'].includes(a.property))set({...a,property:'pause'},true);};
 engine=new SceneEngine({config:{...config,scenes:rules},store,now:()=>now,observe:r=>sourceAvailable?{value:r.deviceId==='a'?sourceValue:otherValue,observedAt:now}:null,inspect,execute,log:Object.fromEntries(['info','warn','error'].map(k=>[k,s=>logs.push(s)])),delay:async(ms,allowed)=>{assert.ok(allowed());now+=ms;},...options});engine.running=true;
 return {engine,store,values,revisions,writers,unavailable,calls,logs,inspect,set,source(v){sourceValue=v;},other(v){otherValue=v;},available(v){sourceAvailable=v;},advance(ms){now+=ms;},now:()=>now,async trigger(){await engine.tick();sourceValue=true;await engine.tick();},async reset(){sourceValue=false;await engine.tick();}};
}
test('optional reset restores the saved boolean state once, rather than simply inverting the action',async()=>{
 for(const before of [false,true]){const s=setup();s.set(on,before);await s.trigger();assert.equal(s.store.states.test.phase,'reset-pending');assert.equal(s.calls.length,1);await s.reset();assert.equal(s.calls.length,2);assert.equal(s.calls[1].value,before);assert.equal(s.store.states.test.phase,'reset-done');await s.engine.tick();assert.equal(s.calls.length,2);assert.equal(s.store.states.test.reset,undefined);}
});
test('unchecked Scenes retain their previous one-way behavior',async()=>{
 const s=setup([rule({restoreOnReset:false})]);await s.trigger();await s.reset();assert.equal(s.calls.length,1);assert.equal(s.store.states.test.reset,undefined);
});
test('an OR group resets only when its complete expression is false, not when one branch resets',async()=>{
 const s=setup([rule({condition:{kind:'group',operator:'or',children:[condition,{...condition,source:{...source,deviceId:'c'}}]}})]);await s.trigger();s.other(true);s.source(false);await s.engine.tick();assert.equal(s.calls.length,1);s.other(false);await s.engine.tick();assert.equal(s.calls.length,2);
});
test('unavailable source data cannot be interpreted as a reset',async()=>{
 const s=setup();await s.trigger();s.available(false);s.source(false);await s.engine.tick();assert.equal(s.calls.length,1);assert.equal(s.store.states.test.conditionState,'unknown');s.available(true);await s.engine.tick();assert.equal(s.calls.length,2);
});
test('a confirmation duration delays activation but never adds a delay after a known reset',async()=>{
 const s=setup([rule({condition:{...condition,holdSeconds:5}})]);await s.engine.tick();s.source(true);await s.engine.tick();s.advance(5000);await s.engine.tick();assert.equal(s.calls.length,1);await s.reset();assert.equal(s.calls.length,2);
});
test('repeated actions on the same property restore its original value, not an intermediate Scene value',async()=>{
 const s=setup([rule({actions:[on,{...on,value:false},on]})]);await s.trigger();await s.reset();assert.deepEqual(s.calls.map(a=>a.value),[true,false,true,false]);
});
test('all target values are captured before any action and an unavailable original blocks the entire Scene',async()=>{
 const s=setup([rule({actions:[on,{...on,deviceId:'c'}]})]);s.unavailable.add(key({...on,deviceId:'c'}));await s.trigger();assert.equal(s.calls.length,0);assert.equal(s.store.states.test.status,'Kein aktueller Ausgangszustand – Scene nicht ausgeführt');
});
test('brightness Scenes return to their previous numerical value',async()=>{
 const a={...on,component:'light:0',property:'Brightness',value:80},s=setup([rule({actions:[a]})]);await s.trigger();await s.reset();assert.deepEqual(s.calls.map(a=>a.value),[80,25]);
});
test('shading restores height, tilt and automatic-pause state in dependency order',async()=>{
 const a={area:'shading',deviceId:'shade',property:'position',value:10},s=setup([rule({actions:[a]})]);await s.trigger();await s.reset();assert.deepEqual(s.calls.map(a=>[a.property,a.value]),[['position',10],['position',80],['slatPosition',35],['pause',false]]);assert.equal(s.store.states.test.phase,'reset-done');
});
test('an externally changed target value is not overwritten by reset',async()=>{
 const s=setup();await s.trigger();s.set(on,false);await s.reset();assert.equal(s.calls.length,1);assert.equal(s.store.states.test.phase,'reset-partial');assert.ok(s.store.states.test.events.some(e=>e.message.includes('zwischenzeitlich verändert')));
});
test('a later known manual command takes precedence even when it sets the same value',async()=>{
 const s=setup();await s.trigger();s.revisions.set(group(on),99);await s.reset();assert.equal(s.calls.length,1);assert.ok(s.store.states.test.events.some(e=>e.message.includes('neuere Steuerung')));
});
test('another Scene can supersede ownership of the same target without a redundant reset',async()=>{
 const second=rule({id:'second',condition:{...condition,source:{...source,deviceId:'c'}},restoreOnReset:false}),s=setup([rule(),second]);await s.trigger();s.other(true);await s.engine.tick();assert.equal(s.calls.length,2);await s.reset();assert.equal(s.calls.length,2);assert.equal(s.store.states.test.phase,'reset-partial');
});
test('a target that goes offline is logged and skipped, without retry storms',async()=>{
 const s=setup();await s.trigger();s.unavailable.add(key(on));await s.reset();assert.equal(s.calls.length,1);const events=JSON.stringify(s.store.states.test.events);await s.engine.tick();assert.equal(JSON.stringify(s.store.states.test.events),events);
});
test('a failed or ambiguous forward command is never automatically inverted',async()=>{
 const s=setup([rule()],{execute:async()=>{throw Error('unknown response');}});await s.trigger();await s.reset();assert.equal(s.calls.length,0);assert.ok(s.store.states.test.events.some(e=>e.type==='reset-skip'));
});
test('reset during an action delay cancels remaining stages and restores already accepted commands',async()=>{
 let s;s=setup([rule({actions:[on,{...on,deviceId:'c',delaySeconds:30}]})],{delay:async(ms,allowed)=>{s.advance(ms);s.source(false);if(!allowed())throw Object.assign(Error('cancelled'),{code:'SCENE_CANCELLED'});}});await s.trigger();assert.deepEqual(s.calls.map(a=>[a.deviceId,a.value]),[['b',true],['b',false]]);assert.equal(s.store.states.test.phase,'reset-done');
});
test('a completed Scene can clean up after its activation window without starting new work',async()=>{
 const s=setup([rule({mode:'schedule',schedule:{start:'13:00',end:'14:00',days:[3]}})]);await s.trigger();s.advance(3600000);await s.reset();assert.equal(s.calls.length,2);assert.equal(s.calls.at(-1).value,false);
});
test('pending restoration is explicitly abandoned on restart rather than becoming an unsolicited command',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scene-reset-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=setup([rule()],{store:new SceneStore(dir)});await s.trigger();const nextStore=new SceneStore(dir);assert.equal(nextStore.states.test.reset,undefined);assert.equal(nextStore.states.test.phase,'aborted');assert.ok(nextStore.states.test.events.at(-1).message.includes('Neustart'));const next=setup([rule()],{store:nextStore});await next.engine.tick();assert.equal(next.calls.length,0);
});
test('a restore is cancelled when the original condition becomes true again while it waits for capacity',async()=>{
 let s;s=setup([rule()],{delay:async ms=>{s.advance(ms);s.source(true);}});await s.trigger();s.engine.budget=Array(30).fill(s.now());await s.reset();assert.equal(s.calls.length,1);assert.equal(s.store.states.test.phase,'aborted');
});
test('runtime condition lamp state respects confirmation duration, unavailable readings and disabled Scenes',async()=>{
 const s=setup([rule({restoreOnReset:false,condition:{...condition,holdSeconds:5}})]);await s.engine.tick();assert.equal(s.store.states.test.conditionState,'false');s.source(true);await s.engine.tick();assert.equal(s.store.states.test.conditionState,'false');s.advance(5000);await s.engine.tick();assert.equal(s.store.states.test.conditionState,'true');s.available(false);await s.engine.tick();assert.equal(s.store.states.test.conditionState,'unknown');s.engine.rules[0].mode='off';await s.engine.tick();assert.equal(s.store.states.test.conditionState,'inactive');
});
test('the restoration option rejects non-boolean values',()=>{assert.throws(()=>M.validate([rule({restoreOnReset:'yes'})],config),/Rücksetzung/);});
test('a persisted restore protocol always remains bounded to ten events',async()=>{
 const s=setup();for(let i=0;i<4;i++){await s.trigger();await s.reset();s.advance(6000);}assert.equal(s.store.states.test.events.length,10);assert.ok(s.store.states.test.events.some(e=>e.type==='reset-done'));
});

test('actual general write queue keeps a restore allowed through its own revision change',async()=>{
 const {Platform}=require('../engines/universal'),stamp=Date.now(),descriptor={key:'switch:0',output:true,gen:2,values:{On:true},options:{}},record={online:true,checkedAt:stamp,readings:[{component:'switch:0',values:{On:true}}]},unit={config:{id:'b'},sceneModel:{descriptors:[descriptor]},sceneOnline:true,sceneCheckedAt:stamp,writeTail:Promise.resolve()},p={devices:{running:true,config:{pollInterval:20},units:new Map([['b',unit]]),statusStore:{maxAge:60000,devices:new Map([['b',record]])},poll(){}}};
 let before=R.inspect(p,on),checks=0;const token='restore-test';unit.client={write:async(_c,_v,allowed)=>{checks++;assert.ok(allowed());record.readings[0].values.On=false;assert.ok(allowed());}};
 const allowed=()=>{const r=R.inspect(p,on);return r.writer===token||r.revision===before.revision&&r.value===true;};await Platform.prototype.sceneAction.call(p.devices,{...on,value:false,_sceneRestoreToken:token},allowed);assert.equal(checks,1);assert.equal(R.inspect(p,on).writer,token);
});
test('real cover controller can finish an in-flight move before restoring height, slats and pause',async t=>{
 const {CoverController}=require('../engines/shading/lib/controller');let now=Date.now(),sourceValue=false,revision=0,writer,pause=false,polls=0; t.mock.method(Date,'now',()=>now);
 const hw={state:'stopped',current_pos:80,slat_pos:35,pos_control:true,target_pos:80},commands=[],records=new Map();let remaining=0;
 const publish=()=>records.set('shade',{online:true,checkedAt:now,position:hw.current_pos,slatPosition:hw.slat_pos,manualPaused:pause,automationEnabled:true,windAlarm:false});publish();
 const client={call:async(method,args)=>{
  if(method==='Cover.GetConfig')return{slat:{enable:true}};
  if(method==='Cover.GetStatus'){if(remaining>0){remaining--;hw.current_pos=remaining?Math.round((hw.current_pos+hw.target_pos)/2):hw.target_pos;hw.state=remaining?(hw.current_pos<hw.target_pos?'opening':'closing'):'stopped';}return{...hw};}
  if(method==='Cover.GoToPosition'){commands.push({...args});if(args.pos!==undefined&&args.pos!==hw.current_pos){hw.target_pos=args.pos;remaining=3;hw.state=args.pos>hw.current_pos?'opening':'closing';}if(args.slat_pos!==undefined)hw.slat_pos=args.slat_pos;return{};}throw Error(method);
 }};
 const controller=new CoverController(client,0,()=>publish(),0,{kind:'raffstore',clock:()=>now,onCommand:origin=>{revision++;writer=origin.startsWith('scene-reset:')?origin.slice(12):undefined;}}),runtime={config:config.shading.devices[0],controller,automation:{},sceneRevision:()=>revision,sceneWriter:()=>writer,claimSceneWriter:v=>{writer=v;},setPause:v=>{pause=v;revision++;writer=undefined;publish();}};
 const platform={config:{...config,pollInterval:20},shading:{devices:[runtime],statusStore:{records}}};
 const shade={area:'shading',deviceId:'shade',property:'position',value:10},store=new SceneStore(),engine=new SceneEngine({config:{...config,pollInterval:20,scenes:[rule({actions:[shade]})]},store,now:()=>now,observe:()=>({value:sourceValue,observedAt:now}),inspect:(a,at)=>R.inspect(platform,a,at),execute:(a,allowed)=>R.execute(platform,a,allowed),delay:async(ms,allowed)=>{assert.ok(allowed());now+=ms;polls++;await controller.refresh();},log:{info(){},warn(){},error:assert.fail}});engine.running=true;
 await engine.tick();sourceValue=true;await engine.tick();assert.equal(store.states.test.phase,'reset-pending');sourceValue=false;now+=1;await engine.tick();assert.equal(store.states.test.phase,'reset-done');assert.equal(hw.current_pos,80);assert.equal(hw.slat_pos,35);assert.equal(pause,false);assert.ok(polls>=3);assert.deepEqual(commands.filter(c=>c.pos!==undefined).map(c=>c.pos),[10,80]);controller.dispose();
});
test('the condition indicator persists a heartbeat without appending protocol noise',async()=>{
 const s=setup([rule({restoreOnReset:false})]);await s.engine.tick();const first=s.store.states.test.conditionCheckedAt;s.advance(15000);await s.engine.tick();assert.equal(s.store.states.test.conditionCheckedAt,first+15000);assert.equal(s.store.states.test.events,undefined);
});
