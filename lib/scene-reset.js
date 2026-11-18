'use strict';
const {actions,mode}=require('../homebridge-ui/public/scene-model');
const {evaluate}=require('./scene-condition');
const metrics={auto:'automationEnabled',pause:'manualPaused',wind:'windAlarm'};
const group=a=>JSON.stringify([a.area,a.deviceId,a.component||'']);
const key=a=>JSON.stringify([a.area,a.deviceId,a.component||'',a.property]);
const ref=a=>({...a,metric:metrics[a.property]||a.property});
const target=a=>Object.fromEntries(['area','deviceId','component','property'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
const same=(a,b,property)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<=(['position','slatPosition'].includes(property)?2:.51):a===b;
class SceneReset{
 constructor(engine,config,inspect){this.engine=engine;this.config=config;this.inspect=inspect||((a,now)=>engine.observe(ref(a),now));this.owners=new Map();}
 affected(action,c){return key(action)===key(c.action)||action.area==='shading'&&['position','slatPosition'].includes(action.property)&&['position','slatPosition','pause'].includes(c.action.property);}
 marker(scene){return scene.id+':'+this.engine.store.states[scene.id].lastRun;}
 prepare(scene){
  if(!scene.restoreOnReset)return;const e=this.engine,unique=new Map(),add=a=>unique.set(key(a),target(a));
  for(const a of actions(scene)){
   add(a);
   if(a.area==='shading'&&['position','slatPosition'].includes(a.property)){
    add({...a,property:'position'});const d=this.config.shading?.devices?.find(d=>d.id===a.deviceId);
    if(d?.deviceType!=='roller')add({...a,property:'slatPosition'});
    if(d?.sunAutomation?.enabled)add({...a,property:'pause'});
   }
  }
  const captures=[...unique.values()].map(action=>{const reading=this.inspect(action,e.now());if(!reading||!(typeof reading.value==='boolean'||Number.isFinite(reading.value)))throw Object.assign(Error('Kein aktueller Ausgangszustand für die Rücksetzung.'),{code:'SCENE_SNAPSHOT'});return {action,before:reading.value,expected:reading.value,group:group(action),sent:false,accepted:false};});
  const memory=e.memory.get(scene.id);e.store.states[scene.id].reset={marker:this.marker(scene),captures,nodes:scene.condition.kind==='group'?structuredClone(memory?.nodes||{}):{root:{match:memory?.match===true}},requested:false};e.event(scene,'snapshot','Ausgangszustände für Rücksetzung gespeichert');
 }
 truth(scene,context=this.engine.store.states[scene.id]?.reset){if(!context)return null;const e=this.engine;return evaluate(scene.condition,context.nodes,e.now(),e.observe,e.local(e.now()),{ignoreHold:true}).value;}
 request(scene){const e=this.engine,state=e.store.states[scene.id];if(!state?.reset||state.reset.requested)return state?.reset?.requested===true;if(this.truth(scene)!==false)return false;state.reset.requested=true;e.event(scene,'reset-trigger','Startbedingungen zurückgesetzt – Rücksetzung angefordert');return true;}
 before(scene,action){
  const e=this.engine,g=group(action),marker=this.marker(scene),reset=e.store.states[scene.id].reset;
  if(reset)for(const c of reset.captures.filter(c=>c.group===g)){
   const current=this.inspect(c.action,e.now());if(c.accepted&&(this.owners.get(g)!==reset.marker||current?.revision!==undefined&&current.revision!==c.revision))c.overridden=true;
   if(this.affected(action,c)){c.sent=true;c.sentAt=e.now();}
  }
  this.owners.set(g,marker);e.store.save();
 }
 accepted(scene,action){
  const e=this.engine,reset=e.store.states[scene.id].reset;if(!reset)return;const g=group(action);
  for(const c of reset.captures.filter(c=>c.group===g)){
   if(!this.affected(action,c)&&!c.accepted)continue;c.accepted=true;if(this.affected(action,c))c.sentAt=e.now();const current=this.inspect(c.action,e.now());c.revision=current?.revision;
   if(key(c.action)===key(action))c.expected=action.value;
   else if(action.area==='shading'&&['position','slatPosition'].includes(action.property)){
    if(c.action.property==='pause')c.expected=true;
    else if(c.action.property==='slatPosition'&&action.property==='position')c.expected=undefined;
   }
  }
  e.store.save();
 }
 failed(scene,action){const reset=this.engine.store.states[scene.id].reset;if(reset)for(const c of reset.captures.filter(c=>c.group===group(action)&&c.sent))c.uncertain=true;}
 gate(scene,context=this.engine.store.states[scene.id]?.reset){return this.engine.running&&mode(scene)!=='off'&&context?.requested===true&&this.truth(scene,context)===false;}
 async restore(scene){
  const e=this.engine,state=e.store.states[scene.id],reset=state.reset;if(!reset)return;state.phase='resetting';state.status='Vorherige Zustände werden wiederhergestellt';
  let restored=0,skipped=0;const rank={wind:0,position:1,slatPosition:2,Brightness:3,On:4,auto:5,pause:6},failed=new Set();
  const entries=[...reset.captures].sort((a,b)=>a.group.localeCompare(b.group)||(rank[a.action.property]??9)-(rank[b.action.property]??9));
  const deadline=e.now()+300000;
  try{e.event(scene,'reset-start',state.status);for(const c of entries){
   if(!c.sent)continue;if(!this.gate(scene))throw e.cancelled();
   const label=c.action.deviceId+' · '+c.action.property;
   const skip=reason=>{skipped++;e.event(scene,'reset-skip',label+': Rücksetzung ausgelassen – '+reason);};
   if(c.uncertain||!c.accepted||failed.has(c.group)){skip('vorheriger Befehl nicht eindeutig bestätigt');continue;}
   if(c.overridden||this.owners.get(c.group)!==reset.marker){skip('neuere Steuerung hat Vorrang');continue;}
   let current=this.inspect(c.action,e.now());
   // Normal status polling must first confirm a read after the Scene command.
   while(current&&(current.observedAt??e.now())<=c.sentAt&&e.now()<deadline){await e.delay(1000,()=>this.gate(scene)&&e.now()<deadline);current=this.inspect(c.action,e.now());}
   if(!current){failed.add(c.group);skip('keine aktuellen Zieldaten');continue;}
   if(current.revision!==undefined&&current.revision!==c.revision){failed.add(c.group);skip('neuere Steuerung hat Vorrang');continue;}
   if(c.expected!==undefined&&!same(current.value,c.expected,c.action.property)&&!current.moving){failed.add(c.group);skip('Ziel wurde zwischenzeitlich verändert');continue;}
   const writeToken=reset.marker+':'+key(c.action);let revoked=false;const allowed=()=>{const r=this.inspect(c.action,e.now()),own=r?.writer===writeToken;const valid=this.gate(scene,reset)&&e.now()<deadline&&this.owners.get(c.group)===reset.marker&&r&&(r.observedAt??e.now())>c.sentAt&&(own||((r.revision===undefined||r.revision===c.revision)&&(c.expected===undefined||r.moving||same(r.value,c.expected,c.action.property))));if(!valid)revoked=true;return !revoked;};
   e.budget=e.budget.filter(ts=>e.now()-ts<60000);if(e.budget.length>=30){e.event(scene,'reset-wait','Rücksetzung wartet auf freie Aktionskapazität');await e.delay(Math.max(1,e.budget[0]+60000-e.now()),allowed);e.budget=e.budget.filter(ts=>e.now()-ts<60000);}
   if(!allowed()){if(!this.gate(scene,reset))throw e.cancelled();failed.add(c.group);skip('Freigabe oder Zielzustand nicht mehr bestätigt');continue;}
   const action={...c.action,value:c.before,_sceneRestoreToken:writeToken};e.event(scene,'reset-send',label+': Befehl für vorherigen Wert '+c.before+' wird übergeben');e.budget.push(e.now());
   try{const sentAt=e.now();await e.execute(action,allowed);restored++;e.event(scene,'reset-accepted',label+': Befehl übergeben; Endzustand noch nicht bestätigt');
    if(c.action.area==='shading'&&['position','slatPosition'].includes(c.action.property)){
     let r=this.inspect(c.action,e.now());while(r&&(!same(r.value,c.before,c.action.property)||r.moving||r.pending||(r.observedAt??e.now())<sentAt)){
      if(!allowed())throw e.cancelled();await e.delay(1000,allowed);r=this.inspect(c.action,e.now());
     }if(!r)throw e.cancelled();e.event(scene,'reset-confirmed',label+': vorherige Position durch Rückmeldung bestätigt');
    }
    const revision=this.inspect(c.action,e.now())?.revision;for(const sibling of reset.captures.filter(x=>x.group===c.group))sibling.revision=revision;}
   catch{failed.add(c.group);skip('Befehl fehlgeschlagen oder Schutzsperre aktiv; keine Wiederholung');}
  }
   state.phase=skipped?'reset-partial':'reset-done';state.status='Rücksetzung: '+restored+' Befehle übergeben'+(skipped?', '+skipped+' ausgelassen':'');e.event(scene,'reset-done',state.status+'; Endzustände nicht bestätigt');
  }catch{state.phase='aborted';state.status='Rücksetzung abgebrochen: Bedingung erneut aktiv oder Plugin beendet';e.event(scene,'reset-aborted',state.status);}
  finally{delete state.reset;delete state.waitUntil;e.memory.delete(scene.id);try{e.store.save();}catch{e.log.error('Scene: Rücksetzergebnis konnte nicht gespeichert werden.');}}
 }
}
module.exports={SceneReset,ref,key,group};
