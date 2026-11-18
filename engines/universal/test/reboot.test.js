'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {RebootScheduler}=require('../lib/reboot'),{Client}=require('../lib/client'),{validate}=require('../lib/config'),{device,rpc}=require('./fixtures');
test('reboot config validates strict time and explicit opt in',()=>{
  for(const d of [{rebootEnabled:true},{rebootEnabled:'true'},{rebootTime:'24:00'},{rebootTime:'4:00'},{rebootTime:'12:60'},{rebootTime:null}])assert.throws(()=>validate({devices:[{...device(),...d}]}));
  for(const time of ['00:00','23:59'])assert.doesNotThrow(()=>validate({devices:[{...device(),rebootEnabled:true,rebootTime:time}]}));
});
test('scheduled restart persists attempts, skips startup/missed times, failures and repeated dates',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shelly-reboot-'));let now=new Date(2026,10,12,4,29),calls=0;
  const d={...device(),rebootEnabled:true,rebootTime:'04:30'},units=new Map([['one',{config:d,client:{reboot:async due=>{assert.ok(due());calls++;throw Error('offline');}}}]]),log={info(){},warn(){},error(){}};
  const s=new RebootScheduler(dir,units,log,()=>now);
  try {
    await s.start();await s.tick();assert.equal(calls,0);now=new Date(2026,10,12,4,30);await Promise.all([s.tick(),s.tick()]);assert.equal(calls,1);await s.tick();assert.equal(calls,1);s.stop();
    now=new Date(2026,10,12,4,29);const restored=new RebootScheduler(dir,units,log,()=>now);await restored.start();now=new Date(2026,10,12,4,30);await restored.tick();assert.equal(calls,1);
    now=new Date(2026,10,13,4,31);await restored.tick();assert.equal(calls,1);now=new Date(2026,10,14,4,30);await restored.tick();assert.equal(calls,2);restored.stop();
    const startup=new RebootScheduler(dir,units,log,()=>now);await startup.start();await startup.tick();assert.equal(calls,2);startup.stop();
    await fs.writeFile(s.file,'broken');const broken=new RebootScheduler(dir,units,log,()=>now);await broken.start();assert.equal(broken.timer,undefined);broken.stop();
  } finally {s.stop();await fs.rm(dir,{recursive:true,force:true});}
});
test('reboot uses verified hardware and correct API; opt out, identity mismatch and late queue block writes',async()=>{
  for(const gen of [1,2]) {
    const calls=[],config={...device(),rebootEnabled:true};const c=new Client(config,async(url,opt)=>{const p=new URL(url).pathname,b=opt.body&&JSON.parse(opt.body);calls.push(p==='/rpc'?b.method:p);return new Response(JSON.stringify(p==='/shelly'?(gen===2?rpc().info:{mac:config.shellyDeviceId}):p==='/rpc'?{id:b.id,result:null}:{}));});
    await c.reboot();assert.deepEqual(calls,['/shelly',gen===1?'/reboot':'Shelly.Reboot']);
    calls.length=0;await assert.rejects(c.reboot(()=>false));assert.equal(calls.length,0);
    c.config.rebootEnabled=false;await assert.rejects(c.reboot());assert.equal(calls.length,0);
  }
  const c=new Client({...device(),rebootEnabled:true},async()=>new Response(JSON.stringify({mac:'112233445566'})));await assert.rejects(c.reboot(),/Geräte-ID/);
});
