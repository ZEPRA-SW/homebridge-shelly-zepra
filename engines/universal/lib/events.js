'use strict';
const { digest } = require('./client');
const { matches } = require('./config');
const eventValue = name => ({single_push:0,double_push:1,long_push:2,S:0,SS:1,L:2})[name];
class Events {
  constructor(client, onEvent, warn, Socket = WebSocket) {
    this.client=client; this.onEvent=onEvent; this.warn=warn; this.Socket=Socket; this.seen=new Set(); this.closed=false; this.retry=1000;
  }
  start() {
    if(this.closed || this.socket) return;
    const url=new URL('/rpc',this.client.base); url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=this.socket=new this.Socket(url);
    let authorized=false, attempts=0;
    const frame={id:1,src:'hb-shelly-'+this.client.config.id,method:'Shelly.GetStatus'};
    const send=()=>socket.send(JSON.stringify(frame));
    const handshake=setTimeout(()=>socket.close(),10000); handshake.unref?.();
    socket.addEventListener('open',send);
    socket.addEventListener('message',e=>{
      try {
        const m=JSON.parse(e.data);
        if(!matches({id:m.src},this.client.config.shellyDeviceId) && !matches({mac:String(m.src).slice(-12)},this.client.config.shellyDeviceId)) throw new Error('WebSocket-Geräte-ID weicht ab.');
        if(m.id===1) {
          if(m.error?.code===401 && attempts++===0) {
            const challenge=JSON.parse(m.error.message);
            frame.auth=digest(challenge,this.client.config.password,'dummy_method','dummy_uri',1,Math.floor(Math.random()*0x7fffffff)); send(); return;
          }
          if(m.error) throw new Error('WebSocket-Anmeldung fehlgeschlagen.');
          authorized=true; clearTimeout(handshake); this.retry=1000; return;
        }
        if(!authorized || m.method!=='NotifyEvent') return;
        for(const event of m.params?.events || []) {
          const value=eventValue(event.event); if(value===undefined) continue;
          const stamp=event.ts ?? m.params.ts;
          if(typeof stamp!=='number') continue;
          const key=[event.component,event.idx,event.event,stamp].join('|');
          if(this.seen.has(key)) continue;
          this.seen.add(key); if(this.seen.size>512) this.seen.delete(this.seen.values().next().value);
          this.onEvent(event,value);
        }
      } catch(err) {this.warn(err.message);socket.close();}
    });
    socket.addEventListener('error',()=>{this.warn('WebSocket nicht erreichbar; Tastenereignisse können fehlen.');socket.close();});
    socket.addEventListener('close',()=>{
      clearTimeout(handshake); if(this.socket===socket) this.socket=null;
      if(!this.closed) {this.timer=setTimeout(()=>this.start(),this.retry);this.timer.unref?.();this.retry=Math.min(60000,this.retry*2);}
    });
  }
  stop() {this.closed=true;clearTimeout(this.timer);this.socket?.close();}
}
module.exports={Events,eventValue};
