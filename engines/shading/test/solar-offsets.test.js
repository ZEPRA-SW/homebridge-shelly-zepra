'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solarConfig, SunAutomation, sunExposure } = require('../lib/solar');
const { dailyPeriods, dayBounds } = require('../lib/timeline');
const make = extra => ({ sunAutomation: { enabled:true, startOffsetMinutes:0, endOffsetMinutes:0, ...extra }, deviceType:'roller' });
const day = (extra = {}, global = {latitude:52.52,longitude:13.405}, date = '2026-06-21', zone='Europe/Berlin') => dailyPeriods(global,make(extra),date,zone);

test('old shared values migrate independently without changing their units',()=>{
  const cfg=solarConfig({latitude:52.52,longitude:13.405}, {sunAutomation:{enabled:true,delaySeconds:300,halfAngle:65}});
  assert.equal(cfg.startOffsetSeconds,300);assert.equal(cfg.endOffsetSeconds,300);
  assert.equal(cfg.leftAngle,65);assert.equal(cfg.rightAngle,65);
  const edited=solarConfig({latitude:52.52,longitude:13.405},make({delaySeconds:300,halfAngle:65,startOffsetMinutes:-10,endOffsetMinutes:5,leftAngle:20}));
  assert.equal(edited.startOffsetSeconds,-600);assert.equal(edited.endOffsetSeconds,300);
  assert.equal(edited.leftAngle,20);assert.equal(edited.rightAngle,65);
  for(const extra of [{startOffsetMinutes:-121},{endOffsetMinutes:121},{leftAngle:-1},{rightAngle:90},{startOffsetMinutes:'-10'}])assert.throws(()=>solarConfig({latitude:52.52,longitude:13.405},make(extra)));
});

test('left and right solar limits work independently, including north wrap and exit hysteresis',()=>{
  const cfg=solarConfig({latitude:52.52,longitude:13.405},make({orientation:0,leftAngle:20,rightAngle:60}));
  assert.equal(sunExposure({azimuth:345,elevation:20},cfg,false),true);
  assert.equal(sunExposure({azimuth:335,elevation:20},cfg,false),false);
  assert.equal(sunExposure({azimuth:55,elevation:20},cfg,false),true);
  assert.equal(sunExposure({azimuth:65,elevation:20},cfg,false),false);
  assert.equal(sunExposure({azimuth:338,elevation:20},cfg,true),true);
  const base=day().intervals[0],left=day({leftAngle:20}).intervals[0],right=day({rightAngle:20}).intervals[0];
  assert.ok(left.start>base.start);assert.equal(left.end,base.end);
  assert.equal(right.start,base.start);assert.ok(right.end<base.end);
});

for(const startOffsetMinutes of [-10,10])for(const endOffsetMinutes of [-15,15]){
 test('signed start/end shifts '+startOffsetMinutes+'/'+endOffsetMinutes+' match timeline and actual automation',async()=>{
  const offsets={startOffsetMinutes,endOffsetMinutes,endBehavior:'open'};
  const raw=day().intervals[0],shifted=day(offsets).intervals[0];
  assert.equal(shifted.start-raw.start,startOffsetMinutes*60000);
  assert.equal(shifted.end-raw.end,endOffsetMinutes*60000);
  let now=shifted.start-60000;
  const sent=[],status={state:'stopped',current_pos:100};
  const controller={async move(target,allowed){if(allowed())sent.push(target);}};
  const cfg=solarConfig({latitude:52.52,longitude:13.405},make(offsets));const auto=new SunAutomation(cfg,controller,{},()=>{},()=>now);
  await auto.tick(status);assert.equal(sent.length,0);
  now=shifted.start;await auto.tick(status);assert.deepEqual(sent,[{pos:30}]);
  status.current_pos=30;now=shifted.end-60000;await auto.tick(status);assert.equal(sent.length,1);
  now=shifted.end;await auto.tick(status);assert.deepEqual(sent,[{pos:30},{pos:100}]);
 });
}

test('early explicit enable remains active before a delayed start and pause lasts until shifted period end',async()=>{
  const cfg=solarConfig({latitude:52.52,longitude:13.405},make({startOffsetMinutes:10,endOffsetMinutes:-10}));
  const raw=day().intervals[0],shifted=day({startOffsetMinutes:10,endOffsetMinutes:-10}).intervals[0];
  let now=raw.start;const sent=[],status={state:'stopped',current_pos:100};
  const controller={async move(target,allowed){if(allowed())sent.push(target);}};
  const auto=new SunAutomation(cfg,controller,{},()=>{},()=>now);
  auto.setEnabled(true);await auto.tick(status);assert.equal(sent.length,1);
  status.current_pos=30;now+=60000;await auto.tick(status);assert.equal(auto.active,true);
  auto.manual();now+=60000;await auto.tick(status);assert.equal(auto.manualPaused,true);
  now=shifted.start+60000;await auto.tick(status);assert.equal(auto.manualPaused,true);
  controller.windAlarm=true;now=shifted.end;await auto.tick(status);assert.equal(auto.manualPaused,false);
});

test('shifted intervals clip across midnight and DST days without losing the previous day tail',()=>{
  const extra={orientation:270,leftAngle:89,rightAngle:89,endOffsetMinutes:60};
  const first=day(extra,{latitude:0,longitude:0},'2026-03-20','Asia/Dhaka');
  const next=day(extra,{latitude:0,longitude:0},'2026-03-21','Asia/Dhaka');
  assert.equal(first.intervals.at(-1).end,first.end);
  assert.equal(next.intervals[0].start,next.start);
  assert.ok(next.intervals[0].end>next.start);
  for(const date of ['2026-03-29','2026-10-25']){
    const d=day({startOffsetMinutes:-120,endOffsetMinutes:120},{latitude:52.52,longitude:13.405},date);
    assert.deepEqual({start:d.start,end:d.end},dayBounds(date,'Europe/Berlin'));
    assert.ok(d.intervals.every(p=>p.start>=d.start&&p.end<=d.end&&p.end>p.start));
  }
});

test('crossed start and end shifts suppress an empty shading window',async()=>{
  const extra={leftAngle:5,rightAngle:5,startOffsetMinutes:120,endOffsetMinutes:-120};
  assert.deepEqual(day(extra).intervals,[]);
  const cfg=solarConfig({latitude:52.52,longitude:13.405},make(extra));const sent=[];
  const auto=new SunAutomation(cfg,{async move(t,a){if(a())sent.push(t);}},{},()=>{},()=>Date.parse('2026-06-21T11:30:00Z'));
  await auto.tick({state:'stopped',current_pos:100});assert.deepEqual(sent,[]);
});


test('manual early start survives restart without executing a premature end action',async()=>{
  const cfg=solarConfig({latitude:52.52,longitude:13.405},make({startOffsetMinutes:10,endOffsetMinutes:0,endBehavior:'open'}));
  let now=day().intervals[0].start;let saved;const sent=[];
  const controller={async move(t,a){if(a())sent.push(t);}};
  const auto=new SunAutomation(cfg,controller,{},s=>{saved=s;},()=>now);
  auto.setEnabled(true);await auto.tick({state:'stopped',current_pos:100});
  assert.equal(saved.earlyStart,true);
  now+=60000;const restarted=new SunAutomation(cfg,controller,saved,()=>{},()=>now);
  await restarted.tick({state:'stopped',current_pos:30});
  assert.equal(restarted.active,true);assert.deepEqual(sent,[{pos:30}]);
});

test('negative offsets never bypass wind, recovery, errors or manual pause',async()=>{
  const extra={startOffsetMinutes:-10,endOffsetMinutes:-10};
  const cfg=solarConfig({latitude:52.52,longitude:13.405},make(extra));const now=day(extra).intervals[0].start;
  for(const flag of ['windAlarm','recovering','recoveryFailed','manualPaused']){
    const sent=[],controller={async move(t,a){if(a())sent.push(t);}};
    const auto=new SunAutomation(cfg,controller,{},()=>{},()=>now);
    if(flag==='manualPaused')auto.setPaused(true);else controller[flag]=true;
    auto.setEnabled(true);await auto.tick({state:'stopped',current_pos:100});
    assert.deepEqual(sent,[],flag);
  }
});
