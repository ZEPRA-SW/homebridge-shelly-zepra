'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const stamp=d=>({day:[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),time:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')});
class RebootScheduler {
  constructor(storage,units,log,now=()=>new Date()) {this.file=path.join(storage,'shelly-universal-reboots.json');this.units=units;this.log=log;this.now=now;this.stopped=false;this.busy=false;this.started=stamp(now());}
  async start() {
    try {this.days=JSON.parse(await fs.readFile(this.file,'utf8'));if(!this.days||Array.isArray(this.days)||typeof this.days!=='object'||Object.values(this.days).some(v=>typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)))throw Error();}
    catch(e){if(e.code==='ENOENT')this.days={};else {this.log.error('Neustartplan nicht lesbar; automatische Neustarts bleiben aus.');return;}}
    if(this.stopped)return;
    this.timer=setInterval(()=>this.tick(),15000);this.timer.unref?.();
  }
  async tick() {
    if(this.stopped||this.busy||!this.days)return;this.busy=true;
    try {
      const current=stamp(this.now());
      // Do not trigger during the minute Homebridge was started, or catch up missed minutes.
      if(current.day===this.started.day&&current.time===this.started.time)return;
      for(const unit of this.units.values()) {
        const d=unit.config,key=String(d.shellyDeviceId).toLowerCase().replace(/:/g,'').slice(-12);
        if(this.stopped||d.rebootEnabled!==true||d.rebootTime!==current.time||this.days[key]>=current.day)continue;
        this.days[key]=current.day;
        // Persist the attempt BEFORE sending: restart/DST repetition must never create a loop.
        const temp=this.file+'.'+process.pid+'.tmp';
        try {await fs.writeFile(temp,JSON.stringify(this.days),{mode:0o600});await fs.rename(temp,this.file);}
        catch {await fs.unlink(temp).catch(()=>{});this.log.error(d.name+': Neustart ausgelassen, Zeitplan konnte nicht gespeichert werden.');continue;}
        const due=()=>{const n=stamp(this.now());return !this.stopped&&n.day===current.day&&n.time===current.time;};
        if(!due())continue;
        try {await unit.client.reboot(due);this.log.info(d.name+': geplanter Neustart angefordert.');}
        catch(e){this.log.warn(d.name+': geplanter Neustart fehlgeschlagen: '+e.message);}
      }
    } finally {this.busy=false;}
  }
  stop(){this.stopped=true;clearInterval(this.timer);}
}
module.exports={RebootScheduler,stamp};
