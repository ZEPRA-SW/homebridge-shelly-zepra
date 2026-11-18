'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {powerReadings}=require('../lib/power'),{device,rpc}=require('./fixtures');
test('plugin power display works independently of HomeKit exposure flags and preserves real zero',()=>{
  const d=device();d.energy=false;d.channels[0].showEnergy=false;d.channels[0].enabled=false;d.channels[0].name='Büro';const snap=rpc();snap.status['switch:0'].apower=0;
  const r=powerReadings(snap,d);assert.equal(r[0].name,'Büro');assert.equal(r[0].values.Power,0);assert.equal(r[0].values.Energy,1.234);assert.equal(r[0].values.Voltage,230);assert.ok(!JSON.stringify(r).includes('password'));
});
test('Gen1 shared meter is never assigned to one relay; individual meters retain channel ownership',()=>{
  const d={...device(),channels:[{component:'relay:0',name:'Links'},{component:'relay:1',name:'Rechts'}]},snap={gen:1,info:{type:'SHSW-21'},settings:{},status:{relays:[{ison:true},{ison:false}],meters:[{power:10,total:60000}]}};
  let r=powerReadings(snap,d);assert.equal(r[0].channel,undefined);assert.equal(r[0].name,'Gemeinsamer Zähler');snap.status.meters.push({power:20,total:120000});r=powerReadings(snap,d);assert.equal(r[0].channel,'relay:0');assert.equal(r[1].channel,'relay:1');
});
test('Pro 3EM exposes phase and total measurements without inventing missing values',()=>{
  const snap=rpc();snap.status={'em:0':{a_act_power:100,b_act_power:200,c_act_power:300,total_act_power:600,a_voltage:230,a_current:.5},'emdata:0':{a_total_act_energy:1234,total_act:5678}};
  const r=powerReadings(snap,device());assert.equal(r.find(r=>r.component==='em:0:A').values.Energy,1.234);assert.equal(r.find(r=>r.component==='em:0:total').values.Power,600);assert.ok(!Object.hasOwn(r.find(r=>r.component==='em:0:B').values,'Voltage'));snap.status['em:0'].errors=['fault'];assert.equal(powerReadings(snap,device()).length,0);
});
