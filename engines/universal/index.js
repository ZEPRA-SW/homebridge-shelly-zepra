'use strict';
const {pollDelay}=require('../../lib/local-poll');
const {validate}=require('./lib/config');
const {Client}=require('./lib/client');
const {CloudClient}=require('./lib/cloud');
const {powerReadings}=require('./lib/power');
const {model,command}=require('./lib/model');
const {Events,eventValue}=require('./lib/events');
const {types}=require('./lib/hap');
const Models=require('./homebridge-ui/public/models');
const {translate}=require('./homebridge-ui/public/i18n');
const {StatusStore}=require('./lib/status');
const {bthomeStatus}=require('./lib/bthome-status');
const {RebootScheduler}=require('./lib/reboot');
const PLUGIN='homebridge-shelly-universal', PLATFORM='ShellyUniversal';
class Platform {
  constructor(log,config,api) {
    this.log=log;try{this.config=validate(config || {});}catch(error){error.message=translate(error.message,config?.language);throw error;}this.api=api;this.cache=new Map();this.units=new Map();this.running=false;this.types=types(api.hap);
    api.on('didFinishLaunching',()=>this.launch());api.on('shutdown',()=>this.stop());
  }
  configureAccessory(accessory) {this.cache.set(accessory.UUID,accessory);}
  makeClient(config) {return config.connection==='cloud'?new CloudClient(config):new Client(config);}
  makeStatusStore() {return new StatusStore(this.api.user.storagePath(),this.config.devices||[],this.config.pollInterval||10,()=>this.log.warn('Statusanzeige konnte nicht gespeichert werden.'));}
  uuid(device,bluetooth) {return this.api.hap.uuid.generate(PLUGIN+':'+device.id+(bluetooth?':bthome:'+bluetooth.id:''));}
  channelUuid(device,component) {return this.api.hap.uuid.generate(PLUGIN+':'+device.id+':channel:'+component);}
  thermostatUuid(device,component) {return this.api.hap.uuid.generate(PLUGIN+':'+device.id+':thermostat:'+component);}
  virtualUuid(device,component) {return this.api.hap.uuid.generate(PLUGIN+':'+device.id+':virtual:'+component);}
  thermostatName(unit,component) {return unit.config.name+' '+translate('Thermostat',this.config.language)+(component==='thermostat:0'?'':' '+(Number(component.split(':')[1])+1));}
  accessorySpecs(d) {
    if(d.homekitEnabled===false)return [];
    const thermostats=d.thermostat===true?new Set(['thermostat:0',...[...this.cache.values()].filter(a=>a.context?.deviceId===d.id&&/^thermostat:\d+$/.test(a.context.thermostatComponent||'')).map(a=>a.context.thermostatComponent)]):new Set();
    return [{uuid:this.uuid(d)},...(d.tileMode==='grouped'?[]:(d.channels||[]).filter(c=>c.enabled!==false).map(c=>({uuid:this.channelUuid(d,c.component),channel:c.component}))),...[...thermostats].map(thermostat=>({uuid:this.thermostatUuid(d,thermostat),thermostat})),...(d.virtualComponents||[]).filter(v=>v.enabled!==false).map(v=>({uuid:this.virtualUuid(d,v.component),virtual:v.component})),...(d.bthome||[]).map(b=>({uuid:this.uuid(d,b),bluetooth:b}))];
  }
  launch() {
    this.running=true;
    this.statusStore=this.makeStatusStore();this.statusStore.save();
    const allowed=new Set();
    for(const d of this.config.devices || []) for(const spec of this.accessorySpecs(d))allowed.add(spec.uuid);
    for(const [uuid,a] of this.cache) if(!allowed.has(uuid)) {this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,[a]);this.cache.delete(uuid);}
    for(const d of this.config.devices || []) {
      const unit={config:d,client:this.makeClient(d),accessories:[],counters:new Map(),busy:false,failures:0,writeTail:Promise.resolve()};this.units.set(d.id,unit);
      // Bind cached services immediately; no stale successful reads during an outage.
      for(const spec of this.accessorySpecs(d)) {
        const a=this.cache.get(spec.uuid);if(!a)continue;
        const record={accessory:a,bluetooth:spec.bluetooth,channel:spec.channel,thermostat:spec.thermostat,virtual:spec.virtual,states:new Map(),offline:true};unit.accessories.push(record);
        for(const service of a.services) if(service.subtype?.startsWith('su:')) for(const c of service.characteristics) {
          if(c.UUID!==this.api.hap.Characteristic.Name.UUID) c.onGet(()=>{throw this.error();});
        }
      }
      this.poll(unit);
    }
    if((this.config.devices||[]).some(d=>d.rebootEnabled===true)){
      this.rebootScheduler=new RebootScheduler(this.api.user.storagePath(),this.units,this.log);
      this.rebootScheduler.start();
    }
  }
  error() {return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);}
  channelName(unit,component) {
    const c=unit.config.channels?.find(c=>c.component===component),name=typeof c?.name==='string'?c.name.trim():'';
    return name&&!/^Kanal \d+$/.test(name)?name:unit.config.name+' '+(name||translate('Kanal {number}',this.config.language,{number:Number(component.split(':')[1])+1}));
  }
  getRecord(unit,b,info,channel,thermostat) {
    let record=unit.accessories.find(r=>!r.virtual&&r.bluetooth?.id===b?.id&&r.channel===channel&&r.thermostat===thermostat);
    if(record) {
      const name=thermostat?this.thermostatName(unit,thermostat):channel?this.channelName(unit,channel):b?.name||unit.config.name;
      record.accessory.displayName=name;
      record.accessory.getService(this.api.hap.Service.AccessoryInformation).setCharacteristic(this.api.hap.Characteristic.Name,name);
      return record;
    }
    const uuid=thermostat?this.thermostatUuid(unit.config,thermostat):channel?this.channelUuid(unit.config,channel):this.uuid(unit.config,b),name=thermostat?this.thermostatName(unit,thermostat):channel?this.channelName(unit,channel):b?.name||unit.config.name;
    const c=unit.config.channels?.find(c=>c.component===channel),categories=this.api.hap.Categories,category=thermostat?categories.THERMOSTAT:channel?({light:categories.LIGHTBULB,outlet:categories.OUTLET,switch:categories.SWITCH})[c.type]:undefined;
    const a=new this.api.platformAccessory(name,uuid,category);
    a.context={deviceId:unit.config.id,...(b?{bthomeId:b.id}:{}),...(channel?{channelComponent:channel}:{}),...(thermostat?{thermostatComponent:thermostat}:{})};
    const serial=info.mac||info.id||unit.config.shellyDeviceId;
    a.getService(this.api.hap.Service.AccessoryInformation).setCharacteristic(this.api.hap.Characteristic.Manufacturer,'Shelly').setCharacteristic(this.api.hap.Characteristic.Model,info.model || info.type || info.app || 'Shelly').setCharacteristic(this.api.hap.Characteristic.SerialNumber,b?unit.config.id+':'+b.id:thermostat?serial+':'+thermostat:channel?serial+':'+channel:serial).setCharacteristic(this.api.hap.Characteristic.FirmwareRevision,info.ver || info.fw || 'unknown');
    this.cache.set(uuid,a);record={accessory:a,bluetooth:b,channel,thermostat,states:new Map(),offline:true};unit.accessories.push(record);
    // Add services before registration (HomeKit requires a functional service).
    record.new=true;return record;
  }
  channelOwner(unit,key,snap) {
    const channels=unit.config.channels||[];
    for(const c of channels)if(key===c.component||key===c.component+':energy'||key===c.component+':temperature')return c.component;
    if(/^meter:\d+:energy$/.test(key)) {
      // The original two-output Shelly 2 can have a single shared meter.
      if(snap.gen===1&&snap.status.meters?.length===1&&snap.status.relays?.length>1)return undefined;
      return channels.find(c=>c.component.split(':')[1]===key.split(':')[1])?.component;
    }
  }
  getVirtualRecord(unit,d,info){
    let record=unit.accessories.find(r=>r.virtual===d.key);
    if(record){record.accessory.displayName=d.name;record.accessory.getService(this.api.hap.Service.AccessoryInformation).setCharacteristic(this.api.hap.Characteristic.Name,d.name);return record;}
    const uuid=this.virtualUuid(unit.config,d.key),a=new this.api.platformAccessory(d.name,uuid,this.api.hap.Categories.SWITCH),C=this.api.hap.Characteristic;
    a.context={deviceId:unit.config.id,virtualComponent:d.key};
    a.getService(this.api.hap.Service.AccessoryInformation).setCharacteristic(C.Manufacturer,'Shelly').setCharacteristic(C.Model,info.model||info.app||'Shelly Virtual').setCharacteristic(C.SerialNumber,(info.mac||unit.config.shellyDeviceId)+':'+d.key).setCharacteristic(C.FirmwareRevision,info.ver||'unknown');
    record={accessory:a,virtual:d.key,states:new Map(),offline:true,new:true};unit.accessories.push(record);this.cache.set(uuid,a);return record;
  }
  syncAccessories(unit,snap,m) {
    if(unit.config.homekitEnabled===false)return;
    unit.generation=snap.gen;
    for(const d of m.descriptors)if(d.output&&d.values.On===true)unit.brightnessIntents?.delete(d.key);
    const virtuals=m.descriptors.filter(d=>d.virtual),configuredVirtuals=new Set((unit.config.virtualComponents||[]).filter(v=>v.enabled!==false).map(v=>v.component));
    for(const record of [...unit.accessories])if(record.virtual){
      if(!configuredVirtuals.has(record.virtual)){clearTimeout(record.momentaryTimer);if(!record.new)this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,[record.accessory]);this.cache.delete(record.accessory.UUID);unit.accessories.splice(unit.accessories.indexOf(record),1);}
      else if(!virtuals.some(d=>d.key===record.virtual))this.reconcile(unit,record,[],true);
    }
    for(const d of virtuals)this.reconcile(unit,this.getVirtualRecord(unit,d,snap.info),[d]);
    const thermostats=m.descriptors.filter(d=>d.type==='thermostat');
    for(const record of [...unit.accessories])if(record.thermostat){
      if(unit.config.thermostat!==true){if(!record.new)this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,[record.accessory]);this.cache.delete(record.accessory.UUID);unit.accessories.splice(unit.accessories.indexOf(record),1);}
      else if(!thermostats.some(d=>d.key===record.thermostat))this.reconcile(unit,record,[],true);
    }
    for(const descriptor of thermostats)this.reconcile(unit,this.getRecord(unit,undefined,snap.info,undefined,descriptor.key),[descriptor]);
    const regular=m.descriptors.filter(d=>d.type!=='thermostat'&&!d.virtual);
    if(unit.config.tileMode==='grouped') {
      for(const record of [...unit.accessories])if(record.channel){if(!record.new)this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,[record.accessory]);this.cache.delete(record.accessory.UUID);unit.accessories.splice(unit.accessories.indexOf(record),1);}
      const root=this.getRecord(unit,undefined,snap.info),outputs=new Set(regular.filter(d=>d.output).map(d=>d.key)),merged=new Set();
      const descriptors=regular.map(d=>{
        if(!d.output)return d;
        const meters=regular.filter(meter=>meter.type==='energy'&&this.channelOwner(unit,meter.key,snap)===d.key);
        for(const meter of meters)merged.add(meter.key);
        return {...d,values:{...d.values,...Object.assign({},...meters.map(meter=>meter.values))}};
      }).filter(d=>!(d.type==='energy'&&outputs.has(this.channelOwner(unit,d.key,snap))));
      root.splitHost=false;root.channelOwnedKeys=new Set();root.mergedEnergyKeys=merged;
      this.reconcile(unit,root,descriptors);
      for(const b of m.bluetooth)this.reconcile(unit,this.getRecord(unit,b.config,snap.info),b.descriptors,b.fault);
      return;
    }
    const groups=new Map((unit.config.channels||[]).filter(c=>c.enabled!==false).map(c=>[c.component,[]])),host=[];
    for(const record of [...unit.accessories])if(record.channel&&!groups.has(record.channel)) {
      if(!record.new)this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,[record.accessory]);
      this.cache.delete(record.accessory.UUID);unit.accessories.splice(unit.accessories.indexOf(record),1);
    }
    for(const descriptor of regular){const owner=this.channelOwner(unit,descriptor.key,snap);if(owner&&groups.has(owner))groups.get(owner).push(descriptor);else if(!owner)host.push(descriptor);}
    const root=this.getRecord(unit,undefined,snap.info);
    root.splitHost=true;root.mergedEnergyKeys=new Set();root.channelOwnedKeys=new Set(root.accessory.services.filter(s=>s.subtype?.startsWith('su:')&&this.channelOwner(unit,s.subtype.slice(3),snap)).map(s=>s.subtype.slice(3)));
    this.reconcile(unit,root,host);
    for(const [component,descriptors] of groups) {
      const record=this.getRecord(unit,undefined,snap.info,component),output=descriptors.find(d=>d.output);
      let values=descriptors;
      record.mergeEnergy=!!output;
      if(output) {
        const meters=descriptors.filter(d=>d.type==='energy');
        const combined={...output,name:this.channelName(unit,component),values:{...output.values,...Object.assign({},...meters.map(d=>d.values))}};
        values=[combined,...descriptors.filter(d=>d!==output&&d.type!=='energy')];
      }
      this.reconcile(unit,record,values);
    }
    for(const b of m.bluetooth)this.reconcile(unit,this.getRecord(unit,b.config,snap.info),b.descriptors,b.fault);
  }
  reconcile(unit,record,descriptors,fault=false) {
    const {chars,services}=this.types,C=this.api.hap.Characteristic;
    record.offline=fault;
    const live=new Set();
    for(const d of descriptors) {
      const subtype='su:'+d.key, Type=services[d.type];if(!Type)continue;
      let service=record.accessory.getServiceById(Type,subtype);
      if(!service) {
        for(const s of [...record.accessory.services]) if(s.subtype===subtype) record.accessory.removeService(s);
        service=record.accessory.addService(new Type(d.name,subtype));
      }
      live.add(service);record.states.set(d.key,d);
      if(d.output||d.type==='thermostat')service.setPrimaryService(true);
      service.setCharacteristic(C.Name,d.name);
      if(d.type==='outlet') service.updateCharacteristic(C.OutletInUse,!!d.values.On);
      if(d.type==='button') {
        service.getCharacteristic(C.ProgrammableSwitchEvent).setProps({validValues:[0,1,2]}).onGet(()=>null);
        if(d.counter!==undefined) {
          const previous=unit.counters.get(d.key);unit.counters.set(d.key,d.counter);
          if(previous!==undefined && previous!==d.counter && d.counter>previous) {
            const value=eventValue(d.event);if(value!==undefined)service.getCharacteristic(C.ProgrammableSwitchEvent).sendEventNotification(value);
          }
        }
      }
      const supported=new Set([C.Name.UUID,C.StatusFault.UUID]);
      if(d.type==='outlet') supported.add(C.OutletInUse.UUID);
      if(d.type==='button') supported.add(C.ProgrammableSwitchEvent.UUID);
      for(const [key,value] of [...Object.entries(d.values),...(d.missingValues||[]).map(k=>[k,undefined])]) {
        const Char=chars[key];if(!Char)continue;supported.add(Char.UUID);
        const ch=service.testCharacteristic(Char)?service.getCharacteristic(Char):service.addCharacteristic(Char);
        if(d.virtual&&key==='On'){const P=this.api.hap.Perms;ch.setProps({perms:[P.PAIRED_READ,P.NOTIFY,...(d.writable===false?[]:[P.PAIRED_WRITE])]});}
        if(key==='AnalogValue')ch.setProps({unit:d.unit==='V'?'V':'percentage',minValue:0,maxValue:d.unit==='V'?1000:100,minStep:.001});
        if(key==='CurrentTemperature') ch.setProps({minValue:-100,maxValue:200});
        if(d.type==='thermostat'&&key==='TargetTemperature')ch.setProps({minValue:5,maxValue:35,minStep:.5});
        if(d.type==='thermostat'&&key==='TargetHeatingCoolingState')ch.setProps({validValues:[0,1,2]});
        if(key==='ColorTemperature') {
          // Explicit per-channel Kelvin limits avoid claiming an arbitrary range.
          const c=unit.config.channels?.find(c=>c.component===d.key), min=c?.minKelvin || 2700, max=c?.maxKelvin || 6500;
          ch.setProps({minValue:Math.ceil(1e6/max),maxValue:Math.floor(1e6/min)});
        }
        ch.onGet(()=>{const state=record.states.get(d.key);if(record.offline || state?.fault || !Object.hasOwn(state?.values || {},key))throw this.error();return state.values[key];});
        if(d.output&&['On','Brightness','Hue','Saturation','ColorTemperature'].includes(key)||d.control&&['TargetTemperature','TargetHeatingCoolingState','TemperatureDisplayUnits'].includes(key)) ch.onSet(async v=>{
          if(record.offline || d.fault)throw this.error();
          if(d.momentary&&v===false)return;
          try {
            const job=unit.writeTail.then(async()=>{
              const state=record.states.get(d.key);if(!state || state.fault || record.offline)throw this.error();
              // HomeKit can send brightness before On. Keep that explicit level
              // until the following On, or discard it on an explicit Off.
              const pending=unit.brightnessIntents?.get(d.key);
              const effective=key==='On'&&v&&pending!==undefined?{...state,options:{...state.options,onBrightness:pending}}:state;
              const values=command(effective,key,v,state.values);
              unit.sceneWriters??=new Map();unit.sceneWriters.delete(d.key);unit.sceneRevisions??=new Map();unit.sceneRevisions.set(d.key,(unit.sceneRevisions.get(d.key)||0)+1);await unit.client.write(d.key,values);
              const latest=record.states.get(d.key);
              if(latest){latest.values[key]=d.momentary?false:key==='Brightness'?(values.brightness??values.gain??v):v;
                if(key==='On'&&v&&(values.brightness!==undefined||values.gain!==undefined))latest.values.Brightness=values.brightness??values.gain;
              }
              if(key==='Brightness'){
                unit.brightnessIntents??=new Map();const level=values.brightness??values.gain;
                if(level>0&&state.values.On===false)unit.brightnessIntents.set(d.key,level);else unit.brightnessIntents.delete(d.key);
              }else if(key==='On')unit.brightnessIntents?.delete(d.key);
            });
            unit.writeTail=job.catch(()=>{});await job;
            if(d.momentary){clearTimeout(record.momentaryTimer);record.momentaryTimer=setTimeout(()=>{if(!record.offline)service.getCharacteristic(C.On).updateValue(false);},300);record.momentaryTimer.unref?.();}
            this.poll(unit);
          } catch(e) {this.log.error(unit.config.id+': '+e.message+(e.rpcDiagnostic?' '+JSON.stringify(e.rpcDiagnostic):''));throw this.error();}
        });
        ch.updateValue(fault||d.fault?this.error():value);
      }
      for(const ch of [...service.characteristics]) if(!supported.has(ch.UUID)) service.removeCharacteristic(ch);
      if(!service.testCharacteristic(C.StatusFault))service.addCharacteristic(C.StatusFault);
      service.updateCharacteristic(C.StatusFault,fault||d.fault?1:0);
    }
    // Missing readings retain their service and report an error instead of fabricating zero.
    for(const service of [...record.accessory.services]) if(service.subtype?.startsWith('su:') && !live.has(service)) {
      const key=service.subtype.slice(3);record.states.delete(key);
      const addonSensor=/^(temperature|humidity):/.test(key) && ((unit.generation===1||unit.config.generation==='gen1')?key!=='temperature:internal':Number(key.split(':')[1])>=100);
      const addonDisabled=addonSensor&&(!unit.config.addons?.length||(key.startsWith('temperature:')?unit.config.addons[0].temperature===false:unit.config.addons[0].humidity===false));
      const energyChannel=(unit.config.channels||[]).find(c=>key===c.component+':energy'||key.startsWith('meter:')&&key.split(':')[1]===c.component.split(':')[1]);
      const temperatureChannel=(unit.config.channels||[]).find(c=>key===c.component+':temperature');
      const removed=!record.bluetooth && (
        record.splitHost&&record.channelOwnedKeys?.has(key) ||
        record.channel&&record.mergeEnergy&&key.endsWith(':energy') ||
        record.mergedEnergyKeys?.has(key) ||
        (/^(switch|relay|light|rgb|rgbw|cct|color|white):\d+$/.test(key) && !unit.config.channels?.some(c=>c.component===key&&c.enabled!==false)) ||
        (/^(input|extinput|voltmeter):/.test(key) && !unit.config.inputs?.some(c=>c.component===key&&c.enabled!==false)) ||
        (key.endsWith(':energy') && (unit.config.energy===false||energyChannel?.showEnergy===false||energyChannel?.enabled===false)) ||
        (temperatureChannel&&temperatureChannel.showTemperature!==true) ||
        (addonDisabled&&!unit.config.cloudSensors) ||
        (key.startsWith('thermostat:')&&(unit.config.thermostat!==true||!record.thermostat)) ||
        (key.startsWith('illuminance:')&&unit.config.wallIlluminance!==true) ||
        (!addonSensor&&key.startsWith('temperature:')&&(unit.config.modelId==='wall-xl'||unit.config.wallTemperature!==true)) ||
        (!addonSensor&&key.startsWith('humidity:')&&(unit.config.modelId==='wall-xl'||unit.config.wallHumidity!==true)) ||
        (key.startsWith('motion:')&&unit.config.wallMotion!==true) ||
        (/^(battery|devicepower):/.test(key)||key.endsWith(':temperature')));
      if(removed&&!(unit.config.connection==='cloud'&&unit.config.cloudSensors===true&&/^(temperature|humidity|motion|battery|devicepower|illuminance|contact):/.test(key))){record.accessory.removeService(service);continue;}
      for(const ch of service.characteristics) if(ch.UUID!==C.Name.UUID) ch.updateValue(this.error());
    }
    const functional=record.accessory.services.some(s=>s.subtype?.startsWith('su:'));
    if(!record.new&&!functional){this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,[record.accessory]);record.new=true;}
    if(record.new && live.size) {this.api.registerPlatformAccessories(PLUGIN,PLATFORM,[record.accessory]);record.new=false;}
    if(!record.new) this.api.updatePlatformAccessories([record.accessory]);
  }
  async sceneAction(action,allowed){
    const unit=this.units.get(action.deviceId);if(!unit)throw Error('Scene-Ziel nicht verfügbar.');
    const job=unit.writeTail.then(async()=>{
      if(!allowed()||!this.running||!unit.sceneOnline||Date.now()-unit.sceneCheckedAt>(this.statusStore?.maxAge??Math.max(30000,(this.config.pollInterval||20)*3000+15000)))throw Error('Scene: keine aktuellen Zieldaten.');
      const descriptor=unit.sceneModel?.descriptors.find(d=>d.key===action.component&&d.output&&!d.fault&&Object.hasOwn(d.values,action.property));
      if(!descriptor)throw Error('Scene: Ausgang oder Funktion nicht verfügbar.');
      unit.sceneWriters??=new Map();unit.sceneWriters.set(action.component,action._sceneRestoreToken);unit.sceneRevisions??=new Map();unit.sceneRevisions.set(action.component,(unit.sceneRevisions.get(action.component)||0)+1);await unit.client.write(action.component,command(descriptor,action.property,action.value),allowed);
    });unit.writeTail=job.catch(()=>{});await job;if(this.running)this.poll(unit);
  }
  async poll(unit) {
    if(unit.busy || !this.running)return;unit.busy=true;clearTimeout(unit.timer);
    try {
      const snap=await unit.client.snapshot();if(!this.running)return;
      const m=model(snap,{...unit.config,language:this.config.language});
      for(const warning of m.warnings) if(!unit.warnings?.has(warning)) this.log.warn(unit.config.id+': '+warning);
      unit.warnings=new Set(m.warnings);
      this.syncAccessories(unit,snap,m);
      const statusModel=model(snap,{...unit.config,language:this.config.language,channels:(unit.config.channels||[]).map(c=>({...c,enabled:true})),inputs:(unit.config.inputs||[]).map(i=>({...i,enabled:true,mode:i.mode==='analog'?'analog':'state'}))});
      unit.sceneModel=statusModel;unit.sceneCheckedAt=Date.now();unit.sceneOnline=true;
      this.statusStore?.update(unit.config.id,true,Date.now(),powerReadings(snap,{...unit.config,language:this.config.language}),statusModel.descriptors.filter(d=>d.type!=='energy'&&!d.fault&&Object.keys(d.values).length).map(d=>({component:d.key,name:d.name,...(d.unit?{unit:d.unit}:{}),values:d.values})),bthomeStatus(snap,statusModel));
      if(unit.failures) this.log.info(unit.config.id+': wieder erreichbar.');unit.failures=0;
      if(unit.config.homekitEnabled!==false && unit.config.connection!=='cloud' && snap.gen===2 && !unit.events && ((unit.config.inputs || []).some(i=>i.enabled!==false&&i.mode==='button') || (unit.config.bthome||[]).some(b=>b.buttonIndices?.length)||(unit.config.virtualComponents||[]).some(v=>v.enabled!==false&&v.mode==='events'))) {
        unit.events=new Events(unit.client,(event,value)=>this.event(unit,event,value),message=>this.log.warn(unit.config.id+': '+message));unit.events.start();
      }
    } catch(e) {
      unit.sceneOnline=false;
      this.statusStore?.update(unit.config.id,false);
      if(unit.failures++===0 || unit.failures%12===0)this.log.error(unit.config.id+': '+e.message+(e.rpcDiagnostic?' '+JSON.stringify(e.rpcDiagnostic):''));
      unit.events?.stop();unit.events=null;
      for(const r of unit.accessories){r.offline=true;for(const s of r.accessory.services) if(s.subtype?.startsWith('su:')) for(const c of s.characteristics) if(c.UUID!==this.api.hap.Characteristic.Name.UUID)c.updateValue(this.error());}
    } finally {
      unit.busy=false;
      if(this.running){const interval=(this.config.pollInterval||10)*1000;unit.pollCycle=(unit.pollCycle||0)+1;unit.timer=setTimeout(()=>this.poll(unit),unit.config.connection==='cloud'?interval:pollDelay(interval,unit.config.id,unit.pollCycle));unit.timer.unref?.();}
    }
  }
  event(unit,event,value) {
    let record,key=event.component;
    if(key.startsWith('input:')) record=unit.accessories.find(r=>!r.bluetooth&&!r.channel&&!r.thermostat&&!r.virtual);
    else if(/^button:2\d\d$/.test(key))record=unit.accessories.find(r=>r.virtual===key);
    else if(key.startsWith('bthomedevice:')) {record=unit.accessories.find(r=>r.bluetooth?.deviceComponent===key);key='button:'+(event.idx || 0);}
    else if(key.startsWith('bthomesensor:')) {
      record=unit.accessories.find(r=>r.bluetooth && [...r.states.values()].some(d=>d.key===key||d.eventComponent===key));
      key=[...record?.states.values()||[]].find(d=>d.key===key||d.eventComponent===key)?.key;
    }
    if(!record || record.offline || record.states.get(key)?.type!=='button')return;
    record.accessory.getServiceById(this.types.services.button,'su:'+key)?.getCharacteristic(this.api.hap.Characteristic.ProgrammableSwitchEvent).sendEventNotification(value);
  }
  stop(){this.running=false;this.rebootScheduler?.stop();this.statusStore?.stop();for(const u of this.units.values()){clearTimeout(u.timer);u.client.stop?.();u.events?.stop();for(const r of u.accessories)clearTimeout(r.momentaryTimer);}}
}
module.exports=api=>api.registerPlatform(PLUGIN,PLATFORM,Platform);
module.exports.Platform=Platform;
