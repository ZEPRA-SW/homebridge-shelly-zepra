"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const pub=path.join(__dirname,'../homebridge-ui/public/devices'),schema=require('../engines/universal/config.schema.json'),I=require('../homebridge-ui/public/devices/i18n');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL==='bundled'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})});try{
for(const language of ['de','en','fr','es']){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(fs.readFileSync(path.join(pub,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''));
 await page.evaluate(({language,schema})=>{const d={id:'sensor-id',name:'Water level: Küche',host:'192.0.2.10',shellyDeviceId:'aabbccddeeff',generation:'rpc',modelId:'plus2pm',channels:[],addons:[{type:'plus-addon',analogType:'percent',analogId:101}],inputs:[{component:'input:101',mode:'analog',name:'Tank',enabled:true},{component:'voltmeter:100',mode:'analog',name:'Pressure',enabled:true},{component:'voltmeter:101',mode:'analog',name:'Hidden',enabled:false}]};window.addonStatus={version:1,maxAge:60000,devices:[{target:JSON.stringify([d.id,d.host,d.shellyDeviceId]),online:true,checkedAt:Date.now(),readings:[{component:'input:101',unit:'%',values:{AnalogValue:0}},{component:'voltmeter:100',unit:'V',values:{AnalogValue:2.75}},{component:'voltmeter:101',unit:'V',values:{AnalogValue:8}}]}]};window.homebridge={getPluginConfig:async()=>[{platform:'ShellyUniversal',language,devices:[d]}],getPluginConfigSchema:async()=>schema,request:async()=>structuredClone(addonStatus),enableSaveButton(){},disableSaveButton(){},updatePluginConfig:async()=>{}};},{language,schema});
 for(const name of ['i18n.js','models.js','status.js','overview.js','app.js'])await page.addScriptTag({content:fs.readFileSync(path.join(pub,name),'utf8')});
 await page.getByRole('button',{name:I.translate('Statusübersicht',language),exact:true}).click();
 const percent=page.locator('#overview [data-component="input:101"]'),voltage=page.locator('#overview [data-component="voltmeter:100"]');
 await percent.waitFor();assert.equal(await percent.locator('.metric-value').textContent(),'0 %');assert.equal(await voltage.locator('.metric-value').textContent(),(new Intl.NumberFormat(I.locale(language),{maximumFractionDigits:3}).format(2.75))+' V');assert.equal(await percent.locator('.channel-lamp').getAttribute('data-state'),'reading');assert.ok((await percent.textContent()).includes(I.translate('Analogwert',language)));assert.equal(await page.locator('#overview [data-component="voltmeter:101"]').count(),0);
 await page.evaluate(()=>{addonStatus.devices[0].readings[1].fault=true;addonStatus.devices[0].readings[1].values={};});
 await page.waitForFunction(()=>document.querySelector('#overview [data-component="voltmeter:100"] .channel-lamp')?.dataset.state==='unknown',{},{timeout:10000});assert.equal(await voltage.locator('.metric-value').count(),0);assert.deepEqual(errors,[]);await page.close();
}
console.log('Analog overview values, units, disabled inputs and fault recovery passed in de/en/fr/es.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
