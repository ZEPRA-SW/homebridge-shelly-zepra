'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sunPosition, slatTarget, angleDifference, solarConfig, SunAutomation } = require('../lib/solar');
const { CoverController } = require('../lib/controller');

test('solar position: equinox equatorial noon, morning east, evening west, midnight below horizon', () => {
  const noon = sunPosition(new Date('2026-03-20T12:00:00Z'), 0, 0);
  assert.ok(noon.elevation > 87 && noon.elevation <= 90);
  assert.ok(Math.abs(sunPosition(new Date('2026-03-20T06:00:00Z'), 0, 0).azimuth - 90) < 2);
  assert.ok(Math.abs(sunPosition(new Date('2026-03-20T18:00:00Z'), 0, 0).azimuth - 270) < 2);
  assert.ok(sunPosition(new Date('2026-03-20T00:00:00Z'), 0, 0).elevation < -87);
});
test('Berlin centre solstice noon is south/high in summer, low in winter; timezones describe same instant', () => {
  const summer = sunPosition(new Date('2026-06-21T11:08:00Z'), 52.52, 13.405);
  const winter = sunPosition(new Date('2026-12-21T11:04:00Z'), 52.52, 13.405);
  assert.ok(summer.elevation > 60 && summer.elevation < 62);
  assert.ok(winter.elevation > 13 && winter.elevation < 15);
  assert.ok(Math.abs(summer.azimuth - 180) < 2);
  assert.deepEqual(summer, sunPosition(new Date('2026-06-21T13:08:00+02:00'), 52.52, 13.405));
});
test('sun azimuth wraps correctly across north and longitude handles date boundary', () => {
  assert.equal(angleDifference(355, 5), -10);
  assert.equal(angleDifference(5, 355), 10);
  const a = sunPosition(new Date('2026-03-20T00:00:00Z'), 0, 179.9);
  assert.ok(a.elevation > 87);
  assert.throws(() => sunPosition(new Date('invalid'), 0, 0));
  assert.throws(() => sunPosition(new Date(), 100, 0));
});
test('cutoff geometry opens slats further at high or oblique sun; width and pitch affect angle', () => {
  const low = slatTarget({ azimuth: 166, elevation: 10 }, 166, 80, 70, 5);
  const high = slatTarget({ azimuth: 166, elevation: 60 }, 166, 80, 70, 5);
  const side = slatTarget({ azimuth: 230, elevation: 10 }, 166, 80, 70, 5);
  assert.ok(low >= 0 && high <= 100 && high > low && side > low);
  for (let elevation = 5; elevation < 85; elevation += 5) {
    const target = slatTarget({ azimuth: 166, elevation }, 166, 80, 70, 5);
    const beta = (1 - target / 100) * Math.PI / 2;
    const alpha = elevation * Math.PI / 180;
    assert.ok(80 * Math.sin(beta + alpha) / Math.cos(alpha) >= 69);
  }
});
test('invalid solar settings fail before any commands', () => {
  for (const values of [{ orientation: '166' }, { endBehavior: 'bad' }, { slatSpacing: 100, slatWidth: 80 }]) {
    assert.throws(() => solarConfig({latitude:52.52,longitude:13.405}, { sunAutomation: { enabled: true, ...values } }));
  }
  assert.throws(() => solarConfig({latitude:52.52,longitude:13.405}, { deviceType: 'roller', sunAutomation: { enabled: true, endBehavior: 'horizontal' } }));
  assert.equal(solarConfig({latitude:52.52,longitude:13.405}, {}), null);
});

function fixture(kind = 'raffstore', extra = {}, saved = {}) {
  let now = Date.parse('2026-06-21T11:30:00Z');
  const sent = [];
  const persisted = [];
  const controller = { disposed: false, async move(target, allowed) { if (allowed()) sent.push(target); } };
  const config = solarConfig({latitude:52.52,longitude:13.405}, { deviceType: kind, sunAutomation: { enabled: true, delaySeconds: 0, ...extra } });
  const auto = new SunAutomation(config, controller, saved, value => persisted.push(value), () => now);
  const status = { state: 'stopped', current_pos: 100, slat_pos: 100 };
  return { auto, sent, controller, status, persisted,
    advance(ms = 60000) { now += ms; },
    tick(date) { return auto.tick(status, date || new Date(now)); },
  };
}
test('raffstore closes completely and includes calculated slat target in one command', async () => {
  const f = fixture();
  await f.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].pos, 0);
  assert.ok(f.sent[0].slat_pos >= 0 && f.sent[0].slat_pos <= 100);
  assert.equal(f.auto.active, true);
});
test('roller shading sends only configured height, no slat parameter', async () => {
  const f = fixture('roller', { shadePosition: 35 });
  await f.tick();
  assert.deepEqual(f.sent, [{ pos: 35 }]);
});
for (const kind of ['raffstore', 'roller']) {
  for (const behavior of ['keep', 'open', 'close', 'custom', ...(kind === 'raffstore' ? ['horizontal'] : [])]) {
    test(kind + ': end behavior ' + behavior, async () => {
      const f = fixture(kind, { endBehavior: behavior, endPosition: 42, endSlatPosition: 55 });
      await f.tick();
      f.status.current_pos = 0;
      f.status.slat_pos = 0;
      f.sent.length = 0;
      f.advance(60000);
      await f.tick(new Date('2026-06-21T23:00:00Z'));
      const expected = {
        keep: [],
        open: [kind === 'roller' ? { pos: 100 } : { pos: 100, slat_pos: 100 }],
        close: [], // Already at 0/0: no redundant movement.
        custom: [kind === 'roller' ? { pos: 42 } : { pos: 42, slat_pos: 55 }],
        horizontal: [{ slat_pos: 100 }],
      };
      assert.deepEqual(f.sent, expected[behavior]);
      assert.equal(f.auto.active, false);
    });
  }
}
test('close end mode sends zero targets when not already closed', async () => {
  const f = fixture('raffstore', { endBehavior: 'close' });
  await f.tick();
  f.status.current_pos = 30;
  f.status.slat_pos = 50;
  f.sent.length = 0;
  f.advance();
  await f.tick(new Date('2026-06-21T23:00:00Z'));
  assert.deepEqual(f.sent, [{ pos: 0, slat_pos: 0 }]);
});
test('manual pause stays visible without timeout, survives restart, and resumes only when cleared', async () => {
  const f = fixture('raffstore', { endBehavior: 'open' });
  await f.tick();
  f.auto.manual();
  assert.equal(f.auto.enabled, true);
  assert.equal(f.auto.manualPaused, true);
  const saved = f.persisted.at(-1);
  const restarted = fixture('raffstore', {}, saved);
  await restarted.tick();
  assert.equal(restarted.sent.length, 0);
  assert.equal(restarted.auto.manualPaused, true);
  f.sent.length = 0;
  f.advance(120 * 60000);
  await f.tick();
  assert.equal(f.auto.manualPaused, true);
  assert.equal(f.sent.length, 0);
  f.auto.setPaused(false);
  await f.tick();
  assert.equal(f.sent.length, 1);
});
test('pause resets at period end without moving manual position, and next day starts normally', async () => {
  const f = fixture('raffstore', { endBehavior: 'open' });
  await f.tick();
  f.auto.manual();
  f.sent.length = 0;
  f.advance(10 * 3600000);
  await f.tick();
  assert.equal(f.auto.manualPaused, false);
  assert.equal(f.auto.enabled, true);
  assert.equal(f.sent.length, 0);
  f.advance(14 * 3600000);
  await f.tick();
  assert.equal(f.sent.length, 1);
});
test('pause from yesterday resets after restart and period end resets even while wind blocks movement', async () => {
  const f = fixture();
  await f.tick();
  f.auto.manual();
  const saved = f.persisted.at(-1);
  const restarted = fixture('raffstore', {}, saved);
  restarted.advance(24 * 3600000);
  await restarted.tick();
  assert.equal(restarted.auto.manualPaused, false);
  assert.equal(restarted.sent.length, 1);
  f.controller.windAlarm = true;
  f.advance(10 * 3600000);
  await f.tick();
  assert.equal(f.auto.manualPaused, false);
});

test('HomeKit automation switch off cancels queued command, reenable clears pause', async () => {
  const f = fixture();
  f.controller.move = async (target, allowed) => {
    f.auto.setEnabled(false);
    assert.equal(allowed(), false);
  };
  await f.tick();
  assert.equal(f.auto.active, false);
  f.auto.manual();
  f.auto.setEnabled(true);
  assert.equal(f.auto.pausedUntil, 0);
});
test('two-minute entry and exit delay, no movement at night or behind facade', async () => {
  const f = fixture('roller', { delaySeconds: 120 });
  await f.tick();
  assert.equal(f.sent.length, 0);
  f.advance();
  await f.tick();
  assert.equal(f.sent.length, 0);
  f.advance();
  await f.tick();
  assert.equal(f.sent.length, 1);
  const north = fixture('roller', { orientation: 0 });
  await north.tick();
  assert.equal(north.sent.length, 0);
  const night = fixture();
  await night.tick(new Date('2026-06-21T23:00:00Z'));
  assert.equal(night.sent.length, 0);
});
test('no repeat command at achieved target, no motion interruption, minimum interval for tracking', async () => {
  const f = fixture();
  await f.tick();
  Object.assign(f.status, { current_pos: f.sent[0].pos, slat_pos: f.sent[0].slat_pos });
  f.advance();
  await f.tick();
  assert.equal(f.sent.length, 1);
  f.status.slat_pos = 0;
  f.status.state = 'closing';
  f.advance(1200000);
  await f.tick();
  assert.equal(f.sent.length, 1);
  f.status.state = 'stopped';
  await f.tick();
  assert.equal(f.sent.length, 1); // Same minute not reevaluated.
  f.advance();
  await f.tick();
  assert.equal(f.sent.length, 2);
});
test('external button movement pauses; own tagged motion and endstop do not', async () => {
  const f = fixture();
  await f.tick();
  f.auto.observe({ ...f.status, state: 'closing', source: 'http', tag: 'hb-raffstore', current_pos: 50 });
  f.auto.observe({ ...f.status, state: 'stopped', source: 'http', tag: 'hb-raffstore', current_pos: 0 });
  assert.equal(f.auto.pausedUntil, 0);
  f.auto.observe({ ...f.status, state: 'opening', source: 'button', current_pos: 0, move_started_at: 123 });
  assert.equal(f.auto.manualPaused, true);
});
test('roller controller accepts absent slat status, sends no slat, rejects tilt command', async () => {
  const calls = [];
  const client = { async call(method, params) {
    calls.push({ method, params });
    return method === 'Cover.GetConfig' ? {} : method === 'Cover.GetStatus'
      ? { pos_control: true, current_pos: 50, state: 'stopped' } : null;
  } };
  const controller = new CoverController(client, 0, () => {}, 1, { kind: 'roller' });
  await controller.set('pos', 35);
  assert.deepEqual(calls.at(-1), { method: 'Cover.GoToPosition', params: { id: 0, pos: 35 } });
  await assert.rejects(controller.set('slat_pos', 30));
});
test('queued automatic command checks manual override again after status read', async () => {
  let valid = true;
  const commands = [];
  const client = { async call(method, params) {
    if (method === 'Cover.GetConfig') return { slat: { enable: true } };
    if (method === 'Cover.GetStatus') { valid = false; return { pos_control: true, current_pos: 50, slat_pos: 50 }; }
    commands.push({ method, params });
  } };
  const controller = new CoverController(client);
  await controller.move({ pos: 0, slat_pos: 50 }, () => valid);
  assert.deepEqual(commands, []);
});
test('sun boundary hysteresis retains shading until wider exit boundary and exit delay expires', async () => {
  const f = fixture('roller', { delaySeconds: 120, endBehavior: 'open' });
  await f.tick();
  f.advance(120000);
  await f.tick(new Date('2026-06-21T11:30:00Z'));
  assert.equal(f.auto.active, true);
  f.status.current_pos = 30;
  f.sent.length = 0;
  const sun = sunPosition(new Date('2026-06-21T11:30:00Z'), f.auto.config.latitude, f.auto.config.longitude);
  f.auto.config.orientation = sun.azimuth - 81;
  f.advance();
  await f.tick(new Date('2026-06-21T11:30:00Z'));
  assert.equal(f.auto.active, true);
  assert.equal(f.sent.length, 0);
  f.auto.config.orientation = sun.azimuth - 84;
  f.advance();
  await f.tick(new Date('2026-06-21T11:30:00Z'));
  assert.equal(f.sent.length, 0);
  f.advance();
  await f.tick(new Date('2026-06-21T11:30:00Z'));
  assert.equal(f.sent.length, 0);
  f.advance();
  await f.tick(new Date('2026-06-21T11:30:00Z'));
  assert.deepEqual(f.sent, [{ pos: 100 }]);
});
test('failed automatic command does not commit active state or immediately retry', async () => {
  const f = fixture();
  let count = 0;
  f.controller.move = async () => { count++; throw new Error('offline'); };
  await assert.rejects(f.tick(), /offline/);
  assert.equal(f.auto.active, false);
  await f.tick();
  assert.equal(count, 1);
  f.advance();
  await assert.rejects(f.tick(), /offline/);
  assert.equal(count, 2);
});
test('untagged completion at the commanded target is not treated as a manual override', async () => {
  const f = fixture();
  await f.tick();
  f.auto.observe({ ...f.status, source: 'http' });
  f.auto.observe({ ...f.status, current_pos: f.sent[0].pos, slat_pos: f.sent[0].slat_pos, source: 'limit_switch' });
  assert.equal(f.auto.pausedUntil, 0);
});
test('explicit HomeKit enable bypasses entry delay while automatic entry still waits', async () => {
  const f = fixture('roller', { delaySeconds: 120 });
  await f.tick();
  assert.equal(f.sent.length, 0);
  f.auto.setEnabled(false);
  f.auto.setEnabled(true);
  await f.tick();
  assert.deepEqual(f.sent, [{ pos: 30 }]);
});
test('explicit enable respects wind and waits for an existing movement without losing immediate intent', async () => {
  const f = fixture('roller', { delaySeconds: 120 });
  f.auto.setEnabled(true);
  f.controller.windAlarm = true;
  await f.tick();
  assert.equal(f.sent.length, 0);
  f.controller.windAlarm = false;
  f.status.state = 'opening';
  await f.tick();
  assert.equal(f.sent.length, 0);
  f.status.state = 'stopped';
  await f.tick();
  assert.deepEqual(f.sent, [{ pos: 30 }]);
});
test('explicit enable outside the solar window does not command a cover', async () => {
  const f = fixture('roller', { delaySeconds: 120, orientation: 0 });
  f.auto.setEnabled(true);
  await f.tick();
  assert.equal(f.sent.length, 0);
});


test('slat tracking defaults to twenty minutes and respects a custom interval without delaying initial shading', async () => {
  for (const seconds of [1200, 600, 1800]) {
    const extra = seconds === 1200 ? {} : { minCommandSeconds: seconds };
    const f = fixture('raffstore', { ...extra, slatStep: 1 });
    assert.equal(f.auto.config.minCommandSeconds, seconds);
    await f.tick();
    assert.equal(f.sent.length, 1);
    Object.assign(f.status, { current_pos: 0, slat_pos: 0 });
    f.advance((seconds - 60) * 1000);
    await f.tick();
    assert.equal(f.sent.length, 1, 'no follow-up before interval');
    f.advance(60000);
    await f.tick();
    assert.equal(f.sent.length, 2, 'follow-up permitted at configured interval');
  }
});

test('solar automation requires explicit coordinates and preserves saved locations', () => {
  const device = { sunAutomation: { enabled: true } };
  assert.throws(()=>solarConfig({},device), /Geokoordinaten/);
  assert.throws(()=>solarConfig({latitude:0},device), /Geokoordinaten/);
  const existing = solarConfig({ latitude: 48.8566, longitude: 2.3522 }, device);
  assert.equal(existing.latitude, 48.8566);assert.equal(existing.longitude, 2.3522);
  const zero=solarConfig({latitude:0,longitude:0},device);assert.equal(zero.latitude,0);assert.equal(zero.longitude,0);
});
