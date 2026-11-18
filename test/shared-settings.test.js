'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict');
const{normalize,shadingConfig}=require('../homebridge-ui/public/shared-settings');
test('legacy general settings migrate without altering devices or source and choose the slower poll interval',()=>{
 const devices=[{id:'a'}],covers=[{id:'b'}],old={name:'ZEPRA',language:'de',pollInterval:10,devices,shading:{name:'Old shading',language:'en',pollInterval:20,latitude:51,devices:covers,globalControls:false}};
 const c=normalize(old),s=shadingConfig(c);assert.equal(c.pollInterval,20);assert.equal(c.shading.pollInterval,undefined);assert.equal(c.shading.name,undefined);assert.equal(c.shading.language,undefined);assert.equal(s.pollInterval,20);assert.equal(s.name,'ZEPRA');assert.equal(s.language,'de');assert.equal(s.latitude,51);assert.equal(s.globalControls,false);assert.equal(c.devices,devices);assert.equal(c.shading.devices,covers);assert.equal(old.shading.pollInterval,20);
 assert.deepEqual(normalize(c),c);
});
test('old shading-only settings and safe defaults remain available',()=>{
 const c=normalize({shading:{language:'fr',pollInterval:30,name:'My Plugin'}});assert.equal(c.language,'fr');assert.equal(c.pollInterval,30);assert.equal(c.name,'My Plugin');assert.equal(normalize().pollInterval,20);
});
