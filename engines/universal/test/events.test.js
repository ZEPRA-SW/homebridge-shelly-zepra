'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Events,eventValue}=require('../lib/events');const {Client,digest}=require('../lib/client');const {device,rpc}=require('./fixtures');
class Socket extends EventTarget {
  static instances=[];
  constructor(url){super();this.url=url;this.sent=[];Socket.instances.push(this);}
  send(text){this.sent.push(JSON.parse(text));}
  close(){this.dispatchEvent(new Event('close'));}
  receive(value){const e=new Event('message');e.data=JSON.stringify(value);this.dispatchEvent(e);}
}
function setup(t,password='secret') {
  const events=[],warnings=[],client=new Client({...device(),password}),e=new Events(client,(...args)=>events.push(args),w=>warnings.push(w),Socket);e.start();const s=Socket.instances.at(-1);s.dispatchEvent(new Event('open'));t.after(()=>e.stop());return {e,s,events,warnings};
}
test('WebSocket subscribes only to configured host and waits for authenticated response',t=>{
  const {s,events}=setup(t);assert.equal(String(s.url),'ws://192.0.2.10/rpc');assert.equal(s.sent[0].method,'Shelly.GetStatus');
  s.receive({src:rpc().info.id,method:'NotifyEvent',params:{events:[{component:'input:0',event:'single_push',ts:1}]}});assert.equal(events.length,0);
});
for(const nonce of [1625053638,'base64_nonce=='])test('WebSocket RPC digest supports '+typeof nonce+' nonces',t=>{
  const {s}=setup(t),challenge={realm:rpc().info.id,nonce,algorithm:'SHA-256'};s.receive({src:rpc().info.id,id:1,error:{code:401,message:JSON.stringify(challenge)}});const auth=s.sent[1].auth;assert.equal(auth.nonce,nonce);assert.equal(auth.response,digest(challenge,'secret','dummy_method','dummy_uri',1,auth.cnonce).response);assert.equal(auth.nc,'00000001');
});
test('WebSocket deduplicates repeated events and ignores unsupported gestures',t=>{
  const {s,events}=setup(t);s.receive({src:rpc().info.id,id:1,result:{}});
  const event={component:'input:0',event:'single_push',ts:123};const frame={src:rpc().info.id,method:'NotifyEvent',params:{events:[event,event,{...event,event:'triple_push'},{...event,event:'double_push',ts:124}]}};s.receive(frame);s.receive(frame);assert.deepEqual(events.map(e=>e[1]),[0,1]);
});
test('WebSocket identity mismatch closes connection and rejects foreign notifications',t=>{
  const {s,events,warnings}=setup(t);s.receive({src:'shellyplus1-112233445566',id:1,result:{}});assert.equal(events.length,0);assert.ok(warnings.some(w=>w.includes('Geräte-ID')));
});
test('WebSocket repeated authentication failure is bounded',t=>{
  const {s,warnings}=setup(t);const frame={src:rpc().info.id,id:1,error:{code:401,message:JSON.stringify({realm:'shelly',nonce:1,algorithm:'SHA-256'})}};s.receive(frame);s.receive(frame);assert.equal(s.sent.length,2);assert.ok(warnings.some(w=>w.includes('Anmeldung')));
});
test('HomeKit event vocabulary has no invented mapping for triple or rotation gestures',()=>{assert.deepEqual(['single_push','double_push','long_push'].map(eventValue),[0,1,2]);assert.equal(eventValue('rotate_left'),undefined);assert.equal(eventValue('triple_push'),undefined);});
