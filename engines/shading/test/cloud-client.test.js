'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShellyCloudClient, CloudQueue, cloudHost } = require('../lib/cloud-client');
const { CoverController } = require('../lib/controller');
const { cloneDevice } = require('../homebridge-ui/public/device-copy');
const config = { connection: 'cloud', cloudServer: 'https://shelly-1-eu.shelly.cloud',
  cloudKey: 'secret-test-key', cloudDeviceId: '000000000001' };
function fixture(transform = value => value, fail) {
  let now = 10000;
  const calls = [];
  const state = { id: config.cloudDeviceId, gen: 'G2', online: 1,
    settings: { 'cover:0': { slat: { enable: true } }, 'cover:1': { slat: { enable: true } } },
    status: { 'cover:0': { current_pos: 40, slat_pos: 60, pos_control: true, state: 'stopped', source: 'cloud' },
      'cover:1': { current_pos: 10, slat_pos: 20, pos_control: true, state: 'stopped' } } };
  const client = new ShellyCloudClient(config, async (url, options) => {
    const body = JSON.parse(options.body);calls.push({ path: url.pathname, body });
    assert.equal(url.searchParams.get('auth_key'), config.cloudKey);
    assert.equal(options.redirect, 'error');
    if (fail) return fail(url, options, calls);
    return url.pathname.endsWith('/get') ? Response.json(transform(state)) : url.pathname.endsWith('/groups') ? Response.json({}) : new Response('', { status: 200 });
  }, { clock: () => now, sleep: async () => {}, queue: { run: work => work() } });
  return { client, calls, state, advance: ms => { now += ms; } };
}
test('cloud server must be an HTTPS Shelly endpoint without credentials or redirects', () => {
  assert.equal(cloudHost('shelly-1-eu.shelly.cloud'), config.cloudServer);
  for (const value of ['http://shelly-1-eu.shelly.cloud','https://evil.example',
    'https://shelly-1-eu.shelly.cloud.evil.example','https://secret@shelly-1-eu.shelly.cloud',
    'https://shelly-1-eu.shelly.cloud/path','https://shelly-1-eu.shelly.cloud/?key=secret']) {
    assert.throws(() => cloudHost(value));
  }
  assert.throws(() => new ShellyCloudClient({ ...config, cloudKey: '' }));
  assert.throws(() => new ShellyCloudClient({ ...config, cloudDeviceId: 'not-valid' }));
});
test('cloud config and status share one read, preserving actual positions and channel', async () => {
  const { client, calls } = fixture(value => [value]);
  assert.equal((await client.call('Cover.GetConfig', { id: 1 })).slat.enable, true);
  const status = await client.call('Cover.GetStatus', { id: 1 });
  assert.equal(status.current_pos, 10);assert.equal(status.slat_pos, 20);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { ids: [config.cloudDeviceId], select: ['status','settings'] });
  status.current_pos = 99;
  assert.equal((await client.call('Cover.GetStatus', { id: 1 })).current_pos, 10);
});
test('cloud cache expires and does not invent local provenance', async () => {
  const { client, calls, advance } = fixture(value => [value]);
  assert.equal((await client.call('Cover.GetStatus', { id: 0 })).source, undefined);
  advance(2001);await client.call('Cover.GetStatus', { id: 0 });assert.equal(calls.length, 2);
});
test('wrong or offline cloud device and missing channel cannot receive any command', async () => {
  for (const transform of [value => [{...value,id:'000000000002'}],value => [{...value,online:0}],
    value => [{...value,settings:{}}],() => [],() => ({secret:config.cloudKey})]) {
    const { client, calls } = fixture(transform);
    await assert.rejects(client.call('Cover.Open', { id: 0 }));
    assert.ok(calls.every(call => call.path.endsWith('/get')));
  }
});
for (const [method, params, expected] of [
  ['Cover.GoToPosition',{id:1,pos:50,slat_pos:75},{position:50,slatPosition:75}],
  ['Cover.GoToPosition',{id:1,slat_pos:90},{slatPosition:90}],
  ['Cover.Open',{id:1},{position:'open'}],['Cover.Close',{id:1},{position:'close'}],['Cover.Stop',{id:1},{position:'stop'}],
]) test('cloud command mapping '+method+JSON.stringify(params), async () => {
  const { client, calls } = fixture(value => [value]);
  await client.call(method, params);
  assert.deepEqual(calls.at(-1), expected.slatPosition !== undefined
    ? {path:'/v2/devices/api/set/groups',body:{cover:{ids:[config.cloudDeviceId+'_1'],command:expected}}}
    : {path:'/v2/devices/api/set/cover',body:{id:config.cloudDeviceId,channel:1,...expected}});
});
test('cloud writes invalidate reads and unknown commands never send requests', async () => {
  const { client, calls } = fixture(value => [value]);
  await assert.rejects(client.call('Shelly.Reboot'));assert.equal(calls.length,0);
  await client.call('Cover.GetStatus',{id:0});await client.call('Cover.Open',{id:0});
  await client.call('Cover.GetStatus',{id:0});assert.equal(calls.length,4);
  await assert.rejects(client.call('Cover.GoToPosition',{id:0,pos:101}));
  assert.equal(calls.filter(c=>c.path.endsWith('/cover')).length,1);
});
test('cloud transport retry applies only to reads, without leaking secret errors', async () => {
  let writes=0,reads=0;
  const { client } = fixture(undefined,(url, options) => {
    if(url.pathname.endsWith('/get')) {
      reads++;if(reads===1) throw new TypeError('secret-test-key '+url);
      return Response.json([{id:config.cloudDeviceId,online:1,settings:{'cover:0':{}},status:{'cover:0':{}}}]);
    }
    writes++;throw new TypeError('secret-test-key '+url);
  });
  await client.call('Cover.GetConfig',{id:0});assert.equal(reads,2);
  await assert.rejects(client.call('Cover.Open',{id:0}), error => {
    assert.doesNotMatch(error.message+JSON.stringify(error),/secret-test-key|auth_key/);return true;
  });assert.equal(writes,1);
});
test('cloud HTTP errors do not retry or leak the server response', async () => {
  const { client,calls }=fixture(undefined,()=>new Response('secret-test-key',{status:401}));
  await assert.rejects(client.call('Cover.GetStatus',{id:0}),error=>{
    assert.equal(error.code,'SHELLY_CLOUD_HTTP');assert.doesNotMatch(error.message,/secret-test-key/);return true;
  });assert.equal(calls.length,1);
});
test('shared cloud queue enforces spacing and recovers after a rejected request',async()=>{
  let now=0;const starts=[];const q=new CloudQueue({clock:()=>now,sleep:async ms=>{now+=ms;}});
  await Promise.allSettled([q.run(()=>{starts.push(now);throw Error('failure');}),q.run(()=>starts.push(now)),q.run(()=>starts.push(now))]);
  assert.deepEqual(starts,[0,2000,4000]);
});
test('real cloud controller sends height first and tilt only after confirmed arrival',async()=>{
  const {client,calls,state}=fixture(value=>[value]);const seen=[];
  const controller=new CoverController(client,0,value=>seen.push(value),0,{kind:'raffstore'});
  await controller.refresh();await controller.move({pos:50,slat_pos:75},()=>true);
  assert.equal(seen[0].current_pos,40);
  assert.deepEqual(calls.at(-1).body,{id:config.cloudDeviceId,channel:0,position:50});
  state.status['cover:0'].current_pos=50;
  await controller.refresh();
  assert.equal(calls.at(-1).path,'/v2/devices/api/set/groups');
  assert.deepEqual(calls.at(-1).body,{cover:{ids:[config.cloudDeviceId+'_0'],command:{slatPosition:75}}});
  assert.ok(calls.filter(c=>c.path.endsWith('/cover')).every(c=>!(Object.hasOwn(c.body,'position')&&Object.hasOwn(c.body,'slatPosition'))));
  controller.dispose();
});
test('copying a cloud device clears its binding but retains account settings',()=>{
  const source={...config,id:'cloud-one',name:'Cloud blind'};
  const copied=cloneDevice(source,[source]);assert.equal(copied.cloudDeviceId,'');assert.equal(source.cloudDeviceId,config.cloudDeviceId);
  assert.equal(copied.cloudServer,config.cloudServer);assert.equal(copied.cloudKey,config.cloudKey);
});

test('Homebridge launches a cloud-only device without a local host or hardware-ID field', async () => {
  const { ShellyPlatform } = require('../index');
  const original = global.fetch; const handlers = {}, registered = [], errors = [];
  const fixtureState = { id: config.cloudDeviceId, online: 1,
    settings: { 'cover:0': {} }, status: { 'cover:0': { current_pos: 35, pos_control: true, state: 'stopped' } } };
  global.fetch = async url => {
    assert.equal(url.hostname,'shelly-1-eu.shelly.cloud');
    if(url.pathname.endsWith('/cover'))return Response.json({error:'DEVICE_FAILED_COMMAND'},{status:400});
    return Response.json([fixtureState]);
  };
  class Service {
    constructor(){this.values=new Map();}
    testCharacteristic(type){return this.values.has(type);}
    removeCharacteristic(){}
    getCharacteristic(type){if(!this.values.has(type))this.values.set(type,{
      onGet(fn){this.get=fn;return this;},onSet(fn){this.set=fn;return this;},
      setProps(){return this;},updateValue(v){this.value=v;return this;},
    });return this.values.get(type);}
    setCharacteristic(type,value){this.getCharacteristic(type).value=value;return this;}
    updateCharacteristic(type,value){return this.setCharacteristic(type,value);}
  }
  class Accessory {
    constructor(name,uuid){this.UUID=uuid;this.context={};this.services=new Map([['info',new Service()]]);}
    getService(type){return this.services.get(type);}
    getServiceById(){return undefined;}
    addService(type){const s=new Service();this.services.set(type,s);return s;}
    removeService(){}
  }
  const C={PositionState:{INCREASING:1,DECREASING:0,STOPPED:2}};
  for(const name of ['Manufacturer','Model','SerialNumber','Name','CurrentPosition','TargetPosition','HoldPosition','ObstructionDetected'])C[name]=name;
  const api={on:(name,fn)=>handlers[name]=fn,platformAccessory:Accessory,
    hap:{Service:{AccessoryInformation:'info',WindowCovering:'cover'},Characteristic:C,HapStatusError:Error,
      HAPStatus:{SERVICE_COMMUNICATION_FAILURE:-70402},uuid:{generate:value=>value}},
    registerPlatformAccessories:(p,n,list)=>registered.push(...list),updatePlatformAccessories(){},unregisterPlatformAccessories(){}};
  try {
    const platform=new ShellyPlatform({error:text=>errors.push(text),warn:text=>errors.push(text)},
      {globalControls:false,devices:[{...config,id:'cloud-roller',name:'Cloud roller',deviceType:'roller'}]},api);
    platform.launch();assert.equal(platform.devices.length,1,JSON.stringify(errors));
    await platform.devices[0].initialPoll;
    assert.deepEqual(errors,[]);assert.equal(registered.length,1);
    assert.equal(registered[0].getService('cover').getCharacteristic(C.CurrentPosition).get(),35);
    await assert.rejects(registered[0].getService('cover').getCharacteristic(C.TargetPosition).set(70));
    assert.equal(registered[0].getService('cover').getCharacteristic(C.CurrentPosition).get(),35);
    assert.equal(registered[0].getService('cover').getCharacteristic(C.CurrentPosition).value,35);
    assert.equal(errors.length,1);assert.match(errors[0],/DEVICE_FAILED_COMMAND/);
  } finally {handlers.shutdown?.();global.fetch=original;}
});

test('cloud overview uses its slower polling interval without exposing credentials',()=>{
  const { Overview }=require('../lib/overview');const now=Date.now();
  const output=new Overview().build({pollInterval:3,devices:[{...config,id:'one',name:'Cloud'}]},undefined,
    [{id:'one',online:true,updatedAt:now-60000}],now);
  assert.equal(output.rows[0].state.online,true);
  assert.doesNotMatch(JSON.stringify(output),/secret-test-key|cloudKey|shelly-1-eu/);
});

test('HTTP 400 exposes only an allowlisted reason and the operation/channel',async()=>{
  for(const code of ['DEVICE_INVALID_MODE','DEVICE_INVALID_CHANNEL','BAD_REQUEST']){
    const {client,calls}=fixture(undefined,()=>Response.json({error:code,data:{messages:['secret-test-key https://example/?auth_key=secret-test-key']}},{status:400}));
    await assert.rejects(client.request('/v2/devices/api/set/cover',{id:config.cloudDeviceId,channel:1,position:'open'}),error=>{
      assert.equal(error.rpcDiagnostic.cloudError,code);assert.equal(error.rpcDiagnostic.operation,'Cloud.SetCover');
      assert.equal(error.rpcDiagnostic.channel,1);assert.match(error.message,new RegExp(code));
      assert.doesNotMatch(error.message+JSON.stringify(error),/secret-test-key|auth_key/);return true;
    });assert.equal(calls.length,1);
  }
});
test('unknown cloud errors and malformed response bodies never leak server text',async()=>{
  for(const body of [JSON.stringify({error:'secret-test-key',data:{messages:['secret-test-key']}}),'secret-test-key']){
    const {client}=fixture(undefined,()=>new Response(body,{status:400}));
    await assert.rejects(client.call('Cover.GetStatus',{id:0}),error=>{
      assert.equal(error.rpcDiagnostic.httpStatus,400);assert.equal(error.rpcDiagnostic.cloudError,undefined);
      assert.doesNotMatch(error.message+JSON.stringify(error),/secret-test-key/);return true;
    });
  }
});
test('Retry-After honors seconds and HTTP dates, with a bounded default pause',()=>{
  const {retryDelay}=require('../lib/cloud-client');const now=Date.parse('2026-11-12T10:00:00Z');
  assert.equal(retryDelay('60',now),60000);assert.equal(retryDelay('Thu, 12 Nov 2026 10:02:00 GMT',now),120000);
  assert.equal(retryDelay(null,now),30000);assert.equal(retryDelay('0',now),5000);
});
test('429 blocks already queued requests across devices and releases after the server pause',async()=>{
  let now=100000;let requests=0;
  const shared=new CloudQueue({clock:()=>now,sleep:async ms=>{now+=ms;}});
  const options={queue:shared,clock:()=>now,sleep:async()=>{}};
  const fetcher=async()=>{
    requests++;
    return requests===1?Response.json({error:'TOO_MANY_REQUESTS',data:{messages:['secret-test-key']}},
      {status:429,headers:{'Retry-After':'45'}}):Response.json([]);
  };
  const first=new ShellyCloudClient(config,fetcher,options);
  const second=new ShellyCloudClient({...config,cloudDeviceId:'000000000002'},fetcher,options);
  const results=await Promise.allSettled([first.request('/v2/devices/api/get',{},true),second.request('/v2/devices/api/get',{},true)]);
  assert.equal(results[0].reason.rpcDiagnostic.httpStatus,429);
  assert.equal(results[0].reason.rpcDiagnostic.retryAfterMs,45000);
  assert.equal(results[1].reason.code,'SHELLY_CLOUD_RATE_LIMIT');assert.equal(requests,1);
  now+=44999;await assert.rejects(second.request('/v2/devices/api/get',{},true),{code:'SHELLY_CLOUD_RATE_LIMIT'});assert.equal(requests,1);
  now+=1;await second.request('/v2/devices/api/get',{},true);assert.equal(requests,2);
});
test('commands blocked by the cloud cooldown are not sent later',async()=>{
  let now=0;const shared=new CloudQueue({clock:()=>now,sleep:async ms=>{now+=ms;}});shared.defer(30000);
  let calls=0;const client=new ShellyCloudClient(config,async()=>{calls++;throw Error('must not run');},{queue:shared,clock:()=>now});
  await assert.rejects(client.call('Cover.Open',{id:0}),{code:'SHELLY_CLOUD_RATE_LIMIT'});
  now=30001;await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
});

test('group per-device failure despite HTTP 200 is rejected once without leaking keys',async()=>{
  for(const reason of ['DEVICE_FAILED_COMMAND','DEVICE_OFFLINE','secret-test-key']){
    const {client,calls}=fixture(undefined,(url)=>url.pathname.endsWith('/get')
      ? Response.json([{id:config.cloudDeviceId,online:1,status:{'cover:0':{}},settings:{'cover:0':{}}}])
      : Response.json({failedCommands:{'000000000001_0':reason}}));
    await assert.rejects(client.call('Cover.GoToPosition',{id:0,slat_pos:80}),error=>{
      assert.equal(error.code,'SHELLY_CLOUD_GROUP_FAILED');assert.equal(error.rpcDiagnostic.httpStatus,200);
      assert.equal(error.rpcDiagnostic.operation,'Cloud.SetGroups');assert.equal(error.rpcDiagnostic.channel,0);
      assert.doesNotMatch(error.message+JSON.stringify(error),/secret-test-key/);return true;
    });assert.equal(calls.filter(c=>c.path.endsWith('/groups')).length,1);
    assert.equal(calls.filter(c=>c.path.endsWith('/cover')).length,0);
  }
});
test('malformed group replies do not acknowledge a successful command',async()=>{
  for(const reply of ['not-json',null,[],{failedCommands:null}]){
    const {client}=fixture(undefined,()=>reply==='not-json'?new Response(reply):Response.json(reply));
    await assert.rejects(client.request('/v2/devices/api/set/groups',{cover:{ids:[config.cloudDeviceId+'_0'],command:{slatPosition:80}}}),{code:'SHELLY_CLOUD_INVALID'});
  }
});
test('group HTTP errors identify endpoint and channel, and 429 sets shared cooldown',async()=>{
  const pauses=[];
  const {client,calls}=fixture(undefined,()=>Response.json({error:'TOO_MANY_REQUESTS'},{status:429,headers:{'Retry-After':'60'}}));
  client.queue.defer=ms=>pauses.push(ms);
  await assert.rejects(client.request('/v2/devices/api/set/groups',{cover:{ids:[config.cloudDeviceId+'_1'],command:{slatPosition:80}}}),error=>{
    assert.equal(error.rpcDiagnostic.operation,'Cloud.SetGroups');assert.equal(error.rpcDiagnostic.channel,1);return true;
  });assert.deepEqual(pauses,[60000]);assert.equal(calls.length,1);
});

test('empty HTTP 200 group success is accepted without replaying the write',async()=>{
  const {client,calls}=fixture(undefined,()=>new Response('',{status:200}));
  await client.request('/v2/devices/api/set/groups',{cover:{ids:[config.cloudDeviceId+'_0'],command:{slatPosition:80}}});
  assert.equal(calls.length,1);
});
