'use strict';
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function validateReboot(config) {
  if (config === undefined) return;
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config.enabled !== undefined && typeof config.enabled !== 'boolean') ||
      (config.time !== undefined && config.time !== '' && (typeof config.time !== 'string' || !TIME.test(config.time))) ||
      (config.enabled === true && !TIME.test(config.time || ''))) {
    throw new Error('Neustartzeit muss im Format HH:MM angegeben werden.');
  }
}
function localTime(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = key => parts.find(p => p.type === key).value;
  return { day: get('year') + '-' + get('month') + '-' + get('day'), minute: Number(get('hour')) * 60 + Number(get('minute')) };
}
const physicalId = config => config.shellyDeviceId.toLowerCase().replace(/:/g, '').slice(-12);
class RebootSchedule {
  constructor(devices, { timeZone = 'Europe/Berlin', clock = () => Date.now(), log = () => {} } = {}) {
    this.devices = devices;
    this.timeZone = timeZone;
    this.clock = clock;
    this.log = log;
    this.previous = localTime(clock(), timeZone);
    this.first = true;
    this.notices = new Map();
    this.retryAt = new Map();
  }
  save(device, value) { device.rebootState = value; device.persistReboot(value); }
  notice(key, device, text) {
    if (this.notices.get(key) === text) return;
    this.notices.set(key, text);
    this.log(device.config.name, text);
  }
  blocked(group) {
    if (this.stopped || group.some(d => d.controller.disposed)) return 'Plugin wurde beendet.';
    if (group.some(d => d.controller.windAlarm)) return 'Windalarm aktiv.';
    if (group.some(d => d.controller.recovering || d.controller.recoveryFailed)) return 'Windalarm-Rückfahrt oder Rückfahrtsperre aktiv.';
    if (group.some(d => d.controller.submitting || d.controller.heightTarget || d.controller.waitingSlat ||
      Object.keys(d.controller.pending || {}).length)) return 'Fahrt oder Fahrbefehl ausstehend.';
    return null;
  }
  start() {
    for (const device of this.devices) if (device.config.dailyReboot?.enabled === true) {
      this.log(device.config.name, 'Täglicher Neustart geplant: ' + device.config.dailyReboot.time + ' (' + this.timeZone + ')');
    }
    this.timer = setTimeout(() => this.run(), 1000);
  }
  async run() {
    try { await this.tick(); }
    catch { /* Device failures are logged by tick; keep the schedule alive. */ }
    if (!this.stopped) this.timer = setTimeout(() => this.run(), 15000);
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  async tick() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const now = this.clock(), local = localTime(now, this.timeZone);
      const groups = new Map();
      for (const d of this.devices) {
        const key = physicalId(d.config);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
        if (d.config.dailyReboot?.enabled !== true) continue;
        const time = d.config.dailyReboot.time;
        const [hour, minute] = time.split(':').map(Number), target = hour * 60 + minute;
        const crossed = local.minute >= target && (this.previous.day !== local.day ||
          this.previous.minute < target || (this.first && local.minute === target));
        if (crossed && !d.rebootState?.pending && (!d.rebootState?.lastDay || d.rebootState.lastDay < local.day)) {
          this.save(d, { ...d.rebootState, pending: local.day });
          this.notice(key, d, 'Täglicher Neustart ist fällig.');
        }
      }
      this.previous = local;
      this.first = false;
      for (const [key, group] of groups) {
        const owner = group.find(d => d.config.dailyReboot?.enabled === true && d.rebootState?.pending);
        if (!owner || (this.retryAt.get(key) || 0) > now) continue;
        if (group.some(d => d.rebootState?.lastDay >= local.day)) {
          for (const d of group) this.save(d, { lastDay: local.day });
          continue;
        }
        const reason = this.blocked(group);
        if (reason) { this.notice(key, owner, 'Neustart verschoben: ' + reason); continue; }
        // Drain existing commands on every channel; later commands wait until this attempt ends.
        const tails = group.map(d => d.controller.tail);
        let release;
        const barrier = new Promise(resolve => { release = resolve; });
        group.forEach(d => { d.controller.rebootBarrier = barrier; });
        let attempted = false;
        try {
          await Promise.all(tails);
          let reason = this.blocked(group);
          if (reason) { this.notice(key, owner, 'Neustart verschoben: ' + reason); continue; }
          const status = await owner.client.call('Shelly.GetStatus');
          const covers = Object.entries(status || {}).filter(([name]) => /^cover:\d+$/.test(name));
          if (!covers.length || group.some(d => !status?.['cover:' + (d.config.coverId ?? 0)]) ||
              covers.some(([, s]) => !['stopped', 'open', 'closed'].includes(s?.state))) {
            this.notice(key, owner, 'Neustart verschoben: Gerät fährt oder Stillstand nicht bestätigt.');
            continue;
          }
          // The client checks identity, then rechecks this guard immediately before sending.
          await owner.client.call('Shelly.Reboot', { delay_ms: 1000 }, () => {
            if (this.blocked(group)) return false;
            const day = localTime(this.clock(), this.timeZone).day;
            for (const d of group) this.save(d, { lastDay: day });
            attempted = true; // Persist before sending: an ambiguous timeout must never create a reboot loop.
            return true;
          });
          this.notice(key, owner, 'Neustartbefehl bestätigt.');
        } catch (error) {
          if (error.code === 'REBOOT_DEFERRED') {
            this.notice(key, owner, 'Neustart verschoben: ' + (this.blocked(group) || 'Fahrt oder Fahrbefehl ausstehend.'));
          } else {
            this.retryAt.set(key, this.clock() + 60000);
            this.notice(key, owner, (attempted ? 'Neustartbefehl ohne Bestätigung; keine automatische Wiederholung: ' :
              'Neustart verschoben; erneute Prüfung in einer Minute: ') + error.message);
          }
        } finally {
          group.forEach(d => { d.controller.rebootBarrier = null; });
          release();
        }
      }
    } finally { this.running = false; }
  }
}
module.exports = { RebootSchedule, validateReboot, localTime };
