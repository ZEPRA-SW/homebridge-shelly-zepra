'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('../lib/config'),{model,command}=require('../lib/model'),{device,rpc}=require('./fixtures');
test('virtual entries require an exact unique key, mode, name and RPC host',()=>{
  const entry={component:'boolean:200',name:'Watchalarm',mode:'switch'};
  assert.doesNotThrow(()=>validate({devices:[{...device(),virtualComponents:[entry]}]}));
  for(const patch of [{component:'boolean:1'},{component:'group:200'},{mode:'trigger'},{name:''},{event:'wrong'}])assert.throws(()=>validate({devices:[{...device(),virtualComponents:[{...entry,...patch}]}]}));
  assert.throws(()=>validate({devices:[{...device(),virtualComponents:[entry,entry]}]}));assert.throws(()=>validate({devices:[{...device(),generation:'gen1',virtualComponents:[entry]}]}));
});
test('only configured virtual components appear; Boolean false and button modes retain correct semantics',()=>{
  const snap=rpc();snap.components=[{key:'boolean:200',config:{},status:{value:false}},{key:'boolean:201',config:{},status:{value:true}},{key:'button:202',config:{},status:{}}];
  const config={...device(),virtualComponents:[{component:'boolean:200',name:'Watchalarm',mode:'switch'},{component:'button:202',name:'Test button',mode:'trigger',event:'long_push'}]};
  let ds=model(snap,config).descriptors.filter(d=>d.virtual);assert.equal(ds.length,2);assert.deepEqual(ds[0].values,{On:false});assert.deepEqual(command(ds[0],'On',true),{value:true});assert.deepEqual(command(ds[1],'On',true),{event:'long_push'});assert.equal(command(ds[1],'On',false),null);
  delete snap.components[2].status;assert.ok(model(snap,config).descriptors.some(d=>d.key==='button:202'));
  config.virtualComponents[1].mode='events';ds=model(snap,config).descriptors.filter(d=>d.virtual);assert.equal(ds[1].type,'button');assert.throws(()=>command(ds[1],'On',true));
  snap.components[0].status.value=0;assert.ok(!model(snap,config).descriptors.some(d=>d.key==='boolean:200'));
});
test('restricted virtual values cannot be written or fabricated on missing data',()=>{
  const snap=rpc(),config={...device(),virtualComponents:[{component:'boolean:200',name:'Read only',mode:'switch'}]};snap.components=[{key:'boolean:200',status:{value:true},attrs:{owner:'script:1',access:'r'}}];
  const d=model(snap,config).descriptors.find(d=>d.virtual);assert.equal(d.values.On,true);assert.throws(()=>command(d,'On',false));snap.components=[];const m=model(snap,config);assert.ok(!m.descriptors.some(d=>d.virtual));assert.ok(m.warnings.some(w=>w.includes('boolean:200')));
});
