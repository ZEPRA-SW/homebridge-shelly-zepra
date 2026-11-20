'use strict';
const { createHash, randomBytes } = require('node:crypto');
const { diagnosedError, rpcFailure } = require('./rpc-diagnostics');
const RETRYABLE_READS = new Set(['Shelly.GetDeviceInfo', 'Shelly.GetStatus', 'Cover.GetConfig', 'Cover.GetStatus']);
const TRANSIENT_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED', 'ENETDOWN', 'EHOSTDOWN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const sha = value => createHash('sha256').update(value).digest('hex');

class ShellyClient {
  constructor(config, fetcher = fetch) {
    const url = new URL(config.host.includes('://') ? config.host : 'http://' + config.host);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new Error('Host muss eine HTTP(S)-Adresse ohne Zugangsdaten oder Pfad sein.');
    }
    this.expectedDeviceId = typeof config.shellyDeviceId === 'string' ? config.shellyDeviceId.trim().toLowerCase() : '';
    if (!this.expectedDeviceId) throw new Error('Die echte Shelly-Geräte-ID ist eine Pflichtangabe.');
    if (!/^(?:[a-f0-9]{12}|(?:[a-f0-9]{2}:){5}[a-f0-9]{2}|shelly[a-z0-9-]+-[a-f0-9]{12})$/.test(this.expectedDeviceId)) {
      throw new Error('Shelly-Geräte-ID als kurze Kennung/MAC oder vollständige Shelly-ID eingeben.');
    }
    this.url = new URL('/rpc', url);
    this.password = config.password;
    this.fetcher = fetcher;
    this.sequence = 0;
    this.challenge = null;
    this.count = 0;
    this.tail = Promise.resolve();
  }

  call(method, params = {}, allowed) {
    const execute = async () => {
      if (method.startsWith('Cover.') || method === 'Shelly.Reboot') {
        const info = await this.request('Shelly.GetDeviceInfo', {}, { operation: method, channel: params.id });
        this.verifyIdentity(info);
      }
      if (allowed && !allowed()) {
        const error = new Error(method === 'Shelly.Reboot' ? 'Neustart verschoben.' : 'Fahrbefehl verworfen.');
        error.code = method === 'Shelly.Reboot' ? 'REBOOT_DEFERRED' : 'COMMAND_CANCELLED';
        throw error;
      }
      return this.request(method, params, { operation: method, channel: params.id });
    };
    const job = this.tail.then(async () => {
      for (let readAttempt = 1; readAttempt <= 2; readAttempt++) {
        try { return await execute(); }
        catch (error) {
          const diagnostic = error.rpcDiagnostic;
          const transient = diagnostic?.category === 'timeout' ||
            (diagnostic?.category === 'network' && diagnostic.causeCodes?.length > 0 &&
              diagnostic.causeCodes.every(code => TRANSIENT_CODES.has(code)));
          if (!RETRYABLE_READS.has(method) || !transient) throw error;
          if (readAttempt === 2) {
            diagnostic.readAttempt = readAttempt;
            throw error;
          }
          // Retry only reads, inside the existing queue. Recheck identity on the retry.
          // Mutations (including their identity preflight) are never replayed.
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }

  verifyIdentity(info) {
    const expected = this.expectedDeviceId.replace(/:/g, '');
    const actualMac = typeof info?.mac === 'string' ? info.mac.replace(/:/g, '').toLowerCase() : '';
    const actualId = typeof info?.id === 'string' ? info.id.toLowerCase() : '';
    if (expected !== actualId && expected !== actualMac) {
      const error = new Error('Shelly-Ger\u00e4te-ID stimmt an dieser IP-Adresse nicht \u00fcberein. Aufruf gesperrt.');
      error.code = 'SHELLY_ID_MISMATCH';
      error.expectedId = this.expectedDeviceId;
      error.actualId = actualId || actualMac || 'unknown';
      throw error;
    }
  }

  snapshotComponents(configured = []) {
    const job = this.tail.then(async () => {
      const info = await this.request('Shelly.GetDeviceInfo', {}, { operation: 'Shelly.GetComponents' });
      this.verifyIdentity(info);
      const components = [], keys = new Set();
      let total;
      for (let offset = 0; offset < 1000;) {
        const page = await this.request('Shelly.GetComponents', { offset, include: ['config', 'status'], dynamic_only: true });
        if (!Array.isArray(page?.components) || !Number.isInteger(page.total) || page.total < 0 || page.total > 1000 ||
            (total !== undefined && total !== page.total)) throw new Error('Ung\u00fcltige Komponentenliste.');
        total = page.total;
        for (const component of page.components) {
          if (!component || typeof component.key !== 'string' || keys.has(component.key)) throw new Error('Ung\u00fcltige Komponentenliste.');
          keys.add(component.key);components.push(component);
        }
        offset += page.components.length;
        if (offset === total) break;
        if (offset > total || !page.components.length) throw new Error('Unvollst\u00e4ndige Komponentenliste.');
      }
      for (const b of configured) if (b.buttonIndices?.length) {
        const device = components.find(c => c.key === b.deviceComponent);
        if (device) try { device.knownObjects = await this.request('BTHomeDevice.GetKnownObjects', { id: Number(b.deviceComponent.split(':')[1]) }); }
        catch { device.buttonError = true; }
      }
      return { info, gen: 2, status: {}, settings: {}, components };
    });
    this.tail = job.catch(() => {});
    return job;
  }

  authorization() {
    const c = this.challenge;
    if (!c) return undefined;
    if (!this.password) throw new Error('Shelly verlangt ein Passwort. Bitte konfigurieren.');
    const nc = (++this.count).toString(16).padStart(8, '0');
    const cnonce = randomBytes(12).toString('hex');
    const digest = sha(sha('admin:' + c.realm + ':' + this.password) + ':' +
      c.nonce + ':' + nc + ':' + cnonce + ':auth:' + sha('POST:/rpc'));
    const quote = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    return 'Digest username="admin", realm=' + quote(c.realm) + ', nonce=' +
      quote(c.nonce) + ', uri="/rpc", algorithm=SHA-256, response="' + digest +
      '", qop=auth, nc=' + nc + ', cnonce=' + quote(cnonce) +
      (c.opaque ? ', opaque=' + quote(c.opaque) : '');
  }

  async request(method, params, origin = {}) {
    const id = ++this.sequence;
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = performance.now();
      const signal = AbortSignal.timeout(8000);
      let phase = 'authentication', httpStatus;
      try {
        const headers = { 'Content-Type': 'application/json' };
        let auth;
        try { auth = this.authorization(); }
        catch (error) { throw rpcFailure(error.message, 'authentication', 'SHELLY_AUTH_ERROR'); }
        if (auth) headers.Authorization = auth;
        phase = 'request';
        const response = await this.fetcher(this.url, {
          method: 'POST', headers, body: JSON.stringify({ id, method, params }),
          signal, redirect: 'error',
        });
        httpStatus = response.status;
        if (response.status === 401 && attempt === 0) {
          phase = 'authentication';
          const header = response.headers.get('www-authenticate') || '';
          const fields = {};
          for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) fields[m[1]] = m[2] ?? m[3];
          if (!/^Digest /i.test(header) || !fields.realm || !fields.nonce ||
              fields.algorithm?.toUpperCase() !== 'SHA-256' ||
              !fields.qop?.split(',').map(x => x.trim()).includes('auth')) {
            throw rpcFailure('Nicht unterstützte Shelly-Authentifizierung.', 'authentication', 'SHELLY_AUTH_ERROR');
          }
          this.challenge = fields;
          this.count = 0;
          phase = 'response-body';
          await response.arrayBuffer();
          continue;
        }
        phase = 'response-body';
        if (!response.ok) {
          await response.arrayBuffer();
          throw rpcFailure('Shelly HTTP-Fehler ' + response.status, 'http', 'SHELLY_HTTP_ERROR');
        }
        const data = await response.json();
        phase = 'response-validation';
        if (data?.error) throw rpcFailure('Shelly RPC-Fehler ' + data.error.code + ': ' + data.error.message,
          'rpc', 'SHELLY_RPC_ERROR', data.error.code);
        if (!data || data.id !== id || !Object.hasOwn(data, 'result')) {
          throw rpcFailure('Ungültige Shelly-Antwort.', 'invalid-response', 'SHELLY_INVALID_RESPONSE');
        }
        return data.result;
      } catch (error) {
        throw diagnosedError(error, {
          method, operation: origin.operation ?? method,
          ...(Number.isInteger(origin.channel) && origin.channel >= 0 ? { channel: origin.channel } : {}),
          host: this.url.host, elapsedMs: Math.max(0, Math.round(performance.now() - started)),
          timeoutMs: 8000, attempt: attempt + 1, phase,
          ...(httpStatus !== undefined ? { httpStatus } : {}),
        }, signal);
      }
    }
    throw new Error('Shelly-Authentifizierung fehlgeschlagen.');
  }
}
module.exports = { ShellyClient };
