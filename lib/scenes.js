'use strict';
const fs=require('node:fs'),path=require('node:path'),{compare,validate,mode,scheduleActive,actions,conditionLeaves,observation}=require('../homebridge-ui/public/scene-model');
const {evaluate}=require('./scene-condition');
const {SceneReset}=require('./scene-reset');
function appendEvent(state,now,type,message,step){state.events=[...(Array.isArray(state.events)?state.events:[]),{timestamp:now,type,message,...step?{step}:{}}].slice(-10);}
class SceneStore{
 constructor(directory){this.file=directory?path.join(directory,'shelly-zepra-scenes.json'):null;this.states={};if(this.file)try{const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version===1)this.states=data.states||{};let changed=false;for(const state of Object.values(this.states)){if(state?.events?.length>10){state.events=state.events.slice(-10);changed=true;}if(state?.reset){delete state.reset;state.phase='aborted';state.status='Rücksetzung nach Neustart aufgehoben';appendEvent(state,Date.now(),'reset-aborted',state.status);changed=true;}if(state&&['starting','wait','condition','send'].includes(state.phase)){state.phase='aborted';state.status='Nach Neustart abgebrochen';delete state.waitUntil;appendEvent(state,Date.now(),'aborted','Nach Neustart abgebrochen',state.step);changed=true;}}if(changed)this.save();}catch(e){if(e.code!=='ENOENT')throw Error('Gespeicherte Scene-Zustände sind nicht lesbar.');}}
 save(){if(!this.file)return;const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:1,states:this.states}),{mode:0o600});fs.renameSync(temp,this.file);}
}
class SceneEngine{
 constructor({config,store,observe,execute,log,now=()=>Date.now(),delay,inspect}){this.rules=validate(config.scenes||[],config);this.timeZone=config.shading?.timeZone||'Europe/Berlin';new Intl.DateTimeFormat('en-GB',{timeZone:this.timeZone});this.store=store;this.observe=observe;this.execute=execute;this.log=require('./i18n').logger(log,config.language,'scenes');this.t=(text,params={})=>require('../homebridge-ui/public/i18n').translate(text,config.language,params,'scenes');this.now=now;this.memory=new Map();this.displayMemory=new Map();this.resets=new SceneReset(this,config,inspect);this.inFlight=new Set();this.running=false;this.busy=false;this.budget=[];this.waiters=new Set();this.delay=delay??this.wait.bind(this);}
 start(){this.running=true;this.timer=setInterval(()=>{this.tick().catch(e=>this.log.error('Scene: '+e.message));},1000);this.timer.unref?.();return this.tick();}
 stop(){this.running=false;clearInterval(this.timer);for(const cancel of [...this.waiters])cancel();}
 local(now){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:this.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return {day:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute,weekday:new Date(parts.year+'-'+parts.month+'-'+parts.day+'T12:00:00Z').getUTCDay()};}
 publishConditions(){let changed=false;const now=this.now(),local=this.local(now);for(const scene of this.rules){const state=this.store.states[scene.id]??={};let value='inactive';if(mode(scene)!=='off'&&(mode(scene)!=='schedule'||scheduleActive(scene.schedule,local.weekday,local.time))){const nodes=this.displayMemory.get(scene.id)||{};this.displayMemory.set(scene.id,nodes);const result=evaluate(scene.condition,nodes,now,this.observe,local);value=result.value===true?'true':result.value===false?'false':'unknown';}else this.displayMemory.delete(scene.id);if(state.conditionState!==value||now-(state.conditionCheckedAt??0)>=15000){state.conditionState=value;state.conditionCheckedAt=now;changed=true;}}if(changed)try{this.store.save();}catch{} }
 async tick(){if(!this.running||this.busy)return;this.busy=true;this.publishConditions();const jobs=[];try{for(const scene of this.rules){if(!this.running)break;if(mode(scene)==='off')continue;const resetting=this.store.states[scene.id]?.reset;if(resetting){const requested=this.resets.request(scene);if(requested&&!this.inFlight.has(scene.id)){this.inFlight.add(scene.id);jobs.push(this.resets.restore(scene).finally(()=>this.inFlight.delete(scene.id)));}continue;}if(this.inFlight.has(scene.id))continue;const now=this.now(),t=scene.condition,state=this.store.states[scene.id]||{},memory=this.memory.get(scene.id)||{};let due=false,day;
  if(mode(scene)==='schedule'){const local=this.local(now);if(!scheduleActive(scene.schedule,local.weekday,local.time)){this.memory.delete(scene.id);continue;}}
  if(t.kind==='group'){
   memory.nodes??={};const result=evaluate(t,memory.nodes,now,this.observe,this.local(now));
   if(result.value===null){memory.initialized=false;memory.match=null;memory.pending=false;}else{
    const clockDue=result.clocks.some(key=>(state.clockDays?.[key]??(!Object.keys(state.clockDays||{}).length?state.lastDay:undefined))!==this.local(now).day);
    due=result.value===true&&((memory.initialized&&memory.match!==true)||memory.match!==true&&result.rising||clockDue)&&(result.timeless||clockDue);
    memory.initialized=true;memory.match=result.value;memory.pending=due;
    if(due){memory.clockKeys=result.clocks;day=result.clocks.length?this.local(now).day:undefined;}
   }this.memory.set(scene.id,memory);
  }else if(t.kind==='time'){const local=this.local(now);day=local.day;due=t.time===local.time&&t.days.includes(local.weekday)&&state.lastDay!==day;}
  else{const reading=observation(t,this.observe,now);if(!reading||!(typeof reading.value==='boolean'||Number.isFinite(reading.value))){this.memory.delete(scene.id);continue;}const match=compare(reading.value,t,memory.match===true),hold=(t.holdSeconds??0)*1000;
   if(!memory.initialized){memory.initialized=true;memory.pending=!!hold&&match;memory.since=memory.pending?now:null;}
   else if(!match){memory.pending=false;memory.since=null;}
   else if(!memory.match){memory.pending=true;memory.since=now;}
   memory.match=match;due=match&&memory.pending&&now-memory.since>=hold&&(!hold||(reading.observedAt??now)>=memory.since+hold);if(due&&!hold)memory.pending=false;this.memory.set(scene.id,memory);
  }
  if(!due||now-(state.lastRun??-Infinity)<(scene.cooldownSeconds??60)*1000)continue;
  if(t.kind!=='time'){const current=this.memory.get(scene.id);if(current)current.pending=false;}
  const clockDays=Object.fromEntries(Object.entries(state.clockDays||{}).filter(([,value])=>value===this.local(now).day));if(day&&t.kind==='time')clockDays[JSON.stringify([t.time,[...t.days].sort()])]=day;if(day&&t.kind==='group')for(const key of memory.clockKeys||[])clockDays[key]=day;
  this.budget=this.budget.filter(ts=>now-ts<60000);if(this.budget.length>=30){this.store.states[scene.id]={...state,lastRun:now,clockDays,...day?{lastDay:day}:{},status:'Auslösung verworfen – Aktionsgrenze'};appendEvent(this.store.states[scene.id],now,'limit','Auslösung verworfen – Aktionsgrenze');try{this.store.save();}catch{}this.log.warn(this.t('Scene {name}: {status}.',{name:scene.name,status:'Aktionsgrenze erreicht; Auslösung verworfen'}));continue;}
  this.store.states[scene.id]={...state,lastRun:now,clockDays,...day?{lastDay:day}:{},phase:'starting',step:0,total:actions(scene).length,waitUntil:undefined,status:'Befehl wird übergeben'};appendEvent(this.store.states[scene.id],now,'trigger','Startbedingungen erfüllt');
  try{this.store.save();}catch{this.log.error(this.t('Scene {name}: {status}.',{name:scene.name,status:'Status nicht speicherbar; Aktion gesperrt'}));continue;}
  this.inFlight.add(scene.id);jobs.push(this.dispatch(scene));
 }}finally{this.busy=false;}await Promise.all(jobs);}
 active(scene,checkSource=false){
  if(!this.running||mode(scene)==='off')return false;if(scene.restoreOnReset&&this.store.states[scene.id]?.reset&&this.resets.request(scene))return false;const now=this.now();if(mode(scene)==='schedule'){const local=this.local(now);if(!scheduleActive(scene.schedule,local.weekday,local.time))return false;}
  if(checkSource&&scene.condition.kind==='group')return evaluate(scene.condition,this.memory.get(scene.id)?.nodes||{},now,this.observe,this.local(now),{latchedTime:true}).value===true;
  if(checkSource&&scene.condition.kind!=='time'){const observed=observation(scene.condition,this.observe,now);return !!observed&&compare(observed.value,scene.condition,true);}return true;
 }
 cancellationReason(scene){if(!this.running)return 'Plugin beendet';if(mode(scene)==='off')return 'Scene deaktiviert';const local=this.local(this.now());if(mode(scene)==='schedule'&&!scheduleActive(scene.schedule,local.weekday,local.time))return 'Zeitfenster beendet';return 'Bedingung oder Befehlsfreigabe nicht mehr bestätigt';}
 cancelled(){return Object.assign(Error('Scene wurde beendet.'),{code:'SCENE_CANCELLED'});}
 wait(ms,allowed){if(!ms)return Promise.resolve();const until=this.now()+ms;return new Promise((resolve,reject)=>{let timer;const cancel=()=>{clearTimeout(timer);this.waiters.delete(cancel);reject(this.cancelled());};const check=()=>{if(!allowed()){cancel();return;}const remaining=until-this.now();if(remaining<=0){this.waiters.delete(cancel);resolve();return;}timer=setTimeout(check,Math.min(1000,remaining));timer.unref?.();};this.waiters.add(cancel);check();});}
 event(scene,type,message){const state=this.store.states[scene.id];appendEvent(state,this.now(),type,message,state.step);this.store.save();}
 async conditionWait(scene,step,active){
  const nodes={},notBefore=this.now(),state=this.store.states[scene.id],until=notBefore+(step.conditionTimeoutSeconds??300)*1000;state.phase='condition';state.waitUntil=until;state.status='Stufe '+state.step+': wartet auf Bedingungen';this.event(scene,'condition-wait',state.status);
  while(true){if(!active())throw this.cancelled();if(this.now()>=until)throw Object.assign(Error('Bedingungswartezeit abgelaufen.'),{code:'SCENE_CONDITION_TIMEOUT'});
   if(evaluate(step.condition,nodes,this.now(),this.observe,this.local(this.now()),{notBefore}).value===true){delete state.waitUntil;this.event(scene,'condition-met','Stufe '+state.step+': Bedingungen erfüllt');return {nodes,notBefore};}
   await this.delay(Math.min(1000,until-this.now()),active);
  }
 }
 async dispatch(scene){let started=false,currentStep,commandInFlight=false;const steps=actions(scene);
  try{this.resets.prepare(scene);for(const [index,step]of steps.entries()){currentStep=step;
    const active=()=>this.active(scene,steps.length===1||!started);if(!active())throw this.cancelled();const state=this.store.states[scene.id];state.step=index+1;state.total=steps.length;
    this.event(scene,'stage','Stufe '+(index+1)+' begonnen');
    if(step.delaySeconds){state.phase='wait';state.waitUntil=this.now()+step.delaySeconds*1000;state.status='Aktion '+(index+1)+'/'+steps.length+': wartet '+step.delaySeconds+' Sekunden';this.event(scene,'delay',state.status);await this.delay(step.delaySeconds*1000,active);}
    const gate=step.condition?await this.conditionWait(scene,step,active):null;
    const timed=scene.condition.kind==='time'||this.memory.get(scene.id)?.clockKeys?.length||step.condition&&conditionLeaves(step.condition).some(c=>c.kind==='time');
    const deadline=timed?(index===0&&!step.delaySeconds&&!step.condition?state.lastRun+60000:this.now()+60000):Infinity;
    const allowed=()=>active()&&this.now()<deadline&&(!gate||evaluate(step.condition,gate.nodes,this.now(),this.observe,this.local(this.now()),{latchedTime:true,notBefore:gate.notBefore}).value===true);if(!allowed())throw this.cancelled();
    this.budget=this.budget.filter(ts=>this.now()-ts<60000);if(this.budget.length>=30)throw Object.assign(Error('Aktionsgrenze erreicht.'),{code:'SCENE_LIMIT'});
    state.phase='send';delete state.waitUntil;state.status='Aktion '+(index+1)+'/'+steps.length+': Befehl wird übergeben';this.event(scene,'send',state.status);this.budget.push(this.now());
    this.resets.before(scene,step);commandInFlight=true;await this.execute(step,allowed);this.resets.accepted(scene,step);commandInFlight=false;started=true;this.event(scene,'accepted','Stufe '+(index+1)+': Befehl übergeben; Endzustand nicht bestätigt');
   }
   this.store.states[scene.id].phase='done';this.store.states[scene.id].status=steps.length===1?'Befehl übergeben':'Aktionsfolge beendet – Befehle übergeben';this.event(scene,'done',this.store.states[scene.id].status);this.log.info(this.t('Scene {name}: {status}.',{name:scene.name,status:this.store.states[scene.id].status}));
  }
  catch(error){if(commandInFlight&&currentStep)this.resets.failed(scene,currentStep);const state=this.store.states[scene.id];state.phase='aborted';delete state.waitUntil;state.status=error.code==='SCENE_CANCELLED'?'Aktionsfolge abgebrochen: '+this.cancellationReason(scene):error.code==='SCENE_CONDITION_TIMEOUT'?'Maximale Bedingungswartezeit abgelaufen':error.code==='SCENE_LIMIT'?'Auslösung verworfen – Aktionsgrenze':error.code==='SCENE_SNAPSHOT'?'Kein aktueller Ausgangszustand – Scene nicht ausgeführt':'Aktion fehlgeschlagen';appendEvent(state,this.now(),'aborted',state.status,state.step);this.log.warn(this.t('Scene {name}: {status}; verbleibende Schritte verworfen, keine automatische Wiederholung.',{name:scene.name,status:state.status}));}
  finally{const state=this.store.states[scene.id];try{if(state.reset&&this.running){if(this.resets.request(scene))await this.resets.restore(scene);else if(state.reset.captures.some(c=>c.sent)){state.phase='reset-pending';state.status='Wartet auf Rücksetzung der Startbedingungen';appendEvent(state,this.now(),'reset-pending',state.status);}else delete state.reset;}}catch{delete state.reset;state.phase='aborted';state.status='Rücksetzung gesperrt: Status konnte nicht gespeichert werden';appendEvent(state,this.now(),'reset-aborted',state.status);this.log.error(this.t('Scene {name}: {status}',{name:scene.name,status:state.status}));}finally{this.inFlight.delete(scene.id);try{this.store.save();}catch{this.log.error('Scene: Ergebnis konnte nicht gespeichert werden.');}}}

 }

}
module.exports={SceneEngine,SceneStore};
