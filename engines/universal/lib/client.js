'use strict';
const { createHash, randomBytes } = require('node:crypto');
const { hostURL, matches } = require('./config');
const {KEY:VIRTUAL_KEY,canWrite}=require('./virtual');
const sha = s => createHash('sha256').update(s).digest('hex');
const RPC_WRITES = /^(?:(Switch|Light|RGB|RGBW|CCT|Boolean)\.Set|Button\.Trigger|Thermostat\.SetConfig)$/;
const RPC_READS = /^(Shelly\.(GetDeviceInfo|GetStatus|GetConfig|GetComponents)|BTHome(Device|Sensor)\.(GetConfig|GetStatus|GetKnownObjects))$/;
function digest(c, password, method, uri, count = 1, cnonce = randomBytes(12).toString('hex')) {
  if (!password) throw new Error('Shelly verlangt ein Passwort.');
  if (c.algorithm?.toUpperCase() !== 'SHA-256' || !c.realm || c.nonce === undefined) throw new Error('Nicht unterstützte Authentifizierung.');
  const nc = count.toString(16).padStart(8, '0');
  return { realm: c.realm, username: 'admin', nonce: c.nonce, cnonce, nc, algorithm: 'SHA-256',
    response: sha(`${sha('admin:' + c.realm + ':' + password)}:${c.nonce}:${nc}:${cnonce}:auth:${sha(method + ':' + uri)}`) };
}
function digestHeader(a, uri, opaque) {
  const quote = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return 'Digest ' + Object.entries({...a, uri, qop: 'auth', ...(opaque ? {opaque} : {})}).map(([k,v]) => k + '=' + (['nc','algorithm','qop'].includes(k) ? v : quote(v))).join(', ');
}
class Client {
  constructor(config, fetcher = fetch) {
    this.config = config; this.base = hostURL(config.host); this.fetcher = fetcher;
    this.sequence = 0; this.count = 0; this.challenge = null; this.tail = Promise.resolve();
  }
  queue(fn) { const p = this.tail.then(fn); this.tail = p.catch(() => {}); return p; }
  async http(path, body) {
    const method = body ? 'POST' : 'GET';
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = {'Content-Type': 'application/json'};
      if (this.gen === 1 && this.config.password) headers.Authorization = 'Basic ' + Buffer.from((this.config.username || 'admin') + ':' + this.config.password).toString('base64');
      else if (this.challenge) headers.Authorization = digestHeader(digest(this.challenge, this.config.password, method, path, ++this.count), path, this.challenge.opaque);
      let r;
      try { r = await this.fetcher(new URL(path, this.base), {method, headers, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(8000), redirect: 'error'}); }
      catch { throw new Error('Shelly nicht erreichbar oder Zeitlimit überschritten.'); }
      if (r.status === 401 && attempt === 0 && this.gen !== 1) {
        const header = r.headers.get('www-authenticate') || '', fields = {};
        if (/^Basic /i.test(header) && path==='/shelly') {await r.arrayBuffer();this.gen=1;continue;}
        for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) fields[m[1]] = m[2] ?? m[3];
        await r.arrayBuffer();
        if (!/^Digest /i.test(header) || !fields.qop?.split(',').map(x=>x.trim()).includes('auth')) throw new Error('Authentifizierung fehlgeschlagen.');
        this.challenge = fields; this.count = 0; continue;
      }
      if (!r.ok) { await r.arrayBuffer(); throw new Error('Shelly HTTP-Fehler ' + r.status); }
      return r.json();
    }
    throw new Error('Authentifizierung fehlgeschlagen.');
  }
  reboot(due=()=>true) {
    return this.queue(async()=>{
      if(this.config.rebootEnabled!==true)throw new Error('Automatischer Neustart nicht aktiviert.');
      if(!due())throw new Error('Neustartzeit verstrichen.');
      await this.identify();
      if(!due())throw new Error('Neustartzeit verstrichen.');
      if(this.gen===1)return this.http('/reboot');
      return this.rpc('Shelly.Reboot');
    });
  }
  async rpc(method, params = {}) {
    if (!RPC_READS.test(method) && !RPC_WRITES.test(method) && method!=='Shelly.Reboot') throw new Error('RPC-Aufruf nicht freigegeben.');
    const id = ++this.sequence, data = await this.http('/rpc', {id, method, params});
    if (data.error) { const e = new Error('Shelly RPC-Fehler ' + data.error.code); e.code = data.error.code; throw e; }
    if (data.id !== id || !Object.hasOwn(data, 'result')) throw new Error('Ungültige RPC-Antwort.');
    return data.result;
  }
  async identify() {
    if (!this.gen && this.config.generation === 'gen1') this.gen = 1;
    const wall=/^wall(?:-x2|-xl)?$/.test(this.config.modelId||'')||/^shellywalldisplay-/i.test(this.config.shellyDeviceId||'');
    if(wall)this.gen=2;
    const info = wall?await this.rpc('Shelly.GetDeviceInfo'):await this.http('/shelly');
    if (!matches(info, this.config.shellyDeviceId)) throw new Error('Shelly-Geräte-ID stimmt an dieser IP nicht überein. Zugriff gesperrt.');
    this.gen = info.gen >= 2 || info.app === 'WallDisplay' ? 2 : 1;
    if (this.config.generation === 'rpc') this.gen = 2;
    return info;
  }
  async snapshot() {
    return this.queue(async () => {
      const info = await this.identify();
      if (this.gen === 1) {
        const status = await this.http('/status');
        const settings = await this.http('/settings');
        return {info, gen: 1, status, settings};
      }
      const status = await this.rpc('Shelly.GetStatus');
      const settings = await this.rpc('Shelly.GetConfig');
      const components = [];let bthomeError,virtualError;
      if (this.config.bthome?.length||this.config.virtualComponents?.some(v=>v.enabled!==false)) {
        try {
        for (let offset = 0; offset < 1000;) {
          const page = await this.rpc('Shelly.GetComponents', {offset, include: ['config','status'], dynamic_only: true});
          if (!Array.isArray(page.components) || !Number.isInteger(page.total) || page.total>1000) throw new Error('Ungültige Komponentenliste.');
          components.push(...page.components); offset += page.components.length;
          if (offset >= page.total) break;
          if (!page.components.length) throw new Error('Unvollständige Komponentenliste.');
        }
        } catch { components.length=0;if(this.config.bthome?.length)bthomeError='BTHome-Komponenten nicht lesbar; lokale Hostfunktionen bleiben verfügbar.';if(this.config.virtualComponents?.length)virtualError='Virtuelle Komponenten nicht lesbar; lokale Hostfunktionen bleiben verfügbar.'; }
        for(const b of this.config.bthome || []) if(b.buttonIndices?.length) {
          const device=components.find(c=>c.key===b.deviceComponent);
          if(device) try {device.knownObjects=await this.rpc('BTHomeDevice.GetKnownObjects',{id:Number(b.deviceComponent.split(':')[1])});} catch {device.buttonError=true;}
        }
      }
      return {info, gen: 2, status, settings, components,bthomeError,virtualError};
    });
  }
  write(component, values, allowed=()=>true) {
    return this.queue(async () => {
      if(!allowed())throw Error('Scene-Freigabe beendet.');
      const verifiedInfo=await this.identify();
      if(!allowed())throw Error('Scene-Freigabe beendet.');
      const [kind, number] = component.split(':'), id = Number(number);
      if (!Number.isInteger(id) || id < 0) throw new Error('Ungültiger Kanal.');
      if(VIRTUAL_KEY.test(component)){
        const v=this.config.virtualComponents?.find(v=>v.component===component&&v.enabled!==false);
        if(this.gen!==2||!v)throw new Error('Virtuelle Komponente nicht freigegeben.');
        const page=await this.rpc('Shelly.GetComponents',{keys:[component],include:['config','status'],dynamic_only:true}),c=page.components?.find(c=>c.key===component);
        if(!c||!canWrite(c))throw new Error('Virtuelle Komponente fehlt oder ist nur lesbar.');
        if(kind==='boolean'&&v.mode==='switch'&&Object.keys(values).length===1&&typeof values.value==='boolean')return this.rpc('Boolean.Set',{id,value:values.value});
        if(kind==='button'&&v.mode==='trigger'&&Object.keys(values).length===1&&values.event===(v.event||'single_push'))return this.rpc('Button.Trigger',{id,event:values.event});
        throw new Error('Ungültiger virtueller Befehl.');
      }
      if(kind==='thermostat') {
        if(this.gen!==2||this.config.thermostat!==true||!/^wall(?:-x2|-xl)?$/.test(this.config.modelId||'')||!/^WallDisplay/.test(verifiedInfo.app||''))throw new Error('Thermostat nicht freigegeben.');
        const config=values.config;
        const modeChange=config&&Object.keys(config).length===2&&['heating','cooling'].includes(config.type)&&config.enable===true;
        const single=config&&Object.keys(config).length===1&&Object.entries(config).every(([k,v])=>k==='target_C'?(Number.isFinite(v)&&v>=5&&v<=35):k==='enable'?typeof v==='boolean':k==='display_unit'?['C','F'].includes(v):false);
        if(!config||Object.keys(values).some(k=>k!=='config')||!modeChange&&!single)throw new Error('Ungültiger Thermostatbefehl.');
        return this.rpc('Thermostat.SetConfig',{id,config});
      }
      if (this.gen === 1) {
        if (!['relay','light','color','white'].includes(kind)) throw new Error('Ungültiger Gen1-Ausgang.');
        const settings = await this.http('/settings');
        if (settings.mode === 'roller' || settings.mode === 'cover') throw new Error('Rollladenprofil ausgeschlossen.');
        const query = new URLSearchParams();
        for (const [k,v] of Object.entries(values)) {
          if (k === 'on') query.set('turn', v ? 'on' : 'off');
          else if (['brightness','gain','red','green','blue','white','temp'].includes(k)) query.set(k, String(v));
          else throw new Error('Parameter nicht freigegeben.');
        }
        if(!allowed())throw Error('Scene-Freigabe beendet.');
        return this.http('/' + kind + '/' + id + '?' + query);
      }
      if (verifiedInfo.profile === 'cover') throw new Error('Coverprofil ausgeschlossen.');
      const namespace = {switch:'Switch',light:'Light',rgb:'RGB',rgbw:'RGBW',cct:'CCT'}[kind];
      if (!namespace) throw new Error('Ungültiger RPC-Ausgang.');
      if (Object.keys(values).some(k=>!['on','brightness','rgb','white','ct','transition_duration'].includes(k))) throw new Error('Parameter nicht freigegeben.');
      if(!allowed())throw Error('Scene-Freigabe beendet.');
      return this.rpc(namespace + '.Set', {id, ...values});
    });
  }
}
module.exports = { Client, digest, digestHeader };
