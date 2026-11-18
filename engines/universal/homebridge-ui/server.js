'use strict';
const {readStatus}=require('../lib/status');
async function start(){
const {HomebridgePluginUiServer}=await import('@homebridge/plugin-ui-utils');
class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/status',()=>readStatus(this.homebridgeStoragePath));
    this.ready();
  }
}
new UiServer();
}
start().catch(()=>{console.error('Statusanzeige konnte nicht gestartet werden.');process.exitCode=1;});
