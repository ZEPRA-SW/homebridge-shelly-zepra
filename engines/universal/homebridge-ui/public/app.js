'use strict';
(() => {
  const $=id=>document.getElementById(id),M=window.ShellyModels;
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const newId=()=> 'shelly-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
  let blocks=[],cfg,schema,serial=0,revision=0,tail=Promise.resolve(),dragged=null,dragState=null;
  let statusData=null,view='settings';
  function paintStatus(){
    for(const card of document.querySelectorAll('.device-settings')){
      const lamp=card.querySelector('.connection-status');if(!lamp)continue;
      const state=window.ShellyStatus.state(statusData,card.shellyDevice);
      const labels=cfg.language==='en'?{online:'Online – current data received',offline:'Offline – no current data',unknown:'Status unknown – save and restart Homebridge, or status unavailable'}:{online:'Online – aktuelle Daten empfangen',offline:'Offline – keine aktuellen Daten',unknown:'Status unbekannt – speichern und Homebridge neu starten oder Status derzeit nicht verfügbar'};
      const power=card.querySelector('.power-values');if(power){power.replaceChildren();const row=statusData?.devices?.find(r=>r.target===window.ShellyStatus.target(card.shellyDevice));
        if(state!=='online'||!row?.measurements?.length)hint(power,'Keine aktuellen Leistungsdaten / No current power readings');
        else {const nf=new Intl.NumberFormat(cfg.language==='en'?'en-GB':'de-DE',{maximumFractionDigits:3});for(const r of row.measurements){const line=el('div',undefined,'power-row');line.append(el('strong',r.name||r.component));for(const [k,unit] of [['Power','W'],['Energy','kWh'],['Voltage','V'],['Current','A'],['ReturnedEnergy','kWh Einspeisung'],['Frequency','Hz'],['PowerFactor','Leistungsfaktor'],['ApparentPower','VA'],['ReactivePower','var']])if(Number.isFinite(r.values?.[k]))line.append(el('span',nf.format(r.values[k])+' '+unit));power.append(line);}if(Number.isFinite(row.checkedAt))hint(power,'Stand / Updated: '+new Date(row.checkedAt).toLocaleTimeString(cfg.language==='en'?'en-GB':'de-DE'));}}
      lamp.dataset.state=state;lamp.title=labels[state];lamp.setAttribute('aria-label',labels[state]);
    }
    renderOverview();
  }
  async function refreshStatus(){
    let timeout;
    try{statusData=await Promise.race([homebridge.request('/status'),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error()),7000);})]);}catch{statusData=null;}finally{clearTimeout(timeout);}
    paintStatus();setTimeout(refreshStatus,5000);
  }
  const en={'Verbindung':'Connection','Lokal':'Local','Cloud-Geräte-ID':'Cloud device ID','Cloud-Serveradresse':'Cloud server URL','Cloudschlüssel':'Cloud key','Täglicher Neustart':'Daily reboot','Neustartzeit (HH:MM)':'Reboot time (HH:MM)','HomeKit-Kacheln':'HomeKit tiles','Einzelkacheln':'Separate tiles','Gesamtkachel':'Combined tile','Allgemeine Einstellungen':'General settings','Geräteübersicht':'Device overview','Neuer Shelly':'New Shelly','Dauerhafte eindeutige ID':'Permanent unique ID','Gerätemodell':'Device model','Bitte Modell auswählen':'Select a model','Name in Apple Home':'Name in Apple Home','IP-Adresse':'IP address','Shelly-Geräte-ID':'Shelly hardware ID','Shelly-Passwort (optional)':'Shelly password (optional)','Gen1-Benutzername':'Gen1 username','Sprache':'Language','Statusintervall (Sekunden)':'Poll interval (seconds)','Nach oben':'Move up','Nach unten':'Move down','Kopieren':'Copy','Zum Sortieren ziehen':'Drag to reorder','Gerät entfernen':'Remove device','Ausgänge':'Outputs','Digitale Eingänge / i4':'Digital inputs / i4','Kanalname':'Channel name','HomeKit-Darstellung':'HomeKit service','Schalter':'Switch','Steckdose':'Outlet','Licht':'Light','Kanal anzeigen':'Expose channel','Eingang anzeigen':'Expose input','Eingangsdarstellung':'Input service','Zustand (Kontaktsensor)':'State (contact sensor)','Taste (einfach / doppelt / lang)':'Button (single / double / long)','Messwerte dieses Kanals anzeigen':'Expose this channel’s measurements','Minimale Helligkeit (%)':'Minimum brightness (%)','Maximale Helligkeit (%)':'Maximum brightness (%)','Einschalthelligkeit (%) – optional':'Power-on brightness (%) – optional','Übergang beim Dimmen (Sekunden)':'Dimming transition (seconds)','Lichtprofil am Shelly':'Light profile on the Shelly','Erweiterungen':'Extensions','Add-on hinzufügen':'Add sensor add-on','BLU / BTHome hinzufügen':'Add BLU / BTHome device','Temperatur anzeigen':'Expose temperature','Luftfeuchte anzeigen':'Expose humidity','Add-on entfernen':'Remove add-on','Entfernen':'Remove','BTHome-Gerätetyp':'BTHome device type','Weitere BTHome-Sensoren':'Other BTHome sensors','Lokale Sensorwerte anzeigen':'Expose local sensors','Leistungs- und Energiewerte anzeigen':'Expose power and energy','Hinzufügen':'Add','Komponenten-ID':'Component ID','Minimale Farbtemperatur (Kelvin)':'Minimum colour temperature (Kelvin)','Maximale Farbtemperatur (Kelvin)':'Maximum colour temperature (Kelvin)'};
  const t=s=>cfg?.language==='en'?(en[s]||s):s;
  const def=(title,type='string',extra={})=>({title,type,...extra});
  const button=(label,fn,icon,disabled=false)=>{const b=el('button',icon||t(label));b.type='button';b.title=t(label);b.setAttribute('aria-label',t(label));b.disabled=disabled;b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();});return b;};
  const hint=(parent,text)=>parent.append(el('p',text,'hint'));
  function validation(){
    const ids=new Set(),hardware=new Set();
    for(const d of cfg.devices||[]){
      if(d.rebootEnabled!==undefined&&typeof d.rebootEnabled!=='boolean'||d.rebootTime!==undefined&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.rebootTime)||d.rebootEnabled===true&&!d.rebootTime)return 'Neustartzeit als HH:MM eingeben / Enter reboot time as HH:MM.';
      if(d.tileMode!==undefined&&!['separate','grouped'].includes(d.tileMode))return 'HomeKit-Kacheln auswählen / Select a HomeKit tile mode.';
      if(d.modelId!==undefined&&(!M.get(d.modelId)||(M.get(d.modelId).cloudOnly&&d.connection!=='cloud')))return 'Bitte ein Shelly-Modell auswählen / Select a Shelly model.';
      const cloud=d.connection==='cloud';
      if(![d.id,d.name,...(cloud?[d.cloudDeviceId,d.cloudServer,d.cloudKey]:[d.host,d.shellyDeviceId])].every(v=>typeof v==='string'&&v.trim()))return 'Pflichtfelder ergänzen / Complete required fields.';
      if(ids.has(d.id))return 'ID doppelt / Duplicate ID.';ids.add(d.id);
      const hw=(cloud?d.cloudDeviceId:d.shellyDeviceId).toLowerCase().replace(/:/g,'');if(!(cloud?/^[a-f0-9]{6,12}$/:/^(?:[a-f0-9]{12}|shelly[a-z0-9-]+-[a-f0-9]{12})$/).test(hw))return 'Shelly-Geräte-ID prüfen / Check hardware ID.';
      if(hardware.has(hw.slice(-12).replace(/^0+/,'')))return 'Shelly-Hardware doppelt / Duplicate Shelly hardware.';hardware.add(hw.slice(-12).replace(/^0+/,''));
      if(cloud){try{const u=new URL(d.cloudServer.includes('://')?d.cloudServer:'https://'+d.cloudServer);if(u.protocol!=='https:'||!/^shelly-[a-z0-9-]+\.shelly\.cloud$/.test(u.hostname)||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw 0;}catch{return 'Cloud-Serveradresse prüfen / Check cloud server URL.';}if(d.rebootEnabled===true||d.thermostat===true||(d.virtualComponents||[]).some(v=>v.enabled!==false)||(d.inputs||[]).some(i=>i.enabled!==false&&i.mode==='button'))return 'Cloud: lokale Sonderfunktionen deaktivieren / Disable local-only features.';}
      else try{const u=new URL(d.host.includes('://')?d.host:'http://'+d.host);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(/^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)||u.hostname.startsWith('[')))throw 0;}catch{return 'IP-Adresse prüfen / Check IP address.';}
      for(const [field,key] of [['channels','component'],['inputs','component'],['bthome','id'],['bthome','deviceComponent'],['virtualComponents','component']]){const values=(d[field]||[]).map(x=>x[key]);if(new Set(values).size!==values.length)return 'Komponente/ID doppelt / Duplicate component/ID.';}
      for(const c of d.channels||[])if((c.minKelvin||2700)>=(c.maxKelvin||6500)||(c.minBrightness??0)>=(c.maxBrightness??100)||c.onBrightness!==undefined&&(c.onBrightness<(c.minBrightness??0)||c.onBrightness>(c.maxBrightness??100)))return 'Helligkeits-/Farbtemperaturgrenzen prüfen / Check light limits.';
      for(const v of d.virtualComponents||[])if(!/^(boolean|button):2\d\d$/.test(v.component)||!v.name?.trim()||(v.component.startsWith('boolean:')?v.mode!=='switch':!['trigger','events'].includes(v.mode)))return 'Virtuelle Komponente prüfen / Check virtual component.';
      const bids=new Set();for(const b of d.bthome||[]){if(bids.has(b.id))return 'BTHome-ID doppelt / Duplicate BTHome ID.';bids.add(b.id);}
      if(d.addons?.[0]?.inputId===d.addons?.[0]?.inputId2&&d.addons?.[0]?.inputId!==undefined)return 'Add-on-Eingangsnummern müssen verschieden sein.';
    }
    return $('settings').checkValidity()?'':'Eingaben prüfen / Check fields.';
  }
  function changed(){
    $('message').textContent=validation();homebridge.disableSaveButton();const snapshot=structuredClone(blocks),current=++revision;
    tail=tail.catch(()=>{}).then(()=>homebridge.updatePluginConfig(snapshot)).then(()=>{if(current===revision&&!validation())homebridge.enableSaveButton();}).catch(()=>{$('message').textContent='Einstellungen konnten nicht übernommen werden / Could not update settings.';homebridge.disableSaveButton();});
  }
  function fields(parent,definition,object,onChange){
    const grid=el('div',undefined,'fields');parent.append(grid);
    for(const [key,d] of Object.entries(definition.properties||{})){
      if(key.startsWith('_')||['devices','platform','accessory'].includes(key))continue;
      if(d.type==='array'){list(grid,key,d,object);continue;}
      const wrap=el('div',undefined,'field'+(d.type==='boolean'?' check':'')),label=el('label',t(d.title||key)+(definition.required?.includes(key)?' *':''));
      const input=el(d.enum?'select':'input');input.id='field-'+(++serial);label.htmlFor=input.id;
      if(d.enum)d.enum.forEach((v,i)=>{const option=el('option',t(d.enumNames?.[i]||v));option.value=v;input.append(option);});
      else input.type=d.format==='password'?'password':d.type==='boolean'?'checkbox':['number','integer'].includes(d.type)?'number':'text';
      const value=object[key]??d.default;if(input.type==='checkbox')input.checked=value===true;else input.value=value??'';
      input.required=definition.required?.includes(key)||false;if(d.pattern)input.pattern=d.pattern;if(d.minLength)input.minLength=d.minLength;
      if(d.minimum!==undefined)input.min=d.minimum;if(d.maximum!==undefined)input.max=d.maximum;if(input.type==='number')input.step=d.type==='integer'?'1':'any';
      input.addEventListener(input.tagName==='SELECT'||input.type==='checkbox'||d.rebuildOnChange?'change':'input',()=>{
        const next=input.type==='checkbox'?input.checked:input.type==='number'?(input.value===''?undefined:Number(input.value)):input.value;
        if(next===undefined)delete object[key];else object[key]=next;
        if(key==='language')render();onChange?.(key,next);changed();
      });
      if(d.type==='boolean'){const text=el('div');text.append(label);if(d.description)hint(text,d.description);wrap.append(input,text);}else{wrap.append(label,input);if(d.description)hint(wrap,d.description);}
      grid.append(wrap);
    }
  }
  function list(parent,key,d,object){
    const section=el('section',undefined,'list');section.append(el('h3',t(d.title||key)));const items=object[key]||[];
    items.forEach((item,index)=>{const row=el('div',undefined,'row');if(d.items.type==='integer'){const input=el('input');input.type='number';input.min=d.items.minimum;input.max=d.items.maximum;input.step=1;input.required=true;input.value=item;input.setAttribute('aria-label',t(d.title));input.addEventListener('input',()=>{items[index]=Number(input.value);changed();});row.append(input);}else fields(row,d.items,item);row.append(button('Entfernen',()=>{items.splice(index,1);render();changed();}));section.append(row);});
    section.append(button('Hinzufügen',()=>{object[key]??=[];object[key].push(d.items.type==='integer'?0:Object.fromEntries(Object.entries(d.items.properties||{}).filter(([,v])=>v.default!==undefined).map(([k,v])=>[k,v.default])));render();changed();},'+ '+t('Hinzufügen')));parent.append(section);
  }
  function card(title,kind,open=false){const details=el('details',undefined,kind);details.open=open;const summary=el('summary');summary.append(el('span',title,'device-title'));details.append(summary);return details;}
  function channelRows(parent,d,m){
    const templates=M.outputTemplates(d),section=el('section',undefined,'channels-section');section.append(el('h3',t('Ausgänge')));
    hint(section,(d.tileMode==='grouped'?'Gesamtkachel: Alle Ausgänge werden in einem gemeinsamen HomeKit-Gerät mit gemeinsamer Raumzuordnung zusammengefasst.':'Einzelkacheln: Jeder aktivierte Ausgang erhält ein eigenes HomeKit-Gerät und kann einem eigenen Raum zugeordnet werden.')+' Messwerte gehören direkt zum jeweiligen Kanal; zusätzliche Watt-/kWh-Werte werden in kompatiblen Apps wie Eve gelesen.');
    for(const [i,c] of (d.channels||[]).entries()){
      const cap=templates.find(x=>x.component===c.component)||{},row=card((cfg.language==='en'?'Channel ':'Kanal ')+((m.id.startsWith('pro')||m.id==='gen1-4pro')?c.component.split(':')[1]:i+1),'channel-settings',true);
      const props={enabled:def('Kanal anzeigen','boolean',{default:true}),name:def('Kanalname'),type:schema.schema.properties.devices.items.properties.channels.items.properties.type};
      if(m.energy)props.showEnergy=def('Leistungs- und Energiewerte dieses Kanals anzeigen','boolean',{default:true,description:'W, kWh, V und A, soweit gemeldet. Temperatur wird separat eingestellt.'});
      if(c.type==='light'&&cap.dimmable){Object.assign(props,{minBrightness:def('Minimale Helligkeit (%)','number',{minimum:0,maximum:99,default:0}),maxBrightness:def('Maximale Helligkeit (%)','number',{minimum:1,maximum:100,default:100}),onBrightness:def('Einschalthelligkeit (%) – optional','number',{minimum:1,maximum:100,description:'Nur beim Wechsel von Aus auf Ein. Eine ausdrücklich gesetzte Dimmhelligkeit hat Vorrang. Leer: Helligkeit des Shellys beibehalten.'})});if(d.connection!=='cloud'&&m.generation==='rpc')props.transitionSeconds=def('Übergang beim Dimmen (Sekunden)','number',{minimum:0,maximum:60,default:0});}
      if(c.type==='light'&&cap.cct){props.minKelvin=def('Minimale Farbtemperatur (Kelvin)','integer',{minimum:2000,maximum:10000,default:2700});props.maxKelvin=def('Maximale Farbtemperatur (Kelvin)','integer',{minimum:2000,maximum:10000,default:6500});}
      fields(row,{properties:props,required:['type']},c,key=>{if(key==='type')render(d.id);});section.append(row);
    }
    if(!d.channels?.length)hint(section,m.meter?'Reines Messgerät: Messdienste werden aus den vorhandenen Kanal-/Phasenwerten gebildet.':'Dieses Modell hat keine konfigurierten Schaltausgänge.');parent.append(section);
  }
  function inputRows(parent,d){
    if(!d.inputs?.length)return;const group=card(t('Digitale Eingänge / i4'),'input-group');
    for(const [i,input] of d.inputs.entries()){
      const addon=M.inputTemplates(d).find(x=>x.component===input.component)?.addon;
      const row=el('div',undefined,'row');row.append(el('h4',addon?'Add-on Eingang '+input.component.split(':')[1]:(cfg.language==='en'?'Input ':'Eingang ')+(i+1)));
      fields(row,{properties:{enabled:def('Eingang anzeigen','boolean',{default:false}),name:def('Kanalname'),mode:d.connection==='cloud'?def('Eingangsdarstellung','string',{enum:['state'],enumNames:['Zustand (Kontaktsensor)']}):schema.schema.properties.devices.items.properties.inputs.items.properties.mode},required:['mode']},input);group.append(row);
    }parent.append(group);
  }
  function extensions(parent,d,m){
    const section=el('section',undefined,'extensions');section.append(el('h3',t('Erweiterungen')));
    for(const a of d.addons||[]){
      const row=card(a.type==='pro-sensor'?'Shelly Pro Sensor Add-on':a.type==='gen1-sensor'?'Gen1 Sensor Add-on':'Shelly Sensor Add-on','addon-settings',true);
      hint(row,'Das Add-on muss am Shelly bereits eingerichtet sein. Hier werden nur die Sensorwerte und Eingänge für HomeKit zugeordnet.');
      const props={temperature:def('Temperatur anzeigen','boolean',{default:true}),humidity:def('Luftfeuchte anzeigen','boolean',{default:true})};
      if(a.type!=='gen1-sensor')props.inputId=def('Add-on-Eingangsnummer','integer',{minimum:100,maximum:199,default:100,rebuildOnChange:true,description:'Nummer der bereits angelegten digitalen Eingangskomponente am Shelly.'});
      if(a.type==='pro-sensor')props.inputId2=def('Zweite Add-on-Eingangsnummer','integer',{minimum:100,maximum:199,default:101,rebuildOnChange:true});
      fields(row,{properties:props},a,key=>{if(key.startsWith('inputId')){M.sync(d);render(d.id);}});
      row.append(button('Add-on entfernen',()=>{d.addons=[];M.sync(d);render(d.id);changed();}));section.append(row);
    }
    const bdef=schema.schema.properties.devices.items.properties.bthome.items;
    for(const [index,b] of (d.bthome||[]).entries()){
      const row=card(b.name||'BLU / BTHome','bthome-settings',true);
      const props={sensorType:def('BTHome-Gerätetyp','string',{enum:['blu-ht','blu-motion','blu-doorwindow','blu-button','bthome'],enumNames:['Shelly BLU H&T','Shelly BLU Motion','Shelly BLU Door/Window','Shelly BLU Button / Remote',t('Weitere BTHome-Sensoren')],default:'bthome'}),...bdef.properties};
      if(d.connection==='cloud'||!['blu-button','bthome'].includes(b.sensorType||'bthome'))delete props.buttonIndices;
      fields(row,{properties:props,required:bdef.required},b,key=>{if(key==='sensorType')render(d.id);});row.append(button('Entfernen',()=>{d.bthome.splice(index,1);render(d.id);changed();}));section.append(row);
    }
    const actions=el('div',undefined,'extension-actions');
    if(m.addon)actions.append(button('Add-on hinzufügen',()=>{d.addons=[{type:m.addon,temperature:true,humidity:true,inputId:100,...(m.addon==='pro-sensor'?{inputId2:101}:{})}];M.sync(d);render(d.id);changed();},'+ '+t('Add-on hinzufügen'),!!d.addons?.length));
    if(m.bthome)actions.append(button('BLU / BTHome hinzufügen',()=>{d.bthome??=[];const used=new Set(d.bthome.map(b=>b.deviceComponent));let id=200;while(used.has('bthomedevice:'+id)&&id<299)id++;d.bthome.push({id:newId(),name:'',sensorType:'blu-ht',deviceComponent:'bthomedevice:'+id,staleAfter:86400});render(d.id);changed();},'+ '+t('BLU / BTHome hinzufügen')));
    section.append(actions);if(!m.addon&&!m.bthome)hint(section,'Für dieses Modell sind im Katalog keine unterstützten Erweiterungen freigegeben.');parent.append(section);
  }
  function virtualRows(parent,d,m){
    if(d.connection==='cloud'||(m?!m.virtual:d.generation==='gen1'))return;
    const section=el('section',undefined,'virtual-section');section.append(el('h3','Virtuelle Komponenten'));
    hint(section,'Nur bereits am Shelly angelegte Boolean- und Button-Komponenten. Keine Komponenten oder Skripte werden angelegt. Jede Zuordnung erhält ein eigenes HomeKit-Gerät. Firmware-Unterstützung erforderlich.');
    for(const [index,v] of (d.virtualComponents||[]).entries()){
      const row=card(v.name||v.component,'virtual-settings',true),editor={kind:v.component.split(':')[0],cid:Number(v.component.split(':')[1])};
      fields(row,{properties:{kind:def('Komponententyp','string',{enum:['boolean','button'],enumNames:['Boolean (Ein/Aus)','Button (Taster)']}),cid:def('Virtuelle Komponenten-ID','integer',{minimum:200,maximum:299,rebuildOnChange:true})},required:['kind','cid']},editor,key=>{v.component=editor.kind+':'+(editor.cid??'');if(key==='kind'){v.mode=editor.kind==='boolean'?'switch':'trigger';render(d.id);}});
      const props={name:def('Name in Apple Home'),enabled:def('Komponente anzeigen','boolean',{default:true})};
      if(editor.kind==='button'){props.mode=def('Verwendung','string',{enum:['trigger','events'],enumNames:['Aus HomeKit auslösen','Tastendrücke für HomeKit-Szenen empfangen'],description:'Auslösen: eigene Schaltkachel, die nach dem Tastendruck zurückspringt. Empfangen: Szenentaster für Einfach-, Doppel- und Langdruck.'});if(v.mode==='trigger')props.event=schema.schema.properties.devices.items.properties.virtualComponents.items.properties.event;}
      fields(row,{properties:props,required:['name',...(editor.kind==='button'?['mode']:[])]},v,key=>{if(key==='mode')render(d.id);});
      row.append(button('Virtuelle Komponente entfernen',()=>{d.virtualComponents.splice(index,1);render(d.id);changed();}));section.append(row);
    }
    section.append(button('Virtuelle Komponente hinzufügen',()=>{d.virtualComponents??=[];const used=new Set(d.virtualComponents.map(v=>v.component));let id=200;while(used.has('boolean:'+id)&&id<299)id++;d.virtualComponents.push({component:'boolean:'+id,name:'',mode:'switch',enabled:true});render(d.id);changed();},'+ Virtuelle Komponente hinzufügen'));parent.append(section);
  }
  function setView(next){view=next;for(const id of ['settings','add-device','order-hint','save-hint','intro'])$(id).hidden=view!=='settings';$('overview').hidden=view!=='overview';$('show-settings').classList.toggle('active-tab',view==='settings');$('show-overview').classList.toggle('active-tab',view==='overview');$('show-settings').setAttribute('aria-pressed',String(view==='settings'));$('show-overview').setAttribute('aria-pressed',String(view==='overview'));$('page-title').textContent=view==='overview'?(cfg.language==='en'?'Status overview':'Statusübersicht'):t('Geräteübersicht');renderOverview();}
  function renderOverview(){
    if(!$('overview')||!cfg)return;const root=$('overview');root.replaceChildren();
    const legend=el('div',undefined,'overview-legend');for(const [state,label] of [['active','Ein / Aktiv'],['inactive','Aus / Inaktiv'],['unknown','Unbekannt']]){const item=el('span'),dot=el('i',undefined,'channel-lamp');dot.dataset.state=state;dot.setAttribute('aria-hidden','true');item.append(dot,document.createTextNode(label));legend.append(item);}root.append(legend);
    const nf=new Intl.NumberFormat(cfg.language==='en'?'en-GB':'de-DE',{maximumFractionDigits:3});
    const metric=(parent,value,label,unit)=>{const item=el('span',undefined,'channel-metric');item.title=label;item.append(el('span',nf.format(value)+(unit?' '+unit:''),'metric-value'),el('span',label,'metric-label'));parent.append(item);};
    for(const d of cfg.devices||[]){
      const data=statusData?.devices?.find(r=>r.target===window.ShellyStatus.target(d)),state=window.ShellyStatus.state(statusData,d),online=state==='online',card=el('article',undefined,'overview-device');
      const header=el('div',undefined,'overview-device-header'),identity=el('div'),heading=el('h2',d.name||d.id),meta=el('p',(M.get(d.modelId)?.label||'Shelly')+' · '+(d.connection==='cloud'?'Cloud':'Lokal'),'overview-device-meta'),badge=el('span',online?'Online':state==='offline'?'Offline':'Unbekannt','overview-status');badge.dataset.state=state;identity.append(heading,meta);header.append(identity,badge);card.append(header);
      const rows=window.ShellyOverview.rows(d,data,online);
      for(const r of rows){
        const signal=window.ShellyOverview.signal(r,online),line=el('div',undefined,'channel-line'),dot=el('span',undefined,'channel-lamp');line.dataset.component=r.component;line.dataset.kind=r.kind;dot.dataset.state=signal.state;dot.setAttribute('role','img');dot.setAttribute('aria-label',(r.name||r.component)+': '+signal.label);dot.title=signal.label;
        const title=el('div',undefined,'channel-identity');title.append(el('strong',r.name||r.component));const number=r.component.split(':')[1],kind=r.kind==='output'?'Ausgang '+number:r.kind==='input'?'Eingang '+number:r.kind==='meter'?r.component:'Sensor';title.append(el('span',signal.label+' · '+kind,'channel-state'));
        const values=el('div',undefined,'channel-metrics'),v=online?r.values||{}:{};
        if(Number.isFinite(v.Brightness))metric(values,v.Brightness,'Helligkeit','%');
        for(const [key,label,unit] of [['CurrentTemperature','Temperatur','°C'],['TargetTemperature','Sollwert','°C'],['CurrentRelativeHumidity','Luftfeuchte','%'],['CurrentAmbientLightLevel','Helligkeit','lux'],['BatteryLevel','Batterie','%']])if(Number.isFinite(v[key]))metric(values,v[key],label,unit);
        if([0,1,2].includes(v.TargetHeatingCoolingState))values.append(el('span',['Aus','Heizen','Kühlen'][v.TargetHeatingCoolingState],'channel-mode'));
        for(const m of r.measurements)for(const [key,label,unit] of [['Power','Leistung','W'],['Energy','Verbrauch','kWh'],['Voltage','Spannung','V'],['Current','Strom','A'],['ReturnedEnergy','Einspeisung','kWh'],['Frequency','Frequenz','Hz'],['PowerFactor','Leistungsfaktor',''],['ApparentPower','Scheinleistung','VA'],['ReactivePower','Blindleistung','var']])if(Number.isFinite(m.values?.[key]))metric(values,m.values[key],label,unit);
        line.append(dot,title,values);card.append(line);
      }
      if(!rows.length)hint(card,online?'Keine Status- oder Leistungswerte gemeldet.':'Keine aktuellen Daten verfügbar.');
      if(Number.isFinite(data?.checkedAt))card.append(el('p','Letzte Abfrage: '+new Date(data.checkedAt).toLocaleTimeString(cfg.language==='en'?'en-GB':'de-DE'),'overview-updated'));
      root.append(card);
    }
    if(!cfg.devices?.length)hint(root,'Noch keine Shellys eingerichtet.');
  }
  $('show-overview').addEventListener('click',()=>setView('overview'));$('show-settings').addEventListener('click',()=>setView('settings'));
  function render(openId){
    const openIds=new Set([...$('settings').querySelectorAll('details.device-settings[open]')].map(e=>e.dataset.device)),generalOpen=$('settings').querySelector('.general-settings')?.open||false;
    document.documentElement.lang=cfg.language||'de';$('settings').replaceChildren();$('page-title').textContent=t('Geräteübersicht');
    $('intro').textContent=cfg.language==='en'?'Select a model to configure its channels. Every device is added manually using local or cloud credentials. No discovery.':'Jedes Gerät ist einzeln ausklappbar. Das gewählte Shelly-Modell bestimmt die Kanäle und Eingabefelder. Änderungen unten mit dem Homebridge-Speichern-Knopf übernehmen. Keine Discovery.';
    $('order-hint').textContent=cfg.language==='en'?'Reorder using the arrows or drag handle, then save.':'Reihenfolge mit den Pfeilen ändern oder am Griff ziehen. Anschließend mit Save dauerhaft speichern.';
    $('save-hint').textContent=cfg.language==='en'?'Users and login are managed by Homebridge. Save changes and restart Homebridge. Preserve permanent IDs. Descriptions are currently German.':'Benutzer und Anmeldung verwaltet Homebridge. Speichern und Homebridge neu starten; dauerhafte IDs beibehalten.';
    const general=card(t('Allgemeine Einstellungen'),'general-settings',generalOpen);fields(general,schema.schema,cfg);$('settings').append(general);
    for(const [index,d] of (cfg.devices||[]).entries()){
      if(d.modelId==='wall-xl'){delete d.wallTemperature;delete d.wallHumidity;}
      const m=M.get(d.modelId),details=card(d.id||'Neue ID','device-settings',d.id===openId||openIds.has(d.id));details.dataset.device=d.id||'';details.shellyDevice=d;
      const summary=details.querySelector('summary'),title=summary.querySelector('.device-title'),tools=el('div',undefined,'sort-controls');
      const move=offset=>{[cfg.devices[index+offset],cfg.devices[index]]=[d,cfg.devices[index+offset]];render(d.id);changed();};
      const lamp=el('span',undefined,'connection-status');lamp.setAttribute('role','img');tools.append(lamp);
      tools.append(button('Nach oben',()=>move(-1),'↑',index===0),button('Nach unten',()=>move(1),'↓',index===cfg.devices.length-1));
      const drag=el('span','⠿','drag-device');drag.setAttribute('role','button');drag.tabIndex=0;drag.title=t('Zum Sortieren ziehen');drag.setAttribute('aria-label',t('Zum Sortieren ziehen'));drag.draggable=false;drag.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();dragState={device:d,startX:e.clientX,startY:e.clientY,moved:false,target:null};drag.setPointerCapture(e.pointerId);});drag.addEventListener('pointermove',e=>{if(dragState?.device!==d)return;dragState.moved ||= Math.hypot(e.clientX-dragState.startX,e.clientY-dragState.startY)>8;if(!dragState.moved)return;details.classList.add('dragging');const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.device-settings');dragState.target?.classList.remove('drop-target');dragState.target=target&&target!==details?target:null;dragState.target?.classList.add('drop-target');});const finishDrag=e=>{if(dragState?.device!==d)return;const moving=dragState.device,target=dragState.target?.shellyDevice,moved=dragState.moved;dragState.target?.classList.remove('drop-target');details.classList.remove('dragging');dragState=null;if(drag.hasPointerCapture(e.pointerId))drag.releasePointerCapture(e.pointerId);if(e.type==='pointercancel'||!moved||!target||target===moving)return;const from=cfg.devices.indexOf(moving),to=cfg.devices.indexOf(target);if(from<0||to<0)return;cfg.devices.splice(from,1);cfg.devices.splice(to,0,moving);render(moving.id);changed();};drag.addEventListener('pointerup',finishDrag);drag.addEventListener('pointercancel',finishDrag);drag.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});drag.addEventListener('dragstart',e=>{dragged=d;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',d.id);details.classList.add('dragging');});drag.addEventListener('dragend',()=>{dragged=null;details.classList.remove('dragging');});tools.append(drag);
      tools.append(button('Kopieren',()=>{const copy=structuredClone(d);copy.id=newId();copy.host='';copy.shellyDeviceId='';copy.cloudDeviceId='';copy.bthome=[];copy.virtualComponents=[];copy.rebootEnabled=false;cfg.devices.splice(index+1,0,copy);render(copy.id);changed();},'⧉'));summary.append(tools);
      details.addEventListener('dragover',e=>{if(dragged&&dragged!==d){e.preventDefault();details.classList.add('drop-target');}});details.addEventListener('dragleave',()=>details.classList.remove('drop-target'));
      details.addEventListener('drop',e=>{e.preventDefault();if(!dragged||dragged===d)return;const from=cfg.devices.indexOf(dragged),to=cfg.devices.indexOf(d),moving=dragged;cfg.devices.splice(from,1);cfg.devices.splice(to,0,moving);dragged=null;render(moving.id);changed();});
      const basic=schema.schema.properties.devices.items.properties;
      const props={id:basic.id,modelId:def('Gerätemodell','string',{enum:['',...M.selectable(d.modelId,d.connection).map(m=>m.id)],enumNames:[d.modelId===undefined?'Bestehende manuelle Konfiguration':t('Bitte Modell auswählen'),...M.selectable(d.modelId,d.connection).map(m=>m.label)],description:'Die Modellauswahl erzeugt die passenden Kanalvorlagen. Bei einem Modellwechsel werden Kanal- und Erweiterungseinstellungen neu angelegt; die dauerhafte Geräte-ID bleibt erhalten.'}),name:basic.name,connection:basic.connection,...(d.connection==='cloud'?{cloudDeviceId:basic.cloudDeviceId,cloudServer:basic.cloudServer,cloudKey:basic.cloudKey}:{host:basic.host,shellyDeviceId:basic.shellyDeviceId,password:basic.password})};
      if(d.connection!=='cloud'&&(m?.generation==='gen1'||d.modelId===undefined))props.username=basic.username;
      if(d.modelId===undefined)props.generation=basic.generation;
      if((d.channels?.length||0)>1)props.tileMode=def('HomeKit-Kacheln','string',{enum:['separate','grouped'],enumNames:['Einzelkacheln','Gesamtkachel'],default:'separate',description:'Einzelkacheln: eigener Raum pro Ausgang möglich. Gesamtkachel: gemeinsames Gerät mit allen Kanälen in einem Raum. Nach einem Wechsel speichern und Homebridge neu starten; betroffene Kacheln, Räume und Szenen prüfen.'});
      if(d.connection!=='cloud')props.rebootEnabled=basic.rebootEnabled;if(d.connection!=='cloud'&&d.rebootEnabled===true)props.rebootTime=basic.rebootTime;
      if(m?.profiles)props.profileId=def('Lichtprofil am Shelly','string',{enum:m.profiles.map(p=>p.id),enumNames:m.profiles.map(p=>p.label),default:m.profiles[0].id,description:'Muss dem bereits am Shelly eingestellten Profil entsprechen. Das Plugin ändert das Geräteprofil nicht.'});
      const body=el('div',undefined,'device-body');details.append(body);
      fields(body,{properties:props,required:['id','name',...(d.connection==='cloud'?['cloudDeviceId','cloudServer','cloudKey']:['host','shellyDeviceId']),...(d.modelId!==undefined?['modelId']:[])]},d,(key,value)=>{
        if(key==='id'){title.textContent=value||'Neue ID';details.dataset.device=value;}
        if(key==='connection'){if(value==='cloud'){d.thermostat=false;d.rebootEnabled=false;for(const v of d.virtualComponents||[])v.enabled=false;for(const i of d.inputs||[])if(i.mode==='button'){i.enabled=false;i.mode='state';}for(const b of d.bthome||[])delete b.buttonIndices;}render(d.id);}
        if(key==='modelId'){M.select(d,value);render(d.id);}
        if(key==='profileId'){M.sync(d,true);render(d.id);}
        if(key==='tileMode'||key==='rebootEnabled')render(d.id);
      });
      if(d.connection==='cloud')hint(body,'Cloud: gemeinsame Begrenzung auf eine Anfrage pro Sekunde. Sensoren benötigen passende Daten im Cloudstatus. Thermostatsteuerung, Neustart, virtuelle Komponenten und Echtzeit-Tastendrücke sind nur lokal verfügbar. Bei Cloud-offline werden gespeicherte Daten nicht als aktuelle Messwerte angezeigt.');
      if(m){if(m.note)hint(body,m.note);const options={};if(m.energy)options.energy=basic.energy;if(/^wall(?:-x2|-xl)?$/.test(d.modelId||'')){if(d.connection!=='cloud')options.thermostat=basic.thermostat;options.wallIlluminance=basic.wallIlluminance;if(d.modelId!=='wall-xl'){options.wallTemperature=basic.wallTemperature;options.wallHumidity=basic.wallHumidity;}options.wallMotion=basic.wallMotion;}if(Object.keys(options).length)fields(body,{properties:options},d);channelRows(body,d,m);inputRows(body,d);extensions(body,d,m);}
      else if(d.modelId===undefined){hint(body,'Bestehende manuelle Konfiguration bleibt unverändert nutzbar. Ein Modellwechsel ersetzt die Kanalvorlage; vorher Einstellungen prüfen.');fields(body,{properties:{channels:basic.channels,inputs:basic.inputs,bthome:basic.bthome,energy:basic.energy}},d);}
      if(m?.energy||d.energy===true){const power=card('Leistungsdaten','power-settings');hint(power,'Anzeige im Plugin, unabhängig von den HomeKit-Messwert-Häkchen. Je Kanal bzw. Phase, soweit vom Gerät gemeldet.');power.append(el('div',undefined,'power-values'));body.append(power);}
      virtualRows(body,d,m);
      body.append(button('Gerät entfernen',()=>{cfg.devices.splice(index,1);render();changed();}));$('settings').append(details);
    }
    $('add-device').textContent=t('Neuer Shelly');paintStatus();setView(view);
  }
  $('settings').addEventListener('submit',e=>e.preventDefault());$('add-device').addEventListener('click',()=>{const d={id:newId(),modelId:'',name:'',host:'',shellyDeviceId:'',channels:[],inputs:[],bthome:[],addons:[]};cfg.devices??=[];cfg.devices.push(d);render(d.id);changed();});
  (async()=>{try{[blocks,schema]=await Promise.all([homebridge.getPluginConfig(),homebridge.getPluginConfigSchema()]);cfg=blocks.find(b=>b.platform==='ShellyUniversal');if(!cfg){cfg={platform:'ShellyUniversal',name:'Shelly Universal',language:'de',pollInterval:10,devices:[]};blocks.push(cfg);}render();changed();refreshStatus();}catch{$('message').textContent='Konfiguration konnte nicht geladen werden / Could not load configuration.';homebridge.disableSaveButton();}})();
})();
