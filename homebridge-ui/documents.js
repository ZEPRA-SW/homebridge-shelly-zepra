'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
async function uiDocument(area){
 if(!['shading','devices'].includes(area))throw Error('Ungültiger Gerätebereich.');
 return {html:await fs.readFile(path.join(__dirname,'public',area,'index.html'),'utf8')};
}
module.exports={uiDocument};
