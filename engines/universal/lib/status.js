'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const FILE='shelly-universal-status.json';
const target=d=>JSON.stringify([d.id,d.connection==='cloud'?'cloud:'+d.cloudServer:d.host,String((d.connection==='cloud'?d.cloudDeviceId:d.shellyDeviceId)||'').toLowerCase().replace(/:/g,'').slice(-12)]);
class StatusStore {
  constructor(storage,devices,interval,onError=()=>{}) {
    this.file=path.join(storage,FILE);this.onError=onError;this.failed=false;this.tail=Promise.resolve();
    this.maxAge=Math.max(30000,interval*3000+15000,devices.filter(d=>d.connection==='cloud').length*3200+interval*3000);
    this.devices=new Map(devices.map(d=>[d.id,{target:target(d),online:null,checkedAt:null,lastSuccessAt:null}]));
  }
  update(id,online,now=Date.now(),measurements=[],readings=[],bthome=[]) {
    const d=this.devices.get(id);if(!d)return Promise.resolve();
    d.online=online;d.checkedAt=now;if(online)d.lastSuccessAt=now;
    d.measurements=online?measurements.map(r=>({component:r.component,...(/^(switch|relay|light|rgb|rgbw|cct|color|white):\d+$/.test(r.channel||'')?{channel:r.channel}:{}),name:r.name,values:Object.fromEntries(['Power','Energy','Voltage','Current','ReturnedEnergy','Frequency','PowerFactor','ApparentPower','ReactivePower'].filter(k=>Number.isFinite(r.values?.[k])).map(k=>[k,r.values[k]]))})):[];
    d.readings=online?readings.map(r=>({component:r.component,name:r.name,...(['%','V'].includes(r.unit)?{unit:r.unit}:{}),values:Object.fromEntries(['AnalogValue','On','Brightness','CurrentTemperature','TargetTemperature','CurrentRelativeHumidity','CurrentAmbientLightLevel','BatteryLevel','MotionDetected','ContactSensorState','TargetHeatingCoolingState'].filter(k=>!r.fault&&(Number.isFinite(r.values?.[k])||typeof r.values?.[k]==='boolean')).map(k=>[k,r.values[k]]))})):[];
    d.bthome=(online?bthome:d.bthome||[]).map(b=>({id:b.id,name:b.name,deviceComponent:b.deviceComponent,fault:!online||b.fault===true,readings:(b.readings||[]).map(r=>({component:r.component,name:r.name,type:r.type,fault:!online||r.fault===true,values:online&&!r.fault?Object.fromEntries(['CurrentTemperature','CurrentRelativeHumidity','CurrentAmbientLightLevel','BatteryLevel','MotionDetected','ContactSensorState'].filter(k=>Number.isFinite(r.values?.[k])||typeof r.values?.[k]==='boolean').map(k=>[k,r.values[k]])):{} }))}));
    return this.save();
  }
  save() {
    const data=JSON.stringify({version:1,maxAge:this.maxAge,devices:[...this.devices.values()]});
    this.tail=this.tail.then(async()=>{
      const temp=this.file+'.'+process.pid+'.tmp';
      try {await fs.writeFile(temp,data,{mode:0o600});await fs.rename(temp,this.file);this.failed=false;}
      catch {await fs.unlink(temp).catch(()=>{});if(!this.failed)this.onError();this.failed=true;}
    });return this.tail;
  }
  stop() {for(const d of this.devices.values()){d.online=false;d.checkedAt=Date.now();}return this.save();}
}
async function readStatus(storage) {
  try {
    const result=JSON.parse(await fs.readFile(path.join(storage,FILE),'utf8'));
    if(result.version!==1||!Array.isArray(result.devices)||!Number.isFinite(result.maxAge))return {devices:[]};
    return result;
  } catch {return {devices:[]};}
}
module.exports={StatusStore,readStatus,target};
