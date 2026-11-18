'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {Client,digest}=require('../lib/client');const {device,rpc,bthome}=require('./fixtures');
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
function mock(handler,config=device()) {
  const calls=[];const c=new Client(config,async(url,options)=>{const call={path:new URL(url).pathname,query:new URL(url).search,options,body:options.body?JSON.parse(options.body):undefined};calls.push(call);return handler(call,calls);});return {c,calls};
}
test('mismatched hardware blocks before status reads and before any writes',async()=>{
  const {c,calls}=mock(()=>json({mac:'112233445566',gen:2}));await assert.rejects(c.snapshot(),/Geräte-ID/);await assert.rejects(c.write('switch:0',{on:true}),/Geräte-ID/);assert.ok(calls.every(c=>c.path==='/shelly'));
});
test('RPC call returns errors and rejects mismatched response IDs',async()=>{
  for(const reply of [{id:999,result:{}},{id:1,error:{code:-103}}]){const {c}=mock(()=>json(reply));await assert.rejects(c.rpc('Shelly.GetStatus'));}
});
test('no discovery or cover RPC can be invoked',async()=>{
  const {c,calls}=mock(()=>{throw Error('network must not be reached');});
  for(const method of ['Cover.Open','Shelly.SetProfile','BTHome.StartDeviceDiscovery','Switch.Toggle'])await assert.rejects(c.rpc(method));assert.equal(calls.length,0);
});
test('Gen1 cover mode blocks relay command without changing profile',async()=>{
  const {c,calls}=mock(x=>json(x.path==='/shelly'?{mac:device().shellyDeviceId}:{mode:'roller'}));await assert.rejects(c.write('relay:0',{on:true}),/ausgeschlossen/);assert.deepEqual(calls.map(x=>x.path),['/shelly','/settings']);
});
test('RPC cover profile blocks Switch.Set and all other output methods',async()=>{
  const {c,calls}=mock(()=>json({...rpc().info,profile:'cover'}));await assert.rejects(c.write('switch:0',{on:true}),/ausgeschlossen/);assert.equal(calls.length,1);
});
test('Gen1 Basic authentication uses configured username and encoded password',async()=>{
  const config={...device(),generation:'gen1',username:'custom',password:'p:a ss'};
  const {c,calls}=mock(x=>json(x.path==='/shelly'?{mac:config.shellyDeviceId}:x.path==='/settings'?{mode:'relay'}:{ison:true}),config);
  await c.write('relay:0',{on:true});assert.equal(calls[2].query,'?turn=on');assert.ok(calls.every(x=>x.options.headers.Authorization==='Basic '+Buffer.from('custom:p:a ss').toString('base64')));
});
test('auto generation can retry a Basic /shelly challenge',async()=>{
  const {c}=mock(x=>x.options.headers.Authorization?json({mac:device().shellyDeviceId}):json({},401,{'www-authenticate':'Basic realm="Shelly"'}),{...device(),password:'abc'});await c.identify();assert.equal(c.gen,1);
});
test('Digest calculation agrees with independent SHA256 reference',()=>{
  const h=s=>crypto.createHash('sha256').update(s).digest('hex'),c={realm:'shelly',nonce:'base64/token==',algorithm:'SHA-256'};
  const result=digest(c,'secret','POST','/rpc',3,'nonce');assert.equal(result.response,h(h('admin:shelly:secret')+':base64/token==:00000003:nonce:auth:'+h('POST:/rpc')));assert.equal(result.nc,'00000003');
  assert.throws(()=>digest(c,'','POST','/rpc'));assert.throws(()=>digest({...c,algorithm:'MD5'},'x','POST','/rpc'));
});
test('HTTP Digest challenge, nonce reuse and stale challenge renewal',async()=>{
  let protectedCalls=0;const {c,calls}=mock(x=>{
    if(x.path==='/shelly')return json(rpc().info);
    protectedCalls++;
    if(protectedCalls===1||protectedCalls===4)return json({},401,{'www-authenticate':`Digest realm="shelly", nonce="${protectedCalls}", algorithm=SHA-256, qop="auth", stale=true`});
    return json({id:x.body.id,result:{}});
  },{...device(),password:'secret'});
  await c.snapshot();await c.rpc('Shelly.GetStatus');
  const auth=calls.filter(x=>x.path==='/rpc').map(x=>x.options.headers.Authorization);assert.ok(auth[1].includes('nc=00000001'));assert.ok(auth[2].includes('nc=00000002'));assert.ok(auth.at(-1).includes('nonce="4"'));assert.ok(auth.at(-1).includes('nc=00000001'));
});
test('wrong credentials stop after one authenticated retry',async()=>{
  const {c,calls}=mock(()=>json({},401,{'www-authenticate':'Digest realm="shelly", nonce="1", algorithm=SHA-256, qop="auth"'}),{...device(),password:'secret'});
  await assert.rejects(c.rpc('Shelly.GetStatus'),/401/);assert.equal(calls.length,2);
});
test('redirects are disabled and timeouts are attached to every HTTP request',async()=>{
  const {c,calls}=mock(()=>json(rpc().info));await c.identify();assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.signal instanceof AbortSignal);
});
test('transport errors do not expose URLs or credentials',async()=>{
  const c=new Client({...device(),password:'secret'},()=>{throw Error('secret http://user:pass@host');});await assert.rejects(c.identify(),e=>!e.message.includes('secret')&&!e.message.includes('pass@'));
});
test('BTHome component paging and known-object lookup use distinct IDs',async()=>{
  const b=bthome(),config={...device(),bthome:[{...b.config,buttonIndices:[0]}]};
  const {c,calls}=mock(x=>{
    if(x.path==='/shelly')return json(rpc().info);
    let result={};if(x.body.method==='Shelly.GetComponents'){const offset=x.body.params.offset;result={components:b.components.slice(offset,offset+2),total:b.components.length};}
    return json({id:x.body.id,result});
  },config);
  const snap=await c.snapshot();assert.equal(snap.components.length,4);assert.deepEqual(calls.filter(x=>x.body?.method==='Shelly.GetComponents').map(x=>x.body.params.offset),[0,2]);assert.deepEqual(calls.at(-1).body.params,{id:200});
});
test('per-device queue serializes network access and survives failed jobs',async()=>{
  let active=0,max=0;const {c}=mock(async x=>{active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return json(x.path==='/shelly'?rpc().info:{id:x.body.id,result:{}});});
  await Promise.all([c.write('switch:0',{on:true}),c.write('switch:1',{on:false})]);assert.equal(max,1);
});
test('unsupported BTHome API does not take down host switch status',async()=>{
  const b=bthome(),{c}=mock(x=>x.path==='/shelly'?json(rpc().info):json(x.body.method==='Shelly.GetComponents'?{id:x.body.id,error:{code:-32601}}:{id:x.body.id,result:x.body.method==='Shelly.GetStatus'?rpc().status:{}}),{...device(),bthome:[b.config]});const snap=await c.snapshot();assert.ok(snap.status['switch:0']);assert.deepEqual(snap.components,[]);assert.ok(snap.bthomeError);
});
test('real loopback HTTP server receives correct RPC frames, identity check and Switch.Set',async t=>{
  const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):null;requests.push({url:req.url,data});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/shelly'?rpc().info:{id:data.id,result:{was_on:false}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const c=new Client({...device(),host:'127.0.0.1:'+server.address().port});await c.write('switch:2',{on:true});assert.deepEqual(requests.map(r=>r.url),['/shelly','/rpc']);assert.equal(requests[1].data.method,'Switch.Set');assert.deepEqual(requests[1].data.params,{id:2,on:true});
});
test('RPC dimmer commands retain brightness and transition parameters',async()=>{
  const {c,calls}=mock(x=>x.path==='/shelly'?json(rpc().info):json({id:x.body.id,result:{}}));await c.write('light:0',{on:true,brightness:40,transition_duration:2});assert.equal(calls.at(-1).body.method,'Light.Set');assert.deepEqual(calls.at(-1).body.params,{id:0,on:true,brightness:40,transition_duration:2});
});

test('Wall Display identity, status and config all use working POST RPC endpoints',async()=>{
 for(const modelId of ['wall','wall-x2','wall-xl']){const {c,calls}=mock(x=>json({id:x.body.id,result:x.body.method==='Shelly.GetDeviceInfo'?{...rpc().info,app:'WallDisplayV2'}:{}}),{...device(),modelId,generation:'rpc'});await c.snapshot();assert.deepEqual(calls.map(x=>x.path),['/rpc','/rpc','/rpc']);assert.deepEqual(calls.map(x=>x.body.method),['Shelly.GetDeviceInfo','Shelly.GetStatus','Shelly.GetConfig']);}
 const {c,calls}=mock(x=>json({id:x.body.id,result:{mac:'112233445566',gen:2}}),{...device(),modelId:'wall-xl',generation:'rpc'});await assert.rejects(c.snapshot(),/Geräte-ID/);assert.equal(calls.length,1);
});
test('thermostat writes are identity checked and strictly limited to enabled Wall Displays',async()=>{
 const cfg={...device(),modelId:'wall-xl',generation:'rpc',thermostat:true};const {c,calls}=mock(x=>json({id:x.body.id,result:x.body.method==='Shelly.GetDeviceInfo'?{...rpc().info,app:'WallDisplayV2'}:{}}),cfg);await c.write('thermostat:0',{config:{target_C:22}});assert.deepEqual(calls.at(-1).body.params,{id:0,config:{target_C:22}});
 for(const values of [{config:{target_C:99}},{config:{actuator:'other'}},{config:{enable:'yes'}},{config:{target_C:22,enable:true}}])await assert.rejects(c.write('thermostat:0',values),/Thermostat/);cfg.thermostat=false;await assert.rejects(c.write('thermostat:0',{config:{enable:true}}),/freigegeben/);
});

test('Wall Display mode switching sends atomic heating/cooling enable commands only',async()=>{
 const cfg={...device(),modelId:'wall-xl',generation:'rpc',thermostat:true},{c,calls}=mock(x=>json({id:x.body.id,result:x.body.method==='Shelly.GetDeviceInfo'?{...rpc().info,app:'WallDisplayV2'}:{}}),cfg);
 for(const type of ['heating','cooling']){await c.write('thermostat:0',{config:{type,enable:true}});assert.equal(calls.at(-2).body.method,'Shelly.GetDeviceInfo');assert.deepEqual(calls.at(-1).body,{id:c.sequence,method:'Thermostat.SetConfig',params:{id:0,config:{type,enable:true}}});}
 for(const config of [{type:'auto',enable:true},{type:'cooling',enable:false},{type:'cooling',enable:true,actuator:'different'},{type:'cooling'}]){const before=calls.filter(x=>x.body.method==='Thermostat.SetConfig').length;await assert.rejects(c.write('thermostat:0',{config}),/Ungültiger Thermostat/);assert.equal(calls.filter(x=>x.body.method==='Thermostat.SetConfig').length,before);}
});

test('virtual snapshot paging and commands use explicit IDs and check ownership before writes',async()=>{
 const entries=[{component:'boolean:200',name:'State',mode:'switch'},{component:'button:201',name:'Trigger',mode:'trigger',event:'double_push'}],components=[{key:'boolean:200',status:{value:false},config:{}},{key:'button:201',status:{},config:{}}],cfg={...device(),virtualComponents:entries};
 const {c,calls}=mock(x=>json(x.path==='/shelly'?rpc().info:{id:x.body.id,result:x.body.method==='Shelly.GetComponents'?{components:x.body.params.keys?components.filter(c=>x.body.params.keys.includes(c.key)):components,total:components.length}:x.body.method==='Shelly.GetStatus'?rpc().status:null}),cfg);
 const snap=await c.snapshot();assert.equal(snap.components.length,2);await c.write('boolean:200',{value:true});assert.deepEqual(calls.at(-1).body.params,{id:200,value:true});assert.equal(calls.at(-1).body.method,'Boolean.Set');assert.equal(calls.at(-3).path,'/shelly');await c.write('button:201',{event:'double_push'});assert.equal(calls.at(-1).body.method,'Button.Trigger');assert.deepEqual(calls.at(-1).body.params,{id:201,event:'double_push'});
 components[0].attrs={access:'r'};await assert.rejects(c.write('boolean:200',{value:false}),/lesbar/);await assert.rejects(c.write('boolean:202',{value:false}),/freigegeben/);await assert.rejects(c.write('button:201',{event:'single_push'}),/Ungültiger/);await assert.rejects(c.rpc('Virtual.Add'));await assert.rejects(c.rpc('Boolean.SetConfig'));
});
test('unsupported virtual-component reading does not take physical host functions offline',async()=>{
 const {c}=mock(x=>json(x.path==='/shelly'?rpc().info:x.body.method==='Shelly.GetComponents'?{id:x.body.id,error:{code:-32601}}:{id:x.body.id,result:x.body.method==='Shelly.GetStatus'?rpc().status:{}}),{...device(),virtualComponents:[{component:'boolean:200',name:'x',mode:'switch'}]});const snap=await c.snapshot();assert.ok(snap.status['switch:0']);assert.deepEqual(snap.components,[]);assert.ok(snap.virtualError);assert.equal(snap.bthomeError,undefined);
});
