'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const I=require('../homebridge-ui/public/devices/i18n'),M=require('../homebridge-ui/public/devices/models');
const schema=require('../engines/universal/config.schema.json');
const {model}=require('../engines/universal/lib/model');
const {device,rpc}=require('../engines/universal/test/fixtures');
const languages=['de','en','fr','es'];
test('other-device catalogues cover the same text and placeholders in all four languages',()=>{
 const keys=Object.keys(I.catalogs.de).sort();assert.ok(keys.length>350);
 for(const language of languages){assert.deepEqual(Object.keys(I.catalogs[language]).sort(),keys);for(const key of keys){const translated=I.catalogs[language][key];assert.equal(typeof translated,'string');assert.ok(translated.trim());assert.deepEqual([...translated.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),language+': '+key);}}
});
test('every device schema title and help text has a four-language entry',()=>{
 function visit(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(['title','description'].includes(key)){for(const language of languages)assert.ok(Object.hasOwn(I.catalogs[language],item),language+': '+item);}else visit(item);}}
 visit(schema);assert.deepEqual(schema.schema.properties.language.enum,languages);
});
test('device status, contact/motion values and virtual-component controls translate',()=>{
 assert.equal(I.translate('Geschlossen','fr'),'Fermé');assert.equal(I.translate('Keine Bewegung','es'),'Sin movimiento');
 assert.equal(I.translate('Virtuelle Komponente hinzufügen','fr'),'Ajouter un composant virtuel');
 assert.equal(I.translate('Cloud: lokale Sonderfunktionen deaktivieren.','en'),'Cloud: disable local-only features.');
 assert.equal(I.locale('fr'),'fr-FR');assert.equal(I.locale('es'),'es-ES');assert.equal(I.locale('bad'),'de-DE');
 assert.equal(I.translate('Personal room named Geschlossen','fr'),'Personal room named Geschlossen');
});
test('formatted RPC errors translate without changing API codes, IDs or nested errors',()=>{
 assert.equal(I.translate('Shelly RPC-Fehler -109','fr'),'Erreur RPC Shelly -109');
 assert.equal(I.translate('Virtuelle Komponente nicht lesbar: boolean:200','es'),'Componente virtual ilegible: boolean:200');
 assert.equal(I.translate('Dauerhafte ID doppelt: Mein-Shelly-001','en'),'Duplicate permanent ID: Mein-Shelly-001');
 assert.equal(I.translate('geplanter Neustart fehlgeschlagen: Shelly nicht erreichbar oder Zeitlimit überschritten.','en'),'Scheduled reboot failed: Shelly unreachable or request timed out.');
 assert.equal(I.translate('Stand: {time}','fr',{time:'10:20'}),'Mise à jour : 10:20');
});
test('device validation names stay literal when formatting translated errors',()=>{
 const name='Geschlossen “: {error}',key='Gerät „{name}“: {error}';
 for(const [language,expected] of [['de','Gerät „'+name+'“: Shelly-Geräte-ID prüfen.'],['en','Device “'+name+'”: Check hardware ID.'],['fr','Appareil « '+name+' » : Vérifier l’ID matériel.'],['es','Dispositivo «'+name+'»: Comprobar el ID de hardware.']]){
  assert.equal(I.translate(key,language,{name,error:I.translate('Shelly-Geräte-ID prüfen.',language)}),expected);
 }
});
test('new model templates use the chosen language and preserve existing explicit names',()=>{
 for(const [language,channel,input] of [['de','Kanal 1','Eingang 1'],['en','Channel 1','Input 1'],['fr','Canal 1','Entrée 1'],['es','Canal 1','Entrada 1']]){
  const d={};M.select(d,'pro4pm',language);assert.equal(d.channels[0].name,channel);assert.equal(d.inputs[0].name,input);
  d.channels[0].name='Keep this name';const before=structuredClone(d);M.sync(d,false,language);assert.deepEqual(d,before);
 }
});
test('generated Wall Display service suffixes translate without rewriting device/channel names',()=>{
 const snap=rpc();snap.status['temperature:0']={tC:22};snap.status['humidity:0']={rh:40};
 const cfg={...device(),name:'User name',modelId:'wall',wallTemperature:true,wallHumidity:true,language:'fr'};
 const before=structuredClone(cfg),m=model(snap,cfg);assert.equal(m.descriptors.find(d=>d.key==='temperature:0').name,'User name Température');assert.equal(m.descriptors.find(d=>d.key==='humidity:0').name,'User name Humidité');assert.deepEqual(cfg,before);
});
test('bundled devices and engine copies use the same translations and UI logic',()=>{
 for(const file of ['i18n.js','app.js','models.js','overview.js','status.js'])assert.equal(fs.readFileSync(path.join(__dirname,'../homebridge-ui/public/devices',file),'utf8'),fs.readFileSync(path.join(__dirname,'../engines/universal/homebridge-ui/public',file),'utf8'),file);
});
