'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/models'),{validate}=require('../lib/config'),{model,command}=require('../lib/model'),{device,rpc}=require('./fixtures');
test('static model catalog has unique IDs and official sources; no cover templates',()=>{
  assert.equal(new Set(M.models.map(m=>m.id)).size,M.models.length);assert.ok(M.models.length>=40);
  for(const m of M.models){assert.match(m.source,/^https:\/\/(shelly-api-docs\.shelly\.cloud|kb\.shelly\.cloud)\//);const d=device();M.select(d,m.id);if(m.cloudOnly)Object.assign(d,{connection:'cloud',cloudDeviceId:'aabbccddeeff',cloudKey:'test-key',cloudServer:'https://shelly-123-eu.shelly.cloud'});for(const p of m.profiles||[{id:undefined}]){d.profileId=p.id;M.sync(d,true);assert.doesNotThrow(()=>validate({devices:[d]}));assert.ok(d.channels.every(c=>!c.component.startsWith('cover:')));}}
});
test('Pro 4PM produces exactly four output and four input templates',()=>{
  const d=device();M.select(d,'pro4pm');assert.deepEqual(d.channels.map(c=>c.component),['switch:0','switch:1','switch:2','switch:3']);assert.equal(d.inputs.length,4);assert.ok(d.inputs.every(c=>c.enabled===false));assert.equal(d.generation,'rpc');assert.ok(d.energy);assert.equal(M.get('pro4pm').addon,null);
});
test('model change preserves host identity and resets channel/extension templates explicitly',()=>{
  const d={...device(),bthome:[{id:'old'}]};M.select(d,'pro4pm');const {id,host,shellyDeviceId}=d;M.select(d,'plus10v');assert.deepEqual({id:d.id,host:d.host,shellyDeviceId:d.shellyDeviceId},{id,host,shellyDeviceId});assert.equal(d.channels.length,1);assert.equal(d.channels[0].component,'light:0');assert.deepEqual(d.bthome,[]);
});
test('Plus and Gen3 0–10V dimmers both map to one dimmable light and two inputs',()=>{
  for(const id of ['plus10v','g3-10v','pro-10v']){const d=device();M.select(d,id);assert.equal(d.channels.length,1);assert.equal(d.channels[0].type,'light');assert.ok(M.outputTemplates(d)[0].dimmable);assert.equal(d.inputs.length,2);}
});
test('RGBW profiles produce exact fixed channel sets without changing Shelly profile',()=>{
  const d=device();M.select(d,'plus-rgbw');assert.deepEqual(d.channels.map(c=>c.component),['rgbw:0']);d.profileId='light';M.sync(d,true);assert.deepEqual(d.channels.map(c=>c.component),['light:0','light:1','light:2','light:3']);d.profileId='rgb';M.sync(d,true);assert.deepEqual(d.channels.map(c=>c.component),['rgb:0']);
  M.select(d,'gen1-rgbw2');d.profileId='white';M.sync(d,true);assert.equal(d.channels.length,4);assert.equal(d.channels[3].component,'white:3');
});
test('physical input counts differ from output counts where official APIs require it',()=>{
  for(const [id,n] of [['pro1',2],['pro1pm',2],['pro-dimmer2pm',4],['pluswall',0],['plusi4',4]])assert.equal(M.get(id).inputs.length,n,id);
});
test('model validation rejects nonexistent channels, wrong generation, unsupported extensions and invalid profile',()=>{
  const d=device();M.select(d,'plus10v');d.channels.push({component:'switch:3',type:'outlet'});assert.throws(()=>validate({devices:[d]}));M.select(d,'plus10v');d.generation='gen1';assert.throws(()=>validate({devices:[d]}));M.select(d,'plus10v');d.bthome=[{id:'blu',name:'BLU',deviceComponent:'bthomedevice:200'}];assert.throws(()=>validate({devices:[d]}));M.select(d,'plus-rgbw');d.profileId='cover';assert.throws(()=>validate({devices:[d]}));
});
test('add-on mapping preserves native channel names and allows configured digital component IDs',()=>{
  const d=device();M.select(d,'g3-1pm');d.channels[0].name='Kitchen';d.addons=[{type:'plus-addon',temperature:true,humidity:true,inputId:110}];M.sync(d);assert.equal(d.channels[0].name,'Kitchen');assert.equal(d.inputs.at(-1).component,'input:110');assert.doesNotThrow(()=>validate({devices:[d]}));d.addons=[];M.sync(d);assert.equal(d.inputs.length,1);
  M.select(d,'pro-em');d.addons=[{type:'pro-sensor',inputId:120,inputId2:121}];M.sync(d);assert.deepEqual(d.inputs.map(i=>i.component),['input:120','input:121']);assert.doesNotThrow(()=>validate({devices:[d]}));
});
test('disabled channels and per-channel energy switches suppress only the chosen services',()=>{
  const d=device();M.select(d,'pro4pm');const snap=rpc();for(let i=1;i<4;i++)snap.status['switch:'+i]={output:false,apower:i,current:i,voltage:230};d.channels[0].enabled=false;d.channels[1].type='light';d.channels[2].type='outlet';d.channels[2].showEnergy=false;const m=model(snap,d);assert.ok(!m.descriptors.some(x=>x.key==='switch:0'||x.key==='switch:0:energy'));assert.equal(m.descriptors.find(x=>x.key==='switch:1').type,'light');assert.equal(m.descriptors.find(x=>x.key==='switch:2').type,'outlet');assert.ok(!m.descriptors.some(x=>x.key==='switch:2:energy'));assert.ok(m.descriptors.some(x=>x.key==='switch:3:energy'));
});
test('model-specific add-on sensors are explicit and independent from native sensor option',()=>{
  const d=device();M.select(d,'g3-1pm');d.nativeSensors=false;const snap=rpc();assert.ok(!model(snap,d).descriptors.some(x=>['temperature','humidity'].includes(x.type)));d.addons=[{type:'plus-addon',temperature:true,humidity:false,inputId:100}];M.sync(d);const m=model(snap,d);assert.ok(m.descriptors.some(x=>x.key==='temperature:100'));assert.ok(!m.descriptors.some(x=>x.key==='humidity:100'));
});
test('light profile mismatch blocks outputs while preserving host sensors',()=>{
  const d=device();M.select(d,'plus-rgbw');const snap=rpc();snap.info.profile='light';snap.status['rgbw:0']={output:true,brightness:50,rgb:[255,0,0]};const m=model(snap,d);assert.ok(!m.descriptors.some(x=>x.output));assert.ok(m.warnings.some(x=>x.includes('Lichtprofil')));
});
test('dimmer limits, power-on brightness and RPC transitions map to actual light commands',()=>{
  const d=device();M.select(d,'plus10v');Object.assign(d.channels[0],{minBrightness:10,maxBrightness:80,onBrightness:40,transitionSeconds:2});const snap=rpc();snap.status['light:0']={output:false,brightness:35};const light=model(snap,d).descriptors.find(x=>x.output);assert.deepEqual(command(light,'On',true),{on:true,brightness:40,transition_duration:2});assert.deepEqual(command(light,'Brightness',5),{brightness:10,transition_duration:2});assert.deepEqual(command(light,'Brightness',100),{brightness:80,transition_duration:2});assert.deepEqual(command(light,'Brightness',0),{brightness:0,transition_duration:2});
});
test('bad light limits and unsupported add-on entries fail runtime validation',()=>{
  for(const patch of [{minBrightness:90,maxBrightness:20},{onBrightness:200},{minBrightness:50,onBrightness:20},{transitionSeconds:61}]){const d=device();M.select(d,'plus10v');Object.assign(d.channels[0],patch);assert.throws(()=>validate({devices:[d]}));}
  const d=device();M.select(d,'pro4pm');d.addons=[{type:'plus-addon'}];assert.throws(()=>validate({devices:[d]}));
});
test('old 4Pro template on an RPC device reports the generation mismatch without relay warnings',()=>{
  const d=device();M.select(d,'gen1-4pro');const m=model(rpc(),d);assert.ok(m.warnings.some(w=>w.includes('Shelly Pro 4PM')));assert.ok(!m.warnings.some(w=>w.includes('Ausgang nicht verfügbar')));assert.ok(!m.descriptors.some(d=>d.output));
});
test('per-device tile mode accepts separate/grouped and rejects unknown values',()=>{
  for(const tileMode of ['separate','grouped'])assert.doesNotThrow(()=>validate({devices:[{...device(),tileMode}]}));assert.throws(()=>validate({devices:[{...device(),tileMode:'all-on'}]}));
});

test('EM models are selectable again and existing configurations remain valid',()=>{
 for(const id of ['gen1-em','gen1-3em','pro-em','pro-3em','g3-em']){assert.ok(M.selectable().some(m=>m.id===id));assert.ok(M.selectable(id).some(m=>m.id===id));const d=device();M.select(d,id);assert.doesNotThrow(()=>validate({devices:[d]}));}
});
