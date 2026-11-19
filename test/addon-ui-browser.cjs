'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),pub=path.join(root,'homebridge-ui/public'),schema=require('../engines/universal/config.schema.json');
const M=require('../homebridge-ui/public/devices/models'),I=require('../homebridge-ui/public/devices/i18n'),Status=require('../homebridge-ui/public/devices/status');
function configuration(language){
 const plus={id:'Keep-Plus-ID',name:'Küche “: {error}',host:'192.0.2.10',shellyDeviceId:'aabbccddee01'},pro={id:'Keep-Pro-ID',name:'Pro Kontakt Büro',host:'192.0.2.11',shellyDeviceId:'aabbccddee02'};
 M.select(plus,'plus1',language);M.select(pro,'pro2',language);
 return {platform:'ShellyUniversal',name:'UI test',language,pollInterval:20,devices:[plus,pro]};
}
(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(pub,'.'+decodeURIComponent(url.pathname==='/'?'/devices/index.html':url.pathname));
  if(!file.startsWith(pub+path.sep)){res.writeHead(404).end();return;}
  try{
   let data=fs.readFileSync(file);
   if(file===path.join(pub,'devices/index.html')){
    const cfg=configuration(url.searchParams.get('language')||'de');
    const status={maxAge:60000,devices:cfg.devices.map(d=>({target:Status.target(d),online:true,checkedAt:Date.now(),readings:[],measurements:[]}))};
    // The production page obtains this adapter from its parent; use a local-only adapter here.
    const mock=`window.testSaved=null;window.testDisabled=true;window.homebridge={getPluginConfig:async()=>${JSON.stringify([cfg])},getPluginConfigSchema:async()=>(${JSON.stringify(schema)}),updatePluginConfig:async value=>{window.testSaved=structuredClone(value);},enableSaveButton:()=>window.testDisabled=false,disableSaveButton:()=>window.testDisabled=true,request:async()=>(${JSON.stringify(status)})};`;
    data=data.toString().replace('<script src="../bridge.js"></script>','').replace('<script src="app.js">',()=>'<script>'+mock+'</script><script src="app.js">');
   }
   res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(data);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL==='bundled'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})});
 const origin='http://127.0.0.1:'+server.address().port;let checks=0;const errors=[],external=[];
 const check=(condition,label)=>{assert.ok(condition,label);checks++;};
 try{
  for(const language of ['de','en','fr','es']){
   const page=await browser.newPage({viewport:{width:1100,height:900}});page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
   const t=(text,params={})=>I.translate(text,language,params),plus=page.locator('.device-settings[data-device="Keep-Plus-ID"]'),pro=page.locator('.device-settings[data-device="Keep-Pro-ID"]');
   const saved=()=>page.evaluate(()=>structuredClone(testSaved[0]));
   const openInputs=card=>card.locator('.input-group').evaluate(node=>node.open=true);
   const analogRow=(card,number)=>card.locator('.input-group > .row').filter({has:page.getByRole('heading',{name:t('Add-on Analogeingang {number}',{number}),exact:true})});
   const digitalRow=(card,number)=>card.locator('.input-group > .row').filter({has:page.getByRole('heading',{name:t('Add-on Eingang {number}',{number}),exact:true})});
   const number=async(field,value)=>{await field.fill(String(value));await field.press('Tab');};
   await page.goto(origin+'/devices/index.html?language='+language);await plus.waitFor();await page.waitForFunction(()=>testSaved&&!testDisabled);
   await plus.evaluate(node=>node.open=true);await plus.getByRole('button',{name:t('Add-on hinzufügen'),exact:true}).click();
   check(await plus.locator('.addon-settings').count()===1,'Plus add-on editor '+language);
   await plus.getByLabel(t('Analogeingang'),{exact:true}).selectOption('percent');
   check(await plus.getByLabel(t('Analog-Komponentennummer'),{exact:true}).inputValue()==='101','Plus analog default component '+language);
   check((await saved()).devices[0].inputs.some(i=>i.component==='input:101'&&i.mode==='analog'&&i.unit==='%'),'percent mapping persisted '+language);
   await number(plus.getByLabel(t('Analog-Komponentennummer'),{exact:true}),115);await openInputs(plus);
   await analogRow(plus,115).getByLabel(t('Eingang anzeigen'),{exact:true}).check();await analogRow(plus,115).getByLabel(t('Kanalname'),{exact:true}).fill('Prozentwert Küche');
   await digitalRow(plus,100).getByLabel(t('Eingang anzeigen'),{exact:true}).check();await digitalRow(plus,100).getByLabel(t('Kontaktzustand umkehren'),{exact:true}).check();
   check((await saved()).devices[0].inputs.some(i=>i.component==='input:100'&&i.enabled===true&&i.invert===true&&i.mode==='state'),'digital contact and inversion saved '+language);
   await page.waitForFunction(()=>!testDisabled);const before=JSON.stringify((await saved()).devices);
   const nextLanguage=language==='fr'?'es':'fr';await page.locator('.general-settings').evaluate(node=>node.open=true);await page.getByLabel(t('Sprache'),{exact:true}).selectOption(nextLanguage);
   check(JSON.stringify((await saved()).devices)===before,'language switch preserves sensor names and all IDs '+language);
   await page.getByLabel(I.translate('Sprache',nextLanguage),{exact:true}).selectOption(language);
   check((await saved()).devices[0].id==='Keep-Plus-ID'&&(await saved()).devices[0].name==='Küche “: {error}','device identity remains literal '+language);
   await plus.getByLabel(t('Analogeingang'),{exact:true}).selectOption('voltage');
   check((await saved()).devices[0].inputs.some(i=>i.component==='voltmeter:115'&&i.mode==='analog'&&i.unit==='V')&&!(await saved()).devices[0].inputs.some(i=>i.component==='input:115'),'voltage selection replaces percentage component '+language);
   await openInputs(plus);await analogRow(plus,115).getByLabel(t('Eingang anzeigen'),{exact:true}).check();await analogRow(plus,115).getByLabel(t('Kanalname'),{exact:true}).fill('Spannung Küche');
   await page.locator('#show-overview').click();const missing=page.locator('.overview-device').first().locator('[data-component="voltmeter:115"]');
   check(await missing.locator('.channel-lamp').getAttribute('data-state')==='unknown','missing analog is unknown '+language);
   check(await missing.locator('.metric-value').count()===0,'missing analog does not display fabricated zero '+language);
   await page.locator('#show-settings').click();await plus.getByLabel(t('Analogeingang'),{exact:true}).selectOption('percent');await number(plus.getByLabel(t('Analog-Komponentennummer'),{exact:true}),100);
   const expectedError=t('Gerät „{name}“: {error}',{name:'Küche “: {error}',error:t('Komponente/ID doppelt.')});
   check(await page.locator('#message').textContent()===expectedError,'colliding analog/digital components identify device '+language);check(await page.evaluate(()=>testDisabled),'component collision blocks saving '+language);
   await number(plus.getByLabel(t('Analog-Komponentennummer'),{exact:true}),115);await page.waitForFunction(()=>!testDisabled);check(await page.locator('#message').textContent()==='','correcting component restores saving '+language);
   await pro.evaluate(node=>node.open=true);await pro.getByRole('button',{name:t('Add-on hinzufügen'),exact:true}).click();
   await pro.getByLabel(t('Analogeingang'),{exact:true}).selectOption('percent');await pro.getByLabel(t('Zweiter Analogeingang'),{exact:true}).selectOption('voltage');
   const proInputs=(await saved()).devices[1].inputs;
   check(proInputs.filter(i=>i.mode==='analog').length===2&&proInputs.some(i=>i.component==='input:102'&&i.unit==='%')&&proInputs.some(i=>i.component==='voltmeter:103'&&i.unit==='V'),'Pro supports two independent analog components '+language);
   await openInputs(pro);check(await analogRow(pro,102).count()===1&&await analogRow(pro,103).count()===1,'both Pro analog editors displayed '+language);
   await analogRow(pro,102).getByLabel(t('Eingang anzeigen'),{exact:true}).check();await analogRow(pro,103).getByLabel(t('Eingang anzeigen'),{exact:true}).check();
   await number(pro.getByLabel(t('Zweite Analog-Komponentennummer'),{exact:true}),116);
   check((await saved()).devices[1].inputs.some(i=>i.component==='voltmeter:116')&&!(await saved()).devices[1].inputs.some(i=>i.component==='voltmeter:103'),'remapping second Pro component removes its old mapping '+language);
   if(language==='de'||language==='fr'){fs.mkdirSync(path.join(root,'.preview'),{recursive:true});await pro.locator('.addon-settings').screenshot({path:path.join(root,'.preview',language==='de'?'addon-settings.png':'addon-settings-fr.png')});if(language==='de'){await openInputs(pro);await pro.locator('.input-group').screenshot({path:path.join(root,'.preview/addon-inputs.png')});}}
   await plus.getByRole('button',{name:t('Add-on entfernen'),exact:true}).click();await pro.getByRole('button',{name:t('Add-on entfernen'),exact:true}).click();
   const cleaned=(await saved()).devices;
   check(cleaned.every(d=>d.addons.length===0&&d.inputs.every(i=>i.mode!=='analog'&&Number(i.component.split(':')[1])<100)),'removing add-ons removes all orphan input mappings '+language);
   check(cleaned[0].id==='Keep-Plus-ID'&&cleaned[1].id==='Keep-Pro-ID','removal preserves device IDs '+language);await page.waitForFunction(()=>!testDisabled);
   await page.close();
  }
  check(errors.length===0,JSON.stringify(errors));check(external.length===0,'all browser requests remain local');console.log(JSON.stringify({addonBrowserChecks:checks,errors}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
