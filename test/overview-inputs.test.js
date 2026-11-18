'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
for(const file of ['../homebridge-ui/public/devices/overview','../engines/universal/homebridge-ui/public/overview']){
 const {rows}=require(file);
 test(file+': disabled, unspecified and unconfigured inputs stay hidden even with cached readings',()=>{
  const d={channels:[{component:'switch:0'}],inputs:[{component:'input:0',enabled:false},{component:'input:1',enabled:true},{component:'input:2'},{component:'extinput:0',enabled:false},{component:'input:100',enabled:true}]};
  const data={readings:['input:0','input:1','input:2','input:3','extinput:0','input:100','temperature:0'].map(component=>({component,values:{ContactSensorState:1}})),measurements:[{component:'input:0',values:{Power:1}}]};
  assert.deepEqual(rows(d,data,true).map(r=>r.component),['switch:0','input:1','input:100','temperature:0']);
  assert.deepEqual(rows(d,data,false).map(r=>r.component),['switch:0','input:1','input:100']);
  d.inputs[1].enabled=false;assert.ok(!rows(d,data,true).some(r=>r.component==='input:1'));
 });
}

test('BTHome names retain their component ID without duplicating it',()=>{const {title}=require('../homebridge-ui/public/devices/overview');assert.equal(title({name:'Fenster',component:'bthomesensor:202'}),'Fenster · bthomesensor:202');assert.equal(title({name:'bthomesensor:202',component:'bthomesensor:202'}),'bthomesensor:202');});
