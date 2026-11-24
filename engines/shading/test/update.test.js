'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShellyClient } = require('../lib/client');
const { CoverController } = require('../lib/controller');
const { WindRecovery, captureWindPosition } = require('../lib/wind-recovery');
const { dailyPeriods, dayBounds } = require('../lib/timeline');
const { Overview } = require('../lib/overview');
const { translate } = require('../lib/i18n');

test('MAC, colon MAC and full Shelly ID match; changed hardware blocks every cover operation', async () => {
  for (const expected of ['aabbcc112233', 'AA:BB:CC:11:22:33', 'shelly2pmg3-aabbcc112233']) {
    let actual = 'AABBCC112233';
    const sent = [];
    const client = new ShellyClient({ host: '192.0.2.1', shellyDeviceId: expected }, async (url, options) => {
      const frame = JSON.parse(options.body);
      sent.push(frame.method);
      return Response.json({ id: frame.id, result: frame.method === 'Shelly.GetDeviceInfo'
        ? { id: 'shelly2pmg3-' + actual.toLowerCase(), mac: actual } : null });
    });
    await client.call('Cover.GoToPosition', { id: 0, pos: 10 });
    actual = '000000000002';
    for (const method of ['Cover.GoToPosition', 'Cover.Open', 'Cover.Stop', 'Cover.GetStatus']) {
      await assert.rejects(client.call(method), e => e.code === 'SHELLY_ID_MISMATCH');
    }
    assert.equal(sent.filter(x => x.startsWith('Cover.')).length, 1);
  }
  assert.throws(() => new ShellyClient({ host: '192.0.2.1' }), /Pflichtangabe/);
});
function recoveryFixture(saved) {
  let now = 100000;
  const status = { pos_control: true, current_pos: 100, slat_pos: 100, state: 'stopped' };
  const calls = [], saves = [];
  let completed = 0;
  const client = { async call(method, params) {
    calls.push({ method, params });
    return method === 'Cover.GetConfig' ? { slat: { enable: true } } : method === 'Cover.GetStatus' ? { ...status } : null;
  } };
  const controller = new CoverController(client, 0, () => {}, 1, { clock: () => now });
  const recovery = new WindRecovery(controller, saved, value => saves.push(value), () => completed++);
  return { status, calls, saves, controller, recovery, completed: () => completed,
    advance(ms) { now += ms; }, async poll() { const s = await controller.refresh(); await recovery.tick(s); } };
}
test('snapshot keeps intended height and tilt while a previous command is moving', () => {
  assert.deepEqual(captureWindPosition({ current_pos: 50, slat_pos: 60 }, { heightTarget: { pos: 20, slat_pos: 30 } }), { pos: 20, slat_pos: 30 });
  assert.equal(captureWindPosition(null, {}), null);
});
test('wind recovery restores both targets and releases automation only after position and slats arrive', async () => {
  const f = recoveryFixture();
  await f.recovery.start({ pos: 30, slat_pos: 40 });
  assert.deepEqual(f.calls.at(-1).params, { id: 0, pos: 30, slat_pos: 40 });
  assert.equal(f.controller.recovering, true);
  Object.assign(f.status, { state: 'closing', current_pos: 50, target_pos: 30 });
  await f.poll();
  assert.equal(f.completed(), 0);
  Object.assign(f.status, { state: 'stopped', current_pos: 30 });
  await f.poll();
  assert.equal(f.completed(), 0);
  f.status.slat_pos = 40;
  await f.poll();
  assert.equal(f.completed(), 1);
  assert.equal(f.controller.recovering, false);
});
test('recovery timeout remains blocked across restart and can be cancelled manually', async () => {
  const f = recoveryFixture();
  await f.recovery.start({ pos: 30, slat_pos: 40 });
  f.advance(301000);
  await assert.rejects(f.poll(), /Zeitlimit/);
  assert.equal(f.controller.recoveryFailed, true);
  const again = recoveryFixture(f.saves.at(-1));
  assert.equal(again.controller.recoveryFailed, true);
  again.recovery.cancel();
  assert.equal(again.controller.recoveryFailed, false);
});
test('pending recovery survives restart and an already achieved target is not sent again', async () => {
  const f = recoveryFixture({ target: { pos: 30, slat_pos: 40 }, expiresAt: 400000 });
  await f.poll();
  assert.ok(f.calls.some(c => c.method === 'Cover.GoToPosition'));
  const done = recoveryFixture({ target: { pos: 100, slat_pos: 100 }, expiresAt: 400000 });
  await done.poll();
  assert.equal(done.completed(), 1);
  assert.equal(done.calls.some(c => c.method === 'Cover.GoToPosition'), false);
});
test('daily timeline follows local DST day boundaries and clips intervals', () => {
  assert.equal((dayBounds('2026-03-29', 'Europe/Berlin').end - dayBounds('2026-03-29', 'Europe/Berlin').start) / 3600000, 23);
  assert.equal((dayBounds('2026-10-25', 'Europe/Berlin').end - dayBounds('2026-10-25', 'Europe/Berlin').start) / 3600000, 25);
  assert.throws(() => dayBounds('2026-02-31', 'Europe/Berlin'));
  const day = dailyPeriods({latitude:52.52,longitude:13.405}, { sunAutomation: { orientation: 166 } }, '2026-06-21');
  assert.ok(day.intervals.length >= 1);
  for (const interval of day.intervals) assert.ok(interval.start >= day.start && interval.end <= day.end && interval.end > interval.start);
});
test('overview exposes no hosts or passwords and distinguishes solar period from actual alarm status', () => {
  const now = Date.parse('2026-06-21T12:00:00Z');
  const data = new Overview().build({latitude:52.52,longitude:13.405, devices: [{ id: 'one', name: 'Blind', host: 'SECRET-HOST', password: 'SECRET-PASS', windProtection: true }] },
    '2026-06-21', [{ id: 'one', online: true, windAlarm: true, updatedAt: now }], now);
  assert.equal(data.rows[0].status.kind, 'alarm');
  assert.ok(data.rows[0].period.intervals.length);
  assert.equal(JSON.stringify(data).includes('SECRET'), false);
});
test('all four configured languages translate settings and log identity mismatch without changing raw IDs', () => {
  assert.equal(translate('Windalarm', 'de'), 'Windalarm');
  assert.equal(translate('Windalarm', 'en'), 'Wind alarm');
  assert.equal(translate('Windalarm', 'fr'), 'Alarme vent');
  assert.equal(translate('Windalarm', 'es'), 'Alarma de viento');
  for (const language of ['en', 'fr', 'es']) {
    assert.notEqual(translate('Shelly-Geräte-ID (Pflichtangabe)', language), 'Shelly-Geräte-ID (Pflichtangabe)');
    assert.notEqual(translate('Shelly-Geräte-ID stimmt an dieser IP-Adresse nicht überein. Aufruf gesperrt.', language), 'Shelly-Geräte-ID stimmt an dieser IP-Adresse nicht überein. Aufruf gesperrt.');
    assert.equal(translate('aabbcc112233', language), 'aabbcc112233');
  }
});
test('copy preserves independent settings but clears device binding and generates a unique permanent ID', () => {
  const { cloneDevice } = require('../homebridge-ui/public/device-copy');
  const original = { id: 'office', name: 'Office', host: '192.0.2.1', shellyDeviceId: '000000000001',
    deviceType: 'raffstore', coverId: 0, sunAutomation: { enabled: true, orientation: 166, slatWidth: 80 } };
  const clone = cloneDevice(original, [original, { id: 'office-copy' }], 'Copy');
  assert.equal(clone.id, 'office-copy-2');
  assert.equal(clone.host, '');
  assert.equal(clone.shellyDeviceId, '');
  assert.equal(clone.name, 'Office Copy');
  assert.deepEqual(clone.sunAutomation, original.sunAutomation);
  clone.sunAutomation.orientation = 200;
  assert.equal(original.sunAutomation.orientation, 166);
});
test('recovery start and simultaneous polling share one in-flight movement request', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = {
    tolerance: 1, clock: () => 100000, waitTimeout: 300000,
    clearDeferred() {}, moveCount: 0,
    async move(target, allowed) { this.moveCount++; await gate; assert.equal(allowed(), true); },
  };
  const recovery = new WindRecovery(controller);
  const initial = recovery.start({ pos: 30, slat_pos: 40 });
  const poll = recovery.tick({ state: 'stopped', current_pos: 100, slat_pos: 100 });
  release();
  await Promise.all([initial, poll]);
  assert.equal(controller.moveCount, 1);
});
test('recovery mismatch needs stable confirmation and reports exact target and actual values', async () => {
  const f = recoveryFixture();
  await f.recovery.start({ pos: 80, slat_pos: 68 });
  Object.assign(f.status, { state: 'opening', current_pos: 90, target_pos: 80 });
  await f.poll();
  Object.assign(f.status, { state: 'stopped', current_pos: 86, slat_pos: 68, target_pos: null, source: 'timeout' });
  f.advance(11000);
  await f.poll();
  assert.equal(f.controller.recoveryFailed, false);
  await f.poll();
  assert.equal(f.controller.recoveryFailed, false);
  await assert.rejects(f.poll(), error => {
    assert.deepEqual(error.recoveryDiagnostic.target, { pos: 80, slat_pos: 68 });
    assert.equal(error.recoveryDiagnostic.actual.pos, 86);
    assert.equal(error.recoveryDiagnostic.actual.source, 'timeout');
    return true;
  });
  assert.equal(f.saves.at(-1).target.pos, 80);
  assert.equal(f.saves.at(-1).actual.pos, 86);
});


test('clearing wind during opening stops first and waits for reported standstill before restoring', async () => {
  const f = recoveryFixture();
  Object.assign(f.status, { state: 'opening', current_pos: 60, target_pos: 100 });
  await f.recovery.start({ pos: 30, slat_pos: 40 }, { stopOpening: true });
  assert.equal(f.calls.filter(c => c.method === 'Cover.Stop').length, 1);
  assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
  assert.equal(f.controller.recovering, true);
  assert.equal(f.saves.at(-1).phase, 'stopping');
  f.advance(15000); await f.poll();
  assert.equal(f.controller.recoveryFailed, false);
  assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
  Object.assign(f.status, { state: 'stopped', current_pos: 65, target_pos: null });
  await f.poll();
  assert.deepEqual(f.calls.filter(c => c.method === 'Cover.GoToPosition').map(c => c.params), [{ id: 0, pos: 30, slat_pos: 40 }]);
  Object.assign(f.status, { state: 'closing', current_pos: 50, target_pos: 30 }); await f.poll();
  assert.equal(f.completed(), 0);
  Object.assign(f.status, { state: 'stopped', current_pos: 30, slat_pos: 40 }); await f.poll();
  assert.equal(f.completed(), 1);
  assert.equal(f.controller.recovering, false);
});

test('pending wind-stop phase survives restart and resumes only after standstill', async () => {
  const f = recoveryFixture({ target: { pos: 30, slat_pos: 40 }, expiresAt: 400000, phase: 'stopping' });
  Object.assign(f.status, { state: 'opening', current_pos: 90, target_pos: 100 });
  await f.poll();
  assert.equal(f.calls.filter(c => c.method === 'Cover.Stop').length, 1);
  assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
  Object.assign(f.status, { state: 'stopped', current_pos: 92, target_pos: null }); await f.poll();
  assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 1);
});

test('new wind alarm or manual cancellation discards restoration waiting for standstill', async () => {
  for (const cancel of ['manual', 'wind']) {
    const f = recoveryFixture();
    Object.assign(f.status, { state: 'opening', current_pos: 60, target_pos: 100 });
    await f.recovery.start({ pos: 30, slat_pos: 40 }, { stopOpening: true });
    f.recovery.cancel();
    if (cancel === 'wind') await f.controller.setWindAlarm(true);
    Object.assign(f.status, { state: 'stopped', current_pos: 100 }); await f.poll();
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
  }
});


test('overview exposes only recognized last-control source labels',()=>{
 const now=Date.now();const overview=new Overview();const config={devices:[{id:'one',name:'Blind'}]};
 const state={id:'one',online:true,updatedAt:now,lastControl:{source:'solar',at:now,secret:'PRIVATE'}};
 const result=overview.build(config,'2026-06-21',[state],now);
 assert.deepEqual(result.rows[0].state.lastControl,{source:'solar',at:now});assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 state.lastControl.source='untrusted-source';assert.equal(overview.build(config,'2026-06-21',[state],now).rows[0].state.lastControl,null);
});
