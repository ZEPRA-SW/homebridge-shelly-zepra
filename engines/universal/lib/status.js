'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {WEATHER_METRICS}=require('./bthome-weather');
const READING_METRICS=['AnalogValue','On','Brightness','CurrentTemperature','TargetTemperature','CurrentRelativeHumidity','CurrentAmbientLightLevel','BatteryLevel','MotionDetected','ContactSensorState','TargetHeatingCoolingState',...WEATHER_METRICS];
const values=(reading,active)=>active?Object.fromEntries(READING_METRICS.filter(key=>Number.isFinite(reading.values?.[key])||typeof reading.values?.[key]==='boolean').map(key=>[key,reading.values[key]])):{};
const metadata=reading=>({...((Number.isFinite(reading.observedAt)&&reading.observedAt>0)?{observedAt:reading.observedAt}:{}),...(['%','V','km/h','°','hPa','°C','mm',''].includes(reading.unit)?{unit:reading.unit}:{}),...(WEATHER_METRICS.includes(reading.metric)?{metric:reading.metric}:{})});
const sanitizeBthome=(bthome,online)=>bthome.map(b=>({id:b.id,name:b.name,deviceComponent:b.deviceComponent,fault:!online||b.fault===true,readings:(b.readings||[]).map(r=>({component:r.component,name:r.name,type:r.type,...metadata(r),fault:!online||b.fault===true||r.fault===true,values:values(r,online&&!b.fault&&!r.fault)}))}));
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
    d.readings=online?readings.map(r=>({component:r.component,name:r.name,...metadata(r),values:values(r,!r.fault)})):[];
    d.bthome=sanitizeBthome(online?bthome:d.bthome||[],online);
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
module.exports={StatusStore,readStatus,target,sanitizeBthome};
