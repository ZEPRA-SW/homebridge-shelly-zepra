'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict');
for(const file of ['../homebridge-ui/public/devices/models','../engines/universal/homebridge-ui/public/models']){
 const M=require(file),flatten=groups=>groups.flatMap(g=>g.groups?flatten(g.groups):g.models);
 test(file+': categories contain each selectable model once and keep Pro models in their own sorted subgroups',()=>{
  const before=JSON.stringify(M.models),groups=M.grouped(undefined,'cloud'),all=flatten(groups);assert.deepEqual(all.map(m=>m.id).sort(),M.selectable(undefined,'cloud').map(m=>m.id).sort());assert.equal(new Set(all.map(m=>m.id)).size,all.length);
  const pro=groups.find(g=>g.id==='pro');assert.deepEqual(pro.groups.map(g=>g.id),['relays','lights','meters']);assert.ok(flatten([pro]).every(m=>m.id.startsWith('pro')));assert.ok(flatten(groups.filter(g=>g.id!=='pro')).every(m=>!m.id.startsWith('pro')));
  for(const g of groups.flatMap(g=>g.groups||[g]))assert.deepEqual(g.models.map(m=>m.label),[...g.models].sort((a,b)=>a.label.localeCompare(b.label,'de',{numeric:true,sensitivity:'base'})).map(m=>m.label));assert.equal(JSON.stringify(M.models),before);
  assert.equal(M.category(M.get('gen1-em')),'meters');assert.equal(M.category(M.get('pro-em')),'pro');assert.equal(M.category(M.get('wall')),'displays');
 });
 test(file+': Plus 1 Mini and both Pro 3EM versions are independently discoverable in the intended groups',()=>{
  const groups=M.grouped(undefined,'local'),relays=groups.find(g=>g.id==='relays').models,meters=groups.find(g=>g.id==='pro').groups.find(g=>g.id==='meters').models;
  assert.deepEqual(relays.filter(m=>m.id==='plus1mini').map(m=>m.label),['Shelly Plus 1 Mini']);
  assert.deepEqual(meters.filter(m=>['pro-3em','pro-3em400'].includes(m.id)).map(m=>[m.id,m.label]),[['pro-3em','Shelly Pro 3EM'],['pro-3em400','Shelly Pro 3EM-400']]);
  assert.ok(!relays.some(m=>m.id.startsWith('pro-3em')));assert.ok(!meters.some(m=>m.id==='plus1mini'));
 });
 test(file+': grouping preserves local/cloud selection rules and existing model metadata',()=>{
  assert.ok(!flatten(M.grouped(undefined,'local')).some(m=>m.cloudOnly));assert.ok(flatten(M.grouped(undefined,'cloud')).some(m=>m.id==='cloud-sensor'));assert.ok(flatten(M.grouped('cloud-sensor','local')).some(m=>m.id==='cloud-sensor'));
  for(const m of flatten(M.grouped(undefined,'cloud')))assert.equal(m,M.get(m.id));assert.equal(M.get('gen1-em').outputs[0].component,'relay:0');assert.ok(M.get('pro4pm').outputs.length===4);
 });
}
