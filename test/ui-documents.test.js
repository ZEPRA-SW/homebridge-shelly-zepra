'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {uiDocument}=require('../homebridge-ui/documents');
test('UI document endpoint returns only the two bundled views',async()=>{
 for(const area of ['shading','devices']){const result=await uiDocument(area);assert.ok(result.html.includes('../bridge.js'));assert.ok(result.html.includes('app.js'));}
 for(const area of [undefined,'../private/Shelly-ZEPRA-Konfiguration.json','index.html','unknown'])await assert.rejects(uiDocument(area),/Ungültiger/);
});
