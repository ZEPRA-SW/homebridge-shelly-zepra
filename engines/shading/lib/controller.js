'use strict';
const validPercent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const toAngle = percent => Math.round(percent * 0.9 - 90);
const toPercent = angle => Math.round((angle + 90) / 0.9);
const moving = status => ['opening', 'closing', 'calibrating'].includes(status.state);

class CoverController {
  constructor(client, id = 0, onStatus = () => {}, debounceMs = 200, options = {}) {
    this.kind = options.kind ?? 'raffstore';
    this.tag = options.tag;
    this.client = client;
    this.id = id;
    this.onStatus = onStatus;
    this.onError = options.onError ?? (() => {});
    this.onCommand = options.onCommand ?? (() => {});
    this.clock = options.clock ?? (() => Date.now());
    this.waitTimeout = (options.positionWaitTimeout ?? 300) * 1000;
    this.tolerance = options.positionTolerance ?? 1;
    this.debounceMs = debounceMs;
    this.pending = {};
    this.waiters = [];
    this.tail = Promise.resolve();
    this.disposed = false;
    this.windAlarm = options.windAlarm === true && this.kind === 'raffstore';
    this.lastWindAttempt = -Infinity;
    this.commandGeneration = 0;
    this.heightTarget = null;
    this.waitingSlat = null;
    this.waitingMove = null; this.lastStatus = null;
  }
  enqueue(work) {
    const barrier = this.rebootBarrier;
    const result = this.tail.then(async () => { if (barrier) await barrier; return work(); });
    this.tail = result.catch(() => {});
    return result;
  }
  async read() {
    const snapshot = typeof this.client.readCover==='function'?await this.client.readCover(this.id):null;
    const config = snapshot?snapshot.config:await this.client.call('Cover.GetConfig', { id: this.id });
    if (this.kind === 'raffstore' && config?.slat?.enable !== true) throw new Error('Lamellensteuerung im Shelly aktivieren.');
    const status = snapshot?snapshot.status:await this.client.call('Cover.GetStatus', { id: this.id });
    if (status?.pos_control !== true || !validPercent(status.current_pos)) {
      throw new Error('Shelly kalibrieren und eine bekannte Behangposition herstellen.');
    }
    if (this.kind === 'raffstore' && !validPercent(status.slat_pos)) throw new Error('Shelly meldet keine gültige Lamellenposition.');
    if (status.errors?.length) throw new Error('Shelly meldet: ' + status.errors.join(', '));
    this.lastStatus = { ...status };
    this.onStatus(status);
    return status;
  }
  refresh() {
    return this.enqueue(async () => {
      let status;
      try { status = await this.read(); }
      catch (error) {
        if (this.windAlarm) await this.windOpen();
        throw error;
      }
      if (this.windAlarm) {
        if (status.state !== 'opening' && status.current_pos < 100 - this.tolerance) await this.windOpen();
        return status;
      }
      const interrupted = this.checkHeight(status);
      if (interrupted) this.waitingMove = null;
      if (this.waitingMove && !moving(status) && !this.heightTarget) {
        const queued = this.waitingMove; this.waitingMove = null;
        if (this.clock() < queued.expiresAt && queued.allowed() && !this.disposed) {
          await this.performMove(queued.target, queued.allowed, queued.origin);
        }
      } else await this.releaseSlat(status);
      return status;
    });
  }
  clearDeferred(error) {
    const hadPending = !!this.waitingSlat;
    this.waitingSlat = null;
    if (error && hadPending) this.onError(error);
  }
  checkHeight(status) {
    const height = this.heightTarget;
    if (!height) return;
    if (moving(status)) {
      height.seenMoving = true;
      if (validPercent(status.target_pos) && Math.abs(status.target_pos - height.pos) > this.tolerance) {
        this.heightTarget = null;
        this.clearDeferred(new Error('Fahrziel wurde extern geändert; wartende Lamellenstellung verworfen.'));
        return true;
      }
    } else if (Math.abs(status.current_pos - height.pos) <= this.tolerance) {
      this.heightTarget = null;
    } else if (height.seenMoving || this.clock() - height.startedAt >= 5000) {
      this.heightTarget = null;
      this.clearDeferred(new Error('Behang vor dem Sollwert angehalten; wartende Lamellenstellung verworfen.'));
      return true;
    }
  }
  async releaseSlat(status) {
    const waiting = this.waitingSlat;
    if (!waiting) return;
    if (!waiting.allowed() || this.disposed || this.windAlarm) { this.clearDeferred(); return; }
    if (this.clock() >= waiting.expiresAt) {
      this.clearDeferred(new Error('Zeitlimit beim Warten auf die Behangposition; Lamellenbefehl verworfen.'));
      return;
    }
    if (Object.keys(this.pending).length || moving(status)) return;
    if (validPercent(waiting.expectedPos) && Math.abs(status.current_pos - waiting.expectedPos) <= this.tolerance) {
      this.waitingSlat = null;
      if (this.client.separateSlatCommands === true && Math.abs(status.slat_pos - waiting.value) <= this.tolerance) return;
      await this.performMove({ slat_pos: waiting.value }, waiting.allowed, waiting.origin);
    } else if (!this.heightTarget) {
      this.clearDeferred(new Error('Behang-Sollwert nicht bestätigt; Lamellenbefehl verworfen.'));
    }
  }
  motionBusy() { return this.submitting || !!this.heightTarget || moving(this.lastStatus ?? {}); }
  bufferMove(target, allowed, origin) {
    this.waitingMove = { target: { ...this.waitingMove?.target, ...target }, allowed, origin,
      expiresAt: this.clock() + this.waitTimeout };
    this.clearDeferred();
  }
  set(field, value) {
    if (this.disposed) return Promise.reject(new Error('Plugin wurde beendet.'));
    if (this.windAlarm) return Promise.reject(new Error('Windalarm aktiv: Bedienung gesperrt.'));
    if (!['pos', 'slat_pos'].includes(field) || !validPercent(value) || (field === 'slat_pos' && this.kind === 'roller')) {
      return Promise.reject(new Error('Ungültiger Positionswert.'));
    }
    if (field === 'pos' && (this.submitting || moving(this.lastStatus ?? {}))) {
      this.bufferMove({ pos: Math.round(value) }, () => true, 'apple-home');
      return Promise.resolve();
    }
    if (field === 'slat_pos' && this.waitingMove) {
      this.waitingMove.target.slat_pos = Math.round(value);return Promise.resolve();
    }
    this.pending[field] = Math.round(value);
    clearTimeout(this.timer);
    const result = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    return result;
  }
  flush() {
    const pending = this.pending;
    const waiters = this.waiters;
    const generation = this.commandGeneration;
    this.pending = {};
    this.waiters = [];
    this.timer = undefined;
    return this.enqueue(async () => {
      if (this.disposed) throw new Error('Plugin wurde beendet.');
      if (generation !== this.commandGeneration) throw new Error('Fahrbefehl verworfen.');
      await this.performMove(pending, () => true, 'apple-home');
    }).then(
      () => { waiters.forEach(w => w.resolve()); },
      error => { waiters.forEach(w => w.reject(error)); },
    );
  }
  async performMove(target, allowed = () => true, origin = 'unknown') {
    if (this.disposed || !allowed()) return;
    if (this.windAlarm) throw new Error('Windalarm aktiv: Fahrbefehl gesperrt.');
    if (!Object.keys(target).length || Object.entries(target).some(([key, value]) =>
      !['pos', 'slat_pos'].includes(key) || !validPercent(value) ||
      (this.kind === 'roller' && key === 'slat_pos'))) throw new Error('Ungültiger Fahrbefehl.');
    const generation = this.commandGeneration;
    this.submitting = true;
    try {
      const status = await this.read();
      if (this.disposed || !allowed() || this.windAlarm || generation !== this.commandGeneration) return;
      const interrupted = this.checkHeight(status);
      if (target.pos !== undefined && (moving(status) || this.heightTarget)) { this.bufferMove(target, allowed, origin); return; }
      const slatOnly = target.pos === undefined && target.slat_pos !== undefined;
      if (slatOnly && interrupted && !moving(status)) {
        throw new Error('Behang-Sollwert nicht erreicht; Lamellenbefehl verworfen.');
      }
      if (slatOnly && (moving(status) || this.heightTarget)) {
        const expectedPos = this.heightTarget?.pos ?? (validPercent(status.target_pos) ? status.target_pos : null);
        this.waitingSlat = {
          value: target.slat_pos, expectedPos, allowed, origin,
          expiresAt: (this.heightTarget?.startedAt ?? this.clock()) + this.waitTimeout,
        };
        return;
      }
      const params = { id: this.id, ...target };
      const separate = this.kind === 'raffstore' && this.client.separateSlatCommands === true && params.pos !== undefined;
      const deferredSlat = separate ? params.slat_pos ?? this.waitingSlat?.value ?? status.slat_pos : undefined;
      if (separate) delete params.slat_pos;
      if (!separate && this.kind === 'raffstore' && params.pos !== undefined && params.slat_pos === undefined) {
        params.slat_pos = this.waitingSlat?.value ?? status.slat_pos;
      }
      if (this.tag) params.tag = this.tag;
      if (params.pos !== undefined) {
        this.clearDeferred();
        this.heightTarget = { pos: params.pos, slat_pos: separate ? deferredSlat : params.slat_pos, startedAt: this.clock(), seenMoving: false };
      }
      try { await this.client.call('Cover.GoToPosition', params, () => !this.disposed && !this.windAlarm && generation === this.commandGeneration && allowed()); }
      catch (error) {
        this.heightTarget = null; this.clearDeferred();
        throw error;
      }
      if (separate && validPercent(deferredSlat) && !this.disposed && !this.windAlarm &&
          generation === this.commandGeneration && allowed()) {
        this.waitingSlat = { value: deferredSlat, expectedPos: params.pos, allowed, origin,
          expiresAt: this.heightTarget.startedAt + this.waitTimeout };
      }
      this.onCommand(origin);
    } finally { this.submitting = false; }
  }
  move(target, allowed, origin = 'unknown') {
    const generation = this.commandGeneration;
    return this.enqueue(() => generation === this.commandGeneration ? this.performMove(target, allowed, origin) : undefined);
  }
  cancelPending(reason) {
    this.commandGeneration++;
    clearTimeout(this.timer);
    this.pending = {};
    this.waitingMove = null;
    this.waiters.splice(0).forEach(w => w.reject(new Error(reason)));
    this.clearDeferred();
    this.heightTarget = null;
    this.client.cancelQueued?.();
  }
  stop(origin = 'apple-home') {
    if (this.windAlarm) return Promise.reject(new Error('Windalarm aktiv: Stopp gesperrt.'));
    this.cancelPending('Bewegung angehalten.');
    return this.enqueue(async () => {
      if (this.windAlarm || this.disposed) return;
      await this.client.call('Cover.Stop', { id: this.id, ...(this.tag ? { tag: this.tag } : {}) });
      this.onCommand(origin);
      return this.read();
    });
  }
  async windOpen(force = false) {
    if (!this.windAlarm || this.disposed || (!force && this.clock() - this.lastWindAttempt < 30000)) return;
    this.lastWindAttempt = this.clock();
    await this.client.call('Cover.Open', { id: this.id, ...(this.tag ? { tag: this.tag } : {}) });
    this.onCommand('wind');
  }
  setWindAlarm(value) {
    if (this.kind !== 'raffstore') return Promise.reject(new Error('Windalarm ist nur für Raffstores verfügbar.'));
    if (this.windAlarm === !!value) return Promise.resolve();
    this.windAlarm = !!value;
    this.cancelPending('Windalarm geändert: wartende Befehle verworfen.');
    if (!this.windAlarm) return Promise.resolve();
    return this.enqueue(() => this.windOpen(true));
  }
  dispose() {
    this.disposed = true;
    this.cancelPending('Plugin wurde beendet.');
  }
}
module.exports = { CoverController, validPercent, toAngle, toPercent };
