'use strict';
const Models=require('../homebridge-ui/public/models');
const {translate}=require('../homebridge-ui/public/i18n');
const {virtualDescriptors}=require('./virtual');
const {weatherReading,address}=require('./bthome-weather');
const finite = v => typeof v === 'number' && Number.isFinite(v);
const celsius = t => finite(t?.tC)?t.tC:finite(t?.tF)?(t.tF-32)*5/9:undefined;
const clean = obj => Object.fromEntries(Object.entries(obj).filter(([,v])=>finite(v) || typeof v === 'boolean'));
function rgbToHs(rgb) {
  const [r,g,b] = rgb.map(x=>x/255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = !d ? 0 : max === r ? ((g-b)/d)%6 : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return {Hue: (h*60+360)%360, Saturation: max ? d/max*100 : 0};
}
function hsToRgb(h,s) {
  const c=s/100, x=c*(1-Math.abs((h/60)%2-1)), m=1-c;
  const rgb = h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return rgb.map(v=>Math.round((v+m)*255));
}
function components(snap) {
  if (snap.gen !== 1) return snap.status;
  const s=snap.status, map={};
  for (const [array,kind] of [['relays','relay'],['lights','light'],['inputs','input'],['meters','meter'],['emeters','emeter']]) {
    (s[array] || []).forEach((v,id)=>map[kind+':'+id]=v);
  }
  // Gen1 RGBW color/white endpoints share the lights status array.
  (s.lights || []).forEach((v,id)=>{if(snap.settings.mode==='color') map['color:'+id]=v; if(snap.settings.mode==='white') map['white:'+id]=v;});
  for(const [id,t] of Object.entries(s.ext_temperature || {})) map['temperature:'+id]={tC:celsius(t),tF:t.tF,is_valid:t.is_valid};
  for(const [id,h] of Object.entries(s.ext_humidity || {})) map['humidity:'+id]={rh:h.hum, is_valid:h.is_valid};
  if(finite(celsius(s.tmp))) map['temperature:internal']={tC:celsius(s.tmp),tF:s.tmp.tF,is_valid:s.tmp.is_valid};
  if(finite(s.hum?.value)) map['humidity:0']={rh:s.hum.value,is_valid:s.hum.is_valid};
  if(finite(s.lux?.value)) map['illuminance:0']={lux:s.lux.value,is_valid:s.lux.is_valid};
  if(typeof s.motion === 'boolean') map['motion:0']={motion:s.motion};
  if(finite(s.bat?.value)) map['battery:0']={percent:s.bat.value};
  if(snap.cloud&&['open','close'].includes(s.sensor?.state))map['contact:0']={open:s.sensor.state==='open',is_valid:s.sensor.is_valid};
  for(const [id,switchState] of Object.entries(s.ext_switch || {})) if(switchState.input!==undefined)map['extinput:'+id]={state:!!switchState.input};
  return map;
}
function isCover(snap) {return snap.info.profile === 'cover' || ['roller','cover'].includes(snap.settings.mode) || Object.keys(snap.status).some(k=>k.startsWith('cover:')) || !!snap.status.rollers?.length;}
function model(snap, config, now = Date.now()/1000) {
  const t=text=>translate(text,config.language);
  const map = components(snap), result = [], warnings = [];
  const add=(key,type,values,extra={})=>result.push({key,type,name:extra.name || key,values:clean(values),...extra});
  const cover=isCover(snap);
  const generationMismatch=config.generation==='gen1'&&snap.gen!==1;
  if(generationMismatch)warnings.push('Gewähltes Gen1-Modell passt nicht zum RPC-Gerät. '+(config.modelId==='gen1-4pro'?'Bei Pro 4PM das Modell Shelly Pro 4PM wählen, nicht Shelly 4Pro (Gen1).':'Bitte die Modellauswahl prüfen.'));
  const selectedProfile=Models.profile(config),actualProfile=snap.gen===1?snap.settings.mode:snap.info.profile;
  const wrongProfile=selectedProfile?.deviceProfile && actualProfile && selectedProfile.deviceProfile!==actualProfile;
  if(wrongProfile)warnings.push('Gewähltes Lichtprofil passt nicht zum am Shelly eingerichteten Profil. Ausgänge gesperrt.');
  if(snap.bthomeError)warnings.push(snap.bthomeError);
  if(cover) warnings.push('Cover-/Rollladenprofil: alle Ausgänge gesperrt.');
  for (const c of config.channels || []) {
    if(c.enabled===false)continue;
    const s=map[c.component];
    if(cover || wrongProfile || generationMismatch || !s) {if(!generationMismatch)warnings.push('Ausgang nicht verfügbar: '+c.component);continue;}
    const on = snap.gen===1 ? s.ison : s.output;
    if(typeof on !== 'boolean') {warnings.push('Kein Schaltausgang: '+c.component);continue;}
    const values={On:on}, kind=c.component.split(':')[0];
    if(c.type==='light' && kind!=='switch' && kind!=='relay') {
      if(finite(s.brightness ?? s.gain)) values.Brightness=s.brightness ?? s.gain;
      const rgb=s.rgb || (['red','green','blue'].every(k=>finite(s[k])) ? [s.red,s.green,s.blue] : null);
      if(rgb?.length===3 && rgb.every(finite)) Object.assign(values,rgbToHs(rgb));
      const kelvin=s.ct ?? s.temp;
      if(finite(kelvin) && kelvin>0) values.ColorTemperature=Math.round(1e6/kelvin);
    }
    add(c.component,c.type,values,{name:c.name || c.component, output:true, cloud:snap.cloud===true, gen:snap.gen, raw:s,options:c,fault:s.is_valid===false || !!s.errors?.length});
  }
  for(const i of config.inputs || []) {
    if(i.enabled===false)continue;
    const s=map[i.component],name=i.name||i.component,invalid=!s||s.is_valid===false||!!s.errors?.length;
    if(i.mode==='analog') {
      const template=Models.inputTemplates(config).find(t=>t.component===i.component&&t.analog);if(!template)continue;
      const voltage=template.unit==='V',value=voltage?s?.voltage:s?.percent;
      const fault=invalid||!finite(value)||value<0||value>(voltage?1000:100);
      add(i.component,'analog',fault?{}:{AnalogValue:value},{name,unit:template.unit,fault,...(fault?{missingValues:['AnalogValue']}:{})});
      if(fault)warnings.push('Eingang nicht verfügbar: '+i.component);continue;
    }
    if(i.mode==='button') {if(!invalid)add(i.component,'button',{}, {name,counter:s.event_cnt,event:s.event});else warnings.push('Eingang nicht verfügbar: '+i.component);continue;}
    const state=s?.state ?? (snap.gen===1 ? s?.input : undefined),fault=invalid||!(typeof state==='boolean'||state===0||state===1);
    add(i.component,'contact',fault?{}:{ContactSensorState:(!!state!==!!i.invert)?1:0},{name,fault,...(fault?{missingValues:['ContactSensorState']}:{})});
    if(fault)warnings.push((invalid?'Eingang nicht verfügbar: ':'Eingang ohne Zustand; als Taste konfigurieren: ')+i.component);
  }
  if(config.addons?.length) for(const [key,s] of Object.entries(map)) {
      const addonSensor=/^(temperature|humidity):/.test(key) && (snap.gen===1?key!=='temperature:internal':Number(key.split(':')[1])>=100);
      if(addonSensor && (!config.addons?.length || (key.startsWith('temperature:')?config.addons[0].temperature===false:config.addons[0].humidity===false)))continue;
      if(!addonSensor)continue;
    if(s.is_valid===false || s.errors?.length) continue;
    const sensorC=celsius(s);
    if(key.startsWith('temperature:')&&finite(sensorC)&&sensorC>=-100&&sensorC<=200)add(key,'temperature',{CurrentTemperature:sensorC},{sourceFahrenheit:s.tF});
    if(key.startsWith('humidity:') && finite(s.rh) && s.rh>=0 && s.rh<=100) add(key,'humidity',{CurrentRelativeHumidity:s.rh});
    if(key.startsWith('illuminance:') && finite(s.lux)) add(key,'lux',{CurrentAmbientLightLevel:Math.max(.0001,s.lux)});
    if(key.startsWith('motion:') && typeof s.motion==='boolean') add(key,'motion',{MotionDetected:s.motion});
    if(key.startsWith('battery:') && finite(s.percent)) add(key,'battery',{BatteryLevel:s.percent,StatusLowBattery:s.percent<=20?1:0,ChargingState:2});
    if(key.startsWith('devicepower:') && finite(s.battery?.percent)) add(key,'battery',{BatteryLevel:s.battery.percent,StatusLowBattery:s.battery.percent<=20?1:0,ChargingState:2});
  }
  if(config.connection==='cloud'&&config.cloudSensors===true&&config.modelId==='cloud-sensor')for(const [key,s] of Object.entries(map)){
    if(s.is_valid===false||s.errors?.length)continue;
    const t=celsius(s);if(key.startsWith('temperature:')&&finite(t)&&t>=-100&&t<=200)add(key,'temperature',{CurrentTemperature:t});
    if(key.startsWith('humidity:')&&finite(s.rh)&&s.rh>=0&&s.rh<=100)add(key,'humidity',{CurrentRelativeHumidity:s.rh});
    if(key.startsWith('illuminance:')&&finite(s.lux)&&s.lux>=0)add(key,'lux',{CurrentAmbientLightLevel:Math.max(.0001,s.lux)});
    if(key.startsWith('motion:')&&typeof s.motion==='boolean')add(key,'motion',{MotionDetected:s.motion});
    if(key.startsWith('contact:')&&typeof s.open==='boolean')add(key,'contact',{ContactSensorState:s.open?1:0});
    const battery=key.startsWith('battery:')?s.percent:key.startsWith('devicepower:')?s.battery?.percent:undefined;
    if(finite(battery)&&battery>=0&&battery<=100)add(key,'battery',{BatteryLevel:battery,StatusLowBattery:battery<=20?1:0,ChargingState:2});
  }
  const wall=/^wall(?:-x2|-xl)?$/.test(config.modelId||'');
  if(wall)for(const [key,s] of Object.entries(map)){
    if(key.startsWith('temperature:')&&Number(key.split(':')[1])<100&&config.modelId!=='wall-xl'&&config.wallTemperature===true){const value=celsius(s),fault=!!s.errors?.length||!finite(value)||value< -100||value>200;add(key,'temperature',fault?{}:{CurrentTemperature:value},{name:config.name+' '+t('Temperatur'),fault,...(fault?{missingValues:['CurrentTemperature']}:{})});}
    if(key.startsWith('humidity:')&&Number(key.split(':')[1])<100&&config.modelId!=='wall-xl'&&config.wallHumidity===true){const fault=!!s.errors?.length||!finite(s.rh)||s.rh<0||s.rh>100;add(key,'humidity',fault?{}:{CurrentRelativeHumidity:s.rh},{name:config.name+' '+t('Luftfeuchte'),fault,...(fault?{missingValues:['CurrentRelativeHumidity']}:{})});}
    if(key.startsWith('motion:')&&config.wallMotion===true){const fault=!!s.errors?.length||typeof s.motion!=='boolean';add(key,'motion',fault?{}:{MotionDetected:s.motion},{name:config.name+' '+t('Bewegung'),fault,...(fault?{missingValues:['MotionDetected']}:{})});}
  }
  if(wall&&config.wallIlluminance===true)for(const [key,s] of Object.entries(map))if(key.startsWith('illuminance:')&&finite(s.lux)&&s.lux>=0&&!s.errors?.length)add(key,'lux',{CurrentAmbientLightLevel:Math.max(.0001,s.lux)},{name:config.name+' '+t('Helligkeit')});
  if(wall&&config.thermostat===true)for(const [key,s] of Object.entries(map))if(/^thermostat:\d+$/.test(key)){
    const settings=snap.settings?.[key]||{},mode=settings.type==='heating'?1:settings.type==='cooling'?2:undefined;
    if(mode===undefined){warnings.push('Thermostat ohne unterstützten Heiz-/Kühltyp: '+key);continue;}
    const invalid=s.errors?.length||!finite(s.current_C)||s.current_C< -40||s.current_C>100||!finite(s.target_C)||s.target_C<5||s.target_C>35||typeof s.enable!=='boolean'||typeof s.output!=='boolean';
    if(invalid){warnings.push('Thermostat ohne gültige Messwerte: '+key);continue;}
    add(key,'thermostat',{CurrentTemperature:s.current_C,TargetTemperature:s.target_C,CurrentHeatingCoolingState:s.enable&&s.output?mode:0,TargetHeatingCoolingState:s.enable?mode:0,TemperatureDisplayUnits:settings.display_unit==='F'?1:0},{name:config.name+' '+t('Thermostat'),control:true,mode,gen:snap.gen});
  }
  if(config.energy !== false) for(const [key,s] of Object.entries(map)) {
    if(s.is_valid===false || !/^(switch|light|rgb|rgbw|cct|pm1|em1|em|meter|emeter):/.test(key)) continue;
    const channel=(config.channels||[]).find(c=>c.component===key||key.startsWith('meter:')&&c.component.split(':')[1]===key.split(':')[1]);
    const sharedMeter=key.startsWith('meter:')&&snap.gen===1&&snap.status.meters?.length===1&&snap.status.relays?.length>1;
    if(!sharedMeter&&(channel?.showEnergy===false || channel?.enabled===false))continue;
    if(cover && !/^(em1?|pm1):/.test(key)) continue;
    const energy=(suffix='', power=s.apower ?? s.act_power ?? s.power, voltage=s.voltage, current=s.current, total=s.aenergy?.total ?? s.total, returned=s.ret_aenergy?.total ?? s.total_returned)=>{
      const values=clean({Power:power,Voltage:voltage,Current:current,Energy:finite(total)?total/(key.startsWith('meter:')?60000:1000):undefined,ReturnedEnergy:finite(returned)?returned/1000:undefined});
      if(Object.keys(values).length) add(key+suffix+':energy','energy',values,{name:key+suffix, fault:!!s.errors?.length});
    };
    const id=key.split(':')[1];
    if(key.startsWith('em:')) {
      const data=map['emdata:'+id] || {};
      for(const phase of ['a','b','c']) energy(':'+phase.toUpperCase(),s[phase+'_act_power'],s[phase+'_voltage'],s[phase+'_current'],data[phase+'_total_act_energy'],data[phase+'_total_act_ret_energy']);
      energy(':total',s.total_act_power,undefined,s.total_current,data.total_act, data.total_act_ret);
    } else if(key.startsWith('em1:')) { const data=map['em1data:'+id] || {}; energy('',s.act_power,s.voltage,s.current,data.total_act_energy,data.total_act_ret_energy); }
    else if(key.startsWith('meter:') && snap.info.type==='SHSW-1') { /* Gen1 Shelly 1 reports a configured power constant, not a measured value. */ }
    else energy();
  }
  const bluetooth=[];
  for(const b of config.bthome || []) {
    const device=snap.components?.find(c=>c.key===b.deviceComponent);
    const descriptors=[];
    const staleAfter=b.staleAfter??(b.sensorType==='ws90'?120:86400),addr=address(device?.config?.addr);
    if(!/^[a-f0-9]{12}$/.test(addr)) {bluetooth.push({config:b, descriptors, fault:true});warnings.push('BTHome-Gerät fehlt: '+b.deviceComponent);continue;}
    for(const idx of b.buttonIndices || []) {
      if(device.knownObjects?.objects?.some(o=>o.obj_id===58 && o.idx===idx)) descriptors.push({key:'button:'+idx,type:'button',name:(b.name||b.id)+' '+idx,values:{}});
      else warnings.push('BTHome-Taste nicht bestätigt: '+b.deviceComponent+' idx '+idx);
    }
    for(const c of snap.components.filter(c=>c.key.startsWith('bthomesensor:') && address(c.config?.addr)===addr)) {
      const weather=weatherReading(c,now,staleAfter);if(weather){descriptors.push(weather);continue;}
      const v=c.status?.value, obj=c.config.obj_id;
      const ts=c.status?.last_updated_ts ?? c.status?.last_update_ts;
      const fault=!finite(ts)||ts<=0||ts>now+5||now-ts>staleAfter||c.status?.is_valid===false||!!c.status?.errors?.length;
      const types={1:['battery','BatteryLevel'],2:['temperature','CurrentTemperature'],69:['temperature','CurrentTemperature'],3:['humidity','CurrentRelativeHumidity'],46:['humidity','CurrentRelativeHumidity'],5:['lux','CurrentAmbientLightLevel'],33:['motion','MotionDetected'],26:['contact','ContactSensorState'],45:['contact','ContactSensorState']};
      const pair=types[obj];
      if(obj===58) {const button=descriptors.find(d=>d.key==='button:'+c.config.idx);if(button)button.eventComponent=c.key;}
      if(obj===58 && (b.buttonIndices||[]).includes(c.config.idx) && !descriptors.some(d=>d.key==='button:'+c.config.idx)) descriptors.push({key:c.key,type:'button',name:c.config.name||c.key,values:{}});
      if(!pair || !(finite(v)||typeof v==='boolean')) continue;
      if(!['motion','contact'].includes(pair[0]) && !finite(v))continue;
      if((pair[0]==='temperature' && (v< -100||v>200)) || (['battery','humidity'].includes(pair[0]) && (v<0||v>100)))continue;
      let value=pair[0]==='motion'?!!v:pair[0]==='contact'?(v?1:0):v;
      if(pair[0]==='lux') value=Math.max(.0001,value);
      const values={[pair[1]]:value};
      if(pair[0]==='battery') Object.assign(values,{StatusLowBattery:v<=20?1:0,ChargingState:2});
      descriptors.push({key:c.key,type:pair[0],name:c.config.name||c.key,values,fault,...(finite(ts)&&ts>0?{observedAt:ts*1000}:{})});
    }
    const ds=device.status || {}, ts=ds.last_updated_ts ?? ds.last_update_ts;
    if(finite(ds.battery) && !descriptors.some(d=>d.type==='battery')) descriptors.push({key:'battery',type:'battery',name:t('Batterie'),values:{BatteryLevel:ds.battery,StatusLowBattery:ds.battery<=20?1:0,ChargingState:2},...(finite(ts)&&ts>0?{observedAt:ts*1000}:{}),fault:!finite(ts)||ts<=0||ts>now+5||now-ts>staleAfter});
    // Passive BTHome beacons deliver decoded readings without a paired GATT connection.
    bluetooth.push({config:b,descriptors,fault:!descriptors.length||!!ds.errors?.length});
  }
  result.push(...virtualDescriptors(snap,config,warnings));
  return {descriptors:result,bluetooth,warnings};
}
function command(d, characteristic, value, current=d.values) {
  if(d.virtual){
    if(!d.output||d.writable===false||characteristic!=='On'||typeof value!=='boolean')throw new Error('Virtuelle Komponente ist nicht schreibbar.');
    return d.momentary?value?{event:d.event}:null:{value};
  }
  if(d.type==='thermostat'&&d.control){
    if(characteristic==='TargetTemperature'&&finite(value)&&value>=5&&value<=35)return {config:{target_C:value}};
    if(characteristic==='TargetHeatingCoolingState'&&value===0)return {config:{enable:false}};
    if(characteristic==='TargetHeatingCoolingState'&&[1,2].includes(value))return {config:{type:value===1?'heating':'cooling',enable:true}};
    if(characteristic==='TemperatureDisplayUnits'&&[0,1].includes(value))return {config:{display_unit:value===1?'F':'C'}};
    throw new Error('Ungültiger Thermostatwert.');
  }
  if(!d.output || !Object.hasOwn(d.values,characteristic)) throw new Error('Funktion wird von diesem Kanal nicht unterstützt.');
  const o=d.options||{},transition=values=>!d.cloud&&d.gen!==1&&Number.isFinite(o.transitionSeconds)&&Object.hasOwn(d.values,'Brightness')?{...values,transition_duration:o.transitionSeconds}:values;
  const clamp=v=>v===0?0:Math.max(o.minBrightness??0,Math.min(o.maxBrightness??100,v));
  if(characteristic==='On') return transition({on:!!value,...(value&&current.On===false&&finite(o.onBrightness)&&Object.hasOwn(d.values,'Brightness')?{[d.gen===1&&finite(d.raw.gain)?'gain':'brightness']:clamp(o.onBrightness)}:{})});
  if(!finite(value)) throw new Error('Ungültiger Wert.');
  if(characteristic==='Brightness') return transition({[d.gen===1 && finite(d.raw.gain)?'gain':'brightness']:Math.round(clamp(Math.max(0,Math.min(100,value))))});
  if(characteristic==='ColorTemperature') {if(value<=0)throw new Error('Ungültige Farbtemperatur.');return {[d.gen===1?'temp':'ct']:Math.round(1e6/value)};}
  if(['Hue','Saturation'].includes(characteristic)) {
    const rgb=hsToRgb(characteristic==='Hue'?value:current.Hue,characteristic==='Saturation'?value:current.Saturation);
    return d.gen===1?{red:rgb[0],green:rgb[1],blue:rgb[2]}:{rgb};
  }
  throw new Error('Nicht unterstützte Funktion.');
}
module.exports = { model, command, components, rgbToHs, hsToRgb, isCover };
