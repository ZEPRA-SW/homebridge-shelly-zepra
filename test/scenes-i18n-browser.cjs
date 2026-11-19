'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const I=require('../homebridge-ui/public/i18n');require('../homebridge-ui/public/scenes-i18n');
const publicDir=path.join(__dirname,'../homebridge-ui/public');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL==='bundled'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})});
 try{
  for(const language of ['de','en','fr','es']){
   const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<section id="scenes-panel"><p id="scene-error"></p><p id="scene-empty"></p><button id="scene-add"></button><button id="scene-refresh"></button><div id="scene-list"></div></section>');
   for(const file of ['i18n.js','common-i18n.js','scenes-i18n.js','scene-model.js','scenes-ui.js'])await page.addScriptTag({content:fs.readFileSync(path.join(publicDir,file),'utf8')});
   await page.evaluate(async language=>{
    const sensor={area:'devices',deviceId:'Sensor-ID',sensorId:'200',component:'bthomesensor:200',metric:'CurrentTemperature'},condition={kind:'group',operator:'and',children:[{kind:'value',source:sensor,operator:'gt',value:21.5,holdSeconds:2},{kind:'status',source:{area:'devices',deviceId:'Sensor-ID',component:'input:0',metric:'ContactSensorState'},operator:'eq',value:0},{kind:'group',operator:'or',children:[{kind:'time',time:'08:00',days:[1,2,3,4,5]}]}]};
    window.testConfig={language,devices:[{id:'Sensor-ID',name:'Sensorname Küche',channels:[{component:'light:0',name:'Kanal 1',type:'light'},{component:'light:1',name:'Kanal 1',type:'light'}],inputs:[{component:'input:0',name:'Eingang 1',enabled:true},{component:'input:1',name:'Eingang 9',enabled:true},{component:'input:100',name:'Add-on Eingang',enabled:true}],bthome:[{id:'200',deviceComponent:'bthomedevice:200',name:'BTHome Benutzername'}]},{id:'Ziel-ID',name:'Scene Küche: Befehl übergeben',channels:[{component:'switch:0',name:'Ausgang Benutzername',type:'switch',enabled:true},{component:'switch:1',name:'Kanal 2',type:'switch',enabled:true},{component:'switch:2',name:'Kanal 99',type:'switch',enabled:true}],inputs:[{component:'input:0',name:'Eingang 1',enabled:true}]}],shading:{timeZone:'Europe/Berlin',devices:[]},scenes:[{id:'test-scene',name:'Startbedingungen erfüllt',mode:'schedule',schedule:{start:'00:00',end:'23:59',days:[0,1,2,3,4,5,6]},condition,restoreOnReset:true,cooldownSeconds:60,actions:[{area:'devices',deviceId:'Ziel-ID',component:'switch:0',property:'On',value:true,delaySeconds:3,condition:{kind:'group',operator:'and',children:[{kind:'time',time:'09:00',days:[1]}]},conditionTimeoutSeconds:300}]}]};
    const now=Date.now(),data={devices:[{target:JSON.stringify(['Sensor-ID']),bthome:[{id:'200',deviceComponent:'bthomedevice:200',readings:[{component:'bthomesensor:200',type:'temperature',values:{CurrentTemperature:21.5}}]}]}],states:{'test-scene':{conditionCheckedAt:now,conditionState:'true',lastRun:now,status:'Aktionsfolge abgebrochen: Plugin beendet',step:1,total:2,events:[{timestamp:now,type:'reset-send',message:'Ziel-ID · On: Befehl für vorherigen Wert false wird übergeben'},{timestamp:now,type:'condition-met',message:'Stufe 2: Bedingungen erfüllt'}]}}};
    window.testUi=window.ZepraSceneUi.mount({config:window.testConfig,request:async()=>data,changed:valid=>{window.testValid=valid;}});await window.testUi.refresh();
    document.querySelectorAll('details').forEach(n=>{n.open=true;});
   },language);
   const t=(key,params={})=>I.translate(key,language,params,'scenes');
   assert.equal(await page.locator('.scene-identity strong').textContent(),'Startbedingungen erfüllt','user Scene name must stay untouched');
   assert.equal(await page.locator('.scene-mode').textContent(),t('Zeitplan'));
   assert.equal(await page.locator('.scene-indicator').getAttribute('aria-label'),t('Startbedingungen erfüllt'));
   assert.equal(await page.locator('.scene-indicator.active').count(),1);
   assert.equal(await page.getByRole('button',{name:t('Weiter zur Aktion'),exact:true}).count(),1);
   const adjacent=await page.getByRole('button',{name:t('Weiter zur Aktion'),exact:true}).evaluate(n=>n.previousElementSibling.textContent);
   assert.equal(adjacent,t('Bedingung hinzufügen'));
   assert.equal(await page.getByRole('combobox',{name:t('Verknüpfung'),exact:true}).count(),3);
   assert.equal(await page.getByRole('checkbox',{name:t('Bei Rücksetzen der Bedingung vorherigen Zustand wiederherstellen'),exact:true}).isChecked(),true);
   const options=await page.locator('option').allTextContents();
   assert.ok(options.some(text=>text.includes('BTHome Benutzername [200] / bthomesensor:200 · '+t('Temperatur (°C)'))));
   assert.ok(options.some(text=>text==='Scene Küche: Befehl übergeben [Ziel-ID] / Ausgang Benutzername · '+t('Ein / Aus')));
   assert.ok(options.some(text=>text==='Scene Küche: Befehl übergeben [Ziel-ID] / '+t('Kanal {number}',{number:2})+' · '+t('Ein / Aus')),'generated target channel name');
   assert.ok(options.some(text=>text==='Scene Küche: Befehl übergeben [Ziel-ID] / Kanal 99 · '+t('Ein / Aus')),'custom target name that resembles a default stays intact');
   assert.ok(options.some(text=>text===t('Kanal {number}',{number:1})+' · '+t('Helligkeit (%)')),'generated source channel name');
   assert.ok(options.some(text=>text==='Kanal 1 · '+t('Helligkeit (%)')),'channel name with a mismatching ordinal stays intact');
   assert.ok(options.some(text=>text===t('Eingang {number}',{number:1})+' · '+t('Kontakt (0 geschlossen / 1 offen)')),'generated input name');
   assert.ok(options.some(text=>text==='Eingang 9 · '+t('Kontakt (0 geschlossen / 1 offen)')),'custom input name stays intact');
   assert.ok(options.some(text=>text===t('Add-on Eingang')+' · '+t('Kontakt (0 geschlossen / 1 offen)')),'generated add-on input name');
   const protocol=await page.locator('.scene-protocol').textContent();
   assert.ok(protocol.includes(t('Stufe 2: Bedingungen erfüllt')));
   assert.ok(protocol.includes(t('{target} · {property}: Befehl für vorherigen Wert {value} wird übergeben',{target:'Ziel-ID',property:t('Ein / Aus'),value:t('Aus')})));
   assert.ok((await page.locator('.scene-last').textContent()).includes(t('Aktionsfolge abgebrochen: Plugin beendet')));
   // A hidden-panel language switch must work without fetching or altering user data.
   await page.evaluate(()=>{window.testConfig.language='es';window.testUi.relabel();});
   assert.equal(await page.locator('.scene-mode').textContent(),I.translate('Zeitplan','es',{},'scenes'));
   assert.equal(await page.locator('.scene-identity strong').textContent(),'Startbedingungen erfüllt');
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Scene localization browser checks passed in de/en/fr/es.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
