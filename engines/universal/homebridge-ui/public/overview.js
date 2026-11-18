'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ShellyOverview=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  const output=/^(switch|relay|light|rgb|rgbw|cct|color|white):\d+$/;
  const input=/^(input|extinput):/;
  function rows(device,data,online){
    const enabledInputs=(device.inputs||[]).filter(c=>c.enabled===true),allowed=new Set(enabledInputs.map(c=>c.component));
    const readings=(online?data?.readings||[]:[]).filter(r=>(!Array.isArray(data?.bthome)||!/^bthomesensor:/.test(r.component))&&(!input.test(r.component)||allowed.has(r.component))),measurements=(online?data?.measurements||[]:[]).filter(r=>!input.test(r.component)||allowed.has(r.component)),used=new Set(),result=[];
    for(const c of [...device.channels||[],...enabledInputs]){
      const index=readings.findIndex((r,i)=>!used.has(i)&&r.component===c.component);if(index>=0)used.add(index);
      result.push({component:c.component,name:c.name||c.component,kind:output.test(c.component)?'output':'input',values:index>=0?readings[index].values||{}:{},measurements:[]});
    }
    readings.forEach((r,i)=>{if(!used.has(i))result.push({...r,kind:output.test(r.component)?'output':/^(input|extinput):/.test(r.component)?'input':'sensor',measurements:[]});});
    for(const m of measurements){
      // Only explicitly owned meters join an output; a shared Gen1 meter stays separate.
      const owner=m.channel||m.component,r=result.find(r=>r.kind==='output'&&r.component===owner);
      if(r)r.measurements.push(m);else result.push({component:m.component,name:m.name||m.component,kind:'meter',values:{},measurements:[m]});
    }
    for(const b of device.bthome||[]){
      const group=data?.bthome?.find(g=>g.id===b.id&&g.deviceComponent===b.deviceComponent);
      const readings=group?.readings?.length?group.readings:[{component:b.deviceComponent,name:'Keine aktuellen Sensordaten',type:'unavailable',fault:true,values:{}}];
      for(const r of readings){const fault=!online||group?.fault===true||r.fault===true;result.push({...r,kind:'sensor',sensorId:b.id,sensorName:b.name||b.id,deviceComponent:b.deviceComponent,fault,values:fault?{}:r.values||{},measurements:[]});}
    }
    return result;
  }
  function signal(row,online){
    if(!online||row.fault)return {state:'unknown',label:'Unbekannt'};
    if(row.type==='button')return {state:'reading',label:'Taster'};
    const v=row.values||{};
    if(typeof v.On==='boolean')return {state:v.On?'active':'inactive',label:v.On?'Ein':'Aus'};
    if(row.kind==='input'&&[0,1].includes(v.ContactSensorState))return {state:v.ContactSensorState?'active':'inactive',label:v.ContactSensorState?'Aktiv':'Inaktiv'};
    if([0,1].includes(v.ContactSensorState))return {state:v.ContactSensorState?'active':'inactive',label:v.ContactSensorState?'Offen':'Geschlossen'};
    if(typeof v.MotionDetected==='boolean')return {state:v.MotionDetected?'active':'inactive',label:v.MotionDetected?'Bewegung':'Keine Bewegung'};
    if(row.kind==='input'||row.kind==='output')return {state:'unknown',label:'Unbekannt'};
    return {state:'reading',label:row.kind==='meter'?'Messwerte':'Sensor'};
  }
  function title(row){const name=row.name||row.component;return /^bthomesensor:/.test(row.component)&&!name.includes(row.component)?name+' · '+row.component:name;}
  return {rows,signal,title};
});
