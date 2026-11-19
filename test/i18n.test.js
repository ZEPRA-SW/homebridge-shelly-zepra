'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../homebridge-ui/public/i18n');
require('../homebridge-ui/public/common-i18n');
const fs=require('node:fs'),path=require('node:path');
const publicDir=path.join(__dirname,'../homebridge-ui/public');
test('all common interface labels and shared setting descriptions exist in all four catalogs',()=>{
 const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
 const strings=[...html.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"/g)].map(m=>m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
 const props=require('../config.schema.json').schema.properties;
 for(const def of [props.name,props.language,props.pollInterval,...['timeZone','latitude','longitude','globalControls'].map(key=>props.shading.properties[key])])strings.push(def.title,...def.description?[def.description]:[]);
 for(const lang of I.languages)for(const text of strings)assert.ok(Object.hasOwn(I.catalogs.common[lang],text),lang+': '+text);
});
test('template translation escapes punctuation, preserves names and only translates designated nested reasons',()=>{
 I.register('test',{de:{},en:{'Failure [{name}]: {reason}.':'Error [{name}]: {reason}.','Sensor ausgefallen':'Sensor failed','Pause (1.0)?':'Pause (1.0)?'},fr:{},es:{}});
 assert.equal(I.translate('Failure [Sensor ausgefallen]: Sensor ausgefallen.','en',{},'test'),'Error [Sensor ausgefallen]: Sensor failed.');
 assert.equal(I.translate('Unknown Sensor ausgefallen','en',{},'test'),'Unknown Sensor ausgefallen');
 assert.equal(I.translate('Failure [a.*?]: Sensor ausgefallen.','en',{},'test'),'Error [a.*?]: Sensor failed.');
 assert.equal(I.translate('Failure [x]: Sensor ausgefallen!','en',{},'test'),'Failure [x]: Sensor ausgefallen!');
 assert.equal(I.translate('Failure [{name}]: {reason}.','en',{name:'Küche & Büro',reason:'Sensor ausgefallen'},'test'),'Error [Küche & Büro]: Sensor failed.');
 assert.equal(I.translate('Failure [{name}]: {reason}.','de',{name:'Kitchen',reason:'offline'},'test'),'Failure [Kitchen]: offline.');
});
test('unsupported language falls back safely and locales cover all supported languages',()=>{
 assert.equal(I.normalizeLanguage('xx'),'de');assert.equal(I.translate('Sprache','xx'),'Sprache');
 assert.deepEqual(I.languages.map(I.locale),['de-DE','en-GB','fr-FR','es-ES']);
});
test('language changes translate existing Scene history while preserving event types and device names',()=>{
 require('../homebridge-ui/public/scenes-i18n');
 const event={timestamp:123,type:'condition-met',message:'Stufe 2: Bedingungen erfüllt',step:2};
 for(const lang of ['en','fr','es'])assert.notEqual(I.translate(event.message,lang,{},'scenes'),event.message);
 assert.deepEqual(event,{timestamp:123,type:'condition-met',message:'Stufe 2: Bedingungen erfüllt',step:2});
});
test('logger localizes Scene messages and preserves user identifiers, structured data and calling context',()=>{
 const {logger}=require('../lib/i18n'),calls=[];
 const base={mark:'context',warn(message,metadata){assert.equal(this.mark,'context');calls.push([message,metadata]);}};
 const wrapped=logger(base,'fr');const metadata={deviceId:'Lamellen Küche',category:'timeout'};
 wrapped.warn('Scene Wohnzimmer: Startbedingungen erfüllt.',metadata);
 assert.match(calls[0][0],/^Scène Wohnzimmer : /);assert.equal(calls[0][1],metadata);
 assert.ok(!calls[0][0].includes('Startbedingungen erfüllt'));
 assert.equal(metadata.deviceId,'Lamellen Küche');
});

test('structured Scene logs preserve colon-containing names and translate nested cancellation reasons',()=>{
 require('../homebridge-ui/public/scenes-i18n');
 const name='Hof: Licht {status} [AA-001]';
 const status='Aktionsfolge abgebrochen: Scene deaktiviert';
 const original={name,status};
 assert.equal(I.translate('Scene {name}: {status}.','fr',original,'all'),
  'Scène Hof: Licht {status} [AA-001] : Séquence d’actions interrompue : Scène désactivée.');
 assert.equal(I.translate('Scene {name}: {status}.','en',original,'all'),
  'Scene Hof: Licht {status} [AA-001]: Action sequence aborted: Scene disabled.');
 assert.equal(I.translate('Scene {name}: {status}.','de',original,'all'),
  'Scene Hof: Licht {status} [AA-001]: Aktionsfolge abgebrochen: Scene deaktiviert.');
 assert.deepEqual(original,{name,status});
});
