'use strict';
const fs=require('node:fs');
function merge(cover,devices){
 if(cover?.platform!=='ShellyRaffstore'||devices?.platform!=='ShellyUniversal')throw Error('Erwartet werden die beiden Plugin-Blöcke ShellyRaffstore und ShellyUniversal.');
 const general=structuredClone(devices),shading=structuredClone(cover);
 delete general._bridge;delete general.platform;delete shading._bridge;delete shading.platform;
 const result=require('../homebridge-ui/public/shared-settings').normalize({...general,platform:'ShellyZepra',name:'Shelly ZEPRA',shading});
 for(const device of [...result.devices??[],...result.shading.devices??[]])if(device.connection==='cloud'){
   for(const field of ['host','shellyDeviceId','password','username'])if(device[field]==='')delete device[field];
 }
 require('../index').validateGroups(result);
 require('../engines/universal/lib/config').validate(result);
 return result;
}
if(require.main===module){
 try{
  const [coverFile,devicesFile,outFile]=process.argv.slice(2);
  if(!coverFile||!devicesFile||!outFile)throw Error('Drei Dateipfade erforderlich.');
  const result=merge(JSON.parse(fs.readFileSync(coverFile,'utf8').replace(/^\uFEFF/,'')),JSON.parse(fs.readFileSync(devicesFile,'utf8').replace(/^\uFEFF/,'')));
  fs.writeFileSync(outFile,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Gemeinsame Konfiguration erstellt. Originaldateien unverändert. Zugangsdaten nicht ausgegeben.');
 }catch{console.error('Import fehlgeschlagen: Plugin-Blöcke, Gerätelisten und neuen Ausgabepfad prüfen. Bestehende Dateien werden nicht überschrieben.');process.exitCode=1;}
}
module.exports={merge};
