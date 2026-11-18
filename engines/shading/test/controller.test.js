'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { CoverController, toAngle, toPercent } = require('../lib/controller');
const { ShellyClient } = require('../lib/client');
const sha = v => createHash('sha256').update(v).digest('hex');

function fixture(overrides = {}) {
  const calls = [];
  const status = { pos_control: true, current_pos: 40, slat_pos: 65, state: 'stopped', ...overrides };
  const client = { async call(method, params) {
    calls.push({ method, params });
    if (method === 'Cover.GetConfig') return { slat: { enable: true } };
    if (method === 'Cover.GetStatus') return { ...status };
    return null;
  } };
  return { calls, status, controller: new CoverController(client, 0, () => {}, 5) };
}
test('height command preserves freshest reported slat position', async () => {
  const f = fixture();
  const result = f.controller.set('pos', 80);
  f.status.slat_pos = 73;
  await result;
  assert.deepEqual(f.calls.at(-1), { method: 'Cover.GoToPosition', params: { id: 0, pos: 80, slat_pos: 73 } });
});
test('slat-only command never includes height', async () => {
  const f = fixture();
  await f.controller.set('slat_pos', 20);
  assert.deepEqual(f.calls.at(-1).params, { id: 0, slat_pos: 20 });
});
test('height and tilt setters become one RPC command', async () => {
  const f = fixture();
  await Promise.all([f.controller.set('pos', 10), f.controller.set('slat_pos', 80)]);
  assert.equal(f.calls.filter(c => c.method === 'Cover.GoToPosition').length, 1);
  assert.deepEqual(f.calls.at(-1).params, { id: 0, pos: 10, slat_pos: 80 });
});
test('rapid values use final target and resolve all callers', async () => {
  const f = fixture();
  await Promise.all([f.controller.set('pos', 10), f.controller.set('pos', 60)]);
  assert.equal(f.calls.at(-1).params.pos, 60);
});
for (const status of [{ pos_control: false }, { current_pos: null }, { slat_pos: null }, { errors: ['overtemp'] }]) {
  test('unsafe or unknown status rejects movement ' + JSON.stringify(status), async () => {
    const f = fixture(status);
    await assert.rejects(f.controller.set('pos', 50));
    assert.equal(f.calls.some(c => c.method === 'Cover.GoToPosition'), false);
  });
}
test('disabled slat control rejects movement', async () => {
  const f = fixture();
  f.controller.client.call = async () => ({ slat: { enable: false } });
  await assert.rejects(f.controller.set('pos', 20), /Lamellensteuerung/);
});
test('stop cancels unsent commands', async () => {
  const f = fixture();
  const pending = assert.rejects(f.controller.set('pos', 100), /angehalten/);
  await f.controller.stop();
  await pending;
  assert.equal(f.calls.some(c => c.method === 'Cover.GoToPosition'), false);
  assert.equal(f.calls[0].method, 'Cover.Stop');
});
test('queue recovers after failed command', async () => {
  const f = fixture();
  const original = f.controller.client.call;
  let broken = true;
  f.controller.client.call = async (method, params) => {
    if (method === 'Cover.GoToPosition' && broken) { broken = false; throw new Error('offline'); }
    return original(method, params);
  };
  await assert.rejects(f.controller.set('pos', 10), /offline/);
  await f.controller.set('pos', 50);
  assert.equal(f.calls.at(-1).params.pos, 50);
});
test('angle conversion maps closed and horizontal correctly', () => {
  assert.equal(toAngle(0), -90);
  assert.equal(toAngle(100), 0);
  for (let p = 0; p <= 100; p++) assert.ok(Math.abs(toPercent(toAngle(p)) - p) <= 1);
});
test('shutdown rejects pending movement', async () => {
  const f = fixture();
  const pending = assert.rejects(f.controller.set('pos', 10), /beendet/);
  f.controller.dispose();
  await pending;
  assert.equal(f.calls.length, 0);
});
test('HTTP Digest verifies password, URI, nonce reuse and count', async () => {
  let count = 0;
  const client = new ShellyClient({ host: '192.0.2.1', shellyDeviceId: '000000000001', password: 'secret' }, async (url, options) => {
    count++;
    if (count === 1) return new Response('', { status: 401, headers: {
      'WWW-Authenticate': 'Digest realm="shelly-test", nonce="test-nonce", algorithm=SHA-256, qop="auth"',
    } });
    const fields = {};
    for (const m of options.headers.Authorization.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) fields[m[1]] = m[2] ?? m[3];
    assert.equal(fields.nc, (count - 1).toString(16).padStart(8, '0'));
    assert.equal(fields.response, sha(sha('admin:shelly-test:secret') + ':test-nonce:' +
      fields.nc + ':' + fields.cnonce + ':auth:' + sha('POST:/rpc')));
    const body = JSON.parse(options.body);
    return Response.json({ id: body.id, result: body.method === 'Shelly.GetDeviceInfo' ? { id: 'shelly2pmg3-000000000001', mac: '000000000001' } : { ok: true } });
  });
  await client.call('Cover.GetStatus');
  await client.call('Cover.GetStatus');
  assert.equal(count, 5);
});
test('RPC errors propagate without retrying movement', async () => {
  let count = 0;
  const client = new ShellyClient({ host: '192.0.2.1', shellyDeviceId: '000000000001' }, async (url, options) => {
    count++;
    const body = JSON.parse(options.body);
    if (body.method === 'Shelly.GetDeviceInfo') return Response.json({ id: body.id, result: { id: 'shelly2pmg3-000000000001', mac: '000000000001' } });
    return Response.json({ id: body.id, error: { code: -109, message: 'Precondition failed' } });
  });
  await assert.rejects(client.call('Cover.GoToPosition', { id: 0, pos: 50 }), /-109/);
  assert.equal(count, 2);
});
test('invalid hosts and embedded credentials are rejected', () => {
  for (const host of ['ftp://example.com', 'http://admin:pass@example.com', 'http://example.com/extra']) {
    assert.throws(() => new ShellyClient({ host }));
  }
});


test('command origin is emitted only for dispatched successful requests and survives deferred slat waiting',async()=>{
 const f=fixture();const origins=[];f.controller.onCommand=origin=>origins.push(origin);
 await f.controller.set('pos',80);assert.deepEqual(origins,['apple-home']);
 Object.assign(f.status,{state:'opening',current_pos:60,target_pos:80});
 await f.controller.set('slat_pos',25);assert.deepEqual(origins,['apple-home']);
 Object.assign(f.status,{state:'stopped',current_pos:80});await f.controller.refresh();
 assert.deepEqual(origins,['apple-home','apple-home']);
 await f.controller.move({pos:0},()=>false,'solar');assert.equal(origins.length,2);
 await f.controller.move({pos:0},()=>true,'solar');assert.equal(origins.at(-1),'solar');
 Object.assign(f.status,{state:'stopped',current_pos:0});await f.controller.refresh();
 const call=f.controller.client.call;f.controller.client.call=async(method,params)=>{if(method==='Cover.GoToPosition')throw new Error('offline');return call(method,params);};
 await assert.rejects(f.controller.move({pos:20},()=>true,'wind-recovery'));
 assert.equal(origins.at(-1),'solar');
});
