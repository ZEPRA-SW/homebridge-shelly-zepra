'use strict';
const fs=require('node:fs'),path=require('node:path');
class HiddenAccessories{
 constructor(directory,warn){this.file=directory?path.join(directory,'shelly-zepra-hidden-shading.json'):null;this.warn=warn;this.records={};this.failed=false;
  if(this.file)try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved.version===1&&saved.records&&typeof saved.records==='object')this.records=saved.records;}catch(error){if(error.code!=='ENOENT')this.warn('Gespeicherte Zustände ausgeblendeter Beschattungen konnten nicht gelesen werden.');}
 }
 capture(a){if(!this.file)return;const context=JSON.parse(JSON.stringify(a.context));delete context.zepraUnpublished;this.records[a.UUID]={name:a.displayName,context};if(!this.timer)this.timer=setTimeout(()=>this.flush(),1000);}
 seed(cached,api,allowed){const known=new Set(cached.map(a=>a.UUID));for(const [uuid,record]of Object.entries(this.records)){if(known.has(uuid)||!allowed.has(uuid))continue;const a=new api.platformAccessory(record.name||'Beschattung',uuid);a.context={...record.context,zepraUnpublished:true};cached.push(a);}}
 flush(){clearTimeout(this.timer);this.timer=null;if(!this.file)return;const temp=this.file+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({version:1,records:this.records}),{mode:0o600});fs.renameSync(temp,this.file);this.failed=false;}catch{if(!this.failed)this.warn('Zustände ausgeblendeter Beschattungen konnten nicht gespeichert werden.');this.failed=true;}}
 close(){if(this.timer)this.flush();}
}
module.exports={HiddenAccessories};
