'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RebootSchedule, validateReboot, localTime } = require('../lib/reboot-schedule');
const { ShellyClient } = require('../lib/client');
const { CoverController } = require('../lib/controller');
function fixture(time = '03:00', start = '2026-11-05T01:59:50Z') {
  let now = Date.parse(start);
  const calls = [], logs = [];
  const status = { 'cover:0': { state: 'stopped' }, 'cover:1': { state: 'stopped' } };
  const device = { config: { name: 'Blind', shellyDeviceId: 'aabbcc112233', dailyReboot: { enabled: true, time } },
    controller: { tail: Promise.resolve(), pending: {} },
    persistReboot(state) { this.saved = structuredClone(state); },
    client: { async call(method, params, allowed) {
      if (allowed && !allowed()) throw Object.assign(new Error('deferred'), { code: 'REBOOT_DEFERRED' });
      calls.push(method);
      return method === 'Shelly.GetStatus' ? status : null;
    } } };
  const devices = [device];
  const make = () => new RebootSchedule(devices, { clock: () => now, log: (name, text) => logs.push(text) });
  return { device, devices, calls, logs, status, make, set: value => { now = Date.parse(value); } };
}
test('daily schedule fires once, stays disabled by default and validates time', async () => {
  const f = fixture(), s = f.make();
  await s.tick(); assert.equal(f.calls.length, 0);
  f.set('2026-11-05T02:00:03Z'); await s.tick();
  assert.deepEqual(f.calls, ['Shelly.GetStatus', 'Shelly.Reboot']);
  await s.tick(); assert.equal(f.calls.length, 2);
  assert.equal(f.device.saved.lastDay, '2026-11-05');
  const restarted = f.make(); await restarted.tick(); assert.equal(f.calls.length, 2);
  f.device.config.dailyReboot.enabled = false;
  f.set('2026-11-06T02:00:00Z'); await s.tick(); assert.equal(f.calls.length, 2);
  for (const time of ['24:00','3:00','03:60','', 300]) assert.throws(() => validateReboot({ enabled: true, time }));
  validateReboot(undefined); validateReboot({ enabled: false }); validateReboot({ enabled: true, time: '23:59' });
});
test('busy, wind and recovery postpone once per reason; persisted pending survives restart', async () => {
  const f = fixture(), s = f.make(); f.device.controller.heightTarget = { pos: 0 };
  f.set('2026-11-05T02:00:03Z'); await s.tick(); await s.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.logs.length, 2);
  assert.equal(f.device.saved.pending, '2026-11-05');
  f.device.controller.heightTarget = null; f.device.controller.windAlarm = true;
  await s.tick(); assert.equal(f.calls.length, 0);
  f.device.controller.windAlarm = false; f.device.controller.recovering = true;
  await s.tick(); assert.equal(f.calls.length, 0);
  f.device.controller.recovering = false;
  f.set('2026-11-05T04:00:00Z'); const restarted = f.make(); await restarted.tick();
  assert.equal(f.calls.at(-1), 'Shelly.Reboot');
});
test('all hardware cover channels must be stationary; duplicate entries cause one reboot', async () => {
  const f = fixture(), s = f.make();
  const second = { ...f.device, config: { ...f.device.config, coverId: 1, shellyDeviceId: 'shellyprodualcover-aabbcc112233' }, controller: { tail: Promise.resolve(), pending: {}, windAlarm: true } };
  f.devices.push(second); f.set('2026-11-05T02:00:01Z'); await s.tick(); assert.equal(f.calls.length, 0);
  second.controller.windAlarm = false; f.status['cover:1'].state = 'opening';
  await s.tick(); assert.ok(!f.calls.includes('Shelly.Reboot'));
  f.status['cover:1'].state = 'stopped'; await s.tick();
  assert.equal(f.calls.filter(c => c === 'Shelly.Reboot').length, 1);
  await s.tick(); assert.equal(f.calls.filter(c => c === 'Shelly.Reboot').length, 1);
});
test('offline preflight retries after one minute; ambiguous reboot failure never loops', async () => {
  const f = fixture(), s = f.make(), original = f.device.client.call;
  f.device.client.call = async () => { throw new Error('offline'); };
  f.set('2026-11-05T02:00:01Z'); await s.tick(); assert.ok(f.device.saved.pending);
  f.device.client.call = async function(method, params, allowed) {
    const result = await original.call(this, method, params, allowed);
    if (method === 'Shelly.Reboot') throw new Error('response lost');
    return result;
  };
  await s.tick(); assert.equal(f.calls.length, 0);
  f.set('2026-11-05T02:01:02Z'); await s.tick();
  assert.equal(f.calls.filter(c => c === 'Shelly.Reboot').length, 1);
  f.set('2026-11-05T02:03:00Z'); await s.tick(); await f.make().tick();
  assert.equal(f.calls.filter(c => c === 'Shelly.Reboot').length, 1);
  assert.ok(f.logs.at(-1).includes('keine automatische Wiederholung'));
});
test('DST repeated minute fires once; spring clock jump catches missing scheduled time', async () => {
  const f = fixture('02:30', '2026-10-25T00:29:55Z'), s = f.make();
  f.set('2026-10-25T00:30:01Z'); await s.tick();
  f.set('2026-10-25T01:30:01Z'); await s.tick();
  assert.equal(f.calls.filter(c => c === 'Shelly.Reboot').length, 1);
  const spring = fixture('02:30', '2026-03-29T00:59:55Z'), ss = spring.make();
  spring.set('2026-03-29T01:00:01Z'); await ss.tick();
  assert.equal(spring.calls.at(-1), 'Shelly.Reboot');
  assert.equal(localTime(Date.parse('2026-11-05T02:00:00Z'), 'Europe/Berlin').minute, 180);
});
test('missed schedule while Homebridge was off is not replayed without persisted pending', async () => {
  const f = fixture('03:00', '2026-11-05T15:00:00Z'); await f.make().tick(); assert.equal(f.calls.length, 0);
});
test('reboot requires matching hardware ID and rechecks wind guard after identity lookup', async () => {
  const calls = []; let mismatch = true, wind = false;
  const client = new ShellyClient({ host: '192.0.2.1', shellyDeviceId: 'aabbcc112233' }, async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request.method);
    if (!mismatch) wind = true;
    return Response.json({ id: request.id, result: { mac: mismatch ? '000000000000' : 'aabbcc112233' } });
  });
  await assert.rejects(client.call('Shelly.Reboot', {}, () => !wind), { code: 'SHELLY_ID_MISMATCH' });
  mismatch = false;
  await assert.rejects(client.call('Shelly.Reboot', {}, () => !wind), { code: 'REBOOT_DEFERRED' });
  assert.ok(!calls.includes('Shelly.Reboot'));
});
test('new manual commands wait behind a reboot barrier while older commands drain', async () => {
  const controller = new CoverController({ call() {} });
  const events = [];
  const old = controller.enqueue(() => events.push('old'));
  let release;
  controller.rebootBarrier = new Promise(resolve => { release = resolve; });
  const next = controller.enqueue(() => events.push('new'));
  await old; assert.deepEqual(events, ['old']);
  release(); await next; assert.deepEqual(events, ['old','new']);
  controller.dispose();
});
test('wind arriving during fresh status preflight cancels reboot and leaves it pending', async () => {
  const f = fixture(), s = f.make(), original = f.device.client.call;
  f.device.client.call = async function(method, params, allowed) {
    if (method === 'Shelly.GetStatus') f.device.controller.windAlarm = true;
    return original.call(this, method, params, allowed);
  };
  f.set('2026-11-05T02:00:01Z'); await s.tick();
  assert.ok(!f.calls.includes('Shelly.Reboot')); assert.ok(f.device.saved.pending);
});
