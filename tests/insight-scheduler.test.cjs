const test = require('node:test');
const assert = require('node:assert/strict');
const InsightScheduler = require('../src/features/listen/summary/insightScheduler');
function setup(run = async()=>true) {
    let now=0, next=0; const timers=new Map(); const calls=[];
    const scheduler=new InsightScheduler({run:()=>{calls.push(now);return run();}, now:()=>now,
        setTimer:(fn,delay)=>{timers.set(++next,{fn,at:now+delay});return next;},clearTimer:id=>timers.delete(id)});
    return {scheduler,calls,timers,advance:async ms=>{now+=ms; for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();} await tick();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('five new turns trigger once; silence never triggers a request', async()=>{
    const h=setup(); await h.advance(60000); assert.equal(h.calls.length,0);
    for(let n=0;n<4;n++)h.scheduler.add(); assert.equal(h.calls.length,0);
    h.scheduler.add(); await tick(); assert.equal(h.calls.length,1);
    await h.advance(60000);assert.equal(h.calls.length,1);
});
test('time window begins with first pending content and is not reset by later turns',async()=>{
    const h=setup();h.scheduler.add();await h.advance(20000);h.scheduler.add();await h.advance(9999);assert.equal(h.calls.length,0);
    await h.advance(1);assert.equal(h.calls.length,1);
});
test('slow requests serialize subsequent accumulated turns',async()=>{
    let resolve;let first=true;
    const h=setup(()=>{if(first){first=false;return new Promise(r=>resolve=r);}return Promise.resolve(true);});
    for(let n=0;n<5;n++)h.scheduler.add();
    for(let n=0;n<5;n++)h.scheduler.add();
    await h.advance(60000);assert.equal(h.calls.length,1);
    resolve(true);await tick();assert.equal(h.calls.length,2);
    assert.equal(h.scheduler.pending,0);
});
test('failure retains pending content and retries after delay, not in a busy loop',async()=>{
    let fail=true;const h=setup(async()=>!fail);
    for(let n=0;n<5;n++)h.scheduler.add();await tick();assert.equal(h.scheduler.pending,5);assert.equal(h.calls.length,1);
    fail=false;await h.advance(30000);assert.equal(h.calls.length,2);assert.equal(h.scheduler.pending,0);
});
test('final flush generates an insight for fewer than five turns',async()=>{
    const h=setup();h.scheduler.add();await h.scheduler.flush(true);assert.equal(h.calls.length,1);
});
test('reset invalidates an in-flight completion and clears pending timers',async()=>{
    let resolve;const h=setup(()=>new Promise(r=>resolve=r));
    for(let n=0;n<5;n++)h.scheduler.add();h.scheduler.reset();resolve(true);await tick();
    assert.equal(h.scheduler.pending,0);assert.equal(h.timers.size,0);assert.equal(h.scheduler.flight,null);
});
test('configurable thresholds apply to pending content',async()=>{
    const h=setup();h.scheduler.add();h.scheduler.configure({turns:1,seconds:10});await tick();assert.equal(h.calls.length,1);
});
