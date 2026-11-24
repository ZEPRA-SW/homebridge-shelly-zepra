'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CoverController } = require('../lib/controller');

function fixture(options = {}) {
  let now = 100000;
  const calls = [], errors = [];
  const status = { pos_control: true, current_pos: 20, slat_pos: 50, state: 'stopped' };
  const client = { async call(method, params) {
    calls.push({ method, params });
    if (method === 'Cover.GetConfig') return { slat: { enable: true } };
    if (method === 'Cover.GetStatus') return { ...status };
    return null;
  } };
  const controller = new CoverController(client, 0, () => {}, 1, {
    clock: () => now, onError: error => errors.push(error.message), ...options,
  });
  return { calls, errors, status, controller, advance(ms = 1000) { now += ms; },
    moves() { return calls.filter(c => c.method === 'Cover.GoToPosition'); } };
}
test('tilt during height movement is acknowledged promptly but not sent until stopped at target', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  Object.assign(f.status, { state: 'opening', current_pos: 30, target_pos: 80 });
  await f.controller.set('slat_pos', 90);
  assert.equal(f.moves().length, 1);
  assert.equal(f.controller.waitingSlat.value, 90);
  f.status.current_pos = 80;
  await f.controller.refresh();
  assert.equal(f.moves().length, 1); // Position alone is insufficient while still moving.
  f.status.state = 'stopped';
  await f.controller.refresh();
  assert.deepEqual(f.moves().at(-1).params, { id: 0, slat_pos: 90 });
  assert.equal(f.controller.waitingSlat, null);
});
test('stale stationary status immediately after height acceptance cannot release tilt', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  await f.controller.set('slat_pos', 90);
  assert.equal(f.moves().length, 1);
  await f.controller.refresh();
  assert.equal(f.moves().length, 1);
  Object.assign(f.status, { current_pos: 80, state: 'stopped' });
  await f.controller.refresh();
  assert.equal(f.moves().length, 2);
});
test('latest requested tilt wins during height motion', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  Object.assign(f.status, { current_pos: 40, state: 'opening', target_pos: 80 });
  await f.controller.set('slat_pos', 30);
  await f.controller.set('slat_pos', 70);
  await f.controller.set('slat_pos', 95);
  assert.equal(f.moves().length, 1);
  Object.assign(f.status, { current_pos: 79.5, state: 'stopped' });
  await f.controller.refresh();
  assert.deepEqual(f.moves().at(-1).params, { id: 0, slat_pos: 95 });
});
test('early stop away from target drops deferred tilt', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  Object.assign(f.status, { state: 'opening', current_pos: 40, target_pos: 80 });
  await f.controller.set('slat_pos', 90);
  Object.assign(f.status, { state: 'stopped', current_pos: 50, target_pos: null });
  await f.controller.refresh();
  assert.equal(f.moves().length, 1);
  assert.equal(f.controller.waitingSlat, null);
  assert.match(f.errors[0], /angehalten/);
});
test('timeout does not send tilt even if position finally matches', async () => {
  const f = fixture({ positionWaitTimeout: 30 });
  Object.assign(f.status, { state: 'opening', target_pos: 80 });
  await f.controller.set('slat_pos', 90);
  f.advance(31000);
  Object.assign(f.status, { state: 'stopped', current_pos: 80 });
  await f.controller.refresh();
  assert.equal(f.moves().length, 0);
  assert.match(f.errors[0], /Zeitlimit/);
});
test('external known height target can be waited for; unknown target is never guessed', async () => {
  const f = fixture();
  Object.assign(f.status, { state: 'opening', target_pos: 80 });
  await f.controller.set('slat_pos', 90);
  Object.assign(f.status, { state: 'stopped', current_pos: 80 });
  await f.controller.refresh();
  assert.equal(f.moves().length, 1);
  const unknown = fixture();
  unknown.status.state = 'opening';
  await unknown.controller.set('slat_pos', 90);
  Object.assign(unknown.status, { state: 'stopped', current_pos: 80 });
  await unknown.controller.refresh();
  assert.equal(unknown.moves().length, 0);
  assert.match(unknown.errors[0], /nicht bestätigt/);
});
test('external retarget cancels deferred tilt rather than applying it at a different destination', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  Object.assign(f.status, { state: 'opening', current_pos: 30, target_pos: 80 });
  await f.controller.set('slat_pos', 90);
  Object.assign(f.status, { target_pos: 100 });
  await f.controller.refresh();
  Object.assign(f.status, { state: 'stopped', current_pos: 100 });
  await f.controller.refresh();
  assert.equal(f.moves().length, 1);
  assert.match(f.errors[0], /extern geändert/);
});
test('stop and shutdown discard deferred tilt; stop remains responsive', async () => {
  for (const action of ['stop', 'dispose']) {
    const f = fixture();
    Object.assign(f.status, { state: 'opening', target_pos: 80 });
    await f.controller.set('slat_pos', 90);
    await f.controller[action]();
    assert.equal(f.controller.waitingSlat, null);
    assert.equal(f.moves().length, 0);
    if (action === 'stop') assert.ok(f.calls.some(c => c.method === 'Cover.Stop'));
  }
});
test('cancelled automatic tilt is not released later', async () => {
  const f = fixture();
  let allowed = true;
  Object.assign(f.status, { state: 'opening', target_pos: 80 });
  await f.controller.move({ slat_pos: 90 }, () => allowed);
  allowed = false;
  Object.assign(f.status, { state: 'stopped', current_pos: 80 });
  await f.controller.refresh();
  assert.equal(f.moves().length, 0);
});
test('wind activation cancels pending tilt, opens, and blocks height, tilt, and stop', async () => {
  const f = fixture({ tag: 'hb-raffstore' });
  Object.assign(f.status, { state: 'opening', target_pos: 80 });
  await f.controller.set('slat_pos', 90);
  await f.controller.setWindAlarm(true);
  assert.equal(f.controller.waitingSlat, null);
  assert.deepEqual(f.calls.at(-1), { method: 'Cover.Open', params: { id: 0, tag: 'hb-raffstore' } });
  await assert.rejects(f.controller.set('pos', 0), /Windalarm/);
  await assert.rejects(f.controller.set('slat_pos', 0), /Windalarm/);
  await assert.rejects(f.controller.move({ pos: 0 }), /Windalarm/);
  await assert.rejects(f.controller.stop(), /Windalarm/);
  assert.equal(f.moves().length, 0);
  await f.controller.setWindAlarm(false);
  Object.assign(f.status, { state: 'stopped', current_pos: 100, target_pos: null });
  await f.controller.set('slat_pos', 20);
  assert.equal(f.moves().length, 1);
});
test('wind prevents a command already queued or in status read from being dispatched', async () => {
  const f = fixture();
  const original = f.controller.client.call;
  let activate = true;
  let opening;
  f.controller.client.call = async (method, params) => {
    const value = await original(method, params);
    if (method === 'Cover.GetStatus' && activate) {
      activate = false;
      opening = f.controller.setWindAlarm(true);
    }
    return value;
  };
  await f.controller.move({ pos: 0 });
  await opening;
  assert.equal(f.moves().length, 0);
  assert.ok(f.calls.some(c => c.method === 'Cover.Open'));
});
test('wind retries opening after offline recovery and is unavailable on roller controllers', async () => {
  const f = fixture({ windAlarm: true });
  f.status.current_pos = 20;
  await f.controller.refresh();
  assert.equal(f.calls.filter(c => c.method === 'Cover.Open').length, 1);
  await f.controller.refresh();
  assert.equal(f.calls.filter(c => c.method === 'Cover.Open').length, 1);
  f.advance(31000);
  await f.controller.refresh();
  assert.equal(f.calls.filter(c => c.method === 'Cover.Open').length, 2);
  f.status.current_pos = 100;
  f.advance(31000);
  await f.controller.refresh();
  assert.equal(f.calls.filter(c => c.method === 'Cover.Open').length, 2);
  const roller = fixture({ kind: 'roller', windAlarm: true });
  assert.equal(roller.controller.windAlarm, false);
  await assert.rejects(roller.controller.setWindAlarm(true), /nur für Raffstores/);
});
test('new tilt does not bypass a height command that never started or was stopped early', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  f.advance(6000);
  await assert.rejects(f.controller.set('slat_pos', 90), /Sollwert nicht erreicht/);
  assert.equal(f.moves().length, 1);
});
test('deferred slat failure leaves motor queue usable for a later deliberate height command', async () => {
  const f = fixture();
  await f.controller.set('pos', 80);
  Object.assign(f.status, { state: 'opening', target_pos: 80, current_pos: 40 });
  await f.controller.set('slat_pos', 90);
  Object.assign(f.status, { state: 'stopped', current_pos: 50, target_pos: null });
  await f.controller.refresh();
  await f.controller.set('pos', 100);
  assert.equal(f.moves().at(-1).params.pos, 100);
  assert.equal(f.controller.waitingSlat, null);
});

test('cloud sequencing sends height alone, then tilt only after target and standstill', async () => {
  const f=fixture();f.controller.client.separateSlatCommands=true;
  await f.controller.move({pos:80,slat_pos:30},()=>true,'solar');
  assert.deepEqual(f.moves()[0].params,{id:0,pos:80});assert.equal(f.controller.waitingSlat.value,30);
  Object.assign(f.status,{current_pos:80,state:'opening',target_pos:80});
  await f.controller.refresh();assert.equal(f.moves().length,1);
  f.status.state='stopped';await f.controller.refresh();
  assert.deepEqual(f.moves()[1].params,{id:0,slat_pos:30});assert.equal(f.controller.waitingSlat,null);
});
test('cloud height-only input preserves tilt and skips a redundant tilt command on arrival',async()=>{
  const f=fixture();f.controller.client.separateSlatCommands=true;
  await f.controller.set('pos',80);assert.deepEqual(f.moves()[0].params,{id:0,pos:80});
  assert.equal(f.controller.waitingSlat.value,50);
  f.status.current_pos=80;await f.controller.refresh();assert.equal(f.moves().length,1);assert.equal(f.controller.waitingSlat,null);
});
test('cloud pending tilt is replaced by the latest manual tilt and dropped on an early stop',async()=>{
  const f=fixture();f.controller.client.separateSlatCommands=true;
  await f.controller.move({pos:80,slat_pos:30});
  Object.assign(f.status,{current_pos:40,state:'opening',target_pos:80});
  await f.controller.set('slat_pos',95);assert.equal(f.controller.waitingSlat.value,95);
  Object.assign(f.status,{state:'stopped',current_pos:50,target_pos:null});
  await f.controller.refresh();assert.equal(f.controller.waitingSlat,null);assert.equal(f.moves().length,1);
});
test('rejected cloud height command leaves no deferred tilt or stale height target',async()=>{
  const f=fixture();f.controller.client.separateSlatCommands=true;
  const call=f.controller.client.call.bind(f.controller.client);
  f.controller.client.call=(method,params)=>method==='Cover.GoToPosition'?Promise.reject(Error('cloud rejected')):call(method,params);
  await assert.rejects(f.controller.move({pos:80,slat_pos:30}));
  assert.equal(f.controller.waitingSlat,null);assert.equal(f.controller.heightTarget,null);
});
test('cloud staged arrival is not mistaken for a manual override while tilt is pending',async()=>{
  const {SunAutomation,solarConfig}=require('../lib/solar');
  const f=fixture();f.controller.client.separateSlatCommands=true;
  const auto=new SunAutomation(solarConfig({latitude:52.52,longitude:13.405}, {sunAutomation:{enabled:true}}),f.controller);
  auto.lastTarget={pos:80,slat_pos:30};auto.lastObserved={current_pos:20,slat_pos:50,state:'stopped'};
  f.controller.waitingSlat={value:30,expectedPos:80};
  auto.observe({current_pos:80,slat_pos:50,state:'stopped'});assert.equal(auto.manualPaused,false);
});

test('new wind alarm cancels deferred cloud tilt before any later arrival feedback',async()=>{
  const f=fixture();f.controller.client.separateSlatCommands=true;
  await f.controller.move({pos:80,slat_pos:30});
  await f.controller.setWindAlarm(true);assert.equal(f.controller.waitingSlat,null);
  Object.assign(f.status,{current_pos:100,state:'stopped'});await f.controller.refresh();
  await f.controller.setWindAlarm(false);await f.controller.refresh();
  assert.equal(f.moves().length,1);assert.deepEqual(f.moves()[0].params,{id:0,pos:80});
});
