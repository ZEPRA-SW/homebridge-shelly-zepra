'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShellyClient } = require('../lib/client');
const config = { host: '192.0.2.1', shellyDeviceId: '000000000001' };
const unavailable = () => Object.assign(new Error('private transport message'), { code: 'ECONNRESET' });
function fixture(handler) {
  const calls = [];
  const client = new ShellyClient(config, async (url, options) => {
    const frame = JSON.parse(options.body); calls.push(frame.method);
    const result = await handler(frame, calls);
    return Response.json({ id: frame.id, result: result ?? { mac: config.shellyDeviceId } });
  });
  return { client, calls };
}
test('temporary read failure recovers once with a new identity check', async () => {
  let failed = false;
  const { client, calls } = fixture(frame => {
    if (frame.method === 'Cover.GetStatus' && !failed) { failed = true; throw unavailable(); }
    if (frame.method === 'Cover.GetStatus') return { current_pos: 55, state: 'stopped' };
  });
  assert.equal((await client.call('Cover.GetStatus', { id: 0 })).current_pos, 55);
  assert.deepEqual(calls, ['Shelly.GetDeviceInfo','Cover.GetStatus','Shelly.GetDeviceInfo','Cover.GetStatus']);
});
test('temporary identity lookup failure can recover for a read', async () => {
  const { client, calls } = fixture((frame, calls) => { if (calls.length === 1) throw unavailable(); });
  await client.call('Cover.GetConfig', { id: 0 });
  assert.deepEqual(calls, ['Shelly.GetDeviceInfo','Shelly.GetDeviceInfo','Cover.GetConfig']);
});
test('persistent read failure stops after two attempts and keeps final diagnostics', async () => {
  const { client, calls } = fixture(frame => { if (frame.method === 'Cover.GetStatus') throw unavailable(); });
  await assert.rejects(client.call('Cover.GetStatus', { id: 0 }), error => {
    assert.equal(error.rpcDiagnostic.readAttempt, 2);
    assert.equal(error.rpcDiagnostic.operation, 'Cover.GetStatus');
    assert.doesNotMatch(JSON.stringify(error), /private transport message/);
    return true;
  });
  assert.equal(calls.length, 4);
});
test('rechecked hardware mismatch prevents the repeated cover request', async () => {
  let identities = 0;
  const { client, calls } = fixture(frame => {
    if (frame.method === 'Shelly.GetDeviceInfo') return { mac: ++identities === 1 ? config.shellyDeviceId : '000000000002' };
    throw unavailable();
  });
  await assert.rejects(client.call('Cover.GetStatus', { id: 0 }), { code: 'SHELLY_ID_MISMATCH' });
  assert.deepEqual(calls, ['Shelly.GetDeviceInfo','Cover.GetStatus','Shelly.GetDeviceInfo']);
});
for (const method of ['Cover.GoToPosition', 'Cover.Open', 'Cover.Close', 'Cover.Stop', 'Shelly.Reboot']) {
  test(method + ' and its identity preflight are never automatically repeated', async () => {
    for (const failIdentity of [false, true]) {
      const { client, calls } = fixture(frame => {
        if (failIdentity || frame.method === method) throw unavailable();
      });
      await assert.rejects(client.call(method, { id: 0 }));
      assert.deepEqual(calls, failIdentity ? ['Shelly.GetDeviceInfo'] : ['Shelly.GetDeviceInfo', method]);
    }
  });
}
test('queued write cannot overtake a retried read', async () => {
  let failed = false;
  const { client, calls } = fixture(frame => {
    if (frame.method === 'Cover.GetStatus' && !failed) { failed = true; throw unavailable(); }
  });
  await Promise.all([client.call('Cover.GetStatus', { id: 0 }), client.call('Cover.Stop', { id: 0 })]);
  assert.deepEqual(calls, ['Shelly.GetDeviceInfo','Cover.GetStatus','Shelly.GetDeviceInfo','Cover.GetStatus',
    'Shelly.GetDeviceInfo','Cover.Stop']);
});

test('a timed-out status read recovers without replaying any movement command', async () => {
  let failed = false;
  const { client, calls } = fixture(frame => {
    if (frame.method === 'Cover.GetStatus' && !failed) {
      failed = true; throw new DOMException('deadline reached', 'TimeoutError');
    }
    if (frame.method === 'Cover.GetStatus') return { current_pos: 20 };
  });
  assert.equal((await client.call('Cover.GetStatus', { id: 0 })).current_pos, 20);
  assert.ok(calls.every(method => ['Shelly.GetDeviceInfo', 'Cover.GetStatus'].includes(method)));
  assert.equal(calls.length, 4);
});
