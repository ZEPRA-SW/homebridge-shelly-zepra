'use strict';
const { validPercent } = require('./controller');
const isMoving = s => ['opening', 'closing', 'calibrating'].includes(s.state);
function validTarget(value) {
  return value && validPercent(value.pos) && validPercent(value.slat_pos);
}
function captureWindPosition(status, controller) {
  const pos = controller.heightTarget?.pos ??
    (validPercent(status?.target_pos) ? status.target_pos : status?.current_pos);
  const slat_pos = controller.waitingSlat?.value ?? controller.heightTarget?.slat_pos ?? status?.slat_pos;
  return validTarget({ pos, slat_pos }) ? { pos, slat_pos } : null;
}
class WindRecovery {
  constructor(controller, saved, persist = () => {}, completed = () => {}) {
    this.controller = controller;
    this.persist = persist;
    this.completed = completed;
    this.version = 0;
    this.state = saved && validTarget(saved.target) && Number.isFinite(saved.expiresAt) ? saved : null;
    this.issued = false;
    controller.recovering = !!this.state;
    controller.recoveryFailed = saved?.failed === true;
  }
  cancel() {
    if (!this.state && !this.controller.recoveryFailed) return;
    this.version++;
    this.state = null;
    this.issued = false;
    this.controller.recovering = false;
    this.mismatchSamples = 0;
    this.controller.recoveryFailed = false;
    this.controller.heightTarget = null;
    this.controller.clearDeferred();
    this.persist(null);
  }
  async start(target, { stopOpening = false } = {}) {
    this.cancel();
    if (!validTarget(target)) { this.completed(); return; }
    this.state = { target: { ...target }, expiresAt: this.controller.clock() + this.controller.waitTimeout };
    if (stopOpening) this.state.phase = 'stopping';
    this.stopIssued = false;
    this.controller.recovering = true;
    this.persist(this.state);
    if (stopOpening) {
      const status = await this.stopOpening();
      if (status) await this.tick(status);
    } else await this.attempt();
  }
  async stopOpening() {
    if (this.stopping) return this.stopping;
    const version = this.version;
    if (!this.state || this.controller.windAlarm || this.controller.disposed) return;
    const job = this.controller.stop('wind-recovery');
    this.stopping = job;
    try {
      const status = await job;
      if (this.state && version === this.version && !this.controller.windAlarm) {
        this.stopIssued = true;
        return status;
      }
    } finally { if (this.stopping === job) this.stopping = null; }
  }
  async attempt() {
    if (this.inFlight) return this.inFlight;
    const version = this.version;
    const allowed = () => !!this.state && version === this.version &&
      !this.controller.windAlarm && !this.controller.disposed;
    if (!allowed()) return;
    const job = (async () => {
      await this.controller.move(this.state.target, allowed, 'wind-recovery');
      if (allowed()) {
        this.issued = true;
        this.issuedAt = this.controller.clock();
      }
    })();
    this.inFlight = job;
    try { await job; }
    finally { if (this.inFlight === job) this.inFlight = null; }
  }
  fail(message, status) {
    const target = { ...this.state.target };
    const actual = {
      pos: status.current_pos, slat_pos: status.slat_pos,
      state: status.state, source: status.source ?? null, tag: status.tag ?? null,
    };
    this.cancel();
    this.controller.recoveryFailed = true;
    this.persist({ failed: true, target, actual });
    const error = new Error(message);
    error.recoveryDiagnostic = { target, actual };
    throw error;
  }
  async tick(status) {
    if (!this.state || this.controller.windAlarm || this.controller.disposed) return;
    if (this.controller.clock() >= this.state.expiresAt) {
      this.fail('Windalarm-Rückfahrt: Zeitlimit überschritten; Automatik bleibt bis zu einer erneuten Freigabe pausiert.', status);
    }
    if (this.state.phase === 'stopping') {
      if (this.stopping) return;
      if (!this.stopIssued) {
        const fresh = await this.stopOpening();
        if (fresh) await this.tick(fresh);
        return;
      }
      if (isMoving(status)) return;
      this.state.phase = 'restoring';
      this.state.expiresAt = this.controller.clock() + this.controller.waitTimeout;
      this.persist(this.state);
    }
    const target = this.state.target;
    const arrived = !isMoving(status) &&
      Math.abs(status.current_pos - target.pos) <= this.controller.tolerance &&
      Math.abs(status.slat_pos - target.slat_pos) <= this.controller.tolerance;
    if (arrived) {
      this.cancel();
      this.completed();
      return;
    }
    if (isMoving(status)) { this.mismatchSamples = 0; return; }
    if (!this.issued) await this.attempt();
    else if (!this.controller.heightTarget && Math.abs(status.current_pos - target.pos) > this.controller.tolerance) {
      this.mismatchSamples = (this.mismatchSamples || 0) + 1;
      if (this.mismatchSamples >= 3 && this.controller.clock() - this.issuedAt >= 10000) {
        this.fail('Windalarm-Rückfahrt: Zielstellung nicht erreicht; keine automatische Wiederholung.', status);
      }
    }
  }
}
module.exports = { WindRecovery, captureWindPosition, validTarget };
