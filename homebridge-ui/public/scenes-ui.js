'use strict';
window.ZepraSceneUi={mount({config,request,changed}){
 const I=window.ZepraI18n,t=(text,params={})=>I.translate(text,config.language,params,'scenes'),number=value=>new Intl.NumberFormat(I.locale(config.language)).format(value),date=value=>new Date(value).toLocaleString(I.locale(config.language),{timeZone:config.shading?.timeZone||'Europe/Berlin'});
 const M=window.ZepraScenes,root=document.getElementById('scene-list'),error=document.getElementById('scene-error'),folds=new WeakMap(),summaries=new Map();let data={devices:[],states:{}},opened,liveGood=true,refreshing=false,lastError='';const live=new Map(),calculations=new Map();
 config.scenes??=[];
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const ref=s=>s?Object.fromEntries(['area','deviceId','sensorId','component','metric'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]])):undefined;
 const targetKey=a=>JSON.stringify([a?.area,a?.deviceId,a?.component||'',a?.property]);
 function notify(){for(const fn of calculations.values())fn();for(const [node,fn]of summaries)node.textContent=fn();let valid=true;try{M.validate(config.scenes,config);lastError='';error.textContent='';}catch(e){valid=false;lastError=e.message;error.textContent=t(lastError);}changed(valid);}
 function field(parent,label,node,help){label=t(label);if(help)help=t(help);node.setAttribute('aria-label',label);const wrap=el('label');wrap.append(el('span',label),node);if(help)wrap.append(el('small',help));parent.append(wrap);return node;}
 function select(value,items,handler){const n=el('select');for(const [v,label,verbatim]of items){const o=el('option',verbatim?label:t(label));o.value=String(v);n.append(o);}n.value=String(value??'');n.addEventListener('change',()=>handler(n.value));return n;}
 function input(value,type,handler){const n=el('input');n.type=type;n.value=value??'';if(type==='number')n.step='any';n.addEventListener('input',()=>handler(type==='number'?(n.value===''?undefined:Number(n.value)):n.value));return n;}
 function button(text,handler){const n=el('button',t(text));n.type='button';n.addEventListener('click',handler);return n;}
 function weekdays(parent,object){object.days??=[0,1,2,3,4,5,6];const group=el('div',undefined,'scene-days');[1,2,3,4,5,6,0].forEach(day=>{const name=t(['So','Mo','Di','Mi','Do','Fr','Sa'][day]);const label=el('label'),box=el('input');box.type='checkbox';box.checked=object.days.includes(day);box.addEventListener('change',()=>{object.days=box.checked?[...new Set([...object.days,day])]:object.days.filter(d=>d!==day);notify();});label.append(box,el('span',name));group.append(label);});parent.append(group);}
 function valueField(parent,value,metric,handler){if(M.boolean.has(metric))return field(parent,'Gewünschter Wert',select(value===true?'true':'false',[['true',metric==='MotionDetected'?'Bewegung':'Ein / Aktiv'],['false',metric==='MotionDetected'?'Keine Bewegung':'Aus / Inaktiv']],v=>handler(v==='true')));if(metric==='ContactSensorState')return field(parent,'Kontaktzustand',select(value??1,[[0,'Geschlossen'],[1,'Offen']],v=>handler(Number(v))));return field(parent,'Wert',input(value,'number',handler));}
 function folded(object,cls,title,initial=true){const box=el('details',undefined,cls);box.open=folds.has(object)?folds.get(object):initial;const summary=el('summary',title);box.append(summary);box.addEventListener('toggle',()=>folds.set(object,box.open));return box;}
 function sourceObservation(source,now){
  if(!liveGood||source?.area!=='devices')return null;const device=config.devices?.find(d=>d.id===source.deviceId);if(!device)return null;
  const expected=JSON.stringify([device.id,device.connection==='cloud'?'cloud:'+device.cloudServer:device.host,String((device.connection==='cloud'?device.cloudDeviceId:device.shellyDeviceId)||'').toLowerCase().replace(/:/g,'').slice(-12)]),row=data.devices?.find(r=>r.target===expected),maxAge=Number.isFinite(data.devicesMaxAge)?data.devicesMaxAge:30000;
  if(!row?.online||!Number.isFinite(row.checkedAt)||now-row.checkedAt>maxAge||row.checkedAt>now+5000)return null;
  const readings=source.sensorId?row.bthome?.find(b=>b.id===source.sensorId&&!b.fault)?.readings:row.readings,reading=readings?.find(r=>r.component===source.component&&!r.fault&&Number.isFinite(r.values?.[source.metric]));return reading?{value:reading.values[source.metric],observedAt:row.checkedAt}:null;
 }
 function conditionText(c){
  if(c.kind==='group')return t(c.children.length===1?'{operator} · {count} Bedingung':'{operator} · {count} Bedingungen',{operator:t(c.operator==='or'?'ODER':'UND'),count:number(c.children.length)});
  if(c.kind==='time')return t('Zeit · {time}',{time:c.time||t('Uhrzeit wählen')});
  if(c.kind==='dewpoint')return t('Taupunkt')+' · '+(c.temperatureSource?.deviceId||t('Temperaturquelle'))+' + '+(c.humiditySource?.deviceId||t('Luftfeuchtequelle'))+' '+({eq:'=',ne:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤'})[c.operator]+' '+number(c.value)+' °C'+(c.holdSeconds?t(' · {seconds} s',{seconds:number(c.holdSeconds)}):'');
  const value=typeof c.value==='boolean'?t(c.value?'aktiv':'inaktiv'):c.source?.metric==='ContactSensorState'?t(c.value===0?'geschlossen':'offen'):number(c.value);
  return (c.source?.deviceId||c.sourceDevice?.deviceId||t('Shelly wählen'))+' · '+t(M.labels[c.source?.metric]||'Zustand / Wert wählen')+(c.source?' '+({eq:'=',ne:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤'})[c.operator]+' '+value:'')+(c.holdSeconds?t(' · {seconds} s',{seconds:number(c.holdSeconds)}):'');
 }
 // Protocol property IDs are internal identifiers; translate their display names and values only.
 function protocolText(message){
  const match=/^([\s\S]+) · (On|Brightness|position|slatPosition|auto|pause|wind): ([\s\S]+)$/.exec(message);
  if(!match)return t(message);
  const params={target:match[1],property:t(M.properties[match[2]])},body=match[3];
  if(body.startsWith('Rücksetzung ausgelassen – '))return t('{target} · {property}: Rücksetzung ausgelassen – {reason}',{...params,reason:body.slice('Rücksetzung ausgelassen – '.length)});
  const command=/^Befehl für vorherigen Wert (.+) wird übergeben$/.exec(body);
  if(command){const raw=command[1],value=raw==='true'?t('Ein'):raw==='false'?t('Aus'):Number.isFinite(Number(raw))?number(Number(raw)):raw;return t('{target} · {property}: Befehl für vorherigen Wert {value} wird übergeben',{...params,value});}
  if(body==='Befehl übergeben; Endzustand noch nicht bestätigt')return t('{target} · {property}: Befehl übergeben; Endzustand noch nicht bestätigt',params);
  if(body==='vorherige Position durch Rückmeldung bestätigt')return t('{target} · {property}: vorherige Position durch Rückmeldung bestätigt',params);
  return t(message);
 }
 function localizedLabel(item,labels,property){
  let label=item.label;
  if(item.area==='devices'&&!item.sensorId){
   const device=(config.devices||[]).find(d=>d.id===item.deviceId);
   for(const [key,source,prefixes]of [['channels','Kanal {number}',['Kanal','Channel','Canal']],['inputs','Eingang {number}',['Eingang','Input','Entrée','Entrada']]]){
    const index=device?.[key]?.findIndex(c=>c.component===item.component)??-1,channel=device?.[key]?.[index];if(!channel)continue;
    const ordinal=index+1,generated=prefixes.some(prefix=>channel.name===prefix+' '+ordinal),addon=key==='inputs'&&(/^(?:input:(?:[1-9]\d{2,})|extinput:\d+)$/.test(channel.component))&&['Add-on Eingang','Add-on input','Entrée du module','Entrada del módulo'].includes(channel.name);
    if(!generated&&!addon)continue;
    const prefix=device.name+' ['+device.id+'] / ',segment=prefix+channel.name;
    if(label.startsWith(segment+' · '))label=prefix+(addon?t('Add-on Eingang'):t(source,{number:number(ordinal)}))+label.slice(segment.length);
   }
  }
  const suffix=labels[item[property]],unit=item.unit?' ('+item.unit+')':'';return suffix&&label.endsWith(' · '+suffix+unit)?label.slice(0,-suffix.length-unit.length)+t(suffix)+unit:label;
 }
 function leafFields(c,scene,sources){const fields=el('div',undefined,'scene-fields');
    const deviceKey=d=>JSON.stringify([d.area,d.deviceId]);
    if(!c.sourceDevice&&c.source)c.sourceDevice={area:c.source.area,deviceId:c.source.deviceId};
    const devices=[...(config.devices||[]).map(d=>({area:'devices',deviceId:d.id,name:d.name,label:(d.name||d.id)+' ['+d.id+']'})),...(config.shading.devices||[]).map(d=>({area:'shading',deviceId:d.id,name:d.name,label:(d.name||d.id)+' ['+d.id+'] · '+t('Beschattung')}))];
    if(!['time','dewpoint'].includes(c.kind)){
     const chosen=c.sourceDevice?deviceKey(c.sourceDevice):'',items=[['','Bitte Shelly auswählen'],...devices.map(d=>[deviceKey(d),d.label,true])];if(chosen&&!devices.some(d=>deviceKey(d)===chosen))items.push([chosen,'Gespeichertes Shelly – nicht mehr vorhanden']);
     field(fields,'Quelle – Shelly',select(chosen,items,v=>{const d=devices.find(d=>deviceKey(d)===v);c.sourceDevice=d?{area:d.area,deviceId:d.deviceId}:undefined;delete c.source;c.operator='eq';c.value=c.kind==='status'?true:0;opened=scene.id;render();notify();}));
    }
    field(fields,'Bedingungsart',select(c.kind,[['status','Status'],['time','Zeit'],['value','Wert'],['dewpoint','Taupunkt']],v=>{c.kind=v;delete c.source;delete c.temperatureSource;delete c.humiditySource;if(!['value','dewpoint'].includes(v))delete c.hysteresis;if(v==='time'){delete c.holdSeconds;c.time??='08:00';c.days??=[0,1,2,3,4,5,6];}else{c.value=v==='status'?true:0;c.operator='eq';}opened=scene.id;render();notify();}));
    if(c.kind==='time'){field(fields,'Uhrzeit',input(c.time||'08:00','time',v=>{c.time=v;notify();}));const days=el('div',undefined,'scene-wide');days.append(el('span',t('Wochentage')));weekdays(days,c);fields.append(days);}
    else{
     if(c.kind==='dewpoint'){
      for(const [key,label,metric]of [['temperatureSource','Temperaturquelle','CurrentTemperature'],['humiditySource','Luftfeuchtequelle','CurrentRelativeHumidity']]){
       const options=sources.filter(s=>s.area==='devices'&&s.metric===metric),current=c[key]?M.key(c[key]):'',items=[['','Bitte Zustand oder Sensorwert auswählen'],...options.map(s=>[s.id,s.label,true])];if(current&&!options.some(s=>s.id===current))items.push([current,'Gespeicherter Zustand / Wert – aktuell keine Daten']);
       const sourceField=field(fields,label,select(current,items,value=>{c[key]=ref(options.find(s=>s.id===value));notify();}));if(key==='temperatureSource')sourceField.parentElement.classList.add('scene-dewpoint-temperature');
      }
      const preview=el('p',undefined,'scene-help scene-wide scene-dewpoint-value'),update=()=>{const sample=M.observation(c,sourceObservation,Date.now());preview.textContent=sample?t('Berechneter Taupunkt: {value} °C',{value:number(sample.value)}):t('Keine aktuellen Taupunktdaten verfügbar.');};calculations.set(c,update);update();fields.append(preview,el('p',t('Taupunkt über Wasser nach Magnus. Temperatur und Luftfeuchte müssen dieselbe Luft beschreiben. Bereich: −45 bis 60 °C und über 0 bis 100 % relative Feuchte. Fehlende, fehlerhafte oder veraltete Werte lösen nichts aus.'),'scene-help scene-wide'));
     }else{
      const options=sources.filter(s=>c.sourceDevice&&s.area===c.sourceDevice.area&&s.deviceId===c.sourceDevice.deviceId&&(c.kind==='status'?s.type==='boolean'||s.metric==='ContactSensorState':s.type==='number'&&s.metric!=='ContactSensorState'));
      const current=c.source?M.key(c.source):'',device=devices.find(d=>c.sourceDevice&&deviceKey(d)===deviceKey(c.sourceDevice));
      const short=s=>{const prefix=(device?.name||s.deviceId)+' ['+s.deviceId+']';return s.label.startsWith(prefix)?s.label.slice(prefix.length).replace(/^( \/ | · )/,''):s.label;};
      const items=[['',c.sourceDevice?'Bitte Zustand oder Sensorwert auswählen':'Zuerst Shelly auswählen'],...options.map(s=>[s.id,short(s),true])];if(current&&!options.some(s=>s.id===current))items.push([current,'Gespeicherter Zustand / Wert – aktuell keine Daten']);
      const metric=select(current,items,value=>{const source=options.find(s=>s.id===value);c.source=ref(source);c.value=source?.type==='boolean'?true:source?.metric==='ContactSensorState'?1:0;c.operator='eq';opened=scene.id;render();notify();});metric.disabled=!c.sourceDevice;
      field(fields,c.kind==='status'?'Zustand / Sensor':'Messwert / Sensor',metric,'Hier erscheinen nur Zustände und Sensoren des gewählten Shellys. BTHome-IDs bleiben zur Zuordnung sichtbar.');
     }
     if(c.source||c.kind==='dewpoint'){field(fields,'Vergleich',select(c.operator||'eq',c.kind==='status'?[['eq','ist gleich'],['ne','ist ungleich']]:[['gt','größer als'],['gte','größer oder gleich'],['lt','kleiner als'],['lte','kleiner oder gleich'],['eq','ist gleich'],['ne','ist ungleich']],value=>{c.operator=value;notify();}));
     if(c.kind==='dewpoint')field(fields,'Taupunktgrenze (°C)',input(c.value,'number',value=>{c.value=value;notify();}));else valueField(fields,c.value,c.source?.metric,value=>{c.value=value;notify();});
     const duration=input(c.holdSeconds??0,'number',value=>{c.holdSeconds=value;notify();});duration.min=0;duration.max=86400;duration.step=1;field(fields,'Bedingung muss erfüllt sein (Sekunden)',duration,'0 = ohne zusätzliche Bestätigungsdauer. Unterbrechungen oder fehlende Daten setzen die Dauer zurück. Nach Ablauf ist eine aktuelle Bestätigung nötig; das Statusintervall kann die Auslösung verzögern.');
     if(['value','dewpoint'].includes(c.kind))field(fields,'Hysterese',input(c.hysteresis??0,'number',value=>{c.hysteresis=value;notify();}),'Abstand zur Rücksetzgrenze, in derselben Einheit wie der Messwert. Verhindert häufiges Umschalten nahe der Schwelle.');}
    }
 return fields;}

 function tree(c,scene,sources,depth=0,startTree=false){
  const box=folded(c,'scene-condition-node',conditionText(c),depth===0||!c.source),title=box.querySelector('summary');summaries.set(title,()=>conditionText(c));
  if(c.kind==='group'){
   const controls=el('div',undefined,'scene-fields');field(controls,'Verknüpfung',select(c.operator,[['and','UND – alle Bedingungen'],['or','ODER – mindestens eine Bedingung']],v=>{c.operator=v;notify();}));box.append(controls);const children=el('div',undefined,'scene-branches');
   c.children.forEach((child,index)=>{const branch=el('div',undefined,'scene-branch'),tools=el('div',undefined,'scene-actions');branch.append(tree(child,scene,sources,depth+1));
    const up=button('↑',()=>{[c.children[index-1],c.children[index]]=[c.children[index],c.children[index-1]];render();notify();});up.disabled=index===0;up.setAttribute('aria-label',t('Bedingung nach oben'));
    const down=button('↓',()=>{[c.children[index+1],c.children[index]]=[c.children[index],c.children[index+1]];render();notify();});down.disabled=index===c.children.length-1;down.setAttribute('aria-label',t('Bedingung nach unten'));
    tools.append(up,down,button('Bedingung entfernen',()=>{c.children.splice(index,1);render();notify();}));branch.append(tools);children.append(branch);
   });box.append(children);const tools=el('div',undefined,'scene-actions');
   const add=(group)=>{const child=group?{kind:'group',operator:'and',children:[{kind:'status',operator:'eq',value:true}]}:{kind:'status',operator:'eq',value:true};c.children.push(child);folds.set(c,true);render();notify();};
   const addLeaf=button('Bedingung hinzufügen',()=>add(false)),addGroup=button('Gruppe hinzufügen',()=>add(true));addLeaf.disabled=c.children.length>=16||depth>=5;addGroup.disabled=c.children.length>=16||depth>=4;tools.append(addLeaf);if(startTree){const next=button('Weiter zur Aktion',()=>{folds.set(c,false);if(!scene.actions?.length){scene.actions=[{delaySeconds:0}];delete scene.action;}folds.set(scene.actions[0],true);render();notify();root.querySelector('.scene-action-step > summary')?.scrollIntoView({behavior:'smooth',block:'center'});});next.title=t('Startbedingungen einklappen und zu den Aktionsstufen springen');tools.append(next);}tools.append(addGroup);box.append(tools);
  }else{box.append(leafFields(c,scene,sources));if(depth<5)box.append(button('Als UND-/ODER-Gruppe erweitern',()=>{const old={...c};for(const key of Object.keys(c))delete c[key];Object.assign(c,{kind:'group',operator:'and',children:[old]});folds.set(c,true);render();notify();}));}
  return box;
 }
 function render(){
  root.replaceChildren();summaries.clear();live.clear();calculations.clear();const sources=M.sources(config,data).map(s=>({...s,label:localizedLabel(s,M.labels,'metric')})),targets=M.targets(config).map(a=>({...a,label:localizedLabel(a,M.properties,'property')}));document.getElementById('scene-empty').hidden=config.scenes.length>0;
  for(const scene of config.scenes){const details=el('details',undefined,'scene-card');details.open=opened===scene.id;const summary=el('summary'),name=el('strong',scene.name),badge=el('span',t(({off:'Aus',on:'Immer aktiv',schedule:'Zeitplan'})[M.mode(scene)]),'scene-mode');const lamp=el('span',undefined,'scene-indicator');lamp.setAttribute('role','img');const identity=el('span',undefined,'scene-identity');identity.append(lamp,name);summary.append(identity,badge);details.append(summary);details.addEventListener('toggle',()=>{if(details.open)opened=scene.id;});
   const body=el('div',undefined,'scene-body'),meta=el('div',undefined,'scene-fields');field(meta,'Name der Scene',input(scene.name,'text',v=>{scene.name=v;name.textContent=v;notify();}));field(meta,'Betriebsart',select(M.mode(scene),[['off','Aus'],['on','Immer aktiv'],['schedule','Nach Zeitplan']],v=>{scene.mode=v;scene.schedule??={start:'08:00',end:'20:00',days:[0,1,2,3,4,5,6]};opened=scene.id;render();notify();}));body.append(meta);const resetLabel=el('label',undefined,'scene-reset-option'),resetBox=el('input');resetBox.type='checkbox';resetBox.checked=scene.restoreOnReset===true;resetBox.setAttribute('aria-label',t('Bei Rücksetzen der Bedingung vorherigen Zustand wiederherstellen'));resetBox.addEventListener('change',()=>{scene.restoreOnReset=resetBox.checked;notify();});resetLabel.append(resetBox,el('span',t('Bei Rücksetzen der Bedingung vorherigen Zustand wiederherstellen')));body.append(resetLabel,el('p',t('Mit Haken werden vor dem ersten Befehl die Ausgangswerte gespeichert. Sobald der gesamte Startbedingungsbaum wieder falsch ist, werden eigene Änderungen zurückgenommen. Fehlende Daten lösen keine Rücksetzung aus. Zeitbedingungen werden nach ihrer Trefferminute falsch.'),'scene-help'));
   if(M.mode(scene)==='schedule'){const plan=el('section',undefined,'scene-schedule');plan.append(el('h3',t('Aktivierungszeitplan')));const fields=el('div',undefined,'scene-fields');field(fields,'Beginn',input(scene.schedule.start,'time',v=>{scene.schedule.start=v;notify();}));field(fields,'Ende',input(scene.schedule.end,'time',v=>{scene.schedule.end=v;notify();}));plan.append(fields);weekdays(plan,scene.schedule);plan.append(el('small',t('Zeitzone: {timeZone}. Zeitfenster können über Mitternacht gehen. Der Wochentag gehört zum Beginn. Außerhalb des Fensters wird nichts nachgeholt.',{timeZone:config.shading?.timeZone||'Europe/Berlin'})));body.append(plan);}
   let c=scene.condition??={kind:'status',operator:'eq',value:true};if(c.kind!=='group'){c=scene.condition={kind:'group',operator:'and',children:[c]};}
   const start=el('section',undefined,'scene-start');start.append(el('h3',t('Startbedingungen')),tree(c,scene,sources,0,true));start.append(el('p',t('UND: alle Bedingungen. ODER: mindestens eine Bedingung. Bei 0 Sekunden ist der erste Status nach dem Start der Ausgangszustand; eine positive Dauer verlangt eine aktuelle Bestätigung. Zeitbedingungen gelten in der angegebenen Minute, höchstens einmal je Tag und Zeitzweig.'),'scene-help'));body.append(start);
   const fields=el('div',undefined,'scene-fields');
    if(!Array.isArray(scene.actions)){scene.actions=M.actions(scene);delete scene.action;}
    const sequence=el('div',undefined,'scene-sequence scene-wide');
    for(const [index,a]of scene.actions.entries()){
     const stageText=()=>{const target=targets.find(t=>targetKey(t)===targetKey(a));return t('Stufe {step}',{step:number(index+1)})+(a.delaySeconds?t(' · {seconds} s warten',{seconds:number(a.delaySeconds)}):'')+(a.condition?t(' · Bedingungen'):'')+' → '+(target?.label||t('Aktion wählen'))+(a.property?' = '+(typeof a.value==='boolean'?t(a.value?'Ein':'Aus'):number(a.value)+' %'):'');};const step=folded(a,'scene-action-step',stageText()),head=el('div',undefined,'scene-step-head');summaries.set(step.querySelector('summary'),stageText);step.dataset.step=index+1;head.append(el('h3',t('Aktion {step}',{step:number(index+1)})));
     const tools=el('div',undefined,'scene-actions');const up=button('↑',()=>{[scene.actions[index-1],scene.actions[index]]=[scene.actions[index],scene.actions[index-1]];opened=scene.id;render();notify();});up.disabled=index===0;up.setAttribute('aria-label',t('Aktion {step} nach oben',{step:number(index+1)}));
     const down=button('↓',()=>{[scene.actions[index+1],scene.actions[index]]=[scene.actions[index],scene.actions[index+1]];opened=scene.id;render();notify();});down.disabled=index===scene.actions.length-1;down.setAttribute('aria-label',t('Aktion {step} nach unten',{step:number(index+1)}));
     tools.append(up,down,button('Aktion entfernen',()=>{scene.actions.splice(index,1);opened=scene.id;render();notify();}));head.append(tools);step.append(head);const stepFields=el('div',undefined,'scene-fields'),current=targetKey(a),items=[['','Bitte Ziel und Funktion auswählen'],...targets.map(t=>[targetKey(t),t.label,true])];if(a.property&&!targets.some(t=>targetKey(t)===current))items.push([current,'Gespeichertes Ziel – nicht verfügbar']);
     const timing=el('div',undefined,'scene-fields');field(timing,'Wartezeit davor (Sekunden)',input(a.delaySeconds??0,'number',v=>{a.delaySeconds=v;notify();}),'Zuerst diese feste Wartezeit, dann optionale Zwischenbedingungen, dann die Aktion. Bei späteren Stufen beginnt sie nach Annahme des vorherigen Befehls.');
     field(stepFields,'Zielgerät und Funktion',select(a.property?current:'',items,v=>{const t=targets.find(t=>targetKey(t)===v);scene.actions[index]=t?{...a,...Object.fromEntries(['area','deviceId','component','property'].filter(k=>t[k]!==undefined).map(k=>[k,t[k]])),delaySeconds:a.delaySeconds??0,value:['On','auto','pause','wind'].includes(t.property)?true:100}:{...a,area:undefined,deviceId:undefined,component:undefined,property:undefined};opened=scene.id;render();notify();}));
     if(a.property)valueField(stepFields,a.value,['On','auto','pause','wind'].includes(a.property)?'On':a.property,v=>{a.value=v;notify();});step.append(stepFields);
     const gate=el('section',undefined,'scene-gate');
     if(a.condition){gate.append(el('h4',t('Vor dieser Aktion: auf Bedingungen warten')));const limits=el('div',undefined,'scene-fields'),timeout=input(a.conditionTimeoutSeconds??300,'number',v=>{a.conditionTimeoutSeconds=v;notify();});timeout.step=1;timeout.min=1;timeout.max=86400;field(limits,'Maximale Bedingungswartezeit (Sekunden)',timeout,'Ab Beginn dieser Bedingungsstufe. Sensorwerte müssen danach frisch bestätigt werden. Bei Zeitüberschreitung wird die Scene abgebrochen.');gate.append(limits,tree(a.condition,scene,sources),button('Zwischenbedingung entfernen',()=>{delete a.condition;delete a.conditionTimeoutSeconds;render();notify();}));}
     else gate.append(button('Zwischenbedingung hinzufügen',()=>{a.condition={kind:'group',operator:'and',children:[{kind:'status',operator:'eq',value:true}]};a.conditionTimeoutSeconds=300;folds.set(a,true);render();notify();}));
     step.insertBefore(timing,stepFields);step.insertBefore(gate,stepFields);sequence.append(step);
    }
    const add=button('Stufe hinzufügen',()=>{scene.actions.push({delaySeconds:0});opened=scene.id;render();notify();});add.disabled=scene.actions.length>=20;sequence.append(add);fields.append(sequence);
    fields.append(el('p',t('0 % Behang = geschlossen, 100 % = offen. Lamellen: 100 % = waagerecht. Wartezeiten bestätigen keine Endposition; die bestehende Fahrtsperre bleibt zusätzlich wirksam. Beschattungsfahrten beachten Windalarm und Rückfahrtsperren. Eine Scene-Fahrt pausiert die Sonnenautomatik wie eine manuelle Fahrt.'),'scene-wide'));
   body.append(fields);const footer=el('div',undefined,'scene-fields');field(footer,'Mindestabstand zwischen Auslösungen (Sekunden)',input(scene.cooldownSeconds??60,'number',v=>{scene.cooldownSeconds=v;notify();}),'Mindestens 5 Sekunden. Eine dauerhaft erfüllte Bedingung löst nicht wiederholt aus.');const last=el('p',undefined,'scene-last');footer.append(last);body.append(footer);
   const protocol=folded(scene,'scene-protocol',t('Protokoll · letzte 10 Ereignisse'),false),protocolBody=el('div');protocol.append(protocolBody);body.append(protocol);let previousEvents;
   const updateLive=()=>{
    const state=data.states?.[scene.id],fresh=liveGood&&Number.isFinite(state?.conditionCheckedAt)&&Date.now()-state.conditionCheckedAt<=45000&&state.conditionCheckedAt<=Date.now()+5000;
    const active=M.mode(scene)!=='off'&&fresh&&state.conditionState==='true';lamp.classList.toggle('active',active);const label=active?'Startbedingungen erfüllt':!fresh?'Noch keine aktuelle Prüfung':state.conditionState==='inactive'?'Scene ausgeschaltet oder außerhalb des Zeitplans':state.conditionState==='unknown'?'Startbedingungen derzeit nicht verlässlich prüfbar':'Startbedingungen nicht erfüllt';lamp.title=t(label);lamp.setAttribute('aria-label',t(label));
    last.textContent=state?.lastRun?t('Letzte Auslösung: {time}',{time:date(state.lastRun)})+' · '+t(state.status)+(state.total?t(' · Schritt {step}/{total}',{step:number(state.step),total:number(state.total)}):''):t('Noch keine Auslösung');
    const events=(state?.events||[]).slice(-10).reverse(),signature=JSON.stringify(events);if(signature!==previousEvents){previousEvents=signature;protocolBody.replaceChildren();if(!events.length)protocolBody.append(el('p',t('Noch keine protokollierten Ereignisse.')));else{const list=el('ol');for(const event of events){const row=el('li'),time=el('time',date(event.timestamp));row.append(time,el('span',protocolText(event.message)));list.append(row);}protocolBody.append(list);}}
   };live.set(scene.id,updateLive);updateLive();
   const actions=el('div',undefined,'scene-actions');actions.append(button('Scene entfernen',()=>{config.scenes=config.scenes.filter(s=>s.id!==scene.id);render();notify();}));body.append(actions);details.append(body);root.append(details);
  }
 }
 document.getElementById('scene-add').addEventListener('click',()=>{const id='scene-'+(window.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10));config.scenes.push({id,name:t('Neue Scene'),mode:'off',condition:{kind:'group',operator:'and',children:[{kind:'status',operator:'eq',value:true}]},cooldownSeconds:60});opened=id;render();notify();});
 async function refresh(rebuild=true){if(refreshing)return;refreshing=true;try{data=await request('/scene-data');liveGood=true;if(rebuild)render();else{for(const fn of live.values())fn();for(const fn of calculations.values())fn();}}catch{liveGood=false;for(const fn of live.values())fn();for(const fn of calculations.values())fn();if(rebuild){lastError='Scene-Status konnte nicht geladen werden. Konfiguration bleibt erhalten.';error.textContent=t(lastError);}}finally{refreshing=false;}}
 setInterval(()=>{if(!document.hidden&&!document.getElementById('scenes-panel').hidden)refresh(false);},5000);
 document.getElementById('scene-refresh').addEventListener('click',()=>refresh());render();return {refresh,relabel(){render();error.textContent=t(lastError);},validate(){try{M.validate(config.scenes,config);return true;}catch{return false;}}};
}};
