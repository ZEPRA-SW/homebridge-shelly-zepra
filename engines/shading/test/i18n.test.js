'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { translate, entries, hasTranslation, locale } = require('../lib/i18n');
const { solarConfig } = require('../lib/solar');
const { stateLabel, Overview } = require('../lib/overview');

const languages = ['en', 'fr', 'es'];
const invariants = new Set(['Cloud', 'English', 'Français', 'Español']);
test('every shading settings title and hint has a complete four-language catalog entry', () => {
  const schema = require('../config.schema.json');
  const visit = object => {
    if (!object || typeof object !== 'object') return;
    for (const [key, value] of Object.entries(object)) {
      if (['title', 'description', 'enumNames'].includes(key)) {
        for (const text of Array.isArray(value) ? value : [value]) {
          if (typeof text === 'string' && !invariants.has(text)) assert.ok(hasTranslation(text), 'Missing shading translation: ' + text);
        }
      } else visit(value);
    }
  };
  visit(schema);
  visit(require('../../../config.schema.json').schema.properties.shading);
  for (const directory of ['../homebridge-ui/public', '../../../homebridge-ui/public/shading']) {
    const html = fs.readFileSync(path.join(__dirname, directory, 'index.html'), 'utf8');
    for (const match of html.matchAll(/>([^<>]+)</g)) {
      const text = match[1].trim();
      if (text && text !== 'SHELLY RAFFSTORE') assert.ok(hasTranslation(text), 'Missing static shading text: ' + text);
    }
  }
  for (const [source, values] of Object.entries(entries)) {
    assert.equal(values.length, 3, source);
    assert.ok(values.every(value => typeof value === 'string' && value.trim()), source);
  }
});

test('solar range validation localizes its label and bounds without changing raw identifiers', () => {
  const config = { sunAutomation: { enabled: true, slatStep: 21 } };
  let message;
  try { solarConfig({}, config); } catch (error) { message = error.message; }
  assert.equal(message, 'Lamellen-Mindeständerung muss zwischen 1 und 20 liegen.');
  assert.equal(translate(message, 'en'), 'Minimum slat change must be between 1 and 20.');
  assert.equal(translate(message, 'fr'), 'Variation minimale des lamelles : valeur attendue entre 1 et 20.');
  assert.equal(translate(message, 'es'), 'Cambio mínimo de lamas debe estar entre 1 y 20.');
  for (const language of languages) {
    assert.notEqual(translate('positionWaitTimeout ist außerhalb des gültigen Bereichs.', language), 'positionWaitTimeout ist außerhalb des gültigen Bereichs.');
    assert.ok(translate('positionWaitTimeout ist außerhalb des gültigen Bereichs.', language).startsWith('positionWaitTimeout'));
    assert.equal(translate('office-001 / AA:BB:CC:00:00:01', language), 'office-001 / AA:BB:CC:00:00:01');
  }
});

test('all runtime connection and automation state labels localize in every supported language', () => {
  const now = Date.now();
  const base = { online: true, automationConfigured: true, automationEnabled: true };
  const states = [null, { identityMismatch: true }, {}, { windAlarm: true }, { recoveryFailed: true },
    { recovering: true }, { recovering: true, recoveryPhase: 'stopping' }, { automationConfigured: false },
    { automationEnabled: false }, { manualPaused: true }, { automationPending: 'start' },
    { automationPending: 'end' }, { solarExposure: false }, { shadingActive: true }, {}];
  for (const state of states) {
    const text = stateLabel(state === null ? null : { ...base, ...state }, now, false).text;
    for (const language of languages) assert.notEqual(translate(text, language), text, language + ': ' + text);
  }
  for (const language of languages) {
    for (const text of ['Cloud-Verbindung beendet.', 'Dieses Datum existiert in der gewählten Zeitzone nicht.',
      'Bitte zuerst eine gültige Geräteliste einrichten (maximal 100 Geräte).',
      'Neustart verschoben: Gerät fährt oder Stillstand nicht bestätigt.',
      'Tagesübersicht nicht verfügbar: Bitte Homebridge nach dem Update neu starten. Einstellungen bleiben erreichbar.']) {
      assert.notEqual(translate(text, language), text);
      assert.doesNotMatch(translate(text, language), /Bitte |Gerät fährt|Neustart verschoben|Dieses Datum|Verbindung beendet/);
    }
  }
});

test('Scene source and language locale are available in the shading overview', () => {
  const now = Date.now();
  const row = new Overview().build({ devices: [{ id: 'blind-01', name: 'Office' }] }, '2026-11-19',
    [{ id: 'blind-01', online: true, updatedAt: now, lastControl: { source: 'scene', at: now } }], now).rows[0];
  assert.deepEqual(row.state.lastControl, { source: 'scene', at: now });
  assert.equal(locale('de'), 'de-DE');
  assert.equal(locale('en'), 'en-GB');
  assert.equal(locale('fr'), 'fr-FR');
  assert.equal(locale('es'), 'es-ES');
  assert.equal(locale('invalid'), 'de-DE');
});

test('packaged shading views use exactly the runtime translation catalog and application', () => {
  for (const directory of ['../homebridge-ui/public', '../../../homebridge-ui/public/shading']) {
    assert.equal(fs.readFileSync(path.join(__dirname, directory, 'i18n.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../lib/i18n.js'), 'utf8'));
  }
  assert.equal(fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/app.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../homebridge-ui/public/shading/app.js'), 'utf8'));
});
