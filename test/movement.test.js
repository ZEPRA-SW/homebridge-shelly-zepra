'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CoverController}=require('../engines/shading/lib/controller');
function fixture(){const commands=[];const state={current_pos:10,slat_pos:50,pos_control:true,state:'stopped'};const client={separateSlatCommands:true,async call(method,params){if(method==='Cover.GetConfig')return{slat:{enable:true}};if(method==='Cover.GetStatus')return{...state};commands.push({method,params});return{};}};const c=new CoverController(client,0,()=>{},0);return{c,state,commands};}
test('moving cover buffers only latest height and tilt and sends it after arrival',async()=>{
 const {c,state,commands}=fixture();await c.move({pos:60,slat_pos:30});Object.assign(state,{state:'opening',current_pos:30,target_pos:60});await c.refresh();
 await c.set('pos',70);await c.set('pos',90);await c.set('slat_pos',80);assert.equal(commands.length,1);assert.deepEqual(c.waitingMove.target,{pos:90,slat_pos:80});
 Object.assign(state,{state:'stopped',current_pos:60,target_pos:null});await c.refresh();assert.equal(commands.length,2);assert.equal(commands[1].params.pos,90);
 Object.assign(state,{state:'stopped',current_pos:90});await c.refresh();assert.deepEqual(commands.at(-1).params,{id:0,slat_pos:80});c.dispose();
});
test('stop and wind discard queued normal movement instead of sending it later',async()=>{
 for(const kind of ['stop','wind']){const{c,state,commands}=fixture();await c.move({pos:60});Object.assign(state,{state:'opening',current_pos:30,target_pos:60});await c.refresh();await c.set('pos',90);if(kind==='stop')await c.stop();else await c.setWindAlarm(true);assert.equal(c.waitingMove,null);assert.ok(commands.some(x=>x.method===(kind==='stop'?'Cover.Stop':'Cover.Open')));assert.equal(commands.filter(x=>x.method==='Cover.GoToPosition').length,1);c.dispose();}
});
