'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/models'),{validate}=require('../lib/config'),{model}=require('../lib/model'),{device,rpc}=require('./fixtures');
function configured(modelId='plus1',addon={}){const d=device();M.select(d,modelId);d.addons=[{type:M.get(modelId).addon,...addon}];M.sync(d);for(const i of d.inputs)i.enabled=true;return d;}
const reading=(snap,d,key)=>model(snap,d).descriptors.find(x=>x.key===key);
test('Sensor Add-on maps digital contact and analog percentage independently, including zero',()=>{
 const d=configured('plus1',{analogType:'percent'}),snap=rpc();snap.status['input:100']={state:true};snap.status['input:101']={percent:0,xpercent:85};
 assert.doesNotThrow(()=>validate({devices:[d]}));assert.equal(reading(snap,d,'input:100').values.ContactSensorState,1);assert.deepEqual(reading(snap,d,'input:101').values,{AnalogValue:0});assert.equal(reading(snap,d,'input:101').unit,'%');
 snap.status['input:101'].percent=100;assert.equal(reading(snap,d,'input:101').values.AnalogValue,100);d.inputs.find(i=>i.component==='input:101').enabled=false;assert.equal(reading(snap,d,'input:101'),undefined);
});
test('Pro Add-on supports two analog components and voltmeter namespace independent of digital IDs',()=>{
 const d=configured('pro-em',{analogType:'percent',analogType2:'voltage',analogId2:100}),snap=rpc();Object.assign(snap.status,{'input:100':{state:false},'input:101':{state:true},'input:102':{percent:42.5},'voltmeter:100':{voltage:7.125,xvoltage:80}});
 assert.doesNotThrow(()=>validate({devices:[d]}));assert.equal(reading(snap,d,'input:100').values.ContactSensorState,0);assert.equal(reading(snap,d,'input:102').values.AnalogValue,42.5);assert.equal(reading(snap,d,'voltmeter:100').values.AnalogValue,7.125);assert.equal(reading(snap,d,'voltmeter:100').unit,'V');
});
test('missing, null, invalid and error analog readings remain faulted without fabricated zero',()=>{
 for(const analogType of ['percent','voltage']){const d=configured('plus1',{analogType}),snap=rpc(),key=analogType==='voltage'?'voltmeter:101':'input:101',field=analogType==='voltage'?'voltage':'percent';
  for(const status of [undefined,{[field]:null},{[field]:NaN},{[field]:-1},{[field]:12,errors:['read_error']},{[field]:12,is_valid:false},...[analogType==='percent'?{percent:101}:{voltage:1001}]]){if(status===undefined)delete snap.status[key];else snap.status[key]=status;const r=reading(snap,d,key);assert.equal(r.fault,true);assert.deepEqual(r.values,{});assert.deepEqual(r.missingValues,['AnalogValue']);}
  snap.status[key]={[field]:0};assert.equal(reading(snap,d,key).fault,false);
 }
});
test('digital contacts support polarity inversion and never treat invalid states as closed',()=>{
 const d=configured(),snap=rpc(),i=d.inputs.find(i=>i.component==='input:100');i.invert=true;snap.status[i.component]={state:true};assert.equal(reading(snap,d,i.component).values.ContactSensorState,0);snap.status[i.component].state=false;assert.equal(reading(snap,d,i.component).values.ContactSensorState,1);
 for(const status of [undefined,{state:null},{state:5},{state:true,errors:['read_error']},{state:false,is_valid:false}]){if(status===undefined)delete snap.status[i.component];else snap.status[i.component]=status;const r=reading(snap,d,i.component);assert.equal(r.fault,true);assert.deepEqual(r.values,{});assert.deepEqual(r.missingValues,['ContactSensorState']);}
});
test('validation rejects conflicting, unsupported and malformed Add-on analog mappings',()=>{
 for(const addon of [{analogType:'temperature'},{analogType:'percent',analogId:99},{analogType:'percent',analogId:100},{analogType:'voltage',analogId:200},{analogType2:'percent'}]){const d=configured('plus1',addon);assert.throws(()=>validate({devices:[d]}));}
 const gen1=configured('gen1-1',{analogType:'percent'});assert.throws(()=>validate({devices:[gen1]}));
 for(const mode of ['state','button']){const d=configured('plus1',{analogType:'voltage'});d.inputs.find(i=>i.mode==='analog').mode=mode;assert.throws(()=>validate({devices:[d]}));}
 const d=device();d.inputs=[{component:'input:100',mode:'analog',enabled:true}];assert.throws(()=>validate({devices:[d]}));
 const badInvert=configured();badInvert.inputs[0].invert='false';assert.throws(()=>validate({devices:[badInvert]}));
});

test('harmless false inversion defaults do not invalidate buttons or analog inputs',()=>{
 const d=configured('plus1',{analogType:'percent'});d.inputs[0].mode='button';d.inputs[0].invert=false;d.inputs.find(i=>i.mode==='analog').invert=false;assert.doesNotThrow(()=>validate({devices:[d]}));d.inputs[0].invert=true;assert.throws(()=>validate({devices:[d]}));
});
