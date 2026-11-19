'use strict';
(() => {
 const clone=value=>JSON.parse(JSON.stringify(value));
 let blocks=[],config,schema,sceneUi,activeLanguage,tail=Promise.resolve();
 const t=text=>ZepraI18n.translate(text,config?.language);
 function applyLanguage(){document.documentElement.lang=ZepraI18n.normalizeLanguage(config.language);for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);for(const attribute of ['title','aria-label'])for(const node of document.querySelectorAll('[data-i18n-'+attribute+']'))node.setAttribute(attribute,t(node.getAttribute('data-i18n-'+attribute)));}
 function renderGeneral(){validity.general=ZepraGeneral.render(config,schema,valid=>{validity.general=valid;dirty.devices=dirty.shading=true;if(activeLanguage!==config.language){activeLanguage=config.language;applyLanguage();sceneUi?.relabel();sceneUi?.refresh();}persist().catch(()=>{message.hidden=false;message.textContent=t('Einstellungen konnten nicht gespeichert werden.');});});}
 const dirty={devices:false,shading:false};
 const validity={devices:true,shading:true,general:true,scenes:true},ready={devices:false,shading:false};
 const message=document.getElementById('suite-message');
 function crossError(){
  const identity=d=>String(d.connection==='cloud'?d.cloudDeviceId:d.shellyDeviceId||'').toLowerCase().replace(/:/g,'').slice(-12).padStart(12,'0');
  const known=new Set((config.devices??[]).map(identity));
  return (config.shading?.devices??[]).some(d=>known.has(identity(d))&&identity(d)!=='000000000000');
 }
 function savedState(){const duplicate=crossError();message.hidden=!duplicate;message.textContent=duplicate?t('Ein Shelly ist in beiden Bereichen konfiguriert. Bitte nur einem Bereich zuordnen.'):'';
  if(ready.devices&&ready.shading&&validity.devices&&validity.shading&&validity.general&&validity.scenes&&!duplicate)homebridge.enableSaveButton();else homebridge.disableSaveButton();
 }
 window.ShellyZepra={
  getConfig(area){return Promise.resolve([area==='shading'?{...clone(ZepraSettings.shadingConfig(config)),platform:'ShellyRaffstore',devices:clone(config.shading?.devices??[])}:{...clone(config),platform:'ShellyUniversal'}]);},
  getSchema(area){const value=clone(schema);if(area==='shading')return Promise.resolve({pluginAlias:'ShellyRaffstore',customUi:true,schema:value.schema.properties.shading});delete value.schema.properties.shading;value.pluginAlias='ShellyUniversal';return Promise.resolve(value);},
  update(area,drafts){const draft=clone(drafts[0]);delete draft.platform;
   if(area==='shading')config.shading.devices=draft.devices??[];else config.devices=draft.devices??[];
   for(const device of [...config.devices??[],...config.shading?.devices??[]])if(device.connection==='cloud'){for(const field of ['host','shellyDeviceId','password','username'])if(device[field]==='')delete device[field];}
   return persist();
  },
  valid(area,value){validity[area]=value;savedState();},
  loaded(area){ready[area]=true;savedState();},
  resize(area,height){document.getElementById(area+'-frame').style.height=Math.max(600,height+20)+'px';},
 };
 function persist(){
   if(sceneUi)validity.scenes=sceneUi.validate();
   config.platform='ShellyZepra';const i=blocks.findIndex(b=>b.platform==='ShellyZepra');if(i<0)blocks.push(config);else blocks[i]=config;
   const snapshot=clone(blocks);tail=tail.catch(()=>{}).then(()=>homebridge.updatePluginConfig(snapshot));savedState();return tail;
 }
 async function loadFrame(area){
   const frame=document.getElementById(area+'-frame');ready[area]=false;savedState();
   const {html}=await homebridge.request('/ui-document',{area});
   const base=new URL(area+'/',document.baseURI).href.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
   frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="'+base+'"></head><body>'+html+'</body></html>';dirty[area]=false;
 }
 async function start(){
  blocks=await homebridge.getPluginConfig();schema=await homebridge.getPluginConfigSchema();
  config=blocks.find(b=>b.platform==='ShellyZepra')??{platform:'ShellyZepra',name:'Shelly ZEPRA',devices:[],shading:{devices:[]}};
  config=ZepraSettings.normalize(config);config.devices??=[];config.shading.devices??=[];
  activeLanguage=config.language;applyLanguage();renderGeneral();
  sceneUi=ZepraSceneUi.mount({config,request:(...args)=>homebridge.request(...args),changed:valid=>{validity.scenes=valid;persist().catch(()=>{});}});validity.scenes=sceneUi.validate();
  homebridge.disableSaveButton();
  for(const area of ['shading','devices']){
   const frame=document.getElementById(area+'-frame');frame.addEventListener('load',()=>window.ShellyZepra.loaded(area));await loadFrame(area);
  }
  for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',async()=>{
   for(const area of ['shading','devices'])document.getElementById(area+'-frame').hidden=area!==button.dataset.area;
   document.getElementById('general-panel').hidden=button.dataset.area!=='general';document.getElementById('scenes-panel').hidden=button.dataset.area!=='scenes';if(button.dataset.area==='scenes')await sceneUi.refresh();
   for(const item of document.querySelectorAll('nav button')){const active=item===button;item.classList.toggle('selected',active);item.setAttribute('aria-selected',String(active));}
   if(['shading','devices'].includes(button.dataset.area)){if(dirty[button.dataset.area])await loadFrame(button.dataset.area);document.getElementById(button.dataset.area+'-frame').contentWindow.dispatchEvent(new Event('resize'));}
  });
 }
 homebridge.addEventListener('ready',()=>start().catch(()=>{message.hidden=false;message.textContent=t('Shelly ZEPRA konnte nicht geladen werden. Einstellungen bleiben im JSON-Editor erreichbar.');homebridge.showSchemaForm?.();}),{once:true});
})();
