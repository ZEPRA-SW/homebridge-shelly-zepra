'use strict';
// Shared geometric boundaries for the controller and daily timeline. One-minute
// sampling matches the existing solar evaluation cadence; offsets are exact seconds.
const cache = new Map();
function periods(cfg, from, to, sunPosition, sunExposure) {
  const startOffset = (cfg.startOffsetSeconds ?? cfg.delaySeconds ?? 0) * 1000;
  const endOffset = (cfg.endOffsetSeconds ?? cfg.delaySeconds ?? 0) * 1000;
  const buffer = Math.max(Math.abs(startOffset), Math.abs(endOffset)) + 120000;
  const begin = Math.floor((from - buffer - 86400000) / 60000) * 60000;
  const finish = Math.ceil((to + buffer) / 60000) * 60000;
  let active = false, opened = null;
  const raw = [];
  for (let stamp = begin; stamp <= finish; stamp += 60000) {
    const next = sunExposure(sunPosition(new Date(stamp), cfg.latitude, cfg.longitude), cfg, active);
    if (next && !active) opened = stamp;
    if (!next && active) { raw.push({ start: opened, end: stamp }); opened = null; }
    active = next;
  }
  if (opened !== null) raw.push({ start: opened, end: finish });
  const shifted = raw.map(p => ({ start: p.start + startOffset, end: p.end + endOffset,
    rawStart: p.start, rawEnd: p.end })).filter(p => p.end > p.start && p.end > from && p.start < to);
  const merged = [];
  for (const p of shifted) {
    const previous = merged.at(-1);
    if (previous && p.start <= previous.end) { previous.end = Math.max(previous.end, p.end); previous.rawEnd = p.rawEnd; }
    else merged.push({ ...p });
  }
  return merged;
}
function windowAt(cfg, stamp, sunPosition, sunExposure) {
  const day = Math.floor(stamp / 86400000) * 86400000;
  const key = JSON.stringify([day, cfg.latitude, cfg.longitude, cfg.orientation,
    cfg.minElevation, cfg.leftAngle ?? cfg.halfAngle, cfg.rightAngle ?? cfg.halfAngle,
    cfg.startOffsetSeconds, cfg.endOffsetSeconds, cfg.delaySeconds]);
  if (!cache.has(key)) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, periods(cfg, day, day + 86400000, sunPosition, sunExposure));
  }
  const intervals = cache.get(key);
  const current = intervals.find(p => stamp >= p.start && stamp < p.end);
  return { active: !!current, current, next: intervals.find(p => p.start > stamp), intervals };
}
module.exports = { periods, windowAt };
