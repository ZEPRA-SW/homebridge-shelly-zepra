'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');const root=path.resolve(__dirname,'..');
function files(p){return fs.statSync(p).isDirectory()?fs.readdirSync(p).flatMap(n=>files(path.join(p,n))):/\.(js|cjs)$/.test(p)?[p]:[];}
for(const name of ['index.js','lib','scripts','homebridge-ui','engines/universal/index.js','engines/universal/lib','engines/shading/index.js','engines/shading/lib'])for(const file of files(path.join(root,name))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(1);}}
console.log('Syntaxprüfung bestanden.');
