'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/devices/models'),{validate}=require('../engines/universal/lib/config');
const base=()=>({id:'sensor-host',name:'Sensor host',host:'192.0.2.10',shellyDeviceId:'aabbccddeeff'});
test('analog mappings preserve digital contacts and explicit names across language changes',()=>{
 for(const language of ['de','en','fr','es']){
  const d=base();M.select(d,'g3-1pm',language);d.addons=[{type:'plus-addon',inputId:110,analogType:'percent',analogId:111}];M.sync(d,false,language);
  assert.deepEqual(d.inputs.map(i=>i.component),['input:0','input:110','input:111']);assert.ok(d.inputs.every(i=>!i.enabled));
  const analog=d.inputs.at(-1);assert.equal(analog.mode,'analog');assert.equal(analog.unit,'%');analog.name='Sensor: My custom name';analog.enabled=true;
  M.sync(d,false,language);assert.equal(d.inputs.at(-1).name,analog.name);assert.equal(d.inputs.at(-1).enabled,true);assert.doesNotThrow(()=>validate({devices:[d]}));
  d.addons[0].analogType='voltage';M.sync(d,false,language);assert.equal(d.inputs.at(-1).component,'voltmeter:111');assert.equal(d.inputs.at(-1).unit,'V');assert.ok(!d.inputs.some(i=>i.component==='input:111'));assert.doesNotThrow(()=>validate({devices:[d]}));
  d.addons=[];M.sync(d,false,language);assert.deepEqual(d.inputs.map(i=>i.component),['input:0']);
 }
});
test('Pro Add-on keeps two digital and two separately mapped analog inputs',()=>{
 const d=base();M.select(d,'pro-em');d.addons=[{type:'pro-sensor',inputId:110,inputId2:111,analogType:'percent',analogId:112,analogType2:'voltage',analogId2:100}];M.sync(d);
 assert.deepEqual(d.inputs.map(i=>i.component),['input:110','input:111','input:112','voltmeter:100']);assert.doesNotThrow(()=>validate({devices:[d]}));
 d.addons[0].analogType='none';M.sync(d);assert.ok(!d.inputs.some(i=>i.component==='input:112'));assert.ok(d.inputs.some(i=>i.component==='voltmeter:100'));
});
test('remapping a contact component as analog clears contact-only properties',()=>{
 const d=base();M.select(d,'g3-1pm');d.addons=[{type:'plus-addon',inputId:100}];M.sync(d);Object.assign(d.inputs.at(-1),{name:'Preserve me',invert:true});
 Object.assign(d.addons[0],{inputId:101,analogType:'percent',analogId:100});M.sync(d);
 const analog=d.inputs.find(i=>i.component==='input:100');assert.equal(analog.mode,'analog');assert.equal(analog.name,'Preserve me');assert.equal(analog.invert,undefined);assert.doesNotThrow(()=>validate({devices:[d]}));
});
