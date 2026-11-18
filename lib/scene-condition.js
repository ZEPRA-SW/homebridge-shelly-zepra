'use strict';
const {compare}=require('../homebridge-ui/public/scene-model');
// null means an unavailable observation, never a matching condition.
// Every child is evaluated, so independent hold durations keep advancing.
function evaluate(tree,nodes,now,observe,local,{latchedTime=false,notBefore=-Infinity,ignoreHold=false}={}){
 function visit(t,path){
  if(t.kind==='group'){
   const children=t.children.map((child,i)=>visit(child,path+'.'+i)),truth=children.filter(c=>c.value===true);
   const value=t.operator==='and'?(children.some(c=>c.value===false)?false:children.some(c=>c.value===null)?null:true):(truth.length?true:children.some(c=>c.value===null)?null:false);
   const witnesses=t.operator==='and'?children:truth;
   return {value,rising:value===true&&witnesses.some(c=>c.rising),clocks:value===true?witnesses.flatMap(c=>c.clocks):[],timeless:value===true&&(t.operator==='and'?children.every(c=>c.timeless):truth.some(c=>c.timeless))};
  }
  const memory=nodes[path]??={};
  if(t.kind==='time'){
   const match=latchedTime?memory.match===true:t.time===local.time&&t.days.includes(local.weekday);if(!latchedTime)memory.match=match;
   return {value:match,rising:false,clocks:match?[JSON.stringify([t.time,[...t.days].sort()])]:[],timeless:false};
  }
  const observation=observe(t.source,now);
  if(!observation||(observation.observedAt??now)<notBefore||!(typeof observation.value==='boolean'||Number.isFinite(observation.value))){delete nodes[path];return {value:null,clocks:[],timeless:false};}
  const match=compare(observation.value,t,memory.match===true),hold=ignoreHold?0:(t.holdSeconds??0)*1000;
  if(!match)memory.since=null;else if(!memory.match||memory.since==null)memory.since=now;
  memory.match=match;const value=match&&now-memory.since>=hold&&(!hold||(observation.observedAt??now)>=memory.since+hold);
  const rising=memory.qualified!==undefined&&value&&!memory.qualified;memory.qualified=value;return {value,rising,clocks:[],timeless:value};
 }
 return visit(tree,'root');
}
module.exports={evaluate};
