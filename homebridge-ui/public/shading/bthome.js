"use strict";
// BTHome mappings belong to the existing physical Shelly, including a cover host.
window.ShadingBthome={
 editor(parent,device,definition,language,changed){
  const I=window.ShellyDeviceI18n;if(!I||!definition)return;
  const notes={'BTHome-Tastenereignisse an Beschattungen werden noch nicht unterstützt.':['BTHome button events on shading devices are not supported yet.','Les événements de boutons BTHome sur les protections solaires ne sont pas encore pris en charge.','Los eventos de botones BTHome en las protecciones solares aún no son compatibles.'],'BTHome-Sensoren an Beschattungen benötigen eine lokale Verbindung.':['BTHome sensors on shading devices require a local connection.','Les capteurs BTHome sur les protections solaires nécessitent une connexion locale.','Los sensores BTHome en las protecciones solares requieren una conexión local.']};const t=text=>notes[text]&&language!=='de'?notes[text][['en','fr','es'].indexOf(language)]||text:I.translate(text,language),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const section=el('section',undefined,'shade-bthome-editor');parent.append(section);
  const button=(text,fn)=>{const n=el('button',t(text));n.type='button';n.addEventListener('click',fn);return n;};
  const validate=()=>{for(const input of section.querySelectorAll('[data-key]')){const key=input.dataset.key,value=input.value,duplicate=(device.bthome||[]).filter(b=>b[key]===value).length>1;input.setCustomValidity(duplicate?t(key==='id'?'BTHome-ID doppelt.':'Komponente/ID doppelt.'):'');}for(const card of section.querySelectorAll('.bthome-settings')){const sensor=card.bthomeMapping,input=card.querySelector('input');if(device.connection==='cloud')input?.setCustomValidity(t('BTHome-Sensoren an Beschattungen benötigen eine lokale Verbindung.'));else if(sensor.buttonIndices?.length)input?.setCustomValidity(t('BTHome-Tastenereignisse an Beschattungen werden noch nicht unterstützt.'));}};
  const draw=()=>{section.replaceChildren(el('h3',t('Erweiterungen')));if(device.connection==='cloud')section.append(el('p',t('BTHome-Sensoren an Beschattungen benötigen eine lokale Verbindung.'),'hint'));
   for(const [index,b]of(device.bthome||[]).entries()){
    const card=el('details',undefined,'bthome-settings nested');card.open=true;card.bthomeMapping=b;card.append(el('summary',b.name||'BLU / BTHome'));const fields=el('div',undefined,'fields');card.append(fields);
    if(b.buttonIndices?.length||b.sensorType==='blu-button')card.append(el('p',t('BTHome-Tastenereignisse an Beschattungen werden noch nicht unterstützt.'),'hint'));
    const props={...definition.items.properties,sensorType:{...definition.items.properties.sensorType,title:'BTHome-Gerätetyp',type:'string',enum:['blu-ht','blu-motion','blu-doorwindow',...(b.sensorType==='blu-button'?['blu-button']:[]),'ws90','bthome'],enumNames:['Shelly BLU H&T','Shelly BLU Motion','Shelly BLU Door/Window',...(b.sensorType==='blu-button'?['Shelly BLU Button / Remote']:[]),'Ecowitt WS90 Powered by Shelly','Weitere BTHome-Sensoren'],default:'bthome'}};
    // Put the type first, then keep the stable IDs, display name and component mapping together.
    for(const key of ['sensorType',...Object.keys(props).filter(k=>k!=='sensorType')]){
     const d=props[key];if(key==='buttonIndices'&&!b.buttonIndices?.length)continue;
     const wrap=el('label',undefined,'field');wrap.append(el('span',t(d.title||key)+(definition.items.required?.includes(key)?' *':'')));
     if(key==='buttonIndices'){
      const list=el('div',undefined,'bthome-buttons');for(const [i,value]of(b.buttonIndices||[]).entries()){const row=el('div',undefined,'bthome-button-row'),input=el('input');input.type='number';input.min=0;input.max=3;input.step=1;input.required=true;input.value=value;input.setAttribute('aria-label',t(d.title));input.addEventListener('input',()=>{b.buttonIndices[i]=input.value===''?null:Number(input.value);changed();});row.append(input,button('Entfernen',()=>{b.buttonIndices.splice(i,1);draw();changed();}));list.append(row);}wrap.append(list);fields.append(wrap);continue;
     }
     const input=el(d.enum?'select':'input');if(d.enum){for(const [i,value]of d.enum.entries()){const option=el('option',t(d.enumNames?.[i]||value));option.value=value;input.append(option);}}else input.type=['integer','number'].includes(d.type)?'number':'text';
     input.value=b[key]??(key==='staleAfter'&&b.sensorType==='ws90'?120:d.default)??'';input.required=definition.items.required?.includes(key)||false;if(d.pattern)input.pattern=d.pattern;if(d.minLength)input.minLength=d.minLength;if(d.minimum!==undefined)input.min=d.minimum;if(d.maximum!==undefined)input.max=d.maximum;if(input.type==='number')input.step=d.type==='integer'?1:'any';input.setAttribute('aria-label',t(d.title||key));if(['id','deviceComponent'].includes(key))input.dataset.key=key;
     input.addEventListener(d.enum?'change':'input',()=>{const value=input.type==='number'?(input.value===''?undefined:Number(input.value)):input.value;if(value===undefined)delete b[key];else b[key]=value;if(key==='name')card.querySelector('summary').textContent=b.name||'BLU / BTHome';if(key==='sensorType'){if(value==='ws90'&&(b.staleAfter===undefined||b.staleAfter===86400))b.staleAfter=120;draw();}validate();changed();});wrap.append(input);if(d.description)wrap.append(el('p',t(d.description),'hint'));fields.append(wrap);
    }
    if(b.sensorType==='ws90')for(const text of ['Die Wetterstation muss auf diesem Shelly als BTHome-Gerät eingerichtet sein. Wind und Böen werden in km/h angezeigt.','Die WS90 sendet etwa alle 9 Sekunden. Standardmäßig gelten Messwerte nach 120 Sekunden als veraltet.'])card.append(el('p',t(text),'hint'));
    card.append(button('Entfernen',()=>{device.bthome.splice(index,1);draw();changed();}));section.append(card);
   }
   validate();if(device.connection!=='cloud')section.append(button('BLU / BTHome hinzufügen',()=>{device.bthome??=[];const used=new Set(device.bthome.map(b=>b.deviceComponent));let id=200;while(used.has('bthomedevice:'+id)&&id<=299)id++;if(id>299)return;device.bthome.push({id:'bthome-'+(crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')),name:'',sensorType:'blu-ht',deviceComponent:'bthomedevice:'+id,staleAfter:86400});draw();changed();}));
  };draw();
 },
 status(parent,device,envelope,language,now=Date.now()){
  const O=window.ShellyOverview,I=window.ShellyDeviceI18n;if(!O||!I||!device?.bthome?.length)return;
  const t=text=>I.translate(text,language),nf=new Intl.NumberFormat(I.locale(language),{maximumFractionDigits:3}),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;},section=el('section',undefined,'shade-bthome-status');section.append(el('h3','BLU / BTHome'));
  const online=envelope.bthomeOnline===true&&Number.isFinite(envelope.bthomeCheckedAt)&&envelope.bthomeCheckedAt<=now+5000&&now-envelope.bthomeCheckedAt<=(Number.isFinite(envelope.bthomeMaxAge)?envelope.bthomeMaxAge:30000);
  let group;for(const r of O.rows({bthome:device.bthome},{bthome:envelope.bthome},online)){
   if(group!==r.sensorId){group=r.sensorId;const heading=el('div',undefined,'bthome-group-heading');heading.append(el('strong',(r.sensorName||r.sensorId)+' · ID: '+r.sensorId),el('span',r.deviceComponent));section.append(heading);}
   const signal=O.signal(r,online),weather=O.weather[O.weatherMetric(r)],generated=!r.name||r.name===r.component,line=el('div',undefined,'channel-line'),dot=el('span',undefined,'channel-lamp');line.dataset.component=r.component;dot.dataset.state=signal.state;dot.setAttribute('role','img');dot.setAttribute('aria-label',t(signal.label));dot.title=t(signal.label);
   const identity=el('div',undefined,'channel-identity');identity.append(el('strong',weather&&generated?t(weather[0])+' · '+r.component:r.type==='unavailable'&&r.name==='Keine aktuellen Sensordaten'?t('Keine aktuellen Sensordaten')+' · '+r.component:O.title(r)),el('span',t('BTHome-Sensor'),'channel-state'));const values=el('div',undefined,'channel-metrics'),v=online&&!r.fault?r.values||{}:{},metric=(value,label,unit='')=>{const box=el('span',undefined,'channel-metric');box.append(el('strong',(typeof value==='number'?nf.format(value):t(value))+(unit?' '+unit:''),'metric-value'),el('span',t(label),'metric-label'));values.append(box);};
   if(r.fault||r.type==='button')metric(r.fault?'Unbekannt':'Ereignissensor',weather?weather[0]:'Status');
   if([0,1].includes(v.ContactSensorState)||typeof v.MotionDetected==='boolean')metric(signal.label,'Zustand');if(typeof v.RainDetected==='boolean')metric(signal.label,'Regenstatus');
   for(const [key,[label,unit]]of Object.entries(O.weather))if(key!=='RainDetected'&&Number.isFinite(v[key]))metric(v[key],label,unit);
   for(const [key,label,unit]of [['CurrentTemperature','Temperatur','°C'],['CurrentRelativeHumidity','Luftfeuchte','%'],['CurrentAmbientLightLevel','Helligkeit','lux'],['BatteryLevel','Batterie','%']])if(Number.isFinite(v[key]))metric(v[key],label,unit);
   line.append(dot,identity,values);section.append(line);
  }parent.append(section);
 }
};
