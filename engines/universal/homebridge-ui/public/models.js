'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ShellyModels=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  const models=[];
  const ports=(kind,n,type='switch',extra={})=>Array.from({length:n},(_,id)=>({component:kind+':'+id,type,...extra}));
  const inputs=n=>Array.from({length:n},(_,id)=>({component:'input:'+id,mode:'state'}));
  const gen1='https://shelly-api-docs.shelly.cloud/gen1/';
  const rpc=(gen,page)=>'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen'+gen+'/'+page+'/';
  function add(id,label,generation,outputs,n,options={}) {
    const m={id,label,generation,outputs,inputs:inputs(n),energy:false,sensors:false,bthome:false,addon:null,...options};
    if(!m.source)m.source=generation==='gen1'?gen1:rpc(2,'Shelly'+id);
    models.push(m);return m;
  }
  for(const [id,label,count,n,energy,addon] of [
    ['gen1-1','Shelly 1 (Gen1)',1,1,false,'gen1-sensor'],['gen1-1pm','Shelly 1PM (Gen1)',1,1,true,'gen1-sensor'],
    ['gen1-2','Shelly 2 (Gen1, Relaisprofil)',2,2,true,null],['gen1-25','Shelly 2.5 (Gen1, Relaisprofil)',2,2,true,null],
    ['gen1-4pro','Shelly 4Pro (Gen1)',4,4,true,null],['gen1-plug','Shelly Plug (Gen1)',1,0,true,null],['gen1-plugs','Shelly Plug S (Gen1)',1,0,true,null]
  ])add(id,label,'gen1',ports('relay',count,id.includes('plug')?'outlet':'switch'),n,{energy,sensors:energy,addon});
  add('gen1-dimmer','Shelly Dimmer (Gen1)','gen1',ports('light',1,'light',{dimmable:true}),2,{energy:true,sensors:true});
  add('gen1-dimmer2','Shelly Dimmer 2 (Gen1)','gen1',ports('light',1,'light',{dimmable:true}),2,{energy:true,sensors:true});
  add('gen1-duo','Shelly Duo (Gen1)','gen1',ports('light',1,'light',{dimmable:true,cct:true}),0);
  add('gen1-bulb','Shelly Bulb (Gen1)','gen1',ports('light',1,'light',{dimmable:true,color:true,cct:true}),0);
  add('gen1-rgbw2','Shelly RGBW2 (Gen1)','gen1',[],4,{energy:true,profiles:[
    {id:'color',label:'RGBW (Farbe)',outputs:ports('color',1,'light',{dimmable:true,color:true}),deviceProfile:'color'},
    {id:'white',label:'4 × Weißlicht',outputs:ports('white',4,'light',{dimmable:true}),deviceProfile:'white'}]});
  add('gen1-em','Shelly EM (Gen1)','gen1',ports('relay',1),0,{energy:true,meter:true});
  add('gen1-3em','Shelly 3EM (Gen1)','gen1',ports('relay',1),0,{energy:true,meter:true});
  for(const [id,label,count,n,energy,addon,page] of [
    ['plus1','Shelly Plus 1',1,1,false,'plus-addon','ShellyPlus1'],['plus1pm','Shelly Plus 1PM',1,1,true,'plus-addon','ShellyPlus1PM'],
    ['plus2pm','Shelly Plus 2PM (Schalterprofil)',2,2,true,'plus-addon','ShellyPlus2PM'],
    ['plusplugs','Shelly Plus Plug S',1,0,true,null,'ShellyPlusPlugS'],
    ['pro1','Shelly Pro 1',1,2,false,null,'ShellyPro1'],['pro1pm','Shelly Pro 1PM',1,2,true,null,'ShellyPro1PM'],
    ['pro2','Shelly Pro 2',2,2,false,null,'ShellyPro2'],['pro2pm','Shelly Pro 2PM (Schalterprofil)',2,2,true,null,'ShellyPro2PM'],
    ['pro3','Shelly Pro 3',3,3,false,null,'ShellyPro3'],['pro4pm','Shelly Pro 4PM',4,4,true,null,'ShellyPro4PM']
  ])add(id,label,'rpc',ports('switch',count,id.includes('plug')?'outlet':'switch'),n,{energy,sensors:energy,addon,bthome:id.startsWith('pro'),source:rpc(2,page)});
  add('plus1mini','Shelly Plus 1 Mini','rpc',ports('switch',1),1,{source:'https://kb.shelly.cloud/knowledge-base/shelly-plus-1-mini'});
  add('plusi4','Shelly Plus i4 / i4 DC','rpc',[],4,{source:rpc(2,'ShellyPlusI4')});
  for(const [id,label,n,page,energy] of [
    ['plus10v','Shelly Plus 0–10V Dimmer',1,'ShellyPlus10V',false],
    ['pluswall','Shelly Plus Wall Dimmer',1,'ShellyPlusWallDimmer',true],
    ['pro-dimmer1pm','Shelly Pro Dimmer 1PM',1,'ShellyProDimmer1PM',true],
    ['pro-dimmer2pm','Shelly Pro Dimmer 2PM',2,'ShellyProDimmer2PM',true],
    ['pro-10v','Shelly Pro Dimmer 0/1–10V PM',1,'ShellyProDimmer0110VPM',true]
  ])add(id,label,'rpc',ports('light',n,'light',{dimmable:true}),id==='pluswall'?0:n*2,{energy,sensors:energy,bthome:id.startsWith('pro'),source:rpc(2,page)});
  add('plus-rgbw','Shelly Plus RGBW PM','rpc',[],4,{energy:true,sensors:true,source:rpc(2,'ShellyPlusRGBWPM'),profiles:[
    {id:'rgbw',label:'RGBW (Farbe + Weiß)',outputs:ports('rgbw',1,'light',{dimmable:true,color:true}),deviceProfile:'rgbw'},
    {id:'rgb',label:'RGB (Farbe)',outputs:ports('rgb',1,'light',{dimmable:true,color:true}),deviceProfile:'rgb'},
    {id:'light',label:'4 × Weißlicht',outputs:ports('light',4,'light',{dimmable:true}),deviceProfile:'light'}]});
  for(const [id,label,count,n,energy,page,addon] of [
    ['g3-1','Shelly 1 Gen3',1,1,false,'Shelly1G3','plus-addon'],['g3-1pm','Shelly 1PM Gen3',1,1,true,'Shelly1PMG3','plus-addon'],
    ['g3-2pm','Shelly 2PM Gen3 (Schalterprofil)',2,2,true,'Shelly2PMG3','plus-addon'],
    ['g3-1mini','Shelly 1 Mini Gen3',1,1,false,'ShellyMini1G3',null],['g3-1pmmini','Shelly 1PM Mini Gen3',1,1,true,'ShellyMini1PMG3',null],
    ['g3-plugs','Shelly Plug S Gen3',1,0,true,'ShellyPlugSG3',null]
  ])add(id,label,'rpc',ports('switch',count,id.includes('plug')?'outlet':'switch'),n,{energy,sensors:energy,addon,bthome:true,source:rpc(3,page)});
  add('g3-i4','Shelly i4 / i4 DC Gen3','rpc',[],4,{bthome:true,source:rpc(3,'ShellyI4G3')});
  add('g3-10v','Shelly Dimmer 0/1–10V PM Gen3','rpc',ports('light',1,'light',{dimmable:true}),2,{energy:true,sensors:true,bthome:true,source:rpc(3,'ShellyDimmer0110VPMG3')});
  add('g3-dimmer','Shelly Dimmer Gen3','rpc',ports('light',1,'light',{dimmable:true}),2,{energy:true,sensors:true,bthome:true,source:rpc(3,'ShellyDimmerG3')});
  for(const [id,label,count,page] of [['g4-1','Shelly 1 Gen4',1,'Shelly1G4'],['g4-1pm','Shelly 1PM Gen4',1,'Shelly1PMG4'],['g4-2pm','Shelly 2PM Gen4 (Schalterprofil)',2,'Shelly2PMG4']])add(id,label,'rpc',ports('switch',count),count,{energy:id!=='g4-1',sensors:id!=='g4-1',bthome:true,addon:'plus-addon',source:rpc(4,page)});
  add('plus-pmmini','Shelly Plus PM Mini','rpc',[],0,{energy:true,meter:true,sensors:true,source:rpc(2,'ShellyPlusPMMini')});
  add('g3-pmmini','Shelly PM Mini Gen3','rpc',[],0,{energy:true,meter:true,sensors:true,bthome:true,source:rpc(3,'ShellyMiniPMG3')});
  add('pro-em','Shelly Pro EM / Pro EM-50','rpc',ports('switch',1),0,{energy:true,meter:true,bthome:true,source:rpc(2,'ShellyProEM')});
  add('pro-3em','Shelly Pro 3EM','rpc',[],0,{energy:true,meter:true,bthome:true,source:rpc(2,'ShellyPro3EM')});
  add('pro-3em400','Shelly Pro 3EM-400','rpc',[],0,{energy:true,meter:true,bthome:true,source:rpc(2,'ShellyPro3EM')});
  add('g3-em','Shelly EM Gen3','rpc',ports('switch',1),0,{energy:true,meter:true,bthome:true,source:rpc(3,'ShellyEMG3')});
  for(const [id,label,inputsCount] of [['wall','Shelly Wall Display (4 Zoll)',1],['wall-x2','Shelly Wall Display X2 (6,9 Zoll)',1],['wall-xl','Shelly Wall Display XL (10,1 Zoll)',5]])add(id,label,'rpc',ports('switch',1),inputsCount,{sensors:true,source:'https://kb.shelly.cloud/knowledge-base/shelly-'+({wall:'wall-display','wall-x2':'wall-display-x2','wall-xl':'wall-display-xl'})[id],note:'Lokale Relais, Eingänge, optionale Sensoren und optionaler Thermostat nach Firmware. Keine Bildschirmsteuerung.'});
  add('cloud-sensor','Cloud-Sensor (Temperatur, Feuchte, Bewegung, Kontakt)','auto',[],0,{cloudOnly:true,sensors:true,source:'https://shelly-api-docs.shelly.cloud/cloud-control-api/communication-v2/'});
  for(const m of models)m.virtual=m.generation==='rpc'&&/^(pro|g3-|g4-|wall)/.test(m.id);
  const get=id=>models.find(m=>m.id===id);
  for(const id of ['plusi4','plus10v','plus-rgbw','g3-10v','g3-i4'])get(id).addon='plus-addon';
  for(const id of ['g4-1','g4-1pm','g4-2pm'])get(id).addon=null;
  for(const id of ['pro1','pro1pm','pro2','pro2pm','pro-em','pro-3em','pro-3em400','pro-dimmer1pm','pro-dimmer2pm','pro-10v'])get(id).addon='pro-sensor';
  // EM models are available again; live power readings also appear in the plugin UI.
  const selectable=(current,connection)=>models.filter(m=>(!m.hidden||m.id===current)&&(!m.cloudOnly||connection==='cloud'||m.id===current));
  function profile(d){const m=get(d.modelId);return m?.profiles?.find(p=>p.id===(d.profileId||m.profiles[0].id));}
  function outputTemplates(d){const m=get(d.modelId);return profile(d)?.outputs || m?.outputs || [];}
  function inputTemplates(d){
    const m=get(d.modelId),a=d.addons?.[0],result=[...m?.inputs||[]];if(!a||!m?.addon)return result;
    if(m.addon==='gen1-sensor')return [...result,{component:'extinput:0',mode:'state',addon:true}];
    for(const id of [a.inputId??100,...(m.addon==='pro-sensor'?[a.inputId2??101]:[])])result.push({component:'input:'+id,mode:'state',addon:true});
    for(const suffix of ['',...(m.addon==='pro-sensor'?['2']:[])]){const type=a['analogType'+suffix]??'none';if(['percent','voltage'].includes(type))result.push({component:(type==='voltage'?'voltmeter:':'input:')+(a['analogId'+suffix]??(m.addon==='pro-sensor'?102:101)+(suffix?1:0)),mode:'analog',addon:true,analog:true,unit:type==='voltage'?'V':'%'});}
    return result;
  }
  function sync(d,reset=false,language='de'){
    const m=get(d.modelId);if(!m)return;
    const channels=reset?[]:d.channels||[],ins=reset?[]:d.inputs||[];
    d.generation=m.generation;
    d.channels=outputTemplates(d).map((c,i)=>({component:c.component,name:({de:'Kanal ',en:'Channel ',fr:'Canal ',es:'Canal '}[language]||'Kanal ')+(i+1),type:c.type,enabled:true,...channels.find(x=>x.component===c.component)}));
    d.inputs=inputTemplates(d).map((c,i)=>{
      const previous=ins.find(x=>x.component===c.component)||{},labels=c.analog?{de:'Add-on Analogeingang',en:'Add-on analog input',fr:'Entrée analogique du module',es:'Entrada analógica del módulo'}:{de:'Add-on Eingang',en:'Add-on input',fr:'Entrée du module',es:'Entrada del módulo'};
      const input={component:c.component,name:c.addon?(labels[language]||labels.de):({de:'Eingang ',en:'Input ',fr:'Entrée ',es:'Entrada '}[language]||'Eingang ')+(i+1),mode:c.mode,enabled:false,...previous,...(c.analog?{mode:'analog',unit:c.unit}:previous.mode==='analog'?{mode:'state'}:{})};
      if(input.mode!=='state')delete input.invert;if(!c.analog)delete input.unit;return input;
    });
  }
  function select(d,id,language='de'){const m=get(id);if(!m)return;d.modelId=id;delete d.thermostat;delete d.wallIlluminance;delete d.wallTemperature;delete d.wallHumidity;delete d.wallMotion;delete d.profileId;d.addons=[];d.bthome=[];d.virtualComponents=[];d.cloudSensors=m.cloudOnly===true;d.nativeSensors=false;d.energy=m.energy;sync(d,true,language);}
  const categories=[{id:'relays',label:'Relais und Schalter'},{id:'plugs',label:'Steckdosen'},{id:'lights',label:'Licht und Dimmer'},{id:'inputs',label:'Eingänge und Taster'},{id:'meters',label:'Energiezähler'},{id:'pro',label:'Pro'},{id:'displays',label:'Displays'},{id:'sensors',label:'Sensoren (Cloud)'}];
  function functionCategory(m){if(m.cloudOnly)return 'sensors';if(m.meter)return 'meters';if(/^wall(?:-|$)/.test(m.id))return 'displays';const outputs=[...m.outputs,...(m.profiles||[]).flatMap(p=>p.outputs||[])];if(outputs.some(c=>c.type==='outlet'))return 'plugs';if(outputs.some(c=>c.type==='light'))return 'lights';if(!outputs.length&&m.inputs.length)return 'inputs';return 'relays';}
  function category(m){return m.id.startsWith('pro')?'pro':functionCategory(m);}
  function grouped(current,connection){const list=selectable(current,connection),sort=items=>[...items].sort((a,b)=>a.label.localeCompare(b.label,'de',{numeric:true,sensitivity:'base'}));
    return categories.map(c=>{const items=list.filter(m=>category(m)===c.id);if(c.id!=='pro')return {...c,models:sort(items)};return {...c,groups:['relays','lights','meters'].map(id=>({...categories.find(c=>c.id===id),models:sort(items.filter(m=>functionCategory(m)===id))})).filter(g=>g.models.length)};}).filter(g=>g.models?.length||g.groups?.length);
  }
  return {models,selectable,grouped,category,categories,get,profile,outputTemplates,inputTemplates,sync,select};
});
