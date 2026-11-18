'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZepraSettings=factory();})(typeof window==='object'?window:globalThis,()=>{
 const keys=['name','language','pollInterval'];
 function normalize(source={}){
  const shading={...source.shading},result={...source,shading};
  result.name=source.name??shading.name??'Shelly ZEPRA';result.language=source.language??shading.language??'de';
  const intervals=[source.pollInterval,shading.pollInterval].filter(Number.isFinite);
  result.pollInterval=intervals.length?Math.max(...intervals):20;
  for(const key of keys)delete shading[key];
  return result;
 }
 function shadingConfig(config){return {...config.shading,...Object.fromEntries(keys.map(key=>[key,config[key]]))};}
 return {normalize,shadingConfig};
});
