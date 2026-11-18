'use strict';
const { dailyPeriods, dateKey } = require('./timeline');

function stateLabel(state, now, stale) {
  if (state?.identityMismatch && !stale) return { text: 'Geräte-ID stimmt nicht überein', kind: 'alarm' };
  if (!state || stale || state.online !== true) return { text: 'Keine aktuelle Verbindung', kind: 'offline' };
  if (state.windAlarm) return { text: 'Windalarm aktiv', kind: 'alarm' };
  if (state.recoveryFailed) return { text: 'Rückfahrt prüfen', kind: 'alarm' };
  if (state.recovering && state.recoveryPhase === 'stopping') return { text: 'Öffnungsfahrt wird angehalten', kind: 'pending' };
  if (state.recovering) return { text: 'Vorherige Stellung wird angefahren', kind: 'pending' };
  if (!state.automationConfigured) return { text: 'Automatik nicht eingerichtet', kind: 'muted' };
  if (!state.automationEnabled) return { text: 'Automatik ausgeschaltet', kind: 'muted' };
  if (state.manualPaused || state.pausedUntil > now) return { text: 'Manuell pausiert', kind: 'pending' };
  if (state.automationPending === 'start') return { text: 'Startverzögerung läuft', kind: 'pending' };
  if (state.automationPending === 'end') return { text: 'Ausschaltverzögerung läuft', kind: 'pending' };
  if (state.solarExposure === false) return { text: 'Außerhalb der Sonnenperiode', kind: 'ready' };
  if (state.shadingActive) return { text: 'Beschattung aktiv', kind: 'active' };
  return { text: 'Automatik bereit', kind: 'ready' };
}
class Overview {
  constructor() { this.cache = new Map(); }
  build(config, requestedDate, states = [], now = Date.now()) {
    if (!config || !Array.isArray(config.devices) || config.devices.length > 100) {
      throw new Error('Bitte zuerst eine gültige Geräteliste einrichten (maximal 100 Geräte).');
    }
    const timeZone = config.timeZone ?? 'Europe/Berlin';
    const date = requestedDate || dateKey(new Date(now), timeZone);
    const rows = config.devices.map(device => {
      const result = { id: String(device.id ?? ''), name: String(device.name ?? device.id ?? 'Gerät'),
        deviceType: device.deviceType ?? 'raffstore', orientation: device.sunAutomation?.orientation ?? 166,
        windConfigured: device.deviceType !== 'roller' && device.windProtection === true,
        shadePosition: device.sunAutomation?.shadePosition ?? 30 };
      try {
        // Cache only geometry and numerical settings, never hosts or credentials.
        const settings = { latitude: config.latitude, longitude: config.longitude };
        const safeDevice = { deviceType: device.deviceType, sunAutomation: { ...device.sunAutomation, endBehavior: 'keep' } };
        const key = JSON.stringify([settings, safeDevice, date, timeZone]);
        if (!this.cache.has(key)) {
          if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key, dailyPeriods(settings, safeDevice, date, timeZone));
        }
        result.period = this.cache.get(key);
      } catch (error) { result.periodError = error.message; }
      const state = states.find(value => value.id === device.id);
      const poll = Math.max(device.connection === 'cloud' ? 30 : 1, Number.isFinite(config.pollInterval) ? config.pollInterval : 3);
      const stale = !Number.isFinite(state?.updatedAt) || now - state.updatedAt > Math.max(45000, poll * 4000);
      result.state = state ? {
        lastControl: state.lastControl && ['apple-home','solar','wind','wind-recovery','external','unknown'].includes(state.lastControl.source)
          ? { source: state.lastControl.source, at: state.lastControl.at } : null,
        online: state.online === true && !stale, recoveryDiagnostic: state.recoveryDiagnostic,
        position: state.position, slatPosition: state.slatPosition,
        automationConfigured: state.automationConfigured === true,
        automationEnabled: state.automationEnabled === true, manualPaused: state.manualPaused === true,
        windAlarm: state.windAlarm === true, recovering: state.recovering === true,
        pendingUntil: state.automationPendingUntil, pendingAction: state.automationPending, pausedUntil: state.pausedUntil, updatedAt: state.updatedAt,
      } : null;
      result.status = stateLabel(state, now, stale);
      return result;
    });
    return { date, timeZone, now, today: dateKey(new Date(now), timeZone), rows };
  }
}
module.exports = { Overview, stateLabel };
