'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZepraSettings=factory();})(typeof window==='object'?window:globalThis,()=>{
 const keys=['name','language','pollInterval'];
 function systemTimeZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}}
 function timeZones(current=systemTimeZone()){let zones=[];try{zones=Intl.supportedValuesOf('timeZone');}catch{zones=['Europe/Berlin','Europe/London','America/New_York','America/Los_Angeles','Asia/Tokyo','Australia/Sydney'];}return [...new Set(['UTC',current,...zones])].sort();}
 function hasLocation(shading={}){return typeof shading.latitude==='number'&&Number.isFinite(shading.latitude)&&Math.abs(shading.latitude)<=89.9&&typeof shading.longitude==='number'&&Number.isFinite(shading.longitude)&&Math.abs(shading.longitude)<=180;}
 function requiresLocation(config={}){return Array.isArray(config.shading?.devices)&&config.shading.devices.some(d=>d?.sunAutomation?.enabled===true);}
 function normalize(source={},defaults={}){
  const shading={...source.shading},result={...source,shading};
  result.name=source.name??shading.name??'Shelly ZEPRA';const language=source.language??shading.language;result.language=['de','en','fr','es'].includes(language)?language:'en';shading.timeZone??=defaults.timeZone??systemTimeZone();
  const intervals=[source.pollInterval,shading.pollInterval].filter(Number.isFinite);
  result.pollInterval=intervals.length?Math.max(...intervals):20;
  for(const key of keys)delete shading[key];
  return result;
 }
 function shadingConfig(config){return {...config.shading,...Object.fromEntries(keys.map(key=>[key,config[key]]))};}
 return {normalize,shadingConfig,systemTimeZone,timeZones,hasLocation,requiresLocation};
});
