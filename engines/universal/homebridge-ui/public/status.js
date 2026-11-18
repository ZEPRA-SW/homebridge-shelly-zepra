'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ShellyStatus=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  const target=d=>JSON.stringify([d.id,d.connection==='cloud'?'cloud:'+d.cloudServer:d.host,String((d.connection==='cloud'?d.cloudDeviceId:d.shellyDeviceId)||'').toLowerCase().replace(/:/g,'').slice(-12)]);
  function state(data,device,now=Date.now()) {
    const row=data?.devices?.find(d=>d.target===target(device));
    if(!row||row.online===null||!Number.isFinite(row.checkedAt))return 'unknown';
    if(!Number.isFinite(data.maxAge)||data.maxAge<0)return 'unknown';
    if(now-row.checkedAt>data.maxAge||row.checkedAt>now+5000)return 'offline';
    return row.online===true?'online':'offline';
  }
  return {target,state};
});
