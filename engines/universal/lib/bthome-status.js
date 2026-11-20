'use strict';
const {address}=require('./bthome-weather');
// Keep configured sensor identity and unavailable components in the read-only dashboard.
function bthomeStatus(snap,modeled){
 return modeled.bluetooth.map(group=>{
  const device=snap.components?.find(c=>c.key===group.config.deviceComponent),deviceAddress=address(device?.config?.addr),used=new Set();
  const readings=(snap.components||[]).filter(c=>deviceAddress&&c.key.startsWith('bthomesensor:')&&address(c.config?.addr)===deviceAddress).map(c=>{
   const descriptor=group.descriptors.find(d=>d.key===c.key||d.eventComponent===c.key);if(descriptor)used.add(descriptor.key);
   return {component:c.key,name:descriptor?.name||c.config?.name||c.key,type:descriptor?.type||'unavailable',...(Number.isFinite(descriptor?.observedAt)?{observedAt:descriptor.observedAt}:{}),...(descriptor?.metric?{metric:descriptor.metric,unit:descriptor.unit}:{}),fault:!descriptor||descriptor.fault===true,values:descriptor?.values||{}};
  });
  for(const d of group.descriptors)if(!used.has(d.key))readings.push({component:d.key,name:d.name,type:d.type,...(Number.isFinite(d.observedAt)?{observedAt:d.observedAt}:{}),...(d.metric?{metric:d.metric,unit:d.unit}:{}),fault:d.fault===true,values:d.values});
  return {id:group.config.id,name:group.config.name,deviceComponent:group.config.deviceComponent,fault:group.fault===true,readings};
 });
}
module.exports={bthomeStatus};
