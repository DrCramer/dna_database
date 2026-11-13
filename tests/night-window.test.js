const test=require('node:test'),assert=require('node:assert/strict');
const {DEFAULT_POLICY,windowAt,nextWindows}=require('../src/services/workspace/nightWindow');
test('Night window: Moscow, start-day semantics, midnight, boundaries and configurable days',()=>{
  const p={...DEFAULT_POLICY,days:[1],revision:7,startTime:'22:00',endTime:'07:00'};
  assert.equal(windowAt(new Date('2026-11-09T18:59:00Z'),p).open,false);
  const a=windowAt(new Date('2026-11-09T19:00:00Z'),p),b=windowAt(new Date('2026-11-10T03:59:00Z'),p);
  assert.equal(a.open,true);assert.equal(b.open,true);assert.equal(a.key,b.key);
  assert.equal(windowAt(new Date('2026-11-10T04:00:00Z'),p).open,false);
  assert.equal(windowAt(new Date('2026-11-10T20:00:00Z'),p).open,false);
  assert.equal(nextWindows(new Date('2026-11-09T18:00:00Z'),p,1)[0],'2026-11-09T19:00:00.000Z');
});
test('DST repeated hour shares a window key; skipped start begins at first available in-window time',()=>{
  const p={...DEFAULT_POLICY,timezone:'America/New_York',days:[7],startTime:'01:00',endTime:'03:00',revision:2};
  const a=windowAt(new Date('2026-11-01T05:30:00Z'),p),b=windowAt(new Date('2026-11-01T06:30:00Z'),p);
  assert(a.open&&b.open);assert.equal(a.key,b.key);
  assert.equal(nextWindows(new Date('2026-03-08T06:00:00Z'),{...p,startTime:'02:30',endTime:'04:00'},1)[0],'2026-03-08T07:00:00.000Z');
});
