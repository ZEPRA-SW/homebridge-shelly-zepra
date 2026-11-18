'use strict';
const {Platform: DevicePlatform}=require('./engines/universal');
const {ShellyPlatform: ShadingPlatform}=require('./engines/shading');
const {HiddenAccessories}=require('./lib/hidden-accessories');
const {SceneEngine,SceneStore}=require('./lib/scenes');
const sceneRuntime=require('./lib/scene-runtime');
const {shared}=require('./lib/cloud-queue');
const {normalize,shadingConfig}=require('./homebridge-ui/public/shared-settings');
const PLUGIN='homebridge-shelly-zepra',PLATFORM='ShellyZepra';
function validateGroups(config){
  if(config.shading!==undefined&&(!config.shading||typeof config.shading!=='object'||Array.isArray(config.shading)))throw Error('Beschattungseinstellungen müssen ein Objekt sein.');
  const general=config.devices??[],covers=config.shading?.devices??[];
  if(!Array.isArray(general)||!Array.isArray(covers))throw Error('Beide Gerätelisten müssen Listen sein.');
  const physical=d=>String(d.connection==='cloud'?d.cloudDeviceId:d.shellyDeviceId||'').toLowerCase().replace(/:/g,'').slice(-12).padStart(12,'0');
  const known=new Set(general.map(physical).filter(Boolean));
  for(const d of covers)if(known.has(physical(d)))throw Error('Ein Shelly darf nicht zugleich unter Beschattungen und anderen Geräten eingerichtet sein.');
  const seen=new Set();for(const d of covers){if(d.homekitEnabled!==undefined&&typeof d.homekitEnabled!=='boolean')throw Error('In Apple Home anzeigen muss ein/aus sein.');const key=physical(d)+':'+(d.coverId??0);if(seen.has(key))throw Error('Beschattungskanal doppelt konfiguriert.');seen.add(key);}
  return config;
}
class CombinedPlatform{
  constructor(log,config,api){
    this.config=normalize(validateGroups(config??{}));this.api=api;this.log=log;this.events={universal:{},shading:{}};
    this.hiddenIds=new Set((this.config.shading?.devices??[]).filter(d=>d.homekitEnabled===false).map(d=>d.id));this.hiddenCached=[];
    this.hiddenStore=new HiddenAccessories(api.user?.storagePath?.(),message=>log.warn(message));
    const facade=kind=>new Proxy(api,{get:(target,key)=>{
      if(key==='on')return(event,fn)=>{(this.events[kind][event]??=[]).push(fn);return target;};
      if(['registerPlatformAccessories','updatePlatformAccessories','unregisterPlatformAccessories'].includes(key))return(...args)=>{
        let accessories=key==='updatePlatformAccessories'?args[0]:args[2];
        for(const accessory of accessories){accessory.context={...accessory.context,combinedEngine:kind};if(kind==='shading'&&(this.hiddenIds.has(accessory.context.deviceId)||this.hiddenStore.records[accessory.UUID]))this.hiddenStore.capture(accessory);}
        if(kind==='shading')accessories=accessories.filter(a=>!this.hiddenIds.has(a.context.deviceId));
        if(!accessories.length)return;
        return key==='updatePlatformAccessories'?target[key](accessories):target[key](PLUGIN,PLATFORM,accessories);
      };
      // Homebridge exposes classes as API properties. Binding User would discard static storagePath/configPath methods.
      const value=Reflect.get(target,key,target);
      if(['user','platformAccessory','hapLegacyTypes'].includes(key))return value;
      return typeof value==='function'?value.bind(target):value;
    }});
    this.devices=new DevicePlatform(log,{...this.config,devices:this.config.devices??[]},facade('universal'));
    this.shading=new ShadingPlatform(log,{...shadingConfig(this.config),platform:'ShellyRaffstore',devices:this.config.shading?.devices??[]},facade('shading'));
    const covers=this.config.shading?.devices??[];
    this.coverUUIDs=new Set(covers.flatMap(d=>[
      api.hap.uuid.generate('homebridge-shelly-raffstore:'+d.id),
      api.hap.uuid.generate(JSON.stringify(['homebridge-shelly-raffstore','slats',d.id])),
      api.hap.uuid.generate(JSON.stringify(['homebridge-shelly-raffstore','sun',d.id])),
    ]));this.coverUUIDs.add(api.hap.uuid.generate(JSON.stringify(['homebridge-shelly-raffstore','global-controls'])));
    api.on('didFinishLaunching',()=>{if(this.hiddenCached.length)this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,this.hiddenCached);this.hiddenStore.seed(this.shading.cached,this.api,this.coverUUIDs);for(const kind of ['universal','shading'])for(const fn of this.events[kind].didFinishLaunching??[])fn();
      try{const model=require('./homebridge-ui/public/scene-model');model.validate(this.config.scenes||[],this.config);const store=this.config.scenes?.length?new SceneStore(api.user.storagePath()):null;if((this.config.scenes||[]).some(s=>model.mode(s)!=='off')){this.scenes=new SceneEngine({config:this.config,store,observe:(ref,now)=>sceneRuntime.observe(this,ref,now),execute:(action,allowed)=>sceneRuntime.execute(this,action,allowed),inspect:(action,now)=>sceneRuntime.inspect(this,action,now),log});this.scenes.start().catch(error=>log.error('Scene: '+error.message));}}catch(error){log.error('Scene konnte nicht gestartet werden: '+error.message);}
    });
    api.on('shutdown',()=>{this.scenes?.stop();for(const kind of ['universal','shading'])for(const fn of this.events[kind].shutdown??[])fn();this.hiddenStore.close();shared().close();});
  }
  configureAccessory(accessory){
    if(accessory.context?.combinedEngine==='shading'||this.coverUUIDs.has(accessory.UUID)){if(this.hiddenIds.has(accessory.context?.deviceId)){this.hiddenCached.push(accessory);this.hiddenStore.capture(accessory);}this.shading.configureAccessory(accessory);}
    else this.devices.configureAccessory(accessory);
  }
}
module.exports=api=>api.registerPlatform(PLUGIN,PLATFORM,CombinedPlatform);
module.exports.CombinedPlatform=CombinedPlatform;module.exports.validateGroups=validateGroups;
