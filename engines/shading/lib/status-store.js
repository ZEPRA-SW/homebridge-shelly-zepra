'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const STATUS_FILE = 'shelly-raffstore-status.json';
class StatusStore {
  constructor(directory, warn = () => {}) {
    this.directory = directory;
    this.warn = warn;
    this.records = new Map();
    this.tail = Promise.resolve();
    this.closed = false;
  }
  update(id, state) {
    if (!this.directory || this.closed) return;
    this.records.set(id, { id, ...state, updatedAt: Date.now() });
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1000);
  }
  flush() {
    if (!this.directory) return Promise.resolve();
    const data = JSON.stringify({ updatedAt: Date.now(), devices: [...this.records.values()] });
    this.tail = this.tail.catch(() => {}).then(async () => {
      const target = path.join(this.directory, STATUS_FILE);
      const temporary = target + '.' + process.pid + '.tmp';
      await fs.writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, target);
    }).catch(() => {
      if (!this.warned) { this.warn('Statusübersicht konnte nicht gespeichert werden.'); this.warned = true; }
    });
    return this.tail;
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    return this.flush();
  }
}
async function loadStatus(directory) {
  try {
    const target = path.join(directory, STATUS_FILE);
    const info = await fs.stat(target);
    if (info.size > 2 * 1024 * 1024) return [];
    const data = JSON.parse(await fs.readFile(target, 'utf8'));
    return Array.isArray(data.devices) ? data.devices : [];
  } catch { return []; }
}
module.exports = { StatusStore, loadStatus, STATUS_FILE };
