'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZepraScenes=factory();})(typeof window==='object'?window:globalThis,()=>{
 const labels={On:'Schaltzustand',Brightness:'Helligkeit (%)',CurrentTemperature:'Temperatur (°C)',CurrentRelativeHumidity:'Luftfeuchte (%)',CurrentAmbientLightLevel:'Helligkeit (lux)',BatteryLevel:'Batterie (%)',MotionDetected:'Bewegung',ContactSensorState:'Kontakt (0 geschlossen / 1 offen)',Power:'Leistung (W)',Energy:'Energie (kWh)',Voltage:'Spannung (V)',Current:'Strom (A)',AnalogValue:'Analogwert',WindSpeed:'Windgeschwindigkeit (km/h)',GustSpeed:'Böen (km/h)',WindDirection:'Windrichtung (°)',RainDetected:'Regenstatus',UVIndex:'UV-Index',AirPressure:'Luftdruck (hPa)',DewPoint:'Taupunkt (°C)',Precipitation:'Niederschlag (mm)',CapacitorVoltage:'Kondensatorspannung (V)',position:'Behang (%)',slatPosition:'Lamellen (%)',automationEnabled:'Auto',manualPaused:'Automatik Pause',windAlarm:'Windalarm'};
 const boolean=new Set(['On','MotionDetected','RainDetected','automationEnabled','manualPaused','windAlarm']);
 const properties={On:'Ein / Aus',Brightness:'Helligkeit (%)',position:'Behang (%)',slatPosition:'Lamellen (%)',auto:'Auto',pause:'Automatik Pause',wind:'Windalarm'};
 const key=r=>JSON.stringify([r.area,r.deviceId,r.sensorId||'',r.component||'',r.metric]);
 const endpoint=r=>JSON.stringify([r.area,r.deviceId,r.component||'']);
 function getDevice(config,ref){if(!ref)return undefined;return (ref.area==='shading'?config.shading?.devices:ref.area==='devices'?config.devices:[])?.find(d=>d.id===ref.deviceId);}
 // A source selector may address a whole host, one BTHome device or one native component.
 function scopeMatches(scope,source){
  if(!scope||!source||!['devices','shading'].includes(scope.area)||typeof scope.deviceId!=='string'||!scope.deviceId.trim()||scope.area!==source.area||scope.deviceId!==source.deviceId)return false;
  const sensor=scope.sensorId!==undefined,component=scope.component!==undefined;
  if(sensor&&component)return false;
  if(sensor)return typeof scope.sensorId==='string'&&!!scope.sensorId.trim()&&scope.sensorId===source.sensorId;
  if(component)return typeof scope.component==='string'&&!!scope.component.trim()&&!source.sensorId&&scope.component===source.component;
  return true;
 }
 // Read the latest cached source feedback without sending commands or changing Scene state.
 function sourceReading(config,data,source,now=Date.now()){
  if(!source||!['devices','shading'].includes(source.area)||!Object.hasOwn(labels,source.metric)||!Number.isFinite(now))return null;
  const list=value=>Array.isArray(value)?value:[],device=list(source.area==='shading'?config?.shading?.devices:config?.devices).find(d=>d?.id===source.deviceId);if(!device)return null;
  const sensorSource=source.sensorId!==undefined;
  if(sensorSource&&(typeof source.sensorId!=='string'||!source.sensorId.trim()))return null;
  if((source.area==='devices'||sensorSource)&&(typeof source.component!=='string'||!source.component.trim()))return null;
  let row,checkedAt,maxAge,online,reading;
  if(source.area==='devices'){
   const expected=JSON.stringify([device.id,device.connection==='cloud'?'cloud:'+device.cloudServer:device.host,String((device.connection==='cloud'?device.cloudDeviceId:device.shellyDeviceId)||'').toLowerCase().replace(/:/g,'').slice(-12)]);
   row=list(data?.devices).find(r=>r?.target===expected);checkedAt=row?.checkedAt;maxAge=Number.isFinite(data?.devicesMaxAge)?data.devicesMaxAge:30000;online=row?.online===true;
  }else{
   row=list(data?.shading).find(r=>r?.id===source.deviceId);
   if(sensorSource){checkedAt=row?.bthomeCheckedAt;maxAge=row?.bthomeMaxAge;online=row?.bthomeOnline===true;}
   else{
    if(!['position','slatPosition','automationEnabled','manualPaused','windAlarm'].includes(source.metric))return null;
    const poll=Number.isFinite(config.pollInterval)?config.pollInterval:Number.isFinite(config.shading?.pollInterval)?config.shading.pollInterval:20;
    checkedAt=row?.checkedAt??row?.updatedAt;maxAge=Math.max(30000,(device.connection==='cloud'?30:poll)*3000+15000);online=row?.online===true;
   }
  }
  if(!online||row.fault||row.identityMismatch||!Number.isFinite(checkedAt)||checkedAt<=0||!Number.isFinite(maxAge)||maxAge<=0||now-checkedAt>maxAge||checkedAt>now+5000)return null;
  let sensor,group;
  if(sensorSource){
   sensor=list(device.bthome).find(b=>b?.id===source.sensorId);if(!sensor||typeof sensor.deviceComponent!=='string'||!sensor.deviceComponent.trim())return null;
   group=list(row.bthome).find(b=>b?.id===source.sensorId&&b.deviceComponent===sensor.deviceComponent&&!b.fault);if(!group)return null;
   reading=list(group.readings).find(r=>r?.component===source.component&&!r.fault&&Object.hasOwn(r.values||{},source.metric));
  }else if(source.area==='devices')reading=[...list(row.readings),...list(row.measurements)].find(r=>r?.component===source.component&&!r.fault&&Object.hasOwn(r.values||{},source.metric));
  const value=source.area==='shading'&&!sensorSource?row[source.metric]:reading?.values?.[source.metric];
  if(boolean.has(source.metric)?typeof value!=='boolean':!Number.isFinite(value))return null;
  if(source.metric==='ContactSensorState'&&value!==0&&value!==1)return null;
  if(['position','slatPosition','Brightness','BatteryLevel','CurrentRelativeHumidity'].includes(source.metric)&&(value<0||value>100))return null;
  const observedAt=reading&&Object.hasOwn(reading,'observedAt')?reading.observedAt:sensorSource?null:checkedAt;
  if(!Number.isFinite(observedAt)||observedAt<=0||observedAt>now+5000)return null;
  const staleAfter=sensor?(sensor.staleAfter??(sensor.sensorType==='ws90'?120:86400))*1000:maxAge;
  if(!Number.isFinite(staleAfter)||staleAfter<=0||now-observedAt>staleAfter)return null;
  const units={Brightness:['%'],CurrentTemperature:['°C'],CurrentRelativeHumidity:['%'],CurrentAmbientLightLevel:['lux','lx'],BatteryLevel:['%'],Power:['W'],Energy:['kWh'],Voltage:['V'],Current:['A'],AnalogValue:['%','V'],WindSpeed:['km/h'],GustSpeed:['km/h'],WindDirection:['°'],UVIndex:[''],AirPressure:['hPa'],DewPoint:['°C'],Precipitation:['mm'],CapacitorVoltage:['V'],position:['%'],slatPosition:['%']},unit=reading?.unit??source.unit;
  return {value,observedAt,...(units[source.metric]?.includes(unit)?{unit}:{})};
 }
 function mode(scene){return scene.mode??(scene.enabled?'on':'off');}
 function timeValid(value){return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
 function scheduleActive(schedule,day,time){if(!schedule)return false;const {start,end,days}=schedule;if(start<end)return days.includes(day)&&time>=start&&time<end;return days.includes(day)&&time>=start||days.includes((day+6)%7)&&time<end;}
 function actions(scene){return Array.isArray(scene.actions)?scene.actions:scene.action?[{...scene.action,delaySeconds:0}]:[];}
 function conditionLeaves(tree){return tree?.kind==='group'?(tree.children||[]).flatMap(conditionLeaves):tree?[tree]:[];}
 function conditionSources(leaf){return leaf?.kind==='dewpoint'?[leaf.temperatureSource,leaf.humiditySource]:leaf?.source?[leaf.source]:[];}
 // Magnus approximation over water; coefficients and range: NPL dew-point/RH guide.
 function dewPoint(temperature,humidity){if(!Number.isFinite(temperature)||temperature< -45||temperature>60||!Number.isFinite(humidity)||humidity<=0||humidity>100)return null;if(humidity===100)return temperature;const gamma=Math.log(humidity/100)+17.62*temperature/(243.12+temperature),value=243.12*gamma/(17.62-gamma);return Number.isFinite(value)?value:null;}
 function observation(condition,observe,now){if(condition.kind!=='dewpoint')return observe(condition.source,now);const temperature=observe(condition.temperatureSource,now),humidity=observe(condition.humiditySource,now);if(!temperature||!humidity)return null;const value=dewPoint(temperature.value,humidity.value),observedAt=Math.min(temperature.observedAt??now,humidity.observedAt??now);return value===null||!Number.isFinite(observedAt)?null:{value,observedAt};}
 function validateCondition(tree,config){let count=0;const seen=new Set();function visit(t,depth){
  if(!t||typeof t!=='object'||depth>5||++count>64||seen.has(t))throw Error('Scene: Bedingungsbaum zu groß oder ungültig (maximal 5 Ebenen und 64 Elemente).');seen.add(t);
  if(t.kind==='group'){if(!['and','or'].includes(t.operator)||!Array.isArray(t.children)||!t.children.length||t.children.length>16)throw Error('Scene: UND-/ODER-Gruppe benötigt 1 bis 16 Bedingungen.');for(const child of t.children)visit(child,depth+1);return;}
  if(!['status','value','time','dewpoint'].includes(t.kind))throw Error('Scene: Bedingungsart prüfen.');
  if(t.kind==='time'){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t.time)||!Array.isArray(t.days)||!t.days.length||t.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Scene: Uhrzeit und Wochentage prüfen.');}
   else{if(t.kind==='dewpoint'&&(!['devices','shading'].includes(t.temperatureSource?.area)||t.temperatureSource?.metric!=='CurrentTemperature'||!['devices','shading'].includes(t.humiditySource?.area)||t.humiditySource?.metric!=='CurrentRelativeHumidity'))throw Error('Scene: Taupunkt benötigt eine Temperatur- und eine Luftfeuchtequelle.');for(const source of conditionSources(t))if(!getDevice(config,source)||!Object.hasOwn(labels,source.metric)||(source.area==='devices'||source.sensorId)&&!source.component)throw Error('Scene: Quelle nicht verfügbar.');if(!conditionSources(t).length)throw Error('Scene: Quelle nicht verfügbar.');const metric=t.kind==='dewpoint'?'DewPoint':t.source.metric;if(!['eq','ne','gt','gte','lt','lte'].includes(t.operator)||!(typeof t.value==='boolean'||Number.isFinite(t.value)))throw Error('Scene: Vergleich prüfen.');if(boolean.has(metric)&&(!['eq','ne'].includes(t.operator)||typeof t.value!=='boolean'))throw Error('Scene: Schaltzustände benötigen Ein/Aus-Vergleich.');if(!boolean.has(metric)&&!Number.isFinite(t.value))throw Error('Scene: Zahlenwert erforderlich.');if(!Number.isFinite(t.hysteresis??0)||(t.hysteresis??0)<0)throw Error('Scene: Hysterese muss positiv oder null sein.');if(!Number.isInteger(t.holdSeconds??0)||(t.holdSeconds??0)<0||(t.holdSeconds??0)>86400)throw Error('Scene: Bedingungsdauer muss zwischen 0 und 86400 ganzen Sekunden liegen.');if(t.kind!=='dewpoint'&&t.sourceDevice&&!scopeMatches(t.sourceDevice,t.source))throw Error('Scene: Shelly und gewählter Zustand passen nicht zusammen.');}
 }
 visit(tree,0);return tree;}
 function validate(scenes=[],config={}){
  if(!Array.isArray(scenes)||scenes.length>100)throw Error('Scene: maximal 100 Scenes möglich.');const ids=new Set(),enabled=[];
  for(const scene of scenes){if(!scene||!scene.id||!scene.name?.trim()||ids.has(scene.id))throw Error('Scene benötigt einen Namen und eine eindeutige ID.');ids.add(scene.id);if(scene.restoreOnReset!==undefined&&typeof scene.restoreOnReset!=='boolean')throw Error('Scene: Rücksetzung muss ein/aus sein.');if(scene.enabled!==undefined&&typeof scene.enabled!=='boolean')throw Error('Scene aktiv muss ein/aus sein.');if(!['off','on','schedule'].includes(mode(scene)))throw Error('Scene: Betriebsart prüfen.');if(mode(scene)==='off')continue;
   if(mode(scene)==='schedule'){const w=scene.schedule;if(!w||!timeValid(w.start)||!timeValid(w.end)||w.start===w.end||!Array.isArray(w.days)||!w.days.length||w.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Scene: Zeitplan mit unterschiedlichen Beginn-/Endzeiten und Wochentagen angeben.');}
   const t=scene.condition,steps=actions(scene);if(!t||!['status','value','time','dewpoint','group'].includes(t.kind)||!steps.length)throw Error('Scene: Bedingung und Aktion vervollständigen.');
   if(!Number.isFinite(scene.cooldownSeconds??60)||(scene.cooldownSeconds??60)<5||(scene.cooldownSeconds??60)>86400)throw Error('Scene: Mindestabstand muss zwischen 5 und 86400 Sekunden liegen.');
   validateCondition(t,config);
   if(steps.length>20||steps.reduce((sum,a)=>sum+(a.delaySeconds||0),0)>86400)throw Error('Scene: maximal 20 Aktionen und insgesamt 24 Stunden Wartezeit.');
   for(const a of steps){if(!a||!Number.isInteger(a.delaySeconds??0)||(a.delaySeconds??0)<0||(a.delaySeconds??0)>86400)throw Error('Scene: Wartezeit muss zwischen 0 und 86400 ganzen Sekunden liegen.');
   if(a.condition){validateCondition(a.condition,config);if(!Number.isInteger(a.conditionTimeoutSeconds??300)||(a.conditionTimeoutSeconds??300)<1||(a.conditionTimeoutSeconds??300)>86400)throw Error('Scene: Maximale Bedingungswartezeit muss zwischen 1 und 86400 ganzen Sekunden liegen.');}
   const target=getDevice(config,a);if(!target||!Object.hasOwn(properties,a.property))throw Error('Scene: Ziel nicht verfügbar.');
   if(a.area==='devices'){if(!['On','Brightness'].includes(a.property)||!target.channels?.some(c=>c.component===a.component&&c.enabled!==false))throw Error('Scene: Ausgang nicht konfiguriert.');}
   else{if(['On','Brightness'].includes(a.property)||a.property==='slatPosition'&&target.deviceType==='roller'||['auto','pause'].includes(a.property)&&!target.sunAutomation?.enabled||a.property==='wind'&&(target.deviceType==='roller'||target.windProtection!==true))throw Error('Scene: Funktion am Ziel nicht eingerichtet.');}
   if(['On','auto','pause','wind'].includes(a.property)?typeof a.value!=='boolean':!Number.isFinite(a.value)||a.value<0||a.value>100)throw Error('Scene: Zielwert prüfen.');}enabled.push(scene);
  }
  const edges=new Map();for(const s of enabled){for(const leaf of conditionLeaves(s.condition)){if(leaf.kind==='time')continue;for(const source of conditionSources(leaf)){const from=endpoint(source);for(const a of actions(s)){const to=endpoint(a);(edges.get(from)||edges.set(from,new Set()).get(from)).add(to);}}}}
  const visiting=new Set(),done=new Set();function visit(n){if(visiting.has(n))throw Error('Scene: Regelschleife erkannt. Gegenseitige Geräte-Auslösung ist nicht zulässig.');if(done.has(n))return;visiting.add(n);for(const next of edges.get(n)||[])visit(next);visiting.delete(n);done.add(n);}for(const n of edges.keys())visit(n);
  return scenes;
 }
 function compare(value,condition,previous=false){const limit=condition.value,h=condition.hysteresis||0;switch(condition.operator){case'eq':return value===limit;case'ne':return value!==limit;case'gt':return value>(previous?limit-h:limit);case'gte':return value>=(previous?limit-h:limit);case'lt':return value<(previous?limit+h:limit);case'lte':return value<=(previous?limit+h:limit);default:return false;}}
 function sources(config,data={}){const result=[],seen=new Set();const add=(ref,label)=>{const id=key(ref);if(!seen.has(id)){seen.add(id);result.push({...ref,id,label:label+' · '+labels[ref.metric]+(ref.unit?' ('+ref.unit+')':''),type:boolean.has(ref.metric)?'boolean':'number'});}};
  const sensorSources=(d,row,area,base)=>{
   for(const b of d.bthome||[]){const group=row?.bthome?.find(g=>g.id===b.id&&g.deviceComponent===b.deviceComponent);for(const r of group?.readings||[]){const types={temperature:'CurrentTemperature',humidity:'CurrentRelativeHumidity',lux:'CurrentAmbientLightLevel',battery:'BatteryLevel',motion:'MotionDetected',contact:'ContactSensorState'},metrics=new Set([...Object.keys(r.values||{}),...types[r.type]?[types[r.type]]:[],...r.metric&&Object.hasOwn(labels,r.metric)?[r.metric]:[]]);for(const metric of metrics)if(Object.hasOwn(labels,metric))add({area,deviceId:d.id,sensorId:b.id,component:r.component,metric},base+' / '+(b.name||b.id)+' ['+b.id+'] / '+r.component);}}
  };
  for(const d of config.devices||[]){const row=data.devices?.find(r=>r.target&&JSON.parse(r.target)[0]===d.id);const base=d.name+' ['+d.id+']';
   for(const c of d.channels||[]){add({area:'devices',deviceId:d.id,component:c.component,metric:'On'},base+' / '+(c.name||c.component));if(c.type==='light')add({area:'devices',deviceId:d.id,component:c.component,metric:'Brightness'},base+' / '+(c.name||c.component));}
   for(const c of d.inputs||[])if(c.enabled===true)add({area:'devices',deviceId:d.id,component:c.component,metric:c.mode==='analog'?'AnalogValue':'ContactSensorState',...(c.mode==='analog'?{unit:c.component.startsWith('voltmeter:')?'V':'%'}:{})},base+' / '+(c.name||c.component));
   for(const reading of [...row?.readings||[],...row?.measurements||[]])for(const metric of Object.keys(reading.values||{}))if(Object.hasOwn(labels,metric)){if(metric==='AnalogValue'&&!d.inputs?.some(c=>c.component===reading.component&&c.enabled===true&&c.mode==='analog'))continue;add({area:'devices',deviceId:d.id,component:reading.component,metric,...(metric==='AnalogValue'?{unit:reading.unit|| (reading.component.startsWith('voltmeter:')?'V':'%')}:{})},base+' / '+(reading.name||reading.component));}
   sensorSources(d,row,'devices',base);
  }
  for(const d of config.shading?.devices||[]){for(const metric of ['position',...(d.deviceType!=='roller'?['slatPosition']:[]),...(d.sunAutomation?.enabled?['automationEnabled','manualPaused']:[]),...(d.windProtection===true?['windAlarm']:[])])add({area:'shading',deviceId:d.id,metric},d.name+' ['+d.id+']');sensorSources(d,data.shading?.find(r=>r.id===d.id),'shading',d.name+' ['+d.id+']');}
  return result;
 }
 // Configured BTHome groups remain selectable while offline; native sensor IDs come from actual sources.
 function sensorChoices(config,data={}){
  const result=[],seen=new Set(),readings=sources(config,data),metrics=new Set(['CurrentTemperature','CurrentRelativeHumidity','CurrentAmbientLightLevel','BatteryLevel','MotionDetected','ContactSensorState','AnalogValue','WindSpeed','GustSpeed','WindDirection','RainDetected','UVIndex','AirPressure','DewPoint','Precipitation','CapacitorVoltage']);
  const add=item=>{const id=JSON.stringify([item.area,item.deviceId,item.sensorId??'',item.component??'']);if(!seen.has(id)){seen.add(id);result.push(item);}};
  for(const [area,devices]of [['devices',config.devices||[]],['shading',config.shading?.devices||[]]])for(const device of devices){
   const host={area,deviceId:device.id,hostId:device.id,hostName:device.name||device.id};
   for(const sensor of device.bthome||[])if(typeof sensor.id==='string'&&sensor.id.trim())add({...host,sensorId:sensor.id,name:sensor.name||sensor.id});
   const row=area==='shading'?data.shading?.find(r=>r.id===device.id):data.devices?.find(r=>r.target&&JSON.parse(r.target)[0]===device.id);
   for(const source of readings)if(source.area===area&&source.deviceId===device.id&&!source.sensorId&&source.component&&metrics.has(source.metric)){
    const input=device.inputs?.find(i=>i.component===source.component),reading=row?.readings?.find(r=>r.component===source.component);
    if(input&&(input.enabled!==true||input.mode==='button'))continue;
    add({...host,component:source.component,name:input?.name||reading?.name||source.component,metric:source.metric});
   }
  }
  return result;
 }
 function targets(config){const result=[];for(const d of config.devices||[])for(const c of (d.channels||[]).filter(c=>c.enabled!==false))for(const property of ['On',...(c.type==='light'?['Brightness']:[])])result.push({area:'devices',deviceId:d.id,component:c.component,property,label:d.name+' ['+d.id+'] / '+(c.name||c.component)+' · '+properties[property]});
  for(const d of config.shading?.devices||[])for(const property of ['position',...(d.deviceType!=='roller'?['slatPosition']:[]),...(d.sunAutomation?.enabled?['auto','pause']:[]),...(d.deviceType!=='roller'&&d.windProtection===true?['wind']:[])])result.push({area:'shading',deviceId:d.id,property,label:d.name+' ['+d.id+'] · '+properties[property]});return result;}
 return {validate,validateCondition,conditionLeaves,conditionSources,dewPoint,observation,compare,sources,sensorChoices,scopeMatches,sourceReading,targets,labels,properties,boolean,key,mode,scheduleActive,actions};
});
