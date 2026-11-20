'use strict';
const {Platform}=require('../engines/universal');
const {model}=require('../engines/universal/lib/model');
const {bthomeStatus}=require('../engines/universal/lib/bthome-status');
const {sanitizeBthome}=require('../engines/universal/lib/status');

// Reuse sensor identity, HAP and decoding without a second client, poll timer or status file.
class ShadingBthome extends Platform {
  constructor(log,config,api) {
    const quietApi=new Proxy(api,{get:(target,key)=>key==='on'?()=>target:Reflect.get(target,key,target)});
    super(log,{language:config.language,devices:[]},quietApi);
    this.api=api;this.config={language:config.language,pollInterval:config.pollInterval??20};
    this.hosts=config.shading?.devices??[];this.running=true;
    this.maxAge=Math.max(30000,this.config.pollInterval*3000+15000);
  }
  uuid(device,bluetooth) {
    return this.api.hap.uuid.generate('homebridge-shelly-zepra:shading:'+device.id+':bthome:'+bluetooth.id);
  }
  getRecord(unit,b,info) {
    const record=super.getRecord(unit,b,info);
    record.accessory.context.bthomeHostArea='shading';
    return record;
  }
  prune() {
    const allowed=new Set(this.hosts.filter(d=>d.homekitEnabled!==false&&d.connection!=='cloud').flatMap(d=>(d.bthome||[]).map(b=>this.uuid(d,b))));
    for(const [uuid,a]of this.cache)if(!allowed.has(uuid)) {
      this.api.unregisterPlatformAccessories('homebridge-shelly-universal','ShellyUniversal',[a]);this.cache.delete(uuid);
    }
  }
  attach(runtime) {
    const d=runtime.config;
    if(!d.bthome?.length||d.connection==='cloud')return;
    const unit={config:{...d,channels:[],inputs:[],addons:[],energy:false},accessories:[],counters:new Map(),writeTail:Promise.resolve(),client:runtime.client};
    this.units.set(d.id,unit);
    runtime.bthomeStatus={bthome:[],bthomeCheckedAt:null,bthomeOnline:false,bthomeMaxAge:this.maxAge};
    if(d.homekitEnabled!==false)for(const b of d.bthome||[]) {
      const a=this.cache.get(this.uuid(d,b));if(!a)continue;
      a.context.bthomeHostArea='shading';
      const record={accessory:a,bluetooth:b,states:new Map(),offline:true};unit.accessories.push(record);
      for(const service of a.services)if(service.subtype?.startsWith('su:'))for(const ch of service.characteristics)if(ch.UUID!==this.api.hap.Characteristic.Name.UUID)ch.onGet(()=>{throw this.error();});
    }
  }
  unavailable(runtime) {
    const unit=this.units.get(runtime.config.id);
    for(const record of unit?.accessories||[])this.reconcile(unit,record,[],true);
    runtime.bthomeStatus={bthome:sanitizeBthome(runtime.bthomeStatus?.bthome||[],false),bthomeCheckedAt:Date.now(),bthomeOnline:false,bthomeMaxAge:this.maxAge};
  }
  async poll(runtime) {
    const unit=this.units.get(runtime.config.id);
    if(!this.running||!unit||!unit.config.bthome?.length||unit.config.connection==='cloud')return;
    try {
      const snap=await runtime.client.snapshotComponents(unit.config.bthome);
      if(!this.running||runtime.controller?.disposed)return;
      const m=model(snap,{...unit.config,language:this.config.language});
      if(unit.config.homekitEnabled!==false)for(const b of m.bluetooth)this.reconcile(unit,this.getRecord(unit,b.config,snap.info),b.descriptors,b.fault);
      runtime.bthomeStatus={bthome:sanitizeBthome(bthomeStatus(snap,m),true),bthomeCheckedAt:Date.now(),bthomeOnline:true,bthomeMaxAge:this.maxAge};
      unit.lastError=undefined;
    } catch(error) {
      if(!this.running||runtime.controller?.disposed)return;
      this.unavailable(runtime);
      if(unit.lastError!==error.message)this.log.warn(runtime.config.name+': BTHome: '+error.message);
      unit.lastError=error.message;
    }
    return runtime.bthomeStatus;
  }
  stop() {
    this.running=false;
    for(const unit of this.units.values())for(const record of unit.accessories)record.offline=true;
  }
}
module.exports={ShadingBthome};
