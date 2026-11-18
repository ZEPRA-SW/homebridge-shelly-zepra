'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Ajv=require('ajv');
const schema=require('../config.schema.json'),example=require('../config.example.json'),{validate}=require('../lib/config');
test('schema compiles and example passes both schema and runtime validation',()=>{
  const ajv=new Ajv({strict:false});ajv.addFormat('password',()=>true);const check=ajv.compile(schema.schema);assert.ok(check(example),JSON.stringify(check.errors));assert.equal(validate(example),example);assert.equal(schema.pluginAlias,'ShellyUniversal');assert.equal(schema.customUi,true);
});
test('schema rejects forbidden cover components and missing required device fields',()=>{
  const ajv=new Ajv({strict:false});ajv.addFormat('password',()=>true);const check=ajv.compile(schema.schema);const c=structuredClone(example);c.devices[0].channels[0].component='cover:0';assert.ok(!check(c));delete c.devices[0].host;assert.ok(!check(c));
});
