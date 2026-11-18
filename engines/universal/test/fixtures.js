'use strict';
const device=()=>({id:'living-room',name:'Living room',host:'192.0.2.10',shellyDeviceId:'aabbccddeeff',channels:[{component:'switch:0',type:'outlet'}],inputs:[],bthome:[]});
const rpc=()=>({gen:2,info:{id:'shellyplus2pm-aabbccddeeff',mac:'AABBCCDDEEFF',model:'SNSW-002P16EU',gen:2,profile:'switch',ver:'1.6.0'},settings:{},status:{'switch:0':{id:0,output:true,apower:50,voltage:230,current:.22,aenergy:{total:1234}},'temperature:100':{tC:21.5},'humidity:100':{rh:52},'input:0':{state:true},'input:1':{state:null}}});
const bthome=()=>({
  config:{id:'blu-ht',name:'BLU H&T',deviceComponent:'bthomedevice:200'},
  components:[{key:'bthomedevice:200',config:{addr:'AA:BB:11:22:33:44'},status:{battery:90,last_updated_ts:1000}},
    {key:'bthomesensor:207',config:{addr:'aa:bb:11:22:33:44',obj_id:2},status:{value:22.7,last_updated_ts:1000}},
    {key:'bthomesensor:209',config:{addr:'aa:bb:11:22:33:44',obj_id:3},status:{value:55,last_update_ts:1000}},
    {key:'bthomesensor:200',config:{addr:'ff:ff:ff:ff:ff:ff',obj_id:2},status:{value:99,last_updated_ts:1000}}]
});
module.exports={device,rpc,bthome};
