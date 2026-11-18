'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=['test','engines/universal/test','engines/shading/test'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(f=>f.endsWith('.test.js')).map(f=>path.join(dir,f)));
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',cwd:root});process.exitCode=result.status??1;
