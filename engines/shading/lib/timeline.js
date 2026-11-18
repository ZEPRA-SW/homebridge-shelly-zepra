'use strict';
const { sunPosition, sunExposure, solarConfig } = require('./solar');
const { periods } = require('./solar-schedule');

function dateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
function dayBounds(key, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Ungültiges Datum.');
  const base = Date.parse(key + 'T00:00:00Z');
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== key) throw new Error('Ungültiges Datum.');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const localKey = stamp => {
    const parts = formatter.formatToParts(new Date(stamp));
    const get = type => parts.find(p => p.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  };
  const boundary = target => {
    let low = Math.floor((base - 16 * 3600000) / 60000);
    let high = Math.ceil((base + 40 * 3600000) / 60000);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (localKey(mid * 60000) < target) low = mid + 1;
      else high = mid;
    }
    return low * 60000;
  };
  const nextKey = new Date(base + 86400000).toISOString().slice(0, 10);
  const start = boundary(key), end = boundary(nextKey);
  if (end <= start) throw new Error('Dieses Datum existiert in der gewählten Zeitzone nicht.');
  return { start, end };
}
function dailyPeriods(config, device, key, timeZone = 'Europe/Berlin') {
  // Display the geometric period even when this device's automation is disabled.
  const cfg = solarConfig(config, { ...device, sunAutomation: { ...device.sunAutomation, enabled: true } });
  const bounds = dayBounds(key, timeZone);
  const intervals = periods(cfg, bounds.start, bounds.end, sunPosition, sunExposure)
    .map(p => ({ start: Math.max(bounds.start, p.start), end: Math.min(bounds.end, p.end) }));
  return { ...bounds, intervals, timeZone, date: key, totalMinutes: intervals.reduce((sum, p) => sum + (p.end - p.start) / 60000, 0) };
}
module.exports = { dateKey, dayBounds, dailyPeriods };
