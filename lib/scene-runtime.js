'use strict';
function observe(platform,ref,now=Date.now()){
 if(ref.area==='devices'){const store=platform.devices.statusStore,record=store?.devices.get(ref.deviceId);if(!record?.online||!Number.isFinite(record.checkedAt)||now-record.checkedAt>store.maxAge||record.checkedAt>now+5000)return null;
  const rows=ref.sensorId?record.bthome?.find(b=>b.id===ref.sensorId&&!b.fault)?.readings:[...record.readings||[],...record.measurements||[]];const item=rows?.find(r=>r.component===ref.component&&!r.fault&&Object.hasOwn(r.values||{},ref.metric));return item?{value:item.values[ref.metric],observedAt:record.checkedAt}:null;
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
