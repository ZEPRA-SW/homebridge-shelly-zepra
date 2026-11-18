'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShellyClient } = require('../lib/client');
const { diagnosedError, diagnosticKey } = require('../lib/rpc-diagnostics');
const config = { host: '192.0.2.1', shellyDeviceId: '000000000001', password: 'private-password' };
const frame = options => JSON.parse(options.body);
const identity = options => Response.json({ id: frame(options).id, result: { mac: config.shellyDeviceId } });
async function failure(client, method = 'Cover.GetStatus', params = { id: 0 }) {
  try { await client.call(method, params); assert.fail('Expected failure'); }
  catch (error) { assert.ok(error.rpcDiagnostic, error.stack); return error; }
}
for (const code of ['ECONNREFUSED','ECONNRESET','ENETUNREACH','ENOTFOUND','EAI_AGAIN','UND_ERR_SOCKET']) {
  test('network diagnosis preserves '+code+' without leaking exception text', async () => {
    let calls = 0;
    const client = new ShellyClient(config, async () => {
      calls++;
      throw new TypeError('private-password and Authorization secret', {
        cause: Object.assign(new Error('private-password nonce digest'), { code }),
      });
    });
    const error = await failure(client);
    assert.equal(error.code, 'SHELLY_NETWORK_ERROR');
    assert.equal(error.rpcDiagnostic.method, 'Shelly.GetDeviceInfo');
    assert.equal(error.rpcDiagnostic.operation, 'Cover.GetStatus');
    assert.equal(error.rpcDiagnostic.channel, 0);
    assert.equal(error.rpcDiagnostic.host, '192.0.2.1');
    assert.equal(error.rpcDiagnostic.phase, 'request');
    assert.ok(error.rpcDiagnostic.elapsedMs >= 0);
    assert.deepEqual(error.rpcDiagnostic.causeCodes, [code]);
    assert.equal(calls, code === 'ENOTFOUND' ? 1 : 2);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /private-password|Authorization|nonce|digest/);
  });
}
test('actual status request is distinguished from preceding identity request', async () => {
  const calls = [];
  const client = new ShellyClient(config, async (url, options) => {
    calls.push(frame(options).method);
    if (frame(options).method === 'Shelly.GetDeviceInfo') return identity(options);
    throw new DOMException('private detail', 'TimeoutError');
  });
  const error = await failure(client, 'Cover.GetStatus', { id: 1 });
  assert.equal(error.code, 'SHELLY_TIMEOUT');
  assert.equal(error.rpcDiagnostic.method, 'Cover.GetStatus');
  assert.equal(error.rpcDiagnostic.channel, 1);
  assert.equal(error.rpcDiagnostic.timeoutMs, 8000);
  assert.deepEqual(calls, ['Shelly.GetDeviceInfo','Cover.GetStatus','Shelly.GetDeviceInfo','Cover.GetStatus']);
  assert.equal(error.rpcDiagnostic.readAttempt, 2);
});
test('truncated body and invalid JSON retain HTTP status and body phase', async () => {
  for (const error of [Object.assign(new Error('secret socket info'), { code: 'ECONNRESET' }), new SyntaxError('secret body')]) {
    const client = new ShellyClient(config, async () => ({ status: 200, ok: true, json: async () => { throw error; } }));
    const found = await failure(client, 'Shelly.GetStatus', {});
    assert.equal(found.rpcDiagnostic.phase, 'response-body');
    assert.equal(found.rpcDiagnostic.httpStatus, 200);
    assert.equal(found.rpcDiagnostic.category, error.name === 'SyntaxError' ? 'invalid-response' : 'network');
    assert.doesNotMatch(found.message + JSON.stringify(found), /secret/);
  }
});
test('abort signal timeout during body parsing is identified as timeout', () => {
  const error = diagnosedError(new DOMException('aborted','AbortError'), { phase: 'response-body' },
    { aborted: true, reason: new DOMException('deadline','TimeoutError') });
  assert.equal(error.code, 'SHELLY_TIMEOUT');
  assert.equal(error.rpcDiagnostic.timeoutSource, 'request-deadline');
});
test('HTTP and RPC rejections retain their separate diagnostics and are not retried', async () => {
  for (const mode of ['http','rpc']) {
    let calls = 0;
    const client = new ShellyClient(config, async (url, options) => {
      calls++;
      return mode === 'http' ? new Response('', { status: 503 }) :
        Response.json({ id: frame(options).id, error: { code: -109, message: 'shutting down' } });
    });
    const error = await failure(client, 'Shelly.GetStatus', {});
    assert.equal(error.rpcDiagnostic.category, mode);
    if (mode === 'http') assert.equal(error.rpcDiagnostic.httpStatus, 503);
    else assert.equal(error.rpcDiagnostic.rpcCode, -109);
    assert.equal(calls, 1);
  }
});
test('Digest retry is unchanged and diagnostics identify the second HTTP attempt', async () => {
  let calls = 0;
  const client = new ShellyClient(config, async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 401, headers: {
      'WWW-Authenticate': 'Digest realm="secret-realm", nonce="secret-nonce", algorithm=SHA-256, qop="auth"',
    } });
    throw Object.assign(new Error('private-password'), { code: 'ECONNRESET' });
  });
  const error = await failure({ call: (...args) => client.request(...args) }, 'Shelly.GetStatus', {});
  assert.equal(calls, 2); assert.equal(error.rpcDiagnostic.attempt, 2);
  assert.doesNotMatch(JSON.stringify(error), /secret-realm|secret-nonce|private-password/);
});
test('unsupported auth and invalid response shape get clear diagnostics', async () => {
  for (const mode of ['auth','shape']) {
    const client = new ShellyClient(config, async () => mode === 'auth' ?
      new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Basic secret' } }) : Response.json(null));
    const error = await failure(client, 'Shelly.GetStatus', {});
    assert.equal(error.rpcDiagnostic.category, mode === 'auth' ? 'authentication' : 'invalid-response');
  }
});
test('cyclic AggregateError causes are bounded; elapsed duration does not change log key', () => {
  const child = Object.assign(new Error('secret'), { code: 'ECONNREFUSED' });
  const cause = new AggregateError([child,child], 'secret');cause.cause = cause;
  const first = diagnosedError(cause, { method: 'Shelly.GetStatus', elapsedMs: 10, attempt: 1 });
  const second = diagnosedError(cause, { method: 'Shelly.GetStatus', elapsedMs: 5000, attempt: 2 });
  assert.deepEqual(first.rpcDiagnostic.causeCodes, ['ECONNREFUSED']);
  assert.equal(diagnosticKey(first), diagnosticKey(second));
});


test('transport timeout is distinguished from configured request deadline', () => {
  const error = diagnosedError(Object.assign(new Error('private'), { code: 'ETIMEDOUT' }),
    { phase: 'request', timeoutMs: 8000 }, { aborted: false });
  assert.equal(error.rpcDiagnostic.category, 'timeout');
  assert.equal(error.rpcDiagnostic.timeoutSource, 'transport');
});
