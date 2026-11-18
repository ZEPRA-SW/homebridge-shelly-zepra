'use strict';
const {model,components}=require('./model');
const METRICS=['Power','Energy','Voltage','Current','ReturnedEnergy','Frequency','PowerFactor','ApparentPower','ReactivePower'];
function powerReadings(snap,config){
  const m=model(snap,{...config,energy:true,channels:(config.channels||[]).map(c=>({...c,showEnergy:true,enabled:true}))});
  const raw=components(snap);
  return m.descriptors.filter(d=>d.type==='energy'&&!d.fault).map(d=>{
    const component=d.key.replace(/:energy$/,''),shared=component.startsWith('meter:')&&snap.gen===1&&snap.status.meters?.length===1&&snap.status.relays?.length>1,c=shared?undefined:(config.channels||[]).find(c=>c.component===component||component.startsWith('meter:')&&c.component.split(':')[1]===component.split(':')[1]);
    const parts=component.split(':'),s=raw[parts.slice(0,2).join(':')]||{},prefix=parts[2]?parts[2].toLowerCase()+'_':'',values={...d.values,Frequency:s.freq,PowerFactor:s[prefix+'pf'],ApparentPower:s[prefix+'aprt_power'],ReactivePower:s[prefix+'react_power']};
    return {component,...(c?{channel:c.component}:{}),name:shared?'Gemeinsamer Zähler':c?.name||d.name,values:Object.fromEntries(METRICS.filter(k=>Number.isFinite(values[k])).map(k=>[k,values[k]]))};
  }).filter(r=>Object.keys(r.values).length);
}
module.exports={powerReadings,METRICS};
