'use strict';
// BTHomeSensor status values are already decoded by Shelly. Only wind m/s -> km/h is converted.
// Object definitions: https://shelly-api-docs.shelly.cloud/docs-ble/Devices/BLU_ZB/wstation/
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const address=value=>typeof value==='string'?value.toLowerCase().replace(/[:-]/g,''):'';
const specs={
  4:{metric:'AirPressure',unit:'hPa',min:0,max:167772.15},
  8:{metric:'DewPoint',unit:'°C',min:-327.68,max:327.67},
  12:{metric:'CapacitorVoltage',unit:'V',min:0,max:65.535},
  32:{metric:'RainDetected',unit:'',binary:true},
  70:{metric:'UVIndex',unit:'',min:0,max:25.5},
  94:{metric:'WindDirection',unit:'°',min:0,max:360},
  95:{metric:'Precipitation',unit:'mm',min:0,max:1677721.5}
};
const WEATHER_METRICS=['WindSpeed','GustSpeed','WindDirection','RainDetected','UVIndex','AirPressure','DewPoint','Precipitation','CapacitorVoltage'];
function weatherReading(component,now,staleAfter){
 const object=component.config?.obj_id,index=component.config?.idx??0;if(!Number.isInteger(object))return null;
 const spec=object===68?(index===0?{metric:'WindSpeed',unit:'km/h',min:0,max:655.35,convert:value=>value*3.6}:index===1?{metric:'GustSpeed',unit:'km/h',min:0,max:655.35,convert:value=>value*3.6}:undefined):specs[object];
 if(!spec)return null;
 const status=component.status||{},raw=status.value,time=status.last_updated_ts??status.last_update_ts;
 const valid=spec.binary?[true,false,0,1].includes(raw):finite(raw)&&raw>=spec.min&&raw<=spec.max;
 const fault=!valid||!finite(time)||time<=0||time>now+5||now-time>staleAfter||status.is_valid===false||!!status.errors?.length;
 const value=fault?undefined:spec.binary?!!raw:spec.convert?spec.convert(raw):raw;
 return {key:component.key,type:'weather',name:component.config?.name||component.key,metric:spec.metric,unit:spec.unit,...(finite(time)&&time>0?{observedAt:time*1000}:{}),values:fault?{}:{[spec.metric]:value},fault,...(fault?{missingValues:[spec.metric]}:{})};
}
module.exports={WEATHER_METRICS,weatherReading,address};
