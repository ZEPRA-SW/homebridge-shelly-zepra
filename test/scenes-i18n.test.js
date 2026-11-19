'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const I=require('../homebridge-ui/public/i18n');
const dictionaries=require('../homebridge-ui/public/scenes-i18n');
const M=require('../homebridge-ui/public/scene-model');
const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
test('Scene translations cover every language, preserve template parameters and all model validation messages',()=>{
 const keys=Object.keys(dictionaries.de).sort();
 for(const language of ['de','en','fr','es']){
  assert.deepEqual(Object.keys(dictionaries[language]).sort(),keys);
  for(const key of keys){assert.ok(dictionaries[language][key].trim(),language+': '+key);assert.deepEqual(placeholders(dictionaries[language][key]),placeholders(key),language+': '+key);}
  for(const label of [...Object.values(M.labels),...Object.values(M.properties)])assert.ok(Object.hasOwn(dictionaries[language],label),language+': '+label);
  const model=fs.readFileSync(path.join(__dirname,'../homebridge-ui/public/scene-model.js'),'utf8');
  for(const [,message]of model.matchAll(/throw Error\('([^']+)'\)/g))assert.ok(Object.hasOwn(dictionaries[language],message),language+': '+message);
 }
});
test('Scene historical event templates translate nested reasons while preserving arbitrary target identifiers',()=>{
 const translations={en:'Stage 2: conditions met',fr:'Étape 2 : conditions remplies',es:'Etapa 2: condiciones cumplidas'};
 for(const [language,expected]of Object.entries(translations)){
  assert.equal(I.translate('Stufe 2: Bedingungen erfüllt',language,{},'scenes'),expected);
  const cancellation=I.translate('Aktionsfolge abgebrochen: Plugin beendet',language,{},'scenes');
  assert.ok(!cancellation.includes('Plugin beendet'));assert.ok(!cancellation.includes('Aktionsfolge'));
  const target='Startbedingungen erfüllt: Küche [sensor:200]';
  const message=I.translate('{target} · {property}: Rücksetzung ausgelassen – {reason}',language,{target,property:'On',reason:'neuere Steuerung hat Vorrang'},'scenes');
  assert.ok(message.startsWith(target+' · On'));assert.ok(!message.includes('neuere Steuerung'));
 }
});
test('Scene schedules, lifecycle help, restoration and validation have actual translations in all non-German languages',()=>{
 const messages=['Nach Zeitplan','Bedingung muss erfüllt sein (Sekunden)','Maximale Bedingungswartezeit (Sekunden)','Bei Rücksetzen der Bedingung vorherigen Zustand wiederherstellen','Scene: Regelschleife erkannt. Gegenseitige Geräte-Auslösung ist nicht zulässig.','Rücksetzung: 2 Befehle übergeben, 1 ausgelassen; Endzustände nicht bestätigt'];
 for(const language of ['en','fr','es'])for(const message of messages)assert.notEqual(I.translate(message,language,{},'scenes'),message,language+': '+message);
 assert.equal(I.translate('Unveränderter Benutzername','es',{},'scenes'),'Unveränderter Benutzername');
});
