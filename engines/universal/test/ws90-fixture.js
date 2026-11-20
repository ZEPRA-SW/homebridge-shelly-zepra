'use strict';
const {device,rpc}=require('./fixtures');
// Synthetic values in the WS90's documented object order; IDs match the 13-channel shape.
function ws90Fixture(now=Date.now()/1000){
 const station={id:'outdoor-weather',name:'Outdoor Weather',sensorType:'ws90',deviceComponent:'bthomedevice:200',staleAfter:120};
 const host={...device(),modelId:'pro4pm',generation:'rpc',channels:[],inputs:[],bthome:[station]};
 const snap=rpc();snap.info={...snap.info,id:'shellypro4pm-aabbccddeeff',model:'SPSW-004PE16EU'};
 const samples=[
  [1,0,100,'BatteryLevel'],[5,0,0,'CurrentAmbientLightLevel'],[32,0,false,'RainDetected'],
  [68,0,3.21,'WindSpeed'],[68,1,7.5,'GustSpeed'],[70,0,1.2,'UVIndex'],[94,0,245.25,'WindDirection'],
  [4,0,1013.25,'AirPressure'],[8,0,6.586,'DewPoint'],[12,0,2.735,'CapacitorVoltage'],
  [46,0,89,'CurrentRelativeHumidity'],[69,0,10,'CurrentTemperature'],[95,0,12.3,'Precipitation']
 ];
 const keys=Object.fromEntries(samples.map((row,index)=>[row[3],'bthomesensor:'+(200+index)]));
 snap.components=[{key:station.deviceComponent,config:{addr:'AA:BB:11:22:33:44'},status:{paired:true,last_updated_ts:now}},...samples.map(([obj_id,idx,value],index)=>({key:'bthomesensor:'+(200+index),config:{addr:'aa:bb:11:22:33:44',obj_id,idx},status:{value,last_updated_ts:now}}))];
 return {host,station,snap,keys,now};
}
module.exports={ws90Fixture};
