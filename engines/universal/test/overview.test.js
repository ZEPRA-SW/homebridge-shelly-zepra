'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {rows,signal}=require('../homebridge-ui/public/overview');
test('output state and power share one row by component identity, not order or display name',()=>{
  const d={channels:[{component:'switch:0',name:'Gleich'},{component:'switch:1',name:'Gleich'}],inputs:[{component:'input:0',name:'Taster',enabled:true}]},data={readings:[{component:'input:0',values:{ContactSensorState:1}},{component:'switch:1',values:{On:true}},{component:'switch:0',values:{On:false}}],measurements:[{component:'switch:1',values:{Power:35}},{component:'switch:0',values:{Power:0}}]};
  const r=rows(d,data,true);assert.equal(r.length,3);assert.equal(r[0].measurements[0].values.Power,0);assert.equal(signal(r[0],true).label,'Aus');assert.equal(r[1].measurements[0].values.Power,35);assert.equal(signal(r[2],true).label,'Aktiv');
});
test('missing and offline channels retain unknown indicators and never use stale values',()=>{
  const d={channels:[{component:'switch:0'}],inputs:[{component:'input:0',enabled:true}]},data={readings:[{component:'switch:0',values:{On:true}}],measurements:[{component:'switch:0',values:{Power:50}}]};
  const r=rows(d,data,false);assert.equal(r.length,2);for(const row of r){assert.deepEqual(row.values,{});assert.deepEqual(row.measurements,[]);assert.equal(signal(row,false).state,'unknown');}
  assert.equal(signal(rows(d,{},true)[0],true).state,'unknown');
});
test('input states use active/inactive while physical contact sensors keep open/closed',()=>{
  assert.equal(signal({kind:'input',values:{ContactSensorState:0}},true).label,'Inaktiv');assert.equal(signal({kind:'sensor',values:{ContactSensorState:0}},true).label,'Geschlossen');assert.equal(signal({kind:'sensor',values:{ContactSensorState:1}},true).label,'Offen');
});
test('owned Gen1 meter joins its relay; shared meters and EM phases remain independent',()=>{
  const d={channels:[{component:'relay:0'},{component:'relay:1'}]},data={measurements:[{component:'meter:0',channel:'relay:0',values:{Power:20}},{component:'meter:1',values:{Power:30}},{component:'em:0:A',values:{Power:80}}]};
  const r=rows(d,data,true);assert.equal(r.length,4);assert.equal(r[0].measurements[0].values.Power,20);assert.equal(r[1].measurements.length,0);assert.equal(r[2].kind,'meter');assert.equal(signal(r[2],true).state,'reading');
});
