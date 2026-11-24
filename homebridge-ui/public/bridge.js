'use strict';
(() => {
 const area=window.name==='shading'?'shading':'devices',suite=parent.ShellyZepra;
 const theme=suite.getTheme();document.documentElement.dataset.zepraTheme=theme;document.documentElement.dataset.raffstoreTheme=theme;
 window.homebridge={
  zepraSharedSettings:true,
  getPluginConfig:()=>suite.getConfig(area),getPluginConfigSchema:()=>suite.getSchema(area),
  updatePluginConfig:blocks=>suite.update(area,blocks),
  enableSaveButton:()=>suite.valid(area,true),disableSaveButton:()=>suite.valid(area,false),
  request:(...args)=>parent.homebridge.request(...args),
  userCurrentLightingMode:()=>Promise.resolve(suite.getTheme()),
  showSchemaForm:()=>parent.homebridge.showSchemaForm?.(),
  addEventListener:(name,fn)=>{if(name==='ready')queueMicrotask(fn);},
 };
 function resize(){const children=[...(document.body?.children??[])].filter(n=>!['SCRIPT','STYLE'].includes(n.tagName));const height=Math.max(0,...children.map(n=>n.getBoundingClientRect().bottom+window.scrollY));suite.resize(area,height);}
 window.addEventListener('load',()=>{const observer=new ResizeObserver(resize);observer.observe(document.body);for(const node of document.body.children)if(!['SCRIPT','STYLE'].includes(node.tagName))observer.observe(node);resize();});window.addEventListener('resize',resize);
})();
