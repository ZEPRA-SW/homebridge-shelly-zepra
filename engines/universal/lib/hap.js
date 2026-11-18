'use strict';
function types(hap) {
  const {Characteristic:C,Service:S}=hap, custom={};
  const Formats=hap.Formats||C.Formats,Perms=hap.Perms||C.Perms;
  for(const [name,id,unit,min,max] of [
    ['Power','E863F10D-079E-48FF-8F27-9C2605A29F52','W',-1000000,1000000],
    ['Energy','E863F10C-079E-48FF-8F27-9C2605A29F52','kWh',0,1e12],
    ['Voltage','E863F10A-079E-48FF-8F27-9C2605A29F52','V',0,1000],
    ['Current','E863F126-079E-48FF-8F27-9C2605A29F52','A',0,10000],
    ['ReturnedEnergy','C0D5F101-672A-4F9A-B79A-98A7DB63C201','kWh',0,1e12]]) {
    custom[name]=class extends C {constructor(){super(name,id);this.setProps({format:Formats.FLOAT,unit,minValue:min,maxValue:max,minStep:.001,perms:[Perms.PAIRED_READ,Perms.NOTIFY]});this.value=this.getDefaultValue();}};
    custom[name].UUID=id;
  }
  class EnergyService extends S {constructor(name,subtype){super(name,EnergyService.UUID,subtype);}}
  EnergyService.UUID='E863F008-079E-48FF-8F27-9C2605A29F52';
  return {chars:{...C,...custom},services:{switch:S.Switch,outlet:S.Outlet,light:S.Lightbulb,temperature:S.TemperatureSensor,humidity:S.HumiditySensor,lux:S.LightSensor,motion:S.MotionSensor,contact:S.ContactSensor,button:S.StatelessProgrammableSwitch,battery:S.Battery,thermostat:S.Thermostat,energy:EnergyService}};
}
module.exports={types};
