'use strict';
const { isIP } = require('node:net');
const {cloudURL,cloudId}=require('./cloud');
const Models=require('../homebridge-ui/public/models');
const {validateVirtual}=require('./virtual');
const OUTPUT = /^(switch|light|rgb|rgbw|cct|relay|color|white):\d+$/;
const INPUT = /^(input|extinput|voltmeter):\d+$/;
const normalize = value => String(value || '').toLowerCase().replace(/:/g, '');
function hostURL(host) {
  const u = new URL(String(host).includes('://') ? host : 'http://' + host);
  if (!['http:', 'https:'].includes(u.protocol) || !isIP(u.hostname.replace(/^\[|\]$/g, '')) ||
      u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new Error('Host muss eine IP-Adresse ohne Pfad oder Zugangsdaten sein.');
  }
  return u;
}
function validate(config) {
  if (config.devices !== undefined && !Array.isArray(config.devices)) throw new Error('devices muss eine Liste sein.');
  if (config.pollInterval !== undefined && (!Number.isFinite(config.pollInterval) || config.pollInterval < 3 || config.pollInterval > 300)) throw new Error('Statusintervall: 3 bis 300 Sekunden.');
  const ids = new Set(), hardware = new Set();
  for (const d of config.devices || []) {
    if(d.homekitEnabled!==undefined&&typeof d.homekitEnabled!=='boolean')throw new Error('In Apple Home anzeigen muss ein/aus sein.');
    validateVirtual(d);
    if(d.rebootEnabled!==undefined&&typeof d.rebootEnabled!=='boolean')throw new Error('Täglicher Neustart muss ein/aus sein.');
    if((d.rebootTime!==undefined&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.rebootTime))||(d.rebootEnabled===true&&typeof d.rebootTime!=='string'))throw new Error('Neustartzeit als HH:MM (00:00 bis 23:59) eingeben.');
    const cloud=d.connection==='cloud';
    if(d.connection!==undefined&&!['local','cloud'].includes(d.connection))throw new Error('Verbindung: Lokal oder Cloud auswählen.');
    if(cloud){cloudURL(d.cloudServer);if(typeof d.cloudKey!=='string'||!d.cloudKey.trim()||d.cloudKey!==d.cloudKey.trim())throw new Error('Cloudschlüssel fehlt oder enthält Rand-Leerzeichen.');if(!/^[a-f0-9]{6,12}$/i.test(d.cloudDeviceId||''))throw new Error('Cloud-Geräte-ID: 6 bis 12 Hex-Zeichen.');if(d.rebootEnabled===true||d.thermostat===true||(d.virtualComponents||[]).some(v=>v.enabled!==false)||(d.inputs||[]).some(i=>i.enabled!==false&&i.mode==='button')||(d.bthome||[]).some(b=>b.buttonIndices?.length))throw new Error('Cloud: Neustart, Thermostatsteuerung, virtuelle Komponenten und Tastendruckereignisse benötigen eine lokale Verbindung.');}
    for (const key of cloud?['id','name']:['id', 'name', 'host', 'shellyDeviceId']) if (typeof d[key] !== 'string' || !d[key].trim()) throw new Error(key + ' ist eine Pflichtangabe.');
    if (ids.has(d.id.trim())) throw new Error('Dauerhafte ID doppelt: ' + d.id);
    ids.add(d.id.trim());
    if (d.id !== d.id.trim()) throw new Error('ID darf keine Rand-Leerzeichen enthalten.');
    const hw = cloud?cloudId(d.cloudDeviceId):normalize(d.shellyDeviceId);
    if (!cloud&&!/^(?:[a-f0-9]{12}|shelly[a-z0-9-]+-[a-f0-9]{12})$/.test(hw)) throw new Error('Ungültige Shelly-Geräte-ID.');
    const mac = hw.slice(-12).replace(/^0+/,'');
    if ([...hardware].some(v=>v.endsWith(mac)||mac.endsWith(v))) throw new Error('Shelly-Hardware doppelt konfiguriert. Kanäle im selben Gerät ergänzen.');
    hardware.add(mac); if(!cloud)hostURL(d.host);
    if (d.generation !== undefined && !['auto', 'gen1', 'rpc'].includes(d.generation)) throw new Error('Ungültige Generation.');
    for(const key of ['thermostat','wallIlluminance','wallTemperature','wallHumidity','wallMotion'])if(d[key]!==undefined&&(typeof d[key]!=='boolean'||d[key]&&!/^wall(?:-x2|-xl)?$/.test(d.modelId||'')))throw new Error('Display-Funktion passt nicht zum Gerät: '+key);
    if(d.tileMode!==undefined&&!['separate','grouped'].includes(d.tileMode))throw new Error('HomeKit-Kacheln: Einzelkacheln oder Gesamtkachel auswählen.');
    for (const field of ['channels', 'inputs', 'bthome','addons']) if (d[field] !== undefined && !Array.isArray(d[field])) throw new Error(field + ' muss eine Liste sein.');
    if(d.modelId!==undefined) {
      const m=Models.get(d.modelId);if(m?.cloudOnly&&!cloud)throw new Error('Dieses Sensormodell benötigt die Cloud-Verbindung.');if(!m)throw new Error('Shelly-Modell auswählen.');
      if(d.generation!==m.generation)throw new Error('API-Generation passt nicht zum ausgewählten Modell.');
      if(m.profiles && !Models.profile(d))throw new Error('Ungültiges Geräteprofil.');
      if(d.addons?.length>1 || d.addons?.some(a=>!m.addon||a.type!==m.addon))throw new Error('Add-on passt nicht zum ausgewählten Modell.');
      if(d.bthome?.length && !m.bthome)throw new Error('Dieses Modell ist im Katalog nicht als BTHome-Host freigegeben.');
      const outputs=new Set(Models.outputTemplates(d).map(c=>c.component)),ins=new Set(Models.inputTemplates(d).map(c=>c.component));
      if(d.channels?.some(c=>!outputs.has(c.component))||d.inputs?.some(c=>!ins.has(c.component)))throw new Error('Kanal gehört nicht zum ausgewählten Modell/Profil.');
    }
    for(const a of d.addons||[]) {
      for(const k of ['inputId','inputId2','analogId','analogId2'])if(a[k]!==undefined&&(!Number.isInteger(a[k])||a[k]<100||a[k]>199))throw new Error('Add-on-Eingangsnummer: 100..199.');
      if(a.inputId!==undefined&&a.inputId===a.inputId2)throw new Error('Add-on-Eingangsnummern müssen unterschiedlich sein.');
      for(const k of ['analogType','analogType2'])if(a[k]!==undefined&&!['none','percent','voltage'].includes(a[k]))throw new Error('Ungültiger Eingang.');
      if(a.type==='gen1-sensor'&&[a.analogType,a.analogType2].some(v=>v!==undefined&&v!=='none')||a.type!=='pro-sensor'&&a.analogType2!==undefined&&a.analogType2!=='none')throw new Error('Add-on passt nicht zum ausgewählten Modell.');
      const components=Models.inputTemplates(d).map(i=>i.component);if(new Set(components).size!==components.length)throw new Error('Add-on-Eingangsnummern müssen unterschiedlich sein.');
    }
    const unique = (items, key) => { const seen = new Set(); for (const v of items) { if (seen.has(v[key])) throw new Error('Komponente/ID doppelt.'); seen.add(v[key]); } };
    unique(d.channels || [], 'component'); unique(d.inputs || [], 'component'); unique(d.bthome || [], 'id'); unique(d.bthome || [], 'deviceComponent');
    for (const c of d.channels || []) {
      if(c.showTemperature!==undefined&&typeof c.showTemperature!=='boolean')throw new Error('Gerätetemperatur muss ein/aus sein.');
      if (!OUTPUT.test(c.component) || !['switch', 'outlet', 'light'].includes(c.type)) throw new Error('Ungültiger Ausgang. Cover sind ausgeschlossen.');
      for (const k of ['minKelvin','maxKelvin']) if(c[k]!==undefined && (!Number.isInteger(c[k]) || c[k]<2000 || c[k]>10000)) throw new Error('Farbtemperaturgrenzen: 2000..10000 Kelvin.');
      if((c.minKelvin||2700)>=(c.maxKelvin||6500)) throw new Error('Minimale Farbtemperatur muss kleiner als maximale sein.');
      for(const k of ['minBrightness','maxBrightness','onBrightness'])if(c[k]!==undefined&&(!Number.isFinite(c[k])||c[k]<0||c[k]>100))throw new Error('Helligkeit muss zwischen 0 und 100 liegen.');
      if((c.minBrightness??0)>=(c.maxBrightness??100))throw new Error('Helligkeitsgrenzen prüfen.');
      if(c.onBrightness!==undefined&&(c.onBrightness<(c.minBrightness??0)||c.onBrightness>(c.maxBrightness??100)))throw new Error('Einschalthelligkeit außerhalb der Helligkeitsgrenzen.');
      if(c.transitionSeconds!==undefined&&(!Number.isFinite(c.transitionSeconds)||c.transitionSeconds<0||c.transitionSeconds>60))throw new Error('Übergang: 0..60 Sekunden.');
    }
    for (const i of d.inputs || []) {
      const template=Models.inputTemplates(d).find(t=>t.component===i.component);
      if (!INPUT.test(i.component) || !['state','button','analog'].includes(i.mode) || i.mode==='analog'&&(!template?.analog||!d.modelId||!d.addons?.length) || i.mode!=='analog'&&(i.component.startsWith('voltmeter:')||template?.analog)) throw new Error('Ungültiger Eingang.');
      if(i.invert!==undefined&&(typeof i.invert!=='boolean'||i.invert&&i.mode!=='state'))throw new Error('Ungültiger Eingang.');
    }
    for (const b of d.bthome || []) {
      if (typeof b.id !== 'string' || !b.id.trim() || !b.name?.trim() || !/^bthomedevice:2\d\d$/.test(b.deviceComponent)) throw new Error('BTHome benötigt eine dauerhafte ID, einen Namen und bthomedevice:200..299.');
      if(b.buttonIndices!==undefined && (!Array.isArray(b.buttonIndices) || new Set(b.buttonIndices).size!==b.buttonIndices.length || b.buttonIndices.some(i=>!Number.isInteger(i)||i<0||i>255))) throw new Error('Ungültige BTHome-Tastenindizes.');
      if (b.staleAfter !== undefined && (!Number.isFinite(b.staleAfter) || b.staleAfter < 60)) throw new Error('BTHome-Frist mindestens 60 Sekunden.');
    }
  }
  return config;
}
function matches(info, expected) {
  const e = normalize(expected);
  const mac=normalize(info.mac);
  return e === mac || e === normalize(info.id) || (!info.id && /^[a-f0-9]{12}$/.test(mac) && e.endsWith('-'+mac));
}
module.exports = { validate, hostURL, matches, normalize, OUTPUT };
