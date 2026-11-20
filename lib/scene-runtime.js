'use strict';
function observe(platform,ref,now=Date.now()){
 if(ref.area==='devices'){
  const store=platform.devices.statusStore,record=store?.devices.get(ref.deviceId);if(!record?.online||!Number.isFinite(record.checkedAt)||now-record.checkedAt>store.maxAge||record.checkedAt>now+5000)return null;
  if(ref.sensorId){
   const devices=platform.config?.devices??platform.devices.config?.devices??[],source=devices.find(d=>d.id===ref.deviceId)?.bthome?.find(b=>b.id===ref.sensorId);
   if(!source||typeof source.deviceComponent!=='string'||!/^bthomedevice:2\d\d$/.test(source.deviceComponent))return null;
   const group=record.bthome?.find(b=>b.id===ref.sensorId&&b.deviceComponent===source.deviceComponent&&!b.fault),item=group?.readings?.find(r=>r.component===ref.component&&!r.fault&&Object.hasOwn(r.values||{},ref.metric));
   if(!item||!Number.isFinite(item.observedAt)||item.observedAt<=0||item.observedAt>now+5000)return null;
   const staleAfter=source.staleAfter??(source.sensorType==='ws90'?120:86400);
   if(!Number.isFinite(staleAfter)||staleAfter<=0||now-item.observedAt>staleAfter*1000)return null;
   return {value:item.values[ref.metric],observedAt:item.observedAt};
  }
  const item=[...record.readings||[],...record.measurements||[]].find(r=>r.component===ref.component&&!r.fault&&Object.hasOwn(r.values||{},ref.metric));if(!item)return null;if(Object.hasOwn(item,'observedAt')&&(!Number.isFinite(item.observedAt)||item.observedAt<=0||item.observedAt>now+5000))return null;return {value:item.values[ref.metric],observedAt:item.observedAt??record.checkedAt};
 }
 if(ref.area==='shading'&&ref.sensorId){
  const record=platform.shading.statusStore?.records.get(ref.deviceId),checked=record?.bthomeCheckedAt,maxAge=record?.bthomeMaxAge;
  if(record?.bthomeOnline!==true||!Number.isFinite(checked)||!Number.isFinite(maxAge)||maxAge<=0||now-checked>maxAge||checked>now+5000)return null;
  const group=record.bthome?.find(b=>b.id===ref.sensorId&&!b.fault),item=group?.readings?.find(r=>r.component===ref.component&&!r.fault&&Object.hasOwn(r.values||{},ref.metric));
  if(!item||!Number.isFinite(item.observedAt)||item.observedAt<=0||item.observedAt>now+5000)return null;
  const source=platform.config.shading?.devices?.find(d=>d.id===ref.deviceId)?.bthome?.find(b=>b.id===ref.sensorId&&b.deviceComponent===group.deviceComponent);
  if(!source||now-item.observedAt>(source.staleAfter??(source.sensorType==='ws90'?120:86400))*1000)return null;
  return {value:item.values[ref.metric],observedAt:item.observedAt};
 }
 if(ref.area==='shading'){const record=platform.shading.statusStore.records.get(ref.deviceId),d=platform.config.shading.devices.find(d=>d.id===ref.deviceId),age=Math.max(30000,(d?.connection==='cloud'?30:platform.config.pollInterval)*3000+15000),checked=record?.checkedAt??record?.updatedAt;if(!record?.online||!Number.isFinite(checked)||now-checked>age||checked>now+5000)return null;return Object.hasOwn(record,ref.metric)?{value:record[ref.metric],observedAt:checked}:null;}
 return null;
}
async function execute(platform,action,allowed){
 if(!allowed())throw Error('Scene beendet.');
 if(action.area==='devices')return platform.devices.sceneAction(action,allowed);
 const runtime=platform.shading.devices.find(d=>d.config.id===action.deviceId);if(!runtime||runtime.controller.disposed)throw Error('Beschattung nicht verfügbar.');
 if(['position','slatPosition'].includes(action.property)){
  if(!observe(platform,{area:'shading',deviceId:action.deviceId,metric:'position'}))throw Error('Keine aktuelle Positionsrückmeldung.');
  if(runtime.controller.windAlarm||runtime.controller.recovering||runtime.controller.recoveryFailed)throw Error('Windalarm oder Rückfahrtsperre aktiv.');
  if(runtime.automation)runtime.setPause(true);if(action._sceneRestoreToken)runtime.claimSceneWriter?.(action._sceneRestoreToken);const result=await runtime.controller.move({[action.property==='position'?'pos':'slat_pos']:action.value},allowed,action._sceneRestoreToken?'scene-reset:'+action._sceneRestoreToken:'scene');if(!allowed())throw Object.assign(Error('Scene wurde beendet.'),{code:'SCENE_CANCELLED'});return result;
 }
 if(action.property==='auto'&&runtime.automation){runtime.setAutomation(action.value);return;}
 if(action.property==='pause'&&runtime.automation){runtime.setPause(action.value);return;}
 if(action.property==='wind'&&runtime.windConfigured)return runtime.setWindAlarm(action.value);
 throw Error('Scene-Funktion nicht verfügbar.');
}
function inspect(platform,action,now=Date.now()){
 const {ref}=require('./scene-reset'),reading=observe(platform,ref(action),now);if(!reading)return null;
 if(action.area==='devices'){const unit=platform.devices.units.get(action.deviceId);return {...reading,revision:unit?.sceneRevisions?.get(action.component)||0,writer:unit?.sceneWriters?.get(action.component)};}
 const runtime=platform.shading.devices.find(d=>d.config.id===action.deviceId);return {...reading,revision:runtime?.sceneRevision?.(),writer:runtime?.sceneWriter?.(),moving:['opening','closing','calibrating'].includes(runtime?.controller.lastStatus?.state),pending:!!(runtime?.controller.heightTarget||runtime?.controller.waitingMove||runtime?.controller.waitingSlat)};
}
module.exports={observe,execute,inspect};
