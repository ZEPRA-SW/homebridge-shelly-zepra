'use strict';
const KEY=/^(boolean|button):2\d\d$/;
const EVENTS=['single_push','double_push','triple_push','long_push'];
function validateVirtual(device){
  const items=device.virtualComponents||[];
  if(!Array.isArray(items)||items.length>100)throw new Error('Virtuelle Komponenten müssen eine Liste mit höchstens 100 Einträgen sein.');
  if(items.length&&device.generation==='gen1')throw new Error('Virtuelle Komponenten benötigen ein RPC-Gerät.');
  const seen=new Set();
  for(const v of items){
    if(!v||!KEY.test(v.component)||seen.has(v.component)||typeof v.name!=='string'||!v.name.trim())throw new Error('Virtuelle Komponente: eindeutige Komponenten-ID und Name erforderlich.');
    seen.add(v.component);
    if(v.enabled!==undefined&&typeof v.enabled!=='boolean')throw new Error('Virtuelle Komponente: Anzeigen muss ein/aus sein.');
    if(v.component.startsWith('boolean:')?v.mode!=='switch':!['trigger','events'].includes(v.mode))throw new Error('Darstellung passt nicht zur virtuellen Komponente.');
    if(v.event!==undefined&&!EVENTS.includes(v.event))throw new Error('Ungültiger virtueller Tastendruck.');
  }
}
const canRead=c=>c?.attrs?.access===undefined||/[rw*]/.test(c.attrs.access);
const canWrite=c=>c?.attrs?.access===undefined||/[w*]/.test(c.attrs.access);
function virtualDescriptors(snap,config,warnings){
  const result=[];
  if(snap.virtualError)warnings.push(snap.virtualError);
  for(const v of config.virtualComponents||[]){
    if(v.enabled===false)continue;
    const c=snap.components?.find(c=>c.key===v.component);
    if(!c||!canRead(c)){warnings.push('Virtuelle Komponente nicht lesbar: '+v.component);continue;}
    if(v.component.startsWith('boolean:')){
      if(typeof c.status?.value!=='boolean'||c.status.errors?.length){warnings.push('Virtueller Schalter ohne gültigen Zustand: '+v.component);continue;}
      result.push({key:v.component,name:v.name,type:'switch',values:{On:c.status.value},virtual:true,output:true,writable:canWrite(c)});
    }else if(v.mode==='trigger')result.push({key:v.component,name:v.name,type:'switch',values:{On:false},virtual:true,output:true,momentary:true,event:v.event||'single_push',writable:canWrite(c)});
    else result.push({key:v.component,name:v.name,type:'button',values:{},virtual:true});
  }
  return result;
}
module.exports={KEY,EVENTS,validateVirtual,virtualDescriptors,canWrite};
