'use strict';
window.ZepraGeneral={render(config,schema,changed,defaults={}){
 const t=text=>window.ZepraI18n.translate(text,config.language);
 const form=document.getElementById('general-form');form.replaceChildren();form.addEventListener('submit',e=>e.preventDefault(),{once:true});
 const shared=schema.schema.properties,shade=shared.shading.properties;
 const sections=[['Plugin',config,['name','language','pollInterval'],shared],['Standort und Beschattung',config.shading,['timeZone','latitude','longitude','globalControls'],shade]];
 for(const [title,object,keys,defs] of sections){
  const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.dataset.i18n=title;legend.textContent=t(title);group.append(legend);const fields=document.createElement('div');fields.className='general-fields';group.append(fields);
  for(const key of keys){const def=defs[key],label=document.createElement('label'),text=document.createElement('span');text.dataset.i18n=def.title;text.textContent=t(def.title);const input=document.createElement(def.enum||key==='timeZone'?'select':'input');
   input.id='general-'+key;input.name=key;if(['timeZone','globalControls'].includes(key))label.className='general-wide';
   if(key==='timeZone'){const current=object[key]??defaults.timeZone??window.ZepraSettings.systemTimeZone();for(const value of [...new Set([current,...(defaults.timeZones??window.ZepraSettings.timeZones(current))])].sort()){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}input.value=current;}
   else if(def.enum){def.enum.forEach((value,i)=>{const option=document.createElement('option');option.value=value;option.textContent=def.enumNames?.[i]??value;input.append(option);});input.value=object[key]??def.default;}
   else{input.type=def.type==='boolean'?'checkbox':def.type==='number'?'number':'text';if(input.type==='checkbox')input.checked=object[key]??def.default??false;else input.value=object[key]??def.default??'';if(input.type==='number'){input.step='any';if(def.minimum!==undefined)input.min=def.minimum;if(def.maximum!==undefined)input.max=def.maximum;}}
   input.required=def.type!=='boolean'&&(!['latitude','longitude'].includes(key)||window.ZepraSettings.requiresLocation(config));input.addEventListener(def.enum||key==='timeZone'||input.type==='checkbox'?'change':'input',()=>{object[key]=input.type==='checkbox'?input.checked:input.type==='number'?(input.value===''?undefined:Number(input.value)):input.value;changed(form.checkValidity());});
   label.append(text,input);if(def.description){const hint=document.createElement('small');hint.dataset.i18n=def.description;hint.textContent=t(def.description);label.append(hint);}fields.append(label);
  }form.append(group);
 }
 return form.checkValidity();
}};
