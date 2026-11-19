'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZepraI18n=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
 const catalogs=Object.create(null),compiled=new Map(),languages=['de','en','fr','es'];
 const normalizeLanguage=language=>languages.includes(language)?language:'de';
 const locale=language=>({de:'de-DE',en:'en-GB',fr:'fr-FR',es:'es-ES'})[normalizeLanguage(language)];
 function register(domain,values){catalogs[domain]=values;compiled.clear();}
 const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 function templates(domain,language){const key=domain+':'+language;if(compiled.has(key))return compiled.get(key);const entries=Object.entries(catalogs[domain]?.[language]||{}).filter(([source])=>/\{\w+\}/.test(source)).map(([source,value])=>{const names=[],chunks=[];let last=0;source.replace(/\{(\w+)\}/g,(token,name,index)=>{chunks.push(escape(source.slice(last,index)),'([\\s\\S]*?)');names.push(name);last=index+token.length;});chunks.push(escape(source.slice(last)));return {regex:new RegExp('^'+chunks.join('')+'$'),names,value,weight:source.replace(/\{\w+\}/g,'').length};}).sort((a,b)=>b.weight-a.weight);compiled.set(key,entries);return entries;}
 function translate(text,language='de',params={},domain='common',depth=0){if(typeof text!=='string')return text;language=normalizeLanguage(language);const domains=domain==='all'?Object.keys(catalogs):[domain,...domain==='common'?[]:['common']];let output,values={...params};for(const name of domains){const dict=catalogs[name]?.[language];if(!dict)continue;if(Object.hasOwn(dict,text)){output=dict[text];break;}if(language==='de')continue;for(const entry of templates(name,language)){const match=entry.regex.exec(text);if(!match)continue;values={...Object.fromEntries(entry.names.map((name,i)=>[name,match[i+1]])),...params};output=entry.value;break;}if(output!==undefined)break;}
  output??=text;
  if(depth<4)for(const key of ['reason','status','message'])if(typeof values[key]==='string')values[key]=translate(values[key],language,{},domain,depth+1);
  return output.replace(/\{(\w+)\}/g,(token,key)=>Object.hasOwn(values,key)?String(values[key]):token);
 }
 return {catalogs,register,translate,locale,normalizeLanguage,languages};
});
