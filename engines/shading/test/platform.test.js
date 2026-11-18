'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const register = require('../index');
for (const separateSlatControl of [false, true]) {
test('Homebridge integration; separate slat tile = ' + separateSlatControl, async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let offline = false;
  const warnings = [];
  const status = { pos_control: true, current_pos: 35, slat_pos: 60, state: 'stopped' };
  global.fetch = async (url, options) => {
    if (offline) throw new Error('offline');
    const frame = JSON.parse(options.body);
    calls.push(frame);
    if (frame.method === 'Cover.GoToPosition') {
      if (frame.params.pos !== undefined) status.current_pos = frame.params.pos;
      if (frame.params.slat_pos !== undefined) status.slat_pos = frame.params.slat_pos;
    }
    return Response.json({ id: frame.id, result: frame.method === 'Shelly.GetDeviceInfo' ? { id: 'shelly2pmg3-000000000001', mac: '000000000001' } : frame.method === 'Cover.GetConfig'
      ? { slat: { enable: true } } : frame.method === 'Cover.GetStatus' ? status : null });
  };
  const handlers = {};
  const C = {};
  for (const name of ['Manufacturer', 'Model', 'SerialNumber', 'Name', 'CurrentPosition',
    'TargetPosition', 'CurrentHorizontalTiltAngle', 'TargetHorizontalTiltAngle',
    'HoldPosition', 'ObstructionDetected']) C[name] = name;
  C.PositionState = { INCREASING: 1, DECREASING: 0, STOPPED: 2 };
  class FakeService {
    constructor() { this.values = new Map(); }
    getCharacteristic(type) {
      if (!this.values.has(type)) {
        const item = {
          onGet(fn) { this.get = fn; return this; },
          onSet(fn) { this.set = fn; return this; },
          setProps(props) { this.props = props; return this; },
          updateValue(value) { this.value = value; return this; },
        };
        this.values.set(type, item);
      }
      return this.values.get(type);
    }
    setCharacteristic(type, value) { this.getCharacteristic(type).value = value; return this; }
    updateCharacteristic(type, value) { return this.setCharacteristic(type, value); }
  }
  class FakeAccessory {
    constructor(name, uuid) { this.UUID = uuid; this.services = new Map([['info', new FakeService()]]); }
    getService(type) { return this.services.get(type) || [...this.services.values()].find(s => s.type === type); }
    getServiceById(type, subtype) { return this.services.get(subtype === undefined ? type : type + ':' + subtype); }
    removeService(service) { for (const [key, s] of this.services) if (s === service) this.services.delete(key); }
    addService(type, name, subtype) { const service = new FakeService(); service.type = type; service.subtype = subtype; this.services.set(subtype ? type + ':' + subtype : type, service); return service; }
  }
  const registered = [];
  const removed = [];
  const updated = [];
  const api = {
    hap: { Service: { AccessoryInformation: 'info', WindowCovering: 'cover' }, Characteristic: C,
      HapStatusError: Error, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      uuid: { generate: x => x } },
    on: (event, fn) => { handlers[event] = fn; },
    platformAccessory: FakeAccessory,
    registerPlatformAccessories: (plugin, platform, list) => registered.push(...list),
    updatePlatformAccessories(list) { updated.push(...list); },
    unregisterPlatformAccessories(plugin, platform, list) { removed.push(...list); },
    registerPlatform(plugin, platform, ctor) {
      assert.equal(plugin, 'homebridge-shelly-raffstore');
      assert.equal(platform, 'ShellyRaffstore');
      assert.equal(ctor, register.ShellyPlatform);
    },
  };
  try {
    register(api);
    const platform = new register.ShellyPlatform({ error: assert.fail, warn: message => warnings.push(message) }, {
      devices: [{ id: 'one', name: 'Raffstore', host: '192.0.2.1', shellyDeviceId: '000000000001', separateSlatControl, slatName: 'Lamellen Wohnzimmer' }],
    }, api);
    handlers.didFinishLaunching();
    await platform.devices[0].controller.tail;
    assert.equal(registered.length, separateSlatControl ? 2 : 1);
    const service = registered[0].getService('cover');
    const slats = separateSlatControl ? registered[1].getService('cover') : undefined;
    if (slats) {
      assert.equal(registered[1].displayName, 'Lamellen Wohnzimmer');
      assert.equal(slats.getCharacteristic(C.CurrentPosition).get(), 60);
      assert.equal(slats.getCharacteristic(C.Name).value, 'Lamellen Wohnzimmer');
      // One controller/poll cycle must serve both tiles.
      assert.equal(calls.filter(c => c.method === 'Cover.GetStatus').length, 1);
    }
    assert.equal(service.getCharacteristic(C.CurrentPosition).get(), 35);
    assert.equal(service.getCharacteristic(C.CurrentHorizontalTiltAngle).get(), -36);
    assert.equal(service.getCharacteristic(C.TargetHorizontalTiltAngle).props.maxValue, 0);
    await Promise.all([
      service.getCharacteristic(C.TargetPosition).set(70),
      service.getCharacteristic(C.TargetHorizontalTiltAngle).set(-45),
    ]);
    assert.deepEqual(calls.filter(c => c.method === 'Cover.GoToPosition').map(c => c.params),
      [{ id: 0, pos: 70, slat_pos: 50, tag: 'hb-raffstore' }]);
    assert.equal(service.getCharacteristic(C.TargetPosition).value, 70);
    assert.equal(service.getCharacteristic(C.TargetHorizontalTiltAngle).value, -45);
    if (slats) {
      calls.length = 0;
      await slats.getCharacteristic(C.TargetPosition).set(25);
      assert.deepEqual(calls.filter(c => c.method === 'Cover.GoToPosition').map(c => c.params),
        [{ id: 0, slat_pos: 25, tag: 'hb-raffstore' }]);
      assert.equal(service.getCharacteristic(C.TargetHorizontalTiltAngle).value, -67);
      calls.length = 0;
      await Promise.all([
        service.getCharacteristic(C.TargetPosition).set(55),
        slats.getCharacteristic(C.TargetPosition).set(80),
      ]);
      assert.deepEqual(calls.filter(c => c.method === 'Cover.GoToPosition').map(c => c.params),
        [{ id: 0, pos: 55, slat_pos: 80, tag: 'hb-raffstore' }]);
      status.slat_pos = 90;
      await platform.devices[0].controller.refresh();
      assert.equal(slats.getCharacteristic(C.CurrentPosition).get(), 90);
      assert.equal(slats.getCharacteristic(C.TargetPosition).value, 90);
      offline = true;
      await platform.devices[0].poll();
      assert.throws(() => slats.getCharacteristic(C.CurrentPosition).get());
      assert.ok(slats.getCharacteristic(C.TargetPosition).value instanceof Error);
      offline = false;
      await platform.devices[0].controller.refresh();
      assert.equal(slats.getCharacteristic(C.CurrentPosition).get(), 90);
      assert.equal(slats.getCharacteristic(C.TargetPosition).value, 90);
      await slats.getCharacteristic(C.HoldPosition).set(true);
    }
    await service.getCharacteristic(C.HoldPosition).set(true);
    assert.ok(calls.some(c => c.method === 'Cover.Stop'));
    handlers.shutdown();
    assert.equal(platform.devices[0].controller.disposed, true);
    if (slats) {
      // Disabling removes only the auxiliary tile and preserves the original identity.
      const next = new register.ShellyPlatform({ error: assert.fail, warn() {} }, {
        devices: [{ id: 'one', name: 'Raffstore', host: '192.0.2.1', shellyDeviceId: '000000000001' }],
      }, api);
      registered.forEach(accessory => next.configureAccessory(accessory));
      handlers.didFinishLaunching();
      await next.devices[0].controller.tail;
      assert.deepEqual(removed, [registered[1]]);
      assert.ok(updated.includes(registered[0]));
      assert.equal(registered.length, 2);
      handlers.shutdown();
      // Re-enabling reuses the stable auxiliary identity when restored from cache.
      const again = new register.ShellyPlatform({ error: assert.fail, warn() {} }, {
        devices: [{ id: 'one', name: 'Raffstore', host: '192.0.2.1', shellyDeviceId: '000000000001', separateSlatControl: true }],
      }, api);
      registered.forEach(accessory => again.configureAccessory(accessory));
      handlers.didFinishLaunching();
      await again.devices[0].controller.tail;
      assert.ok(updated.includes(registered[1]));
      assert.equal(registered.length, 2);
      handlers.shutdown();
    }
  } finally {
    handlers.shutdown?.();
    global.fetch = originalFetch;
  }
});

}
