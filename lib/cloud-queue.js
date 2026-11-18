'use strict';
const { createHash } = require('node:crypto');
class CloudScheduler {
  constructor({ now = () => Date.now(), interval = 2000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.now=now;this.interval=interval;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.accounts=new Map();this.jobs=[];this.pendingReads=new Map();this.running=false;this.closed=false;this.order=0;
  }
  state(account){if(!this.accounts.has(account))this.accounts.set(account,{next:0,cooldown:0,strikes:0,lastLimited:0});return this.accounts.get(account);}
  limiter(server,key){
    const account=createHash('sha256').update(server+'\n'+key).digest('hex'),scheduler=this;
    return {
      now:()=>scheduler.now(),
      get next(){const s=scheduler.state(account);return Math.max(s.next,s.cooldown);},
      set next(value){const s=scheduler.state(account);if(Number.isFinite(value))s.next=Math.max(s.next,value);},
      defer(ms){scheduler.defer(account,ms);},
      run(work,meta={}){return scheduler.run(account,work,meta);},
      wake(){scheduler.wake();},
    };
  }
  defer(account,ms=30000){
    const s=this.state(account),now=this.now();
    if(now-s.lastLimited>600000)s.strikes=0;
    s.strikes=Math.min(s.strikes+1,5);s.lastLimited=now;
    s.cooldown=Math.max(s.cooldown,now+Math.max(ms,Math.min(300000,30000*2**(s.strikes-1))));
    this.wake();
  }
  run(account,work,meta={}){
    if(this.closed)return Promise.reject(new Error('Cloud-Warteschlange beendet.'));
    const key=meta.kind==='read'&&meta.coalesceKey?account+':'+meta.coalesceKey:null;
    if(key&&this.pendingReads.has(key))return this.pendingReads.get(key).promise;
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={account,work,promise,resolve,reject,key,allowed:meta.allowed,priority:meta.priority??(meta.kind==='read'?0:10),order:++this.order};
    if(key)this.pendingReads.set(key,job);this.jobs.push(job);this.wake();return promise;
  }
  wake(){
    for(const job of [...this.jobs])if(job.allowed&&!job.allowed()){
      this.jobs.splice(this.jobs.indexOf(job),1);if(job.key)this.pendingReads.delete(job.key);
      job.reject(Object.assign(new Error('Fahrbefehl verworfen.'),{code:'COMMAND_CANCELLED'}));
    }
    if(this.timer!==undefined){this.clearTimer(this.timer);this.timer=undefined;}if(!this.running&&!this.closed)this.pump();}
  pump(){
    if(this.running||this.closed||!this.jobs.length)return;
    for(const job of [...this.jobs])if(job.allowed&&!job.allowed()){
      this.jobs.splice(this.jobs.indexOf(job),1);if(job.key)this.pendingReads.delete(job.key);
      job.reject(Object.assign(new Error('Fahrbefehl verworfen.'),{code:'COMMAND_CANCELLED'}));
    }
    if(!this.jobs.length)return;
    const now=this.now(),due=this.jobs.filter(j=>{const s=this.state(j.account);return Math.max(s.next,s.cooldown)<=now;});
    if(!due.length){
      const next=Math.min(...this.jobs.map(j=>{const s=this.state(j.account);return Math.max(s.next,s.cooldown);}));
      this.timer=this.setTimer(()=>{this.timer=undefined;this.pump();},Math.max(1,next-now));return;
    }
    due.sort((a,b)=>b.priority-a.priority||a.order-b.order);const job=due[0];this.jobs.splice(this.jobs.indexOf(job),1);
    if(job.key)this.pendingReads.delete(job.key);
    this.state(job.account).next=now+this.interval;this.running=true;
    Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{this.running=false;this.pump();});
  }
  close(){this.closed=true;if(this.timer!==undefined)this.clearTimer(this.timer);for(const job of this.jobs)job.reject(new Error('Cloud-Warteschlange beendet.'));this.jobs=[];this.pendingReads.clear();}
}
function retryDelay(header,now=Date.now()){
 const seconds=typeof header==='string'&&/^\d+(?:\.\d+)?$/.test(header.trim())?Number(header)*1000:NaN;
 const ms=Number.isFinite(seconds)?seconds:Date.parse(header)-now;
 return Math.min(86400000,Math.max(5000,Number.isFinite(ms)?ms:30000));
}
let current;
function shared(){if(!current||current.closed)current=new CloudScheduler();return current;}
function forAccount(server,key){return shared().limiter(server,key);}
module.exports={CloudScheduler,shared,forAccount,retryDelay};
