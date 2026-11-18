'use strict';
const {isCover}=require('./model');
function cloudURL(value) {
  let u;try{u=new URL(String(value).includes('://')?value:'https://'+value);}catch{throw new Error('Shelly-Cloud-Serveradresse prüfen.');}
  if(u.protocol!=='https:'||!/^shelly-[a-z0-9-]+\.shelly\.cloud$/.test(u.hostname)||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Cloud-Server muss eine HTTPS-Adresse wie https://shelly-123-eu.shelly.cloud sein.');
  return u;
}
const cloudId=value=>String(value||'').toLowerCase();
class CloudQueue {
  constructor(now=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))){this.now=now;this.wait=wait;this.next=0;this.tail=Promise.resolve();}
  run(fn){const job=this.tail.then(async()=>{const delay=this.next-this.now();if(delay>0)await this.wait(delay);this.next=this.now()+1050;return fn();});this.tail=job.catch(()=>{});return job;}
}
// All devices share the limit, including reads before writes. Never retry a command.
const queue=new CloudQueue();
class CloudClient {
  constructor(config,fetcher=fetch,limiter){this.config=config;this.base=cloudURL(config.cloudServer);this.fetcher=fetcher;this.limiter=limiter??require('../../../lib/cloud-queue').forAccount(this.base.origin,config.cloudKey);this.tail=Promise.resolve();this.stopped=false;}
  queue(fn){const job=this.tail.then(fn);this.tail=job.catch(()=>{});return job;}
  async request(endpoint,body,read=false,allowed=()=>true){
    return this.limiter.run(async()=>{
      if(!allowed())throw Error('Scene-Freigabe beendet.');
      if(this.stopped)throw new Error('Cloud-Verbindung beendet.');
      const u=new URL('/v2/devices/api/'+endpoint,this.base);u.searchParams.set('auth_key',this.config.cloudKey);
      let response;try {response=await this.fetcher(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new Error('Shelly-Cloud nicht erreichbar oder Zeitlimit überschritten.');}
      if(response.status!==200){await response.text();if(response.status===429){if(this.limiter.defer)this.limiter.defer(require('../../../lib/cloud-queue').retryDelay(response.headers?.get?.('retry-after'),this.limiter.now()));else this.limiter.next=Math.max(this.limiter.next,this.limiter.now()+60000);}throw new Error(response.status===401||response.status===403?'Shelly-Cloud: Schlüssel oder Kontozugriff prüfen.':'Shelly-Cloud HTTP-Fehler '+response.status);}
      if(!read){await response.text();return;}
      try{return await response.json();}catch{throw new Error('Ungültige Shelly-Cloud-Antwort.');}
    },{kind:read?'read':'write',coalesceKey:read?cloudId(this.config.cloudDeviceId)+':state':undefined,allowed});
  }
  async read(){
    const id=cloudId(this.config.cloudDeviceId),rows=await this.request('get',{ids:[id],select:['status','settings']},true);
    if(!Array.isArray(rows)||rows.length!==1||cloudId(rows[0]?.id)!==id)throw new Error('Cloud-Geräte-ID stimmt nicht überein. Zugriff gesperrt.');
    const row=rows[0];if(row.online!==1)throw new Error('Shelly ist laut Cloud offline; gespeicherte Werte werden nicht als aktuell gemeldet.');
    if(!row.status||typeof row.status!=='object'||Array.isArray(row.status)||!row.settings||typeof row.settings!=='object'||Array.isArray(row.settings))throw new Error('Unvollständiger Cloudstatus.');
    const gen=/^G([1-4])$/.exec(row.gen);if(!gen)throw new Error('Unbekannte Cloud-Gerätegeneration.');
    const generation=Number(gen[1]);if(this.config.generation==='gen1'&&generation!==1||this.config.generation==='rpc'&&generation===1)throw new Error('Cloud-Gerät passt nicht zur gewählten Modellgeneration.');
    const snap={gen:generation===1?1:2,info:{id:row.id,model:row.code,...(generation===1?{type:row.code}:{}),gen:generation,mac:row.status.sys?.mac||row.status.mac,profile:row.settings.sys?.device?.profile},status:row.status,settings:row.settings,components:[],cloud:true};
    if(snap.info.mac&&!cloudId(snap.info.mac).replace(/:/g,'').replace(/^0+/,'').endsWith(id.replace(/^0+/,'')))throw new Error('Cloud-Hardwarekennung stimmt nicht mit der Geräte-ID überein.');
    if(isCover(snap))throw new Error('Cover-/Rollladenprofil ist in diesem Plugin ausgeschlossen.');
    // Dynamic sensor metadata is usable only when the cloud actually supplies it.
    for(const [key,status] of Object.entries(row.status))if(/^(bthomedevice|bthomesensor):2\d\d$/.test(key)&&row.settings[key])snap.components.push({key,status,config:row.settings[key]});
    if(this.config.bthome?.length&&!snap.components.length)snap.bthomeError='BTHome-Metadaten fehlen im Cloudstatus; direkt gekoppelte Cloud-Sensoren separat eintragen.';
    return snap;
  }
  snapshot(){return this.queue(()=>this.read());}
  write(component,values,allowed=()=>true){return this.queue(async()=>{
    if(!allowed())throw Error('Scene-Freigabe beendet.');
    const c=this.config.channels?.find(c=>c.component===component&&c.enabled!==false);
    if(!c||!values||typeof values!=='object')throw new Error('Cloud-Ausgang nicht freigegeben.');
    const [kind,number]=component.split(':'),channel=Number(number);
    if(!Number.isInteger(channel)||channel<0)throw new Error('Ungültiger Cloudkanal.');
    const relay=['switch','relay'].includes(kind),light=['light','rgb','rgbw','cct','color','white'].includes(kind);
    if(!relay&&!light||Object.keys(values).some(k=>!(relay?['on']:['on','brightness','gain','rgb','red','green','blue','white','ct','temp']).includes(k)))throw new Error('Befehl wird über die Cloud nicht unterstützt.');
    if(values.on!==undefined&&typeof values.on!=='boolean')throw new Error('Ungültiger Cloud-Schaltwert.');
    for(const key of ['brightness','gain'])if(values[key]!==undefined&&(!Number.isFinite(values[key])||values[key]<0||values[key]>100))throw new Error('Ungültige Cloudhelligkeit.');
    const body={id:cloudId(this.config.cloudDeviceId),channel,...values};
    if(values.rgb!==undefined){if(!Array.isArray(values.rgb)||values.rgb.length!==3||values.rgb.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error('Ungültige Cloudfarbe.');[body.red,body.green,body.blue]=values.rgb;delete body.rgb;}
    for(const key of ['red','green','blue','white'])if(body[key]!==undefined&&(!Number.isInteger(body[key])||body[key]<0||body[key]>255))throw new Error('Ungültiger Cloudfarbwert.');
    if(values.ct!==undefined||values.temp!==undefined){body.temperature=values.ct??values.temp;delete body.ct;delete body.temp;if(!Number.isFinite(body.temperature)||body.temperature<2700||body.temperature>7000)throw new Error('Cloud-Farbtemperatur: 2700 bis 7000 Kelvin.');}
    if(['rgb','rgbw','color'].includes(kind)&&body.brightness!==undefined){body.gain=body.brightness;delete body.brightness;}
    const snap=await this.read();const state=snap.gen===1?snap.status[kind==='relay'?'relays':'lights']?.[channel]:snap.status[component];
    if(!state)throw new Error('Ausgang fehlt im Cloudstatus.');
    return this.request('set/'+(relay?'switch':'light'),body,false,allowed);
  });}
  reboot(){return Promise.reject(new Error('Neustart ist über diese Cloud-Schnittstelle nicht verfügbar.'));}
  stop(){this.stopped=true;}
}
module.exports={CloudClient,CloudQueue,cloudURL,cloudId};
