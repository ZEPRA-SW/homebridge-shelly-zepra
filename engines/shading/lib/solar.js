'use strict';
const { windowAt } = require('./solar-schedule');
const RAD = Math.PI / 180;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const wrap = degrees => ((degrees % 360) + 360) % 360;
const angleDifference = (a, b) => ((wrap(a - b) + 180) % 360) - 180;

// NOAA General Solar Position Calculations; UTC avoids host timezone / DST dependencies.
// Approximation, without atmospheric refraction. Azimuth: north=0, east=90.
function sunPosition(date, latitude, longitude) {
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Ungültiger Sonnenstandort.');
  const year = date.getUTCFullYear();
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const day = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / days * (day - 1 + (hour - 12) / 24);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const solarMinutes = ((hour * 60 + equation + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const lat = latitude * RAD;
  const elevation = Math.asin(clamp(Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle), -1, 1)) / RAD;
  const azimuth = wrap(Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat)) / RAD + 180);
  return { elevation, azimuth };
}

// Ideal flat, parallel slats. Choose the most open angle whose projected width
// covers the vertical pitch. Width*sin(beta+profile)/cos(profile) >= pitch.
// Shelly: 0%=vertical closed, 100%=horizontal. Mechanical curvature needs calibration.
function slatTarget(sun, orientation, width, spacing, margin) {
  const difference = angleDifference(sun.azimuth, orientation) * RAD;
  const profile = Math.atan2(Math.tan(sun.elevation * RAD), Math.cos(difference));
  const beta = Math.asin(clamp(spacing / width * Math.cos(profile), 0, 1)) - profile;
  const closedAngle = clamp(beta / RAD + margin, 0, 90);
  return Math.round(100 * (1 - closedAngle / 90));
}

function sunExposure(sun, cfg, active) {
  const difference = angleDifference(sun.azimuth, cfg.orientation);
  const side = difference < 0 ? cfg.leftAngle ?? cfg.halfAngle : cfg.rightAngle ?? cfg.halfAngle;
  return active
    ? sun.elevation >= Math.max(0.5, cfg.minElevation - 2) && Math.abs(difference) < Math.min(89.5, side + 3)
    : sun.elevation >= cfg.minElevation && Math.abs(difference) < side;
}

function number(value, fallback, minimum, maximum, label) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(label + ' muss zwischen ' + minimum + ' und ' + maximum + ' liegen.');
  }
  return result;
}
function solarConfig(global, device) {
  const input = device.sunAutomation;
  if (input?.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new Error('Sonnenautomatik einrichten muss ein Wahrheitswert sein.');
  }
  if (input?.enabled !== true) return null;
  if(!Number.isFinite(global.latitude)||!Number.isFinite(global.longitude))throw new Error('Für die Sonnenautomatik bitte die eigenen gültigen Geokoordinaten eingeben.');
  const cfg = {
    latitude: number(global.latitude, undefined, -89.9, 89.9, 'Breitengrad'),
    longitude: number(global.longitude, undefined, -180, 180, 'Längengrad'),
    orientation: number(input.orientation, 166, 0, 359.9, 'Ausrichtung'),
    minElevation: number(input.minElevation, 5, 0, 80, 'Minimale Sonnenhöhe'),
    halfAngle: number(input.halfAngle, 80, 5, 89, 'Seitlicher Sonnenbereich'),
    leftAngle: number(input.leftAngle, input.halfAngle ?? 80, 0, 89, 'Sonnenbereich links'),
    rightAngle: number(input.rightAngle, input.halfAngle ?? 80, 0, 89, 'Sonnenbereich rechts'),
    delaySeconds: number(input.delaySeconds, 120, 0, 1800, 'Verzögerung'),
    startOffsetSeconds: number(input.startOffsetMinutes, (input.delaySeconds ?? 120) / 60, -120, 120, 'Zeitverschiebung Beginn') * 60,
    endOffsetSeconds: number(input.endOffsetMinutes, (input.delaySeconds ?? 120) / 60, -120, 120, 'Zeitverschiebung Ende') * 60,
    scheduledOffsets: input.startOffsetMinutes !== undefined || input.endOffsetMinutes !== undefined,
    timeZone: global.timeZone ?? 'Europe/Berlin',
    minCommandSeconds: number(input.minCommandSeconds, 1200, 10, 3600, 'Mindest-Fahrintervall'),
    slatStep: number(input.slatStep, 3, 1, 20, 'Lamellen-Mindeständerung'),
    shadePosition: number(input.shadePosition, 30, 0, 100, 'Beschattungsposition'),
    slatWidth: number(input.slatWidth, 80, 1, 300, 'Lamellenbreite'),
    slatSpacing: number(input.slatSpacing, 70, 1, 300, 'Lamellenabstand'),
    slatMargin: number(input.slatMargin, 5, 0, 30, 'Lamellen-Winkelzugabe'),
    endBehavior: input.endBehavior ?? 'keep',
    endPosition: number(input.endPosition, 100, 0, 100, 'Endposition'),
    endSlatPosition: number(input.endSlatPosition, 100, 0, 100, 'Lamellen-Endposition'),
    kind: device.deviceType ?? 'raffstore',
  };
  if (!['keep', 'open', 'close', 'horizontal', 'custom'].includes(cfg.endBehavior)) throw new Error('Ungültiges Beschattungsende.');
  if (cfg.kind === 'roller' && cfg.endBehavior === 'horizontal') throw new Error('Lamellen horizontal gilt nur für Raffstores.');
  if (cfg.slatSpacing > cfg.slatWidth && cfg.kind === 'raffstore') throw new Error('Lamellenabstand darf die Lamellenbreite nicht übersteigen.');
  return cfg;
}

class SunAutomation {
  constructor(config, controller, saved = {}, persist = () => {}, clock = () => Date.now()) {
    this.config = config;
    this.controller = controller;
    this.persist = persist;
    this.clock = clock;
    this.enabled = saved.enabled ?? true;
    this.active = saved.active === true;
    this.earlyStart = saved.earlyStart === true;
    this.pausedUntil = 0;
    this.manualPaused = saved.manualPaused === true || (Number.isFinite(saved.pausedUntil) && saved.pausedUntil > clock());
    this.pauseDay = saved.pauseDay ?? (this.manualPaused ? this.localDay(new Date(clock())) : null);
    this.pausePeriodActive = saved.pausePeriodActive === true || saved.active === true;
    this.pauseEndSince = null;
    this.generation = 0;
    this.lastCommandAt = 0;
    this.lastTarget = null;
    this.candidate = null;
    this.pendingSince = 0;
    this.lastTick = -Infinity;
    this.lastObserved = null;
    this.externalFingerprint = null;
  }
  localDay(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.config.timeZone ?? 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  save() {
    const state = {
      enabled: this.enabled, active: this.active, earlyStart: this.earlyStart, pausedUntil: 0,
      manualPaused: this.manualPaused, pauseDay: this.pauseDay, pausePeriodActive: this.pausePeriodActive,
    };
    const serialized = JSON.stringify(state);
    if (serialized !== this.savedState) {
      this.savedState = serialized;
      this.persist(state);
    }
  }
  setEnabled(value) {
    this.enabled = !!value;
    this.forceEvaluation = this.enabled;
    this.earlyStart = false;
    this.generation++;
    this.active = false;
    this.candidate = null;
    this.lastTarget = null;
    this.lastTick = -Infinity;
    this.pausedUntil = 0;
    this.save();
  }
  resumeAfterWind() {
    this.pausedUntil = 0;
    this.lastObserved = null;
    this.externalFingerprint = null;
    this.interrupt();
  }
  interrupt() {
    this.earlyStart = false;
    this.generation++;
    this.active = false;
    this.candidate = null;
    this.lastTarget = null;
    this.lastTick = -Infinity;
    this.save();
  }
  setPaused(value) {
    this.manualPaused = !!value;
    this.pauseDay = this.manualPaused ? this.localDay(new Date(this.clock())) : null;
    this.pausePeriodActive = this.manualPaused && (this.active || this.lastExposure === true || this.pausePeriodActive);
    this.pauseEndSince = null;
    this.generation++;
    this.active = false;
    this.candidate = null;
    this.lastTarget = null;
    this.lastTick = -Infinity;
    this.forceEvaluation = !this.manualPaused && this.enabled;
    this.save();
  }
  manual() {
    if (this.enabled) this.setPaused(true);
  }
  updatePausePeriod(now, date) {
    if (!this.manualPaused) return;
    const sun = sunPosition(date, this.config.latitude, this.config.longitude);
    const schedule = this.config.scheduledOffsets ? windowAt(this.config, date.getTime(), sunPosition, sunExposure) : null;
    const exposed = schedule ? schedule.active : sunExposure(sun, this.config, this.pausePeriodActive);
    this.lastExposure = exposed;
    if (exposed) {
      this.pausePeriodActive = true;
      this.pauseEndSince = null;
    } else {
      if (this.pauseEndSince === null) this.pauseEndSince = now;
      const waitingForStart = schedule?.next && date.getTime() < schedule.next.start &&
        this.localDay(new Date(schedule.next.start)) === this.pauseDay;
      if (schedule ? this.pausePeriodActive && !waitingForStart : now - this.pauseEndSince >= this.config.endOffsetSeconds * 1000) this.setPaused(false);
    }
    // A restart after the previous period must never keep yesterday's pause.
    if (this.manualPaused && this.pauseDay !== this.localDay(date) &&
        (!schedule?.current || this.localDay(new Date(schedule.current.start)) !== this.pauseDay)) this.setPaused(false);
  }
  observe(status) {
    const moving = status.state === 'opening' || status.state === 'closing';
    const fingerprint = [status.source, status.tag, status.move_started_at, status.target_pos].join(':');
    const ours = status.tag === 'hb-raffstore';
    const external = moving && status.source && !ours &&
      !['init', 'limit_switch'].includes(status.source);
    const unexpected = this.lastTarget && this.lastObserved && (
      Math.abs(status.current_pos - (this.lastTarget.pos ?? this.lastObserved.current_pos)) > 3 ||
      (this.config.kind === 'raffstore' &&
        Math.abs(status.slat_pos - (this.lastTarget.slat_pos ?? this.lastObserved.slat_pos)) > 3));
    const drift = unexpected && this.lastObserved && !ours && !moving && !this.controller.submitting && this.lastTarget &&
      !(this.controller.client?.separateSlatCommands && (this.controller.heightTarget || this.controller.waitingSlat || this.controller.waitingMove)) &&
      this.lastObserved.state !== 'opening' && this.lastObserved.state !== 'closing' &&
      (Math.abs(status.current_pos - this.lastObserved.current_pos) > 2 ||
        (this.config.kind === 'raffstore' && Math.abs(status.slat_pos - this.lastObserved.slat_pos) > 2));
    if (this.enabled && ((external && fingerprint !== this.externalFingerprint) || drift)) {
      this.externalFingerprint = fingerprint;
      this.manual();
    }
    this.lastObserved = { ...status };
  }
  async tick(status, date = new Date(this.clock())) {
    const now = this.clock();
    if (this.controller.disposed) return;
    this.updatePausePeriod(now, date);
    if (now < this.lastTick) {
      this.lastTick = -Infinity;
      this.candidate = null;
    }
    if (!this.enabled || this.manualPaused || this.controller.disposed || this.controller.windAlarm || this.controller.recovering || this.controller.recoveryFailed || now < this.pausedUntil || (!this.forceEvaluation && now - this.lastTick < 60000)) return;
    const force = this.forceEvaluation === true;
    this.forceEvaluation = false;
    this.lastTick = now;
    const cfg = this.config;
    const sun = sunPosition(date, cfg.latitude, cfg.longitude);
    const schedule = cfg.scheduledOffsets ? windowAt(cfg, date.getTime(), sunPosition, sunExposure) : null;
    let illuminated = schedule ? schedule.active : sunExposure(sun, cfg, this.active);
    // Explicit Auto/resume still bypasses a positive start delay, but respects
    // an advanced end and all wind/recovery/manual-pause guards above.
    if (schedule && (force || this.earlyStart) && cfg.startOffsetSeconds > 0 && !illuminated) {
      illuminated = windowAt({ ...cfg, startOffsetSeconds: 0 }, date.getTime(), sunPosition, sunExposure).active;
      this.earlyStart = illuminated;
    } else if (schedule) this.earlyStart = false;
    this.pendingSchedule = schedule && !illuminated && !this.active && schedule.next &&
      date.getTime() >= schedule.next.rawStart ? { action: 'start', until: schedule.next.start } :
      schedule?.current && date.getTime() >= schedule.current.rawEnd ? { action: 'end', until: schedule.current.end } : null;
    this.lastExposure = illuminated;
    if (schedule) this.candidate = null;
    else if (illuminated !== this.active) {
      if (this.candidate !== illuminated) {
        this.candidate = illuminated;
        this.pendingSince = now;
      }
      if (!force && now - this.pendingSince < (illuminated ? cfg.startOffsetSeconds : cfg.endOffsetSeconds) * 1000) return;
    } else this.candidate = null;
    if (['opening', 'closing', 'calibrating'].includes(status.state) || this.controller.motionBusy?.()) {
      this.forceEvaluation = force;
      return;
    }

    let target;
    if (illuminated) {
      target = cfg.kind === 'roller' ? { pos: cfg.shadePosition } : {
        pos: 0,
        slat_pos: sun.elevation <= 0 || Math.abs(angleDifference(sun.azimuth, cfg.orientation)) >= 90
          ? 0 : slatTarget(sun, cfg.orientation, cfg.slatWidth, cfg.slatSpacing, cfg.slatMargin),
      };
    } else if (this.active) {
      switch (cfg.endBehavior) {
        case 'open': target = cfg.kind === 'roller' ? { pos: 100 } : { pos: 100, slat_pos: 100 }; break;
        case 'close': target = cfg.kind === 'roller' ? { pos: 0 } : { pos: 0, slat_pos: 0 }; break;
        case 'horizontal': target = { slat_pos: 100 }; break;
        case 'custom': target = cfg.kind === 'roller' ? { pos: cfg.endPosition } :
          { pos: cfg.endPosition, slat_pos: cfg.endSlatPosition }; break;
        default:
          this.active = false;
          this.candidate = null;
          this.lastTarget = null;
          this.save();
          return;
      }
    } else return;

    const transition = illuminated !== this.active;
    const changed = Object.entries(target).some(([key, value]) =>
      Math.abs(value - (key === 'pos' ? status.current_pos : status.slat_pos)) >= (key === 'pos' ? 2 : cfg.slatStep));
    if (!changed) {
      this.active = illuminated;
      this.candidate = null;
      this.save();
      return;
    }
    if (!transition && now - this.lastCommandAt < cfg.minCommandSeconds * 1000) return;
    const generation = this.generation;
    const allowed = () => this.enabled && !this.manualPaused && this.generation === generation &&
      this.clock() >= this.pausedUntil && !this.controller.disposed && !this.controller.windAlarm && !this.controller.recovering && !this.controller.recoveryFailed;
    await this.controller.move(target, allowed, 'solar');
    if (!allowed()) return;
    this.lastTarget = target;
    this.lastCommandAt = now;
    this.active = illuminated;
    this.candidate = null;
    this.save();
  }
}
module.exports = { sunPosition, slatTarget, angleDifference, solarConfig, SunAutomation, sunExposure };
