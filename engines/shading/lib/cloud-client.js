'use strict';
// Shelly Cloud Control API v2. No URLs, keys or raw response bodies enter errors.
const CLOUD_ERRORS = new Set(['DEVICE_FAILED_COMMAND', 'DEVICE_OFFLINE', 'DEVICE_INVALID_MODE',
  'DEVICE_INVALID_CHANNEL', 'BAD_REQUEST', 'INSTANCE_NOT_FOUND', 'DEVICE_NOT_FOUND',
  'UNEXPECTED_SUBSERVICE_ERROR', 'DEVICE_UNSUPPORTED_COMMAND', 'TOO_MANY_REQUESTS',
  'RATE_LIMIT_EXCEEDED', 'INVALID_AUTH_KEY', 'UNAUTHORIZED', 'FORBIDDEN']);
function retryDelay(header, now = Date.now()) {
  const seconds = typeof header === 'string' && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN;
  const duration = Number.isFinite(seconds) ? seconds : Date.parse(header) - now;
  return Math.min(86400000, Math.max(5000, Number.isFinite(duration) ? duration : 30000));
}
function cooldownError() {
  return Object.assign(cloudFailure('Shelly-Cloud: Abfragepause nach Anfragebegrenzung.', 'SHELLY_CLOUD_RATE_LIMIT'),
    { rpcDiagnostic: { operation: 'Cloud.Queue', category: 'cloud', httpStatus: 429, phase: 'cooldown' } });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
class CloudQueue {
  constructor({ clock = () => Date.now(), sleep = wait } = {}) {
    this.clock = clock; this.sleep = sleep; this.nextAt = 0; this.cooldownUntil = 0; this.tail = Promise.resolve();
  }
  defer(ms) { this.cooldownUntil = Math.max(this.cooldownUntil, this.clock() + ms); }
  run(work) {
    const job = this.tail.then(async () => {
      if (this.clock() < this.cooldownUntil) throw cooldownError();
      const delay = this.nextAt - this.clock();
      if (delay > 0) await this.sleep(delay);
      if (this.clock() < this.cooldownUntil) throw cooldownError();
      this.nextAt = this.clock() + 2000;
      return work();
    });
    this.tail = job.catch(() => {});
    return job;
  }
}
const queue = new CloudQueue();
function cloudFailure(message, code = 'SHELLY_CLOUD_ERROR') {
  return Object.assign(new Error(message), { code });
}
function cloudHost(value) {
  let url;
  try { url = new URL(value?.includes('://') ? value : 'https://' + value); }
  catch { throw cloudFailure('Ungültige Shelly-Cloud-Serveradresse.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.shelly\.cloud$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw cloudFailure('Ungültige Shelly-Cloud-Serveradresse.');
  }
  return url.origin;
}
class ShellyCloudClient {
  constructor(config, fetcher = fetch, options = {}) {
    this.server = cloudHost(config.cloudServer);
    if (typeof config.cloudKey !== 'string' || !config.cloudKey.trim()) throw cloudFailure('Shelly-Cloudschlüssel fehlt.');
    if (typeof config.cloudDeviceId !== 'string' || !/^[a-f0-9]{6,16}$/i.test(config.cloudDeviceId.trim())) {
      throw cloudFailure('Ungültige Shelly-Cloud-Geräte-ID.');
    }
    this.key = config.cloudKey.trim(); this.deviceId = config.cloudDeviceId.trim().toLowerCase();
    this.fetcher = fetcher; this.queue = options.queue ?? require('../../../lib/cloud-queue').forAccount(this.server, this.key);
    this.clock = options.clock ?? (() => Date.now()); this.sleep = options.sleep ?? wait;
    this.tail = Promise.resolve(); this.snapshot = null; this.stopped = false;
    this.separateSlatCommands = true;
  }
  async request(path, body, read = false, allowed) {
    const group = path === '/v2/devices/api/set/groups';
    const operation = read ? 'Cloud.GetDeviceState' : group ? 'Cloud.SetGroups' : 'Cloud.SetCover';
    const channel = group ? Number(body.cover?.ids?.[0]?.split('_').at(-1)) : body.channel;
    for (let attempt = 0; attempt < (read ? 2 : 1); attempt++) {
      try {
        return await this.queue.run(async () => {
          if (allowed && !allowed()) throw cloudFailure('Fahrbefehl verworfen.', 'SHELLY_CLOUD_CANCELLED');
          if (this.stopped) throw cloudFailure('Cloud-Verbindung beendet.', 'SHELLY_CLOUD_STOPPED');
          const url = new URL(path, this.server); url.searchParams.set('auth_key', this.key);
          const signal = AbortSignal.timeout(8000);
          let response;
          try {
            response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal,
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) {
              // Do not copy arbitrary response messages: they may echo auth_key/URLs.
              const pauseMs = response.status === 429 ? retryDelay(response.headers.get('retry-after'), this.clock()) : undefined;
              if (pauseMs !== undefined) this.queue.defer?.(pauseMs);
              let code;
              try {
                const body = await response.text();
                if (body.length <= 16384) {
                  const data = JSON.parse(body);
                  if (CLOUD_ERRORS.has(data?.error)) code = data.error;
                }
              } catch { /* Preserve HTTP status even if the error body is unreadable. */ }
              const error = cloudFailure('Shelly-Cloud: HTTP-Fehler ' + response.status +
                (code ? ' (' + code + ')' : '') + '.', 'SHELLY_CLOUD_HTTP');
              error.rpcDiagnostic = { operation,
                category: 'cloud', httpStatus: response.status,
                ...(Number.isInteger(channel) && channel >= 0 ? { channel } : {}),
                ...(code ? { cloudError: code } : {}), ...(pauseMs !== undefined ? { retryAfterMs: pauseMs } : {}) };
              throw error;
            }
            if (!read && !group) { await response.arrayBuffer(); return {}; }
            let data;
            try {
              if (group) {
                const text = await response.text();
                if (text.length > 16384) throw new Error('oversized response');
                data = text.trim() ? JSON.parse(text) : {};
              } else data = await response.json();
            }
            catch (error) {
              if (signal.aborted) throw error;
              throw cloudFailure('Ungültige Shelly-Cloud-Antwort.', 'SHELLY_CLOUD_INVALID');
            }
            if (group) {
              if (!data || typeof data !== 'object' || Array.isArray(data) ||
                  (Object.hasOwn(data, 'failedCommands') && (!data.failedCommands ||
                    typeof data.failedCommands !== 'object' || Array.isArray(data.failedCommands)))) {
                throw cloudFailure('Ungültige Shelly-Cloud-Antwort.', 'SHELLY_CLOUD_INVALID');
              }
              const failed = Object.values(data.failedCommands ?? {});
              if (data.error || failed.length) {
                const codes = [...new Set([data.error, ...failed].filter(code => CLOUD_ERRORS.has(code)))];
                const error = cloudFailure('Shelly-Cloud: Gruppenbefehl fehlgeschlagen.' +
                  (codes.length ? ' ' + codes.join(', ') : ''), 'SHELLY_CLOUD_GROUP_FAILED');
                error.rpcDiagnostic = { operation, category: 'cloud', httpStatus: response.status,
                  ...(Number.isInteger(channel) && channel >= 0 ? { channel } : {}), cloudErrors: codes };
                throw error;
              }
            }
            return data;
          } catch (error) {
            if (error.code?.startsWith('SHELLY_CLOUD_')) throw error;
            throw cloudFailure(signal.aborted || error.name === 'TimeoutError'
              ? 'Shelly-Cloud: Zeitlimit überschritten.' : 'Shelly-Cloud: Verbindungsfehler.', 'SHELLY_CLOUD_TRANSPORT');
          }
        }, { allowed, kind: read ? 'read' : 'write', coalesceKey: read ? this.deviceId + ':state' : undefined,
          priority: body.position === 'stop' ? 100 : body.position === 'open' ? 80 : read ? 0 : 10 });
      } catch (error) {
        if (!read || attempt || error.code !== 'SHELLY_CLOUD_TRANSPORT') throw error;
        await this.sleep(500);
      }
    }
  }
  stop() { this.stopped = true; this.queue.wake?.(); }
  cancelQueued() { this.queue.wake?.(); }
  async state(fresh = false) {
    if (!fresh && this.snapshot && this.clock() - this.snapshot.at < 2000) return this.snapshot.value;
    const response = await this.request('/v2/devices/api/get',
      { ids: [this.deviceId], select: ['status', 'settings'] }, true);
    if (!Array.isArray(response) || response.length !== 1 ||
        typeof response[0]?.id !== 'string' || response[0].id.toLowerCase() !== this.deviceId) {
      throw cloudFailure('Shelly-Cloud-Geräte-ID stimmt nicht überein.', 'SHELLY_CLOUD_ID_MISMATCH');
    }
    const value = response[0];
    if (value.online !== 1) throw cloudFailure('Shelly-Cloud: Gerät offline.', 'SHELLY_CLOUD_OFFLINE');
    if (!value.status || !value.settings) throw cloudFailure('Ungültige Shelly-Cloud-Antwort.', 'SHELLY_CLOUD_INVALID');
    this.snapshot = { value, at: this.clock() };
    return value;
  }
  call(method, params = {}, allowed) {
    const job = this.tail.then(async () => {
      if (!['Cover.GetConfig', 'Cover.GetStatus', 'Cover.GoToPosition', 'Cover.Open', 'Cover.Close', 'Cover.Stop'].includes(method)) {
        throw cloudFailure('Dieser Befehl ist über Shelly Cloud nicht verfügbar.');
      }
      if (!Number.isInteger(params.id) || params.id < 0) throw cloudFailure('Ungültiger Cloud-Cover-Kanal.');
      if (allowed && !allowed()) throw cloudFailure('Fahrbefehl verworfen.', 'SHELLY_CLOUD_CANCELLED');
      const read = method === 'Cover.GetConfig' || method === 'Cover.GetStatus';
      const state = await this.state(!read);
      const component = 'cover:' + params.id;
      if (!state.status[component] || !state.settings[component]) throw cloudFailure('Cloud-Cover-Kanal nicht verfügbar.');
      if (read) {
        const value = structuredClone(method === 'Cover.GetConfig' ? state.settings[component] : state.status[component]);
        // Cloud commands cannot carry our local RPC tag. Do not mislabel our own cloud
        // movements as external app control merely because the device reports source=cloud.
        if (method === 'Cover.GetStatus') { delete value.source; delete value.tag; }
        return value;
      }
      if (allowed && !allowed()) throw cloudFailure('Fahrbefehl verworfen.');
      const command = { id: this.deviceId, channel: params.id };
      if (method === 'Cover.GoToPosition') {
        for (const field of ['pos', 'slat_pos']) if (params[field] !== undefined &&
          (typeof params[field] !== 'number' || !Number.isFinite(params[field]) || params[field] < 0 || params[field] > 100)) {
          throw cloudFailure('Ungültiger Positionswert.');
        }
        if (params.pos === undefined && params.slat_pos === undefined) throw cloudFailure('Ungültiger Fahrbefehl.');
        if (params.pos !== undefined) command.position = params.pos;
        if (params.slat_pos !== undefined) command.slatPosition = params.slat_pos;
      } else command.position = { 'Cover.Open': 'open', 'Cover.Close': 'close', 'Cover.Stop': 'stop' }[method];
      this.snapshot = null;
      if (command.slatPosition !== undefined) {
        const { id, channel, ...parameters } = command;
        return this.request('/v2/devices/api/set/groups', {
          cover: { ids: [id + '_' + channel], command: parameters },
        }, false, allowed);
      }
      return this.request('/v2/devices/api/set/cover', command, false, allowed);
    });
    this.tail = job.catch(() => {});
    return job;
  }
}
module.exports = { ShellyCloudClient, CloudQueue, cloudHost, retryDelay };
