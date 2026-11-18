'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validate,hostURL,matches}=require('../lib/config');
const {model,command,rgbToHs,hsToRgb}=require('../lib/model');
const {device,rpc,bthome}=require('./fixtures');
test('manual IP only; rejects URLs with credentials, paths and hostnames',()=>{
  for(const host of ['shelly.local','http://x:y@192.0.2.1','http://192.0.2.1/path','ftp://192.0.2.1','192.0.2.1?x=1','999.1.1.1'])assert.throws(()=>hostURL(host));
  for(const host of ['192.0.2.1','192.0.2.1:8080','[::1]','https://[2001:db8::1]'])assert.ok(hostURL(host));
});
test('IDs compare MAC, colon MAC and full ID exactly',()=>{
  const info=rpc().info;for(const id of ['aabbccddeeff','AA:BB:CC:DD:EE:FF',info.id])assert.ok(matches(info,id));
  for(const id of ['ddeeff','other-aabbccddeeff','112233445566'])assert.ok(!matches(info,id));
  assert.ok(matches({mac:info.mac},'shelly1pm-'+info.mac.toLowerCase()));
});
test('configuration rejects duplicate logical IDs and duplicate hardware in full/short form',()=>{
  for(const other of [{...device(),host:'192.0.2.11'},{...device(),id:'another',shellyDeviceId:rpc().info.id}])assert.throws(()=>validate({devices:[device(),other]}));
});
test('configuration rejects cover channels, malformed fields and missing IDs',()=>{
  for(const patch of [{shellyDeviceId:''},{channels:[{component:'cover:0',type:'light'}]},{inputs:[{component:'input:0',mode:'bogus'}]},{bthome:[{id:'x',name:'x',deviceComponent:'bthomesensor:200'}]},{channels:{}},{host:'shelly.local'}])assert.throws(()=>validate({devices:[{...device(),...patch}]}));
});
test('configuration bounds and BTHome uniqueness are validated',()=>{
  for(const pollInterval of [0,NaN,301])assert.throws(()=>validate({pollInterval}));
  assert.throws(()=>validate({devices:[{...device(),channels:[{component:'cct:0',type:'light',minKelvin:6500,maxKelvin:2700}]}]}));
  const b=bthome().config;assert.throws(()=>validate({devices:[{...device(),bthome:[b,{...b,id:'other'}]}]}));
  assert.throws(()=>validate({devices:[{...device(),bthome:[{...b,buttonIndices:[0,0]}]}]}));
});
test('only configured outputs are exposed; per-channel service choice is preserved',()=>{
  const snap=rpc();snap.status['switch:1']={output:false};const m=model(snap,device());
  assert.equal(m.descriptors.find(d=>d.key==='switch:0').type,'outlet');assert.ok(!m.descriptors.some(d=>d.key==='switch:1'));
  for(const type of ['switch','outlet','light'])assert.equal(model(snap,{...device(),channels:[{component:'switch:0',type}]}).descriptors[0].type,type);
});
test('relay-as-light has On only; dimming and colour come from real fields',()=>{
  const c={...device(),channels:[{component:'switch:0',type:'light'}]};assert.deepEqual(model(rpc(),c).descriptors[0].values,{On:true});
  const snap=rpc();snap.status['rgb:0']={output:true,brightness:55,rgb:[255,0,0]};c.channels=[{component:'rgb:0',type:'light'}];
  const d=model(snap,c).descriptors[0];assert.deepEqual(d.values,{On:true,Brightness:55,Hue:0,Saturation:100});assert.deepEqual(command(d,'Hue',120),{rgb:[0,255,0]});
});
test('colour conversions preserve pure primaries and grayscale',()=>{
  for(const [h,rgb] of [[0,[255,0,0]],[120,[0,255,0]],[240,[0,0,255]]]){assert.deepEqual(hsToRgb(h,100),rgb);assert.equal(rgbToHs(rgb).Hue,h);}
  assert.deepEqual(rgbToHs([100,100,100]),{Hue:0,Saturation:0});
});
test('CCT uses Kelvin API and mired HomeKit values',()=>{
  const snap=rpc();snap.status['cct:0']={output:true,brightness:70,ct:4000};const c={...device(),channels:[{component:'cct:0',type:'light'}]};const d=model(snap,c).descriptors[0];
  assert.equal(d.values.ColorTemperature,250);assert.deepEqual(command(d,'ColorTemperature',200),{ct:5000});
});
test('all cover profiles suppress every output without cover service creation',()=>{
  for(const alter of [s=>s.info.profile='cover',s=>s.status['cover:0']={current_pos:50},s=>s.settings.mode='roller',s=>s.status.rollers=[{}]]) {
    const snap=rpc();alter(snap);const m=model(snap,device());assert.ok(!m.descriptors.some(d=>d.output));assert.ok(m.warnings.length);assert.ok(!m.descriptors.some(d=>/cover|window/i.test(d.type)));
  }
});
test('i4 state and stateless button inputs are distinct',()=>{
  const c={...device(),inputs:[{component:'input:0',mode:'state'},{component:'input:1',mode:'button'}]};const m=model(rpc(),c);
  assert.equal(m.descriptors.find(d=>d.key==='input:0').values.ContactSensorState,1);assert.equal(m.descriptors.find(d=>d.key==='input:1').type,'button');
  c.inputs[1].mode='state';assert.ok(model(rpc(),c).warnings.some(w=>w.includes('ohne Zustand')));
});
test('RPC add-on zero preserved while native battery and lux are excluded',()=>{
  const snap=rpc();Object.assign(snap.status,{'temperature:101':{tC:0},'illuminance:0':{lux:0},'devicepower:0':{battery:{percent:0}}});
  const m=model(snap,{...device(),addons:[{type:'plus-addon'}]});assert.equal(m.descriptors.find(d=>d.key==='temperature:101').values.CurrentTemperature,0);assert.ok(!m.descriptors.some(d=>['lux','battery'].includes(d.type)));
});
test('invalid and absent sensors are not fabricated',()=>{
  const snap=rpc();snap.status['temperature:100']={tC:null};snap.status['humidity:100']={rh:999};assert.ok(!model(snap,device()).descriptors.some(d=>['temperature','humidity'].includes(d.type)));
});
test('native sensor and energy options disable their services',()=>assert.ok(model(rpc(),{...device(),nativeSensors:false,energy:false}).descriptors.every(d=>d.output)));
test('RPC energy converts Wh to kWh and preserves measured voltage/current',()=>{
  const d=model(rpc(),device()).descriptors.find(d=>d.type==='energy');assert.deepEqual(d.values,{Power:50,Voltage:230,Current:.22,Energy:1.234});
});
test('Gen1 Wmin and EM Wh have different unit conversions',()=>{
  const snap={gen:1,info:{},settings:{},status:{relays:[{ison:false}],meters:[{power:10,total:60000}],emeters:[{power:100,total:2000,total_returned:200,voltage:230,current:.5}]}};
  const m=model(snap,{...device(),channels:[{component:'relay:0',type:'switch'}]});assert.equal(m.descriptors.find(d=>d.key==='meter:0:energy').values.Energy,1);assert.equal(m.descriptors.find(d=>d.key==='emeter:0:energy').values.Energy,2);
  snap.info.type='SHSW-1';assert.ok(!model(snap,device()).descriptors.some(d=>d.key==='meter:0:energy'));
});
test('Pro EM phase mapping combines EM and EMData without inventing current',()=>{
  const snap=rpc();snap.status={'em:0':{a_act_power:-50,a_voltage:231,a_current:.3,b_act_power:0,b_voltage:230,b_current:0,c_act_power:100,c_voltage:229,c_current:.5,total_act_power:50,total_current:.8},'emdata:0':{a_total_act_energy:1000,a_total_act_ret_energy:10,b_total_act_energy:0,c_total_act_energy:3000,total_act:4000},'em1:1':{act_power:8,voltage:230,current:.1},'em1data:1':{total_act_energy:2000}};
  const m=model(snap,device());assert.equal(m.descriptors.find(d=>d.key==='em:0:A:energy').values.Power,-50);assert.equal(m.descriptors.find(d=>d.key==='em:0:B:energy').values.Energy,0);assert.equal(m.descriptors.find(d=>d.key==='em:0:total:energy').values.Energy,4);assert.equal(m.descriptors.find(d=>d.key==='em1:1:energy').values.Energy,2);
});
test('Gen1 add-on temperature, humidity, digital input and event counter',()=>{
  const snap={gen:1,info:{},settings:{},status:{inputs:[{input:0,event:'S',event_cnt:2}],ext_temperature:{0:{tC:20}},ext_humidity:{0:{hum:44}},ext_switch:{0:{input:1}}}};
  const c={...device(),addons:[{type:'gen1-sensor'}],channels:[],inputs:[{component:'extinput:0',mode:'state'},{component:'input:0',mode:'button'}]};const m=model(snap,c);assert.equal(m.descriptors.find(d=>d.key==='extinput:0').values.ContactSensorState,1);assert.equal(m.descriptors.find(d=>d.type==='button').counter,2);assert.equal(m.descriptors.find(d=>d.type==='humidity').values.CurrentRelativeHumidity,44);
});
test('BTHome inclusion is manual and sensor IDs are joined by device MAC',()=>{
  const b=bthome(),snap=rpc();snap.components=b.components;
  assert.equal(model(snap,device(),1001).bluetooth.length,0);
  const m=model(snap,{...device(),bthome:[b.config]},1001),ds=m.bluetooth[0].descriptors;assert.equal(ds.find(d=>d.type==='temperature').key,'bthomesensor:207');assert.ok(!ds.some(d=>d.key==='bthomesensor:200'));assert.equal(ds.find(d=>d.type==='humidity').values.CurrentRelativeHumidity,55);
});
test('BTHome motion, lux, battery and stale values are supported',()=>{
  const b=bthome(),snap=rpc();snap.components=b.components;for(const [obj,value] of [[33,true],[5,0],[1,88]])snap.components.push({key:'bthomesensor:'+(220+obj),config:{addr:b.components[0].config.addr,obj_id:obj},status:{value,last_update_ts:1000}});
  const m=model(snap,{...device(),bthome:[{...b.config,staleAfter:60}]},2000);const ds=m.bluetooth[0].descriptors;assert.ok(ds.find(d=>d.type==='motion').values.MotionDetected);assert.ok(ds.every(d=>d.fault));assert.equal(ds.filter(d=>d.type==='battery').length,1);
});
test('BTHome button indices require reported object type 58 and preserve separate sensor IDs',()=>{
  const b=bthome(),snap=rpc();snap.components=b.components;snap.components[0].knownObjects={objects:[{obj_id:58,idx:1}]};snap.components.push({key:'bthomesensor:250',config:{addr:b.components[0].config.addr,obj_id:58,idx:1},status:{value:1,last_update_ts:1000}});
  const m=model(snap,{...device(),bthome:[{...b.config,buttonIndices:[1,2]}]},1001);const button=m.bluetooth[0].descriptors.find(d=>d.type==='button');assert.equal(button.key,'button:1');assert.equal(button.eventComponent,'bthomesensor:250');assert.ok(m.warnings.some(w=>w.includes('idx 2')));
});
test('missing BTHome component reports fault without borrowing another device',()=>{
  const b=bthome(),snap=rpc();snap.components=[];const m=model(snap,{...device(),bthome:[b.config]});assert.ok(m.bluetooth[0].fault);assert.deepEqual(m.bluetooth[0].descriptors,[]);
});
test('Wall Display RPC fixtures expose relay, valid local sensors and XL motion only',()=>{
  const snap=rpc();snap.info={...snap.info,app:'WallDisplayV2',model:'SAWD-3A1XE10EU2'};Object.assign(snap.status,{'motion:0':{id:0,motion:true},'temperature:0':{tC:-275.15,errors:['Sensor driver missing from firmware']},'humidity:0':{rh:-2},'illuminance:0':{lux:27}});const m=model(snap,device());assert.ok(!m.descriptors.some(d=>d.key==='motion:0'));assert.ok(!m.descriptors.some(d=>d.key==='temperature:0'||d.key==='humidity:0'));assert.ok(!m.descriptors.some(d=>d.key==='illuminance:0'));
});
test('BTHome alternate precision IDs preserve parsed readings without rescaling',()=>{
  const b=bthome(),snap=rpc();snap.components=b.components;snap.components[1].config.obj_id=69;snap.components[2].config.obj_id=46;const ds=model(snap,{...device(),bthome:[b.config]},1001).bluetooth[0].descriptors;assert.equal(ds.find(d=>d.type==='temperature').values.CurrentTemperature,22.7);assert.equal(ds.find(d=>d.type==='humidity').values.CurrentRelativeHumidity,55);
});

test('native sensor flags cannot expose internal values; configured add-ons and BTHome survive',()=>{
 const snap=rpc(),b=bthome();snap.components=b.components;Object.assign(snap.status,{'temperature:0':{tC:55.9},'temperature:101':{tF:32},'humidity:100':{rh:0},'motion:0':{motion:true},'battery:0':{percent:99}});snap.status['switch:0'].temperature={tC:55.9,tF:132.6};
 const cfg={...device(),nativeSensors:true,channels:[{component:'switch:0',type:'light',showTemperature:true}],addons:[{type:'plus-addon'}],bthome:[b.config]};
 const m=model(snap,cfg,1001);assert.deepEqual(m.descriptors.filter(d=>d.type==='temperature').map(d=>d.key),['temperature:100','temperature:101']);assert.equal(m.descriptors.find(d=>d.key==='temperature:101').values.CurrentTemperature,0);assert.ok(!m.descriptors.some(d=>['motion','battery','lux'].includes(d.type)));assert.ok(m.bluetooth[0].descriptors.some(d=>d.type==='temperature'));
 assert.ok(!model(snap,{...cfg,addons:[]}).descriptors.some(d=>['temperature','humidity'].includes(d.type)));
});

test('real Wall Display and XL replies exclude bad internal readings and expose optional thermostat and lux',()=>{
 for(const [name,raw] of Object.entries(require('./wall-display-fixtures'))){const snap=structuredClone(raw),cfg={...device(),modelId:name==='xl'?'wall-xl':'wall',generation:'rpc'};let m=model(snap,cfg);assert.ok(!m.descriptors.some(d=>['temperature','humidity','thermostat','lux'].includes(d.type)));
 cfg.thermostat=true;cfg.wallIlluminance=true;m=model(snap,cfg);const th=m.descriptors.find(d=>d.type==='thermostat');assert.equal(th.values.CurrentTemperature,21.9);assert.equal(th.values.TargetTemperature,snap.status['thermostat:0'].target_C);assert.equal(th.values.CurrentHeatingCoolingState,name==='xl'?1:0);assert.equal(m.descriptors.find(d=>d.type==='lux').values.CurrentAmbientLightLevel,name==='xl'?11:5);assert.ok(!m.descriptors.some(d=>['temperature','humidity'].includes(d.type)));assert.deepEqual(command(th,'TargetTemperature',23),{config:{target_C:23}});assert.deepEqual(command(th,'TargetHeatingCoolingState',0),{config:{enable:false}});assert.deepEqual(command(th,'TargetHeatingCoolingState',2),{config:{type:'cooling',enable:true}});assert.deepEqual(command(th,'TargetHeatingCoolingState',1),{config:{type:'heating',enable:true}});assert.throws(()=>command(th,'TargetHeatingCoolingState',3));assert.throws(()=>command(th,'TargetTemperature',50));
 snap.settings['thermostat:0'].type='cooling';assert.equal(model(snap,cfg).descriptors.find(d=>d.type==='thermostat').mode,2);snap.status['thermostat:0'].current_C=-275;assert.ok(!model(snap,cfg).descriptors.some(d=>d.type==='thermostat'));}
});

test('optional standard Display sensors retain unavailable readings as faults and recover automatically',()=>{
 const snap=structuredClone(require('./wall-display-fixtures').xl),cfg={...device(),modelId:'wall',generation:'rpc',wallTemperature:true,wallHumidity:true,wallMotion:true};let m=model(snap,cfg);for(const type of ['temperature','humidity']){const d=m.descriptors.find(d=>d.type===type);assert.ok(d.fault);assert.deepEqual(d.values,{});assert.equal(d.missingValues.length,1);}assert.equal(m.descriptors.find(d=>d.type==='motion').values.MotionDetected,false);snap.status['temperature:0']={tC:22.5};snap.status['humidity:0']={rh:45};m=model(snap,cfg);assert.equal(m.descriptors.find(d=>d.type==='temperature').values.CurrentTemperature,22.5);assert.equal(m.descriptors.find(d=>d.type==='humidity').values.CurrentRelativeHumidity,45);assert.ok(!m.descriptors.find(d=>d.type==='temperature').fault);
});

test('XL never exposes internal temperature or humidity while standard Display keeps optional sensors',()=>{
 for(const [id,fixture] of [['wall-xl','xl'],['wall','standard'],['wall-x2','standard']]){const snap=structuredClone(require('./wall-display-fixtures')[fixture]);snap.status['temperature:0']={tC:22};snap.status['humidity:0']={rh:45};const d={...device(),modelId:id,generation:'rpc',wallTemperature:true,wallHumidity:true,thermostat:true,wallIlluminance:true,wallMotion:true},m=model(snap,d);assert.equal(m.descriptors.some(x=>x.type==='temperature'),id!=='wall-xl');assert.equal(m.descriptors.some(x=>x.type==='humidity'),id!=='wall-xl');assert.ok(m.descriptors.some(x=>x.type==='thermostat'));assert.ok(m.descriptors.some(x=>x.type==='lux'));}
});

test('startup brightness applies only to Off-to-On for RPC brightness and Gen1 gain',()=>{
 for(const gen of [1,2]){const d={type:'light',output:true,gen,raw:gen===1?{gain:20}:{brightness:20},options:{onBrightness:35},values:{On:true,Brightness:20}};assert.deepEqual(command(d,'On',true),{on:true});d.values.On=false;assert.deepEqual(command(d,'On',true),gen===1?{on:true,gain:35}:{on:true,brightness:35});assert.deepEqual(command(d,'Brightness',80),gen===1?{gain:80}:{brightness:80});}
});
