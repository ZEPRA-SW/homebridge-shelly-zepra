'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShellyPlatform } = require('../index');

function harness(device) {
  const C = Object.fromEntries(['Manufacturer', 'Model', 'SerialNumber', 'Name', 'CurrentPosition',
    'TargetPosition', 'CurrentHorizontalTiltAngle', 'TargetHorizontalTiltAngle',
    'HoldPosition', 'ObstructionDetected', 'On', 'ConfiguredName'].map(name => [name, name]));
  C.PositionState = { INCREASING: 1, DECREASING: 0, STOPPED: 2 };
  class Service {
    constructor() { this.chars = new Map(); }
    getCharacteristic(type) {
      if (!this.chars.has(type)) {
        const c = {
          onGet(fn) { this.get = fn; return this; },
          onSet(fn) { this.set = fn; return this; },
          setProps(props) { this.props = props; return this; },
          updateValue(value) { this.value = value; return this; },
        };
        this.chars.set(type, c);
      }
      return this.chars.get(type);
    }
    setCharacteristic(type, value) { this.getCharacteristic(type).value = value; return this; }
    updateCharacteristic(type, value) { return this.setCharacteristic(type, value); }
    addOptionalCharacteristic(type) { this.getCharacteristic(type); return this; }
    testCharacteristic(type) { return this.chars.has(type); }
    removeCharacteristic(characteristic) {
      for (const [key, value] of this.chars) if (value === characteristic) this.chars.delete(key);
    }
  }
  class Accessory {
    constructor(name, uuid) { this.UUID = uuid; this.context = {}; this.services = new Map([['info', new Service()]]); }
    getService(type) { return this.services.get(type) || [...this.services.values()].find(s => s.type === type); }
    getServiceById(type, subtype) { return this.services.get(subtype === undefined ? type : type + ':' + subtype); }
    removeService(service) { for (const [key, s] of this.services) if (s === service) this.services.delete(key); }
    addService(type, name, subtype) { const s = new Service(); s.type = type; s.subtype = subtype; this.services.set(subtype ? type + ':' + subtype : type, s); return s; }
  }
  const registered = [], removed = [], handlers = {};
  const api = {
    hap: { Service: { AccessoryInformation: 'info', WindowCovering: 'cover', Switch: 'switch' },
      Characteristic: C, HapStatusError: Error, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      uuid: { generate: value => value } },
    on(event, fn) { handlers[event] = fn; }, platformAccessory: Accessory,
    registerPlatformAccessories(p, n, list) { registered.push(...list); },
    unregisterPlatformAccessories(p, n, list) { removed.push(...list); },
    updatePlatformAccessories() {},
  };
  const config = { latitude:52.52,longitude:13.405, globalControls: false, devices: [{ id: 'one', name: 'Wohnzimmer', host: '192.0.2.1', shellyDeviceId: '000000000001', ...device }] };
  const create = () => new ShellyPlatform({ error: assert.fail, warn() {} }, config, api);
  const calls = [];
  const status = { current_pos: 80, slat_pos: 100, pos_control: true, state: 'stopped', source: 'init' };
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.method === 'Cover.GoToPosition') {
      if (body.params.pos !== undefined) status.current_pos = body.params.pos;
      if (body.params.slat_pos !== undefined) status.slat_pos = body.params.slat_pos;
      status.source = 'http';
      status.tag = body.params.tag;
    }
    return Response.json({ id: body.id, result: body.method === 'Shelly.GetDeviceInfo' ? { id: 'shelly2pmg3-000000000001', mac: '000000000001' } : body.method === 'Cover.GetConfig'
      ? config.devices[0].deviceType === 'roller' ? {} : { slat: { enable: true } }
      : body.method === 'Cover.GetStatus' ? { ...status } : null });
  };
  return { C, api, registered, removed, handlers, create, calls, status, fetcher, config };
}

test('solar HomeKit switch, actual controller commands, manual pause, and state across restart', async () => {
  const original = global.fetch;
  const f = harness({ separateSlatControl: true, sunAutomation: { enabled: true } });
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    const runtime = platform.devices[0];
    await runtime.initialPoll;
    assert.equal(f.registered.length, 3);
    const switchService = f.registered[2].getService('switch');
    const on = switchService.getCharacteristic(f.C.On);
    assert.equal(on.get(), true);
    await on.set(false);
    assert.equal(f.registered[0].context.sunState.enabled, false);
    let now = Date.parse('2026-06-21T11:30:00Z');
    runtime.automation.clock = () => now;
    runtime.automation.config.delaySeconds = 0;
    await on.set(true);
    clearTimeout(runtime.timer);
    await runtime.poll();
    const moves = f.calls.filter(c => c.method === 'Cover.GoToPosition');
    assert.equal(moves.length, 1);
    assert.equal(moves[0].params.pos, 0);
    assert.equal(moves[0].params.tag, 'hb-raffstore');
    assert.equal(typeof moves[0].params.slat_pos, 'number');
    // Own completed movement must not look like an external override.
    await runtime.controller.refresh();
    assert.equal(runtime.automation.pausedUntil, 0);
    const slatService = f.registered[1].getService('cover');
    await slatService.getCharacteristic(f.C.TargetPosition).set(40);
    assert.equal(runtime.automation.manualPaused, true);
    assert.equal(f.registered[2].getServiceById('switch', 'pause').getCharacteristic(f.C.On).get(), true);
    assert.equal(f.registered[0].context.sunState.active, false);
    const priorCount = f.calls.filter(c => c.method === 'Cover.GoToPosition').length;
    now += 60000;
    clearTimeout(runtime.timer);
    await runtime.poll();
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, priorCount);
    f.handlers.shutdown();

    const originalNow = Date.now;
    try {
      Date.now = () => now;
      const next = f.create();
      f.registered.forEach(a => next.configureAccessory(a));
      f.handlers.didFinishLaunching();
      await next.devices[0].initialPoll;
      assert.equal(f.registered.length, 3);
      assert.equal(next.devices[0].automation.manualPaused, true);
      f.handlers.shutdown();
    } finally { Date.now = originalNow; }
  } finally {
    f.handlers.shutdown?.();
    global.fetch = original;
  }
});

test('switching existing raffstore to roller removes tilt and extra tile, retains original UUID', async () => {
  const original = global.fetch;
  const f = harness({ separateSlatControl: true });
  global.fetch = f.fetcher;
  try {
    const before = f.create();
    f.handlers.didFinishLaunching();
    await before.devices[0].controller.tail;
    const main = f.registered[0];
    assert.ok(main.getService('cover').testCharacteristic(f.C.TargetHorizontalTiltAngle));
    f.handlers.shutdown();
    f.config.devices[0].deviceType = 'roller';
    delete f.status.slat_pos;
    const next = f.create();
    f.registered.forEach(a => next.configureAccessory(a));
    f.handlers.didFinishLaunching();
    await next.devices[0].controller.tail;
    assert.equal(f.registered.length, 2);
    assert.deepEqual(f.removed, [f.registered[1]]);
    assert.equal(main.getService('cover').testCharacteristic(f.C.TargetHorizontalTiltAngle), false);
    await main.getService('cover').getCharacteristic(f.C.TargetPosition).set(30);
    assert.deepEqual(f.calls.filter(c => c.method === 'Cover.GoToPosition').at(-1).params, { id: 0, pos: 30, tag: 'hb-raffstore' });
    f.handlers.shutdown();
  } finally {
    f.handlers.shutdown?.();
    global.fetch = original;
  }
});
test('roller solar automation goes through HomeKit runtime and actual controller with height only', async () => {
  const original = global.fetch;
  const f = harness({ deviceType: 'roller', sunAutomation: { enabled: true, shadePosition: 27 } });
  delete f.status.slat_pos;
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    const runtime = platform.devices[0];
    await runtime.initialPoll;
    assert.equal(f.registered.length, 2);
    runtime.automation.clock = () => Date.parse('2026-06-21T11:30:00Z');
    runtime.automation.config.delaySeconds = 0;
    runtime.automation.setEnabled(true);
    clearTimeout(runtime.timer);
    await runtime.poll();
    assert.deepEqual(f.calls.filter(c => c.method === 'Cover.GoToPosition').at(-1).params,
      { id: 0, pos: 27, tag: 'hb-raffstore' });
    assert.equal(f.registered[0].getService('cover').testCharacteristic(f.C.TargetHorizontalTiltAngle), false);
    f.handlers.shutdown();
  } finally {
    f.handlers.shutdown?.();
    global.fetch = original;
  }
});
test('automation and wind are independent switches in one accessory; active wind survives restart', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true, sunAutomation: { enabled: true } });
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    const runtime = platform.devices[0];
    await runtime.initialPoll;
    assert.equal(f.registered.length, 2);
    const controls = f.registered[1];
    const auto = controls.getServiceById('switch', undefined).getCharacteristic(f.C.On);
    const wind = controls.getServiceById('switch', 'wind').getCharacteristic(f.C.On);
    assert.equal(auto.get(), true);
    assert.equal(wind.get(), false);
    await wind.set(true);
    assert.equal(auto.get(), true); // Wind suppresses automation without changing user preference.
    assert.equal(wind.get(), true);
    assert.equal(f.registered[0].context.windAlarm, true);
    assert.equal(f.calls.filter(c => c.method === 'Cover.Open').length, 1);
    await assert.rejects(f.registered[0].getService('cover').getCharacteristic(f.C.TargetPosition).set(0));
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
    runtime.automation.clock = () => Date.parse('2026-06-21T11:30:00Z');
    runtime.automation.config.delaySeconds = 0;
    await runtime.automation.tick(f.status);
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
    f.handlers.shutdown();

    const next = f.create();
    f.registered.forEach(a => next.configureAccessory(a));
    f.handlers.didFinishLaunching();
    await next.devices[0].controller.tail;
    assert.equal(f.registered.length, 2);
    assert.equal(next.devices[0].controller.windAlarm, true);
    assert.equal(controls.getServiceById('switch', 'wind').getCharacteristic(f.C.On).get(), true);
    await controls.getServiceById('switch', 'wind').getCharacteristic(f.C.On).set(false);
    assert.equal(next.devices[0].controller.windAlarm, false);
    Object.assign(f.status, { state: 'stopped', current_pos: 100 });
    await f.registered[0].getService('cover').getCharacteristic(f.C.TargetPosition).set(30);
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').at(-1).params.pos, 30);
    f.handlers.shutdown();
  } finally {
    f.handlers.shutdown?.();
    global.fetch = original;
  }
});
test('wind-only setup can gain automation and restart without duplicating switch services', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true });
  global.fetch = f.fetcher;
  try {
    const first = f.create();
    f.handlers.didFinishLaunching();
    await first.devices[0].controller.tail;
    const controls = f.registered[1];
    assert.ok(controls.getServiceById('switch', 'wind'));
    assert.equal(controls.getServiceById('switch', undefined), undefined);
    f.handlers.shutdown();
    f.config.devices[0].sunAutomation = { enabled: true };
    for (let n = 0; n < 2; n++) {
      const next = f.create();
      f.registered.forEach(a => next.configureAccessory(a));
      f.handlers.didFinishLaunching();
      await next.devices[0].controller.tail;
      assert.equal(f.registered.length, 2);
      assert.ok(controls.getServiceById('switch', 'wind'));
      assert.ok(controls.getServiceById('switch', undefined));
      assert.equal([...controls.services.values()].filter(s => s.type === 'switch').length, 3);
      f.handlers.shutdown();
    }
    f.config.devices[0].windProtection = false;
    const last = f.create();
    f.registered.forEach(a => last.configureAccessory(a));
    f.handlers.didFinishLaunching();
    await last.devices[0].controller.tail;
    assert.equal(controls.getServiceById('switch', 'wind'), undefined);
    assert.ok(controls.getServiceById('switch', undefined));
    f.handlers.shutdown();
  } finally {
    f.handlers.shutdown?.();
    global.fetch = original;
  }
});
test('roller ignores wind configuration and exposes only automation switch', async () => {
  const original = global.fetch;
  const f = harness({ deviceType: 'roller', windProtection: true, sunAutomation: { enabled: true } });
  delete f.status.slat_pos;
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    await platform.devices[0].controller.tail;
    assert.equal(f.registered.length, 2);
    assert.equal(f.registered[1].getServiceById('switch', 'wind'), undefined);
    assert.equal(platform.devices[0].controller.windAlarm, false);
    f.handlers.shutdown();
  } finally {
    f.handlers.shutdown?.();
    global.fetch = original;
  }
});
test('identity mismatch is logged as an error, is throttled, and sends no cover request', async () => {
  const original = global.fetch;
  const f = harness({});
  const errors = [];
  const methods = [];
  global.fetch = async (url, options) => {
    const frame = JSON.parse(options.body);
    methods.push(frame.method);
    return Response.json({ id: frame.id, result: { id: 'shelly2pmg3-000000000002', mac: '000000000002' } });
  };
  try {
    const platform = new ShellyPlatform({ error: m => errors.push(m), warn() {} }, f.config, f.api);
    f.handlers.didFinishLaunching();
    const runtime = platform.devices[0];
    await runtime.initialPoll;
    clearTimeout(runtime.timer);
    await runtime.poll();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /192.0.2.1/);
    assert.match(errors[0], /000000000001/);
    assert.match(errors[0], /000000000002/);
    assert.equal(methods.some(m => m.startsWith('Cover.')), false);
    f.handlers.shutdown();
  } finally { f.handlers.shutdown?.(); global.fetch = original; }
});
test('HomeKit configured names label both switches and preserve user renames across restart', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true, sunAutomation: { enabled: true } });
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    await platform.devices[0].initialPoll;
    const controls = f.registered[1];
    const auto = controls.getServiceById('switch', undefined);
    const wind = controls.getServiceById('switch', 'wind');
    assert.equal(auto.getCharacteristic(f.C.Name).value, 'Auto');
    assert.equal(auto.getCharacteristic(f.C.ConfiguredName).value, 'Auto');
    assert.equal(wind.getCharacteristic(f.C.Name).value, 'Windalarm');
    assert.equal(wind.getCharacteristic(f.C.ConfiguredName).value, 'Windalarm');
    await wind.getCharacteristic(f.C.ConfiguredName).set('Mein Windalarm');
    assert.equal(controls.context.switchNames.wind.de, 'Mein Windalarm');
    f.handlers.shutdown();
    const next = f.create();
    f.registered.forEach(accessory => next.configureAccessory(accessory));
    f.handlers.didFinishLaunching();
    await next.devices[0].initialPoll;
    assert.equal(f.registered.length, 2);
    assert.equal(wind.getCharacteristic(f.C.ConfiguredName).get(), 'Mein Windalarm');
    assert.equal(auto.getCharacteristic(f.C.ConfiguredName).get(), 'Auto');
    f.handlers.shutdown();
  } finally { f.handlers.shutdown?.(); global.fetch = original; }
});
test('Automation Pause reports manual intervention and clears without changing Auto', async () => {
  const original = global.fetch;
  const f = harness({ sunAutomation: { enabled: true }, windProtection: true });
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    const runtime = platform.devices[0];
    await runtime.initialPoll;
    const controls = f.registered[1];
    const pause = controls.getServiceById('switch', 'pause');
    const auto = controls.getServiceById('switch', undefined);
    assert.equal(pause.getCharacteristic(f.C.Name).value, 'Automatik Pause');
    assert.equal(pause.getCharacteristic(f.C.On).get(), false);
    await f.registered[0].getService('cover').getCharacteristic(f.C.TargetPosition).set(40);
    assert.equal(pause.getCharacteristic(f.C.On).get(), true);
    assert.equal(pause.getCharacteristic(f.C.On).value, true);
    assert.equal(auto.getCharacteristic(f.C.On).get(), true);
    await pause.getCharacteristic(f.C.On).set(false);
    assert.equal(runtime.automation.manualPaused, false);
    assert.equal(runtime.automation.forceEvaluation, true);
    await controls.getServiceById('switch', 'wind').getCharacteristic(f.C.On).set(true);
    await pause.getCharacteristic(f.C.On).set(false);
    runtime.automation.clock = () => Date.parse('2026-06-21T11:30:00Z');
    const before = f.calls.filter(c => c.method === 'Cover.GoToPosition').length;
    await runtime.automation.tick(f.status);
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, before);
  } finally { f.handlers.shutdown?.(); global.fetch = original; }
});
test('adding a configured cover registers only new accessories and preserves existing bridge accessories', async () => {
  const original = global.fetch;
  const f = harness({});
  global.fetch = f.fetcher;
  try {
    const first = f.create();
    f.handlers.didFinishLaunching();
    await first.devices[0].initialPoll;
    assert.equal(f.registered.length, 1);
    const existing = f.registered[0];
    const originalUuid = existing.UUID;
    f.handlers.shutdown();
    f.config.devices.push({
      id: 'second-cover', name: 'Second cover', host: '192.0.2.2',
      shellyDeviceId: '000000000001', deviceType: 'roller', coverId: 0,
    });
    const next = f.create();
    next.configureAccessory(existing);
    f.handlers.didFinishLaunching();
    await Promise.all(next.devices.map(device => device.initialPoll));
    assert.equal(f.registered.length, 2);
    assert.equal(f.registered[0], existing);
    assert.equal(f.registered[0].UUID, originalUuid);
    assert.equal(f.registered[1].context.deviceId, 'second-cover');
    assert.equal(f.removed.length, 0);
    f.handlers.shutdown();
    const again = f.create();
    f.registered.forEach(accessory => again.configureAccessory(accessory));
    f.handlers.didFinishLaunching();
    await Promise.all(again.devices.map(device => device.initialPoll));
    assert.equal(f.registered.length, 2);
    assert.equal(f.removed.length, 0);
  } finally { f.handlers.shutdown?.(); global.fetch = original; }
});


test('global switches control eligible devices, reflect mixed states, preserve pauses and reuse cached accessory', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true, sunAutomation: { enabled: true } });
  f.config.globalControls = true;
  f.config.devices.push(
    { ...f.config.devices[0], id: 'two', name: 'Bad' },
    { ...f.config.devices[0], id: 'roller', name: 'Rollladen', deviceType: 'roller' },
    { ...f.config.devices[0], id: 'unmanaged', name: 'Manuell', windProtection: false, sunAutomation: { enabled: false } }
  );
  global.fetch = f.fetcher;
  try {
    const platform = f.create();
    f.handlers.didFinishLaunching();
    await Promise.all(platform.devices.map(d => d.initialPoll));
    const group = f.registered.find(a => a.context.role === 'global-controls');
    assert.ok(group);
    const auto = group.getServiceById('switch', 'auto').getCharacteristic(f.C.On);
    const wind = group.getServiceById('switch', 'wind').getCharacteristic(f.C.On);
    assert.equal(auto.get(), true);
    platform.devices[0].automation.setPaused(true);
    await auto.set(false);
    assert.ok(platform.devices.slice(0, 3).every(d => !d.automation.enabled));
    await auto.set(true);
    assert.ok(platform.devices.slice(0, 3).every(d => d.automation.enabled));
    assert.equal(platform.devices[0].automation.manualPaused, true);
    platform.devices[1].setAutomation(false);
    assert.equal(auto.get(), false);
    assert.equal(auto.value, false);
    const alarmCalls = [];
    for (const [index, d] of platform.devices.entries()) {
      const set = d.setWindAlarm;
      d.setWindAlarm = async value => { alarmCalls.push([index, value]); await set(value); };
    }
    await wind.set(true);
    assert.deepEqual(alarmCalls, [[0, true], [1, true]]);
    assert.equal(wind.get(), true);
    assert.equal(platform.devices[2].controller.windAlarm, false);
    await platform.devices[0].setWindAlarm(false);
    assert.equal(wind.get(), true);
    assert.equal(wind.value, true);
    await wind.set(false);
    assert.ok(platform.devices.every(d => !d.controller.windAlarm));
    assert.equal(wind.value, false);
    assert.equal(platform.devices[0].automation.manualPaused, true);
    const count = f.registered.length;
    const uuid = group.UUID;
    f.handlers.shutdown();
    const next = f.create();
    f.registered.forEach(a => next.configureAccessory(a));
    f.handlers.didFinishLaunching();
    await Promise.all(next.devices.map(d => d.initialPoll));
    assert.equal(f.registered.length, count);
    assert.equal(next.globalControls.switches.length, 3);
    assert.equal(group.UUID, uuid);
    assert.deepEqual(f.removed, []);
  } finally { f.handlers.shutdown(); global.fetch = original; }
});

test('global wind attempts every eligible device even if one command fails and reports actual remaining alarm', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true });
  f.config.globalControls = true;
  f.config.devices.push({ ...f.config.devices[0], id: 'two' });
  global.fetch = f.fetcher;
  try {
    const platform = f.create(); f.handlers.didFinishLaunching();
    await Promise.all(platform.devices.map(d => d.initialPoll));
    const group = f.registered.find(a => a.context.role === 'global-controls');
    assert.equal(group.getServiceById('switch', 'auto'), undefined);
    const wind = group.getServiceById('switch', 'wind').getCharacteristic(f.C.On);
    let secondCalled = false;
    platform.devices[0].setWindAlarm = async () => { throw new Error('offline'); };
    platform.devices[1].setWindAlarm = async value => { secondCalled = true; platform.devices[1].controller.windAlarm = value; };
    await assert.rejects(wind.set(true));
    assert.equal(secondCalled, true);
    assert.equal(wind.get(), true);
    assert.equal(wind.value, true);
  } finally { f.handlers.shutdown(); global.fetch = original; }
});


test('HomeKit wind off during opening stops and defers restoration and solar automation until confirmed arrival', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true, sunAutomation: { enabled: true } });
  global.fetch = f.fetcher;
  try {
    const platform = f.create(); f.handlers.didFinishLaunching();
    const runtime = platform.devices[0]; await runtime.initialPoll;
    const wind = f.registered[1].getServiceById('switch', 'wind').getCharacteristic(f.C.On);
    await wind.set(true);
    Object.assign(f.status, { state: 'opening', current_pos: 90, target_pos: 100 });
    await wind.set(false);
    assert.equal(runtime.controller.recovering, true);
    assert.equal(runtime.recovery.state.phase, 'stopping');
    assert.equal(f.calls.filter(c => c.method === 'Cover.Stop').length, 1);
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
    clearTimeout(runtime.timer); await runtime.poll();
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 0);
    Object.assign(f.status, { state: 'stopped', current_pos: 92, target_pos: null });
    clearTimeout(runtime.timer); await runtime.poll();
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 1);
    assert.equal(runtime.controller.recovering, true);
    clearTimeout(runtime.timer); await runtime.poll();
    assert.equal(runtime.controller.recovering, false);
    assert.equal(runtime.controller.recoveryFailed, false);
    assert.equal(runtime.automation.enabled, true);
  } finally { f.handlers.shutdown(); global.fetch = original; }
});


test('global pause affects all solar devices, reflects individual pauses, preserves Auto and respects wind and recovery', async () => {
  const original = global.fetch;
  const f = harness({ windProtection: true, sunAutomation: { enabled: true } });
  f.config.globalControls = true;
  f.config.devices.push({ ...f.config.devices[0], id: 'roller', deviceType: 'roller' },
    { ...f.config.devices[0], id: 'manual', windProtection: false, sunAutomation: { enabled: false } });
  global.fetch = f.fetcher;
  try {
    const platform = f.create(); f.handlers.didFinishLaunching();
    await Promise.all(platform.devices.map(d => d.initialPoll));
    const group = f.registered.find(a => a.context.role === 'global-controls');
    const pause = group.getServiceById('switch', 'pause').getCharacteristic(f.C.On);
    assert.equal(group.getServiceById('switch', 'pause').getCharacteristic(f.C.Name).value, 'Automatik Pause');
    assert.equal(pause.get(), false);
    platform.devices[0].setPause(true);
    assert.equal(pause.get(), true); assert.equal(pause.value, true);
    assert.equal(platform.devices[1].automation.manualPaused, false);
    await pause.set(true);
    assert.ok(platform.devices.slice(0, 2).every(d => d.automation.manualPaused&&d.automation.enabled));
    platform.devices[1].setAutomation(false);
    platform.devices[0].controller.windAlarm = true;
    await pause.set(false);
    assert.ok(platform.devices.slice(0, 2).every(d => !d.automation.manualPaused));
    assert.equal(pause.value, false);
    assert.equal(platform.devices[0].controller.windAlarm, true);
    assert.equal(platform.devices[1].automation.enabled, false);
    const moves = f.calls.filter(c => c.method === 'Cover.GoToPosition').length;
    const a = platform.devices[0].automation;
    a.clock = () => Date.parse('2026-06-21T11:30:00Z');
    await a.tick(f.status);
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, moves);
    platform.devices[0].controller.windAlarm = false;
    platform.devices[0].controller.recovering = true;
    await pause.set(true); await pause.set(false); await a.tick(f.status);
    assert.equal(platform.devices[0].controller.recovering, true);
    assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, moves);
  } finally { f.handlers.shutdown(); global.fetch = original; }
});


test('clearing pause acknowledges failed wind restoration and immediately allows a fresh solar target', async () => {
  for (const globalPause of [false, true]) {
    const original = global.fetch;
    const f = harness({ windProtection: true, sunAutomation: { enabled: true } });
    f.config.globalControls = globalPause;
    global.fetch = f.fetcher;
    try {
      const platform = f.create();f.handlers.didFinishLaunching();
      const runtime = platform.devices[0];await runtime.initialPoll;
      runtime.automation.clock=()=>Date.parse('2026-06-21T11:30:00Z');
      runtime.automation.setPaused(true);
      await runtime.setWindAlarm(true);
      await runtime.setWindAlarm(false);
      // A completed movement was rejected by the previous recovery validation.
      runtime.controller.recoveryFailed=true;
      f.registered[0].context.windRecovery={failed:true,target:{pos:80,slat_pos:100},actual:{pos:83,slat_pos:100}};
      const accessory=globalPause?f.registered.find(a=>a.context.role==='global-controls'):f.registered[1];
      const pause=accessory.getServiceById('switch','pause').getCharacteristic(f.C.On);
      await pause.set(false);
      assert.equal(runtime.controller.recoveryFailed,false);
      assert.equal(f.registered[0].context.windRecovery,null);
      assert.equal(runtime.automation.manualPaused,false);
      assert.equal(runtime.automation.enabled,true);
      const before=f.calls.filter(c=>c.method==='Cover.GoToPosition').length;
      clearTimeout(runtime.timer);await runtime.poll();
      const moves=f.calls.filter(c=>c.method==='Cover.GoToPosition');
      assert.equal(moves.length,before+1);
      assert.equal(moves.at(-1).params.pos,0);
    }finally{f.handlers.shutdown();global.fetch=original;}
  }
});

test('clearing pause preserves a running restoration or active wind alarm', async () => {
  const original=global.fetch;
  const f=harness({windProtection:true,sunAutomation:{enabled:true}});
  global.fetch=f.fetcher;
  try{
    const platform=f.create();f.handlers.didFinishLaunching();
    const runtime=platform.devices[0];await runtime.initialPoll;
    runtime.automation.setPaused(true);
    await runtime.setWindAlarm(true);
    Object.assign(f.status,{state:'opening',current_pos:90,target_pos:100});
    await runtime.setWindAlarm(false);
    const pending=runtime.recovery.state;
    runtime.setPause(false);
    assert.equal(runtime.recovery.state,pending);
    assert.equal(runtime.controller.recovering,true);
    assert.equal(f.calls.filter(c=>c.method==='Cover.GoToPosition').length,0);
    await runtime.setWindAlarm(true);
    runtime.controller.recoveryFailed=true;
    runtime.setPause(false);
    assert.equal(runtime.controller.windAlarm,true);
    assert.equal(runtime.controller.recoveryFailed,true);
    assert.equal(f.calls.filter(c=>c.method==='Cover.GoToPosition').length,0);
  }finally{f.handlers.shutdown();global.fetch=original;}
});


test('last control distinguishes HomeKit, solar, wind, recovery and observed external movement',async()=>{
 const original=global.fetch;const f=harness({windProtection:true,sunAutomation:{enabled:true}});global.fetch=f.fetcher;
 try{
  const platform=f.create();f.handlers.didFinishLaunching();const runtime=platform.devices[0];await runtime.initialPoll;
  const main=f.registered[0];assert.equal(main.context.lastControl,undefined);
  await main.getService('cover').getCharacteristic(f.C.TargetPosition).set(40);
  assert.equal(main.context.lastControl.source,'apple-home');
  await runtime.controller.refresh();runtime.automation.clock=()=>Date.parse('2026-06-21T11:30:00Z');runtime.setPause(false);await runtime.automation.tick(f.status);
  assert.equal(main.context.lastControl.source,'solar');
  await runtime.setWindAlarm(true);assert.equal(main.context.lastControl.source,'wind');
  Object.assign(f.status,{state:'stopped',current_pos:100,slat_pos:100,target_pos:null});
  await runtime.setWindAlarm(false);assert.equal(main.context.lastControl.source,'wind-recovery');
  Object.assign(f.status,{state:'opening',source:'button',tag:null,target_pos:100,move_started_at:123});
  await runtime.controller.refresh();assert.equal(main.context.lastControl.source,'external');
  const recorded=main.context.lastControl;await runtime.controller.refresh();assert.equal(main.context.lastControl,recorded);
 }finally{f.handlers.shutdown();global.fetch=original;}
});

test('last control persists in cached accessory context without inventing a new source at startup',async()=>{
 const original=global.fetch;const f=harness({deviceType:'roller'});global.fetch=f.fetcher;
 try{
  const first=f.create();f.handlers.didFinishLaunching();await first.devices[0].initialPoll;
  await f.registered[0].getService('cover').getCharacteristic(f.C.TargetPosition).set(40);
  const saved=f.registered[0].context.lastControl;f.handlers.shutdown();
  const next=f.create();f.registered.forEach(a=>next.configureAccessory(a));f.handlers.didFinishLaunching();await next.devices[0].initialPoll;
  assert.deepEqual(f.registered[0].context.lastControl,saved);assert.equal(saved.source,'apple-home');
 }finally{f.handlers.shutdown();global.fetch=original;}
});


test('completed external command seen only after stopping is not mislabeled as Apple Home',async()=>{
 const original=global.fetch;const f=harness({deviceType:'roller'});global.fetch=f.fetcher;
 try{
  const platform=f.create();f.handlers.didFinishLaunching();await platform.devices[0].initialPoll;
  await f.registered[0].getService('cover').getCharacteristic(f.C.TargetPosition).set(50);
  assert.equal(f.registered[0].context.lastControl.source,'apple-home');
  Object.assign(f.status,{state:'stopped',source:'http',tag:null,current_pos:20,target_pos:null});
  await platform.devices[0].controller.refresh();assert.equal(f.registered[0].context.lastControl.source,'external');
 }finally{f.handlers.shutdown();global.fetch=original;}
});


test('per-device reboot schedule is wired to persisted accessory context and shutdown', async () => {
  const original = global.fetch;
  const f = harness({ deviceType: 'roller', dailyReboot: { enabled: true, time: '03:00' } });
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'Shelly.GetStatus') {
      f.calls.push(body);
      return Response.json({ id: body.id, result: { 'cover:0': { state: 'stopped' } } });
    }
    return f.fetcher(url, options);
  };
  try {
    const platform = f.create(); f.handlers.didFinishLaunching();
    const runtime = platform.devices[0]; await runtime.initialPoll;
    const scheduler = platform.rebootScheduler;
    assert.ok(scheduler); clearTimeout(scheduler.timer);
    scheduler.clock = () => Date.parse('2026-11-05T02:00:01Z');
    scheduler.previous = { day: '2026-11-05', minute: 179 };
    await scheduler.tick();
    assert.equal(f.calls.filter(c => c.method === 'Shelly.Reboot').length, 1);
    assert.equal(f.registered[0].context.dailyRebootState.lastDay, '2026-11-05');
    f.handlers.shutdown(); assert.equal(scheduler.stopped, true);
  } finally { f.handlers.shutdown(); global.fetch = original; }
});


test('RPC diagnostic reaches platform log and varying durations do not bypass throttling', async () => {
  const original = global.fetch, f = harness({ deviceType: 'roller' });
  const warnings = []; let offline = true, attempts = 0;
  global.fetch = async (url, options) => {
    if (offline) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, attempts * 3));
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code: 'ECONNRESET' }) });
    }
    return f.fetcher(url, options);
  };
  try {
    const platform = f.create(); platform.log.warn = message => warnings.push(message);
    f.handlers.didFinishLaunching(); const runtime = platform.devices[0];
    await runtime.initialPoll; clearTimeout(runtime.timer);
    await runtime.poll(); clearTimeout(runtime.timer);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Shelly.GetDeviceInfo/);
    assert.match(warnings[0], /Cover.GetStatus/);
    assert.match(warnings[0], /elapsedMs/);
    assert.match(warnings[0], /ECONNRESET/);
    assert.doesNotMatch(warnings[0], /private/);
    offline = false; await runtime.poll(); clearTimeout(runtime.timer);
    offline = true; await runtime.poll(); clearTimeout(runtime.timer);
    assert.equal(warnings.length, 2);
  } finally { f.handlers.shutdown(); global.fetch = original; }
});

test('localized shading accessory labels preserve configured device and switch names', async () => {
  const { translate } = require('../lib/i18n');
  const original = global.fetch;
  for (const language of ['de', 'en', 'fr', 'es']) {
    const f = harness({ name: 'Office AA-001', separateSlatControl: true, windProtection: true, sunAutomation: { enabled: true } });
    f.config.language = language;
    global.fetch = f.fetcher;
    try {
      const platform = f.create();
      f.handlers.didFinishLaunching();
      await platform.devices[0].initialPoll;
      assert.equal(f.registered[0].displayName, 'Office AA-001');
      assert.equal(f.registered[1].displayName, 'Office AA-001 ' + translate('Lamellen', language));
      assert.equal(f.registered[2].displayName, 'Office AA-001 ' + translate('Steuerung', language));
      const wind = f.registered[2].getServiceById('switch', 'wind');
      assert.equal(wind.getCharacteristic(f.C.ConfiguredName).get(), translate('Windalarm', language));
      assert.throws(() => wind.getCharacteristic(f.C.ConfiguredName).set(''), { message: translate('Ungültiger Schaltername.', language) });
      wind.getCharacteristic(f.C.ConfiguredName).set('My custom label AA-001');
      assert.equal(wind.getCharacteristic(f.C.ConfiguredName).get(), 'My custom label AA-001');
      assert.equal(f.config.devices[0].name, 'Office AA-001');
    } finally { f.handlers.shutdown?.(); global.fetch = original; }
  }
});
