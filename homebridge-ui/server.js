'use strict';
const {loadStatus}=require('../engines/shading/lib/status-store');
const {Overview}=require('../engines/shading/lib/overview');
const {uiDocument}=require('./documents');
const {readStatus}=require('../engines/universal/lib/status');
async function start(){
 const {HomebridgePluginUiServer,RequestError}=await import(require('node:url').pathToFileURL(require.resolve('@homebridge/plugin-ui-utils')).href);
 class UiServer extends HomebridgePluginUiServer{
  constructor(){super();const overview=new Overview();
   this.onRequest('/ui-document',async payload=>{try{return await uiDocument(payload?.area);}catch(error){throw new RequestError(error.message);}});
   this.onRequest('/scene-data',async()=>{let scenes={states:{}};try{scenes=JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(this.homebridgeStoragePath,'shelly-zepra-scenes.json'),'utf8'));}catch{}return {devices:(await readStatus(this.homebridgeStoragePath)).devices,shading:await loadStatus(this.homebridgeStoragePath),states:scenes.states||{}};});
   this.onRequest('/status',()=>readStatus(this.homebridgeStoragePath));
   this.onRequest('/overview',async payload=>{try{return overview.build(payload?.config,payload?.date,await loadStatus(this.homebridgeStoragePath));}catch(error){throw new RequestError(error.message);}});
   this.ready();
  }
 }
 new UiServer();
}
start().catch(()=>{console.error('Shelly-ZEPRA-Oberfläche konnte nicht gestartet werden.');process.exitCode=1;});
