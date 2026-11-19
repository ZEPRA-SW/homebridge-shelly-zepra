'use strict';
const I=require('../homebridge-ui/public/i18n');
require('../homebridge-ui/public/common-i18n');
require('../homebridge-ui/public/scenes-i18n');
// Translate at display/log boundaries; stored Scene state and configuration stay language-neutral.
function translate(text,language,domain='all'){
 if(I.normalizeLanguage(language)==='de')return text;
 let result=I.translate(text,language,{},domain);
 if(result===text){
  const devices=require('../homebridge-ui/public/devices/i18n');
  result=devices.translate(text,language);
  if(result===text&&typeof text==='string')for(let at=text.indexOf(': ');at>=0;at=text.indexOf(': ',at+2)){
   const tail=text.slice(at+2),translated=devices.translate(tail,language);
   if(translated!==tail){result=text.slice(0,at+2)+translated;break;}
  }
 }
 return result;
}
function logger(log,language,domain='all'){
 if(!log)return log;
 const args=values=>values.map((value,index)=>index===0&&typeof value==='string'?translate(value,language,domain):value);
 return new Proxy(log,{apply(target,receiver,values){return Reflect.apply(target,receiver,args(values));},get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?(...values)=>Reflect.apply(value,target,args(values)):value;}});
}
module.exports={...I,translate,logger};
