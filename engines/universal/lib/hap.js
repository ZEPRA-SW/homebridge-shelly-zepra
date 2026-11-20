'use strict';
function types(hap) {
  const {Characteristic:C,Service:S}=hap, custom={};
  const Formats=hap.Formats||C.Formats,Perms=hap.Perms||C.Perms;
  for(const [name,id,unit,min,max] of [
    ['Power','E863F10D-079E-48FF-8F27-9C2605A29F52','W',-1000000,1000000],
    ['Energy','E863F10C-079E-48FF-8F27-9C2605A29F52','kWh',0,1e12],
    ['Voltage','E863F10A-079E-48FF-8F27-9C2605A29F52','V',0,1000],
    ['Current','E863F126-079E-48FF-8F27-9C2605A29F52','A',0,10000],
    ['ReturnedEnergy','C0D5F101-672A-4F9A-B79A-98A7DB63C201','kWh',0,1e12],
    ['AnalogValue','C0D5F102-672A-4F9A-B79A-98A7DB63C201','',0,1000]]) {
    custom[name]=class extends C {constructor(){super(name,id);this.setProps({format:Formats.FLOAT,unit,minValue:min,maxValue:max,minStep:.001,perms:[Perms.PAIRED_READ,Perms.NOTIFY]});this.value=this.getDefaultValue();}};
    custom[name].UUID=id;
  }
  for(const [name,suffix,unit,min,max]of [
    ['WindSpeed','110','km/h',0,2359.26],['GustSpeed','111','km/h',0,2359.26],
    ['WindDirection','112','arcdegrees',0,360],['UVIndex','114','',0,25.5],
    ['AirPressure','115','hPa',0,167772.15],['DewPoint','116','celsius',-327.68,327.67],
    ['CapacitorVoltage','117','V',0,65.535],['Precipitation','118','mm',0,1677721.5]]){
    const id='C0D5F'+suffix+'-672A-4F9A-B79A-98A7DB63C201';
    custom[name]=class extends C{constructor(){super(name,id);this.setProps({format:Formats.FLOAT,...(unit?{unit}:{}),minValue:min,maxValue:max,minStep:.001,perms:[Perms.PAIRED_READ,Perms.NOTIFY]});this.value=this.getDefaultValue();}};custom[name].UUID=id;
  }
  class RainDetected extends C{constructor(){super('RainDetected',RainDetected.UUID);this.setProps({format:Formats.BOOL,perms:[Perms.PAIRED_READ,Perms.NOTIFY]});this.value=this.getDefaultValue();}}
  RainDetected.UUID='C0D5F113-672A-4F9A-B79A-98A7DB63C201';custom.RainDetected=RainDetected;
  class WeatherService extends S{constructor(name,subtype){super(name,WeatherService.UUID,subtype);}}
  WeatherService.UUID='C0D5F003-672A-4F9A-B79A-98A7DB63C201';
  class EnergyService extends S {constructor(name,subtype){super(name,EnergyService.UUID,subtype);}}
  EnergyService.UUID='E863F008-079E-48FF-8F27-9C2605A29F52';
  class AnalogService extends S {constructor(name,subtype){super(name,AnalogService.UUID,subtype);}}
  AnalogService.UUID='C0D5F002-672A-4F9A-B79A-98A7DB63C201';
  return {chars:{...C,...custom},services:{switch:S.Switch,outlet:S.Outlet,light:S.Lightbulb,temperature:S.TemperatureSensor,humidity:S.HumiditySensor,lux:S.LightSensor,motion:S.MotionSensor,contact:S.ContactSensor,button:S.StatelessProgrammableSwitch,battery:S.Battery,thermostat:S.Thermostat,energy:EnergyService,analog:AnalogService,weather:WeatherService}};
}
module.exports={types};
