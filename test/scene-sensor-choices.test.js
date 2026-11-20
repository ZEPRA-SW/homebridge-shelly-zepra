'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../homebridge-ui/public/scene-model');
const station={id:'WS90: Keep',name:'Weather: Garden',deviceComponent:'bthomedevice:200',sensorType:'ws90'};
const contact={id:'Contact: Keep',name:'Kitchen window',deviceComponent:'bthomedevice:201',sensorType:'blu-doorwindow'};
const target=id=>JSON.stringify([id]);
function fixture(){return {
 config:{devices:[{id:'host',name:'House host',connection:'local',channels:[{component:'switch:0',type:'switch'}],inputs:[{component:'input:100',name:'Door contact',enabled:true,mode:'state'},{component:'voltmeter:101',name:'Pressure custom',enabled:true,mode:'analog'},{component:'input:102',name:'Disabled input',enabled:false,mode:'state'},{component:'input:103',name:'Button input',enabled:true,mode:'button'}],bthome:[station,contact]},{id:'cloud',name:'Cloud H&T',connection:'cloud',channels:[]},{id:'actuator',name:'Actuator',channels:[{component:'switch:0',type:'switch'}]}],shading:{devices:[{id:'host',name:'Blind host',bthome:[{...station,name:'Weather: Porch'}],deviceType:'roller'}]}},
 data:{devices:[{target:target('host'),readings:[{component:'temperature:100',name:'Tank temperature',values:{CurrentTemperature:30}},{component:'humidity:100',name:'Tank humidity',values:{CurrentRelativeHumidity:50}},{component:'input:102',name:'Disabled input',values:{ContactSensorState:0}},{component:'input:103',name:'Button input',values:{ContactSensorState:0}},{component:'switch:0',name:'Relay',values:{On:true,Brightness:75}},{component:'voltmeter:101',name:'Stale cached name',values:{AnalogValue:2.3},unit:'V'}],measurements:[{component:'switch:0',name:'Relay power',values:{Power:10,Energy:1,Voltage:230,Current:0.05}}],bthome:[{id:station.id,deviceComponent:station.deviceComponent,readings:[{component:'bthomesensor:203',metric:'WindSpeed',values:{WindSpeed:3.6}},{component:'bthomesensor:204',metric:'GustSpeed',values:{GustSpeed:7.2}}]},{id:contact.id,deviceComponent:contact.deviceComponent,readings:[{component:'bthomesensor:202',type:'contact',values:{ContactSensorState:0}}]}]},{target:target('cloud'),readings:[{component:'temperature:0',name:'Outside temperature',values:{CurrentTemperature:10}},{component:'humidity:0',name:'Outside humidity',values:{CurrentRelativeHumidity:80}}]}],shading:[{id:'host',bthome:[{id:station.id,deviceComponent:station.deviceComponent,readings:[{component:'bthomesensor:203',metric:'WindSpeed',values:{WindSpeed:4}}]}]}]}
 };}
const entryKey=s=>JSON.stringify([s.area,s.deviceId,s.sensorId||'',s.component||'']);
const leaf=(source,scope)=>({kind:'value',source,sourceDevice:scope,operator:'gt',value:1});

test('configured BTHome groups remain directly selectable without online readings in either device area',()=>{
 const f=fixture(),items=M.sensorChoices(f.config),groups=items.filter(s=>s.sensorId);
 assert.equal(groups.length,3);assert.ok(groups.some(s=>s.name==='Weather: Garden'&&s.sensorId===station.id&&s.hostName==='House host'&&s.hostId==='host'&&s.area==='devices'));
 assert.ok(groups.some(s=>s.name==='Weather: Porch'&&s.sensorId===station.id&&s.deviceId==='host'&&s.area==='shading'));
 assert.ok(groups.some(s=>s.sensorId===contact.id&&s.name==='Kitchen window'));assert.equal(new Set(groups.map(entryKey)).size,groups.length);
});
test('native, Add-on and cloud sensor components use actual component IDs and configured names',()=>{
 const f=fixture(),items=M.sensorChoices(f.config,f.data);
 for(const [deviceId,component,name]of [['host','input:100','Door contact'],['host','voltmeter:101','Pressure custom'],['host','temperature:100','Tank temperature'],['host','humidity:100','Tank humidity'],['cloud','temperature:0','Outside temperature'],['cloud','humidity:0','Outside humidity']]){
  const item=items.find(s=>s.area==='devices'&&s.deviceId===deviceId&&s.component===component);assert.ok(item,component);assert.equal(item.name,name);assert.equal(item.sensorId,undefined);
 }
 assert.ok(!items.some(s=>s.component==='input:102'));assert.ok(!items.some(s=>s.component==='input:103'));assert.ok(!items.some(s=>s.component==='switch:0'));assert.ok(!items.some(s=>['On','Brightness','Power','Energy','Voltage','Current'].includes(s.metric)));
 assert.equal(new Set(items.map(entryKey)).size,items.length);
});
test('sensor choices never invent Add-on components when no measurements have supplied their IDs',()=>{
 const config={devices:[{id:'addon',name:'Add-on host',channels:[],addons:[{type:'plus-addon',temperature:true,humidity:true}]}],shading:{devices:[]}};
 assert.deepEqual(M.sensorChoices(config),[]);assert.equal(M.sensorChoices(fixture().config).filter(s=>s.component).length,2,'explicit enabled input mappings remain available offline');
});
test('listing choices does not mutate configuration, status values or existing source reference identities',()=>{
 const f=fixture(),before=structuredClone(f),refs=M.sources(f.config,f.data),freeze=o=>{if(o&&typeof o==='object'){Object.freeze(o);for(const value of Object.values(o))freeze(value);}};
 freeze(f);assert.doesNotThrow(()=>M.sensorChoices(f.config,f.data));assert.deepEqual(f,before);assert.deepEqual(M.sources(f.config,f.data),refs);
});
test('source scopes isolate BTHome devices from each other and from native components on the same host',()=>{
 const host={area:'devices',deviceId:'host'},sensor={...host,sensorId:station.id},native={...host,component:'bthomesensor:203'},wind={...sensor,component:'bthomesensor:203',metric:'WindSpeed'};
 assert.equal(M.scopeMatches(host,wind),true);assert.equal(M.scopeMatches(sensor,wind),true);assert.equal(M.scopeMatches({...sensor,sensorId:contact.id},wind),false);assert.equal(M.scopeMatches(native,wind),false);
 assert.equal(M.scopeMatches({...host,component:'input:100'},{...host,component:'input:100',metric:'ContactSensorState'}),true);
 assert.equal(M.scopeMatches({...host,component:'input:100'},{...host,component:'input:101',metric:'ContactSensorState'}),false);
 assert.equal(M.scopeMatches(sensor,{...wind,area:'shading'}),false);assert.equal(M.scopeMatches(sensor,{...wind,deviceId:'other'}),false);
});
test('malformed or ambiguous source scopes cannot silently broaden into host-wide selection',()=>{
 const source={area:'devices',deviceId:'host',component:'temperature:100',metric:'CurrentTemperature'};
 for(const scope of [null,{},{area:'devices'}, {...source,area:'unknown'},{area:'devices',deviceId:'host',sensorId:''},{area:'devices',deviceId:'host',component:''},{area:'devices',deviceId:'host',sensorId:'sensor',component:'temperature:100'}])assert.equal(M.scopeMatches(scope,source),false);
});
test('condition validation preserves legacy host scopes and rejects cross-sensor or cross-component selections',()=>{
 const f=fixture(),host={area:'devices',deviceId:'host'},wind={...host,sensorId:station.id,component:'bthomesensor:203',metric:'WindSpeed'},temperature={...host,component:'temperature:100',metric:'CurrentTemperature'};
 assert.doesNotThrow(()=>M.validateCondition(leaf(wind,host),f.config));assert.doesNotThrow(()=>M.validateCondition(leaf(wind,{...host,sensorId:station.id}),f.config));assert.doesNotThrow(()=>M.validateCondition(leaf(temperature,{...host,component:'temperature:100'}),f.config));
 for(const scope of [{...host,sensorId:contact.id},{...host,component:'bthomesensor:203'},{...host,sensorId:station.id,component:'bthomesensor:203'}])assert.throws(()=>M.validateCondition(leaf(wind,scope),f.config),/passen nicht zusammen/);
 assert.throws(()=>M.validateCondition(leaf(temperature,{...host,component:'humidity:100'}),f.config),/passen nicht zusammen/);
});
