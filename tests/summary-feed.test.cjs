const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const Scheduler=require('../src/features/listen/summary/insightScheduler');
function setup(chat=async()=>({content:'**Summary Overview**\n- Decision made\n**Key Topic: Release**\n- Ship Friday'})){
 const entries=[],events=[],latest=[];let next=0;let service;const controls={owner:'owner',feedReads:0};
 const mocks={electron:{},'../../common/prompts/promptBuilder.js':{getSystemPrompt:()=> '{{CONVERSATION_HISTORY}}'},
 '../../common/ai/factory':{createLLM:()=>({chat})},'../../common/repositories/session':{touch:async()=>{},getAllByUserId:async()=>[],getById:async id=>controls.lookup ? controls.lookup(id) : ({id,uid:'owner'})},
 './repositories':{getSummaryBySessionId:async()=>null,saveSummary:async value=>latest.push(value)},
 '../../common/services/modelStateService':{getCurrentModelInfo:async()=>({provider:'test',model:'test',apiKey:'synthetic'})},
 '../../common/repositories/feed':{list:async sessionId=>{controls.feedReads++;return {entries:entries.filter(e=>e.sessionId===sessionId),hasMore:false};},save:async(sessionId,kind,entry)=>{const value={...entry,id:String(++next),sessionId};entries.push(value);return value;}},
 '../../common/services/authService':{getCurrentUserId:()=> controls.owner},
 '../../common/services/interviewContextService':{on(){},context:()=>({context:null}),snapshot(){}},
 '../../common/services/insightsScreenContext':{capture:async()=>({}),get:()=>[],clear(){}},
 '../../ask/repositories':{getAllAiMessagesBySessionId:async()=>[]},
 '../stt/repositories':{getAllTranscriptsBySessionId:async()=>service.conversationHistory.map(text=>({text,speaker:'Me'}))},
 './insightScheduler':Scheduler,'./insightSettings':{get:()=>({turns:5,seconds:30}),set:value=>value},
 '../../../window/windowManager':{windowPool:new Map([['listen',{isDestroyed:()=>false,webContents:{send:(channel,data)=>events.push({channel,data})}}]])}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/features/listen/summary/summaryService.js'),'utf8'),{module,exports:module.exports,console:{log(){},error(){}},require:id=>mocks[id]||require(id)});
 service=new module.exports();return {service,entries,events,latest,controls};
}
test('insight snapshots append and the latest-summary record remains compatible',async()=>{
 const h=setup();await h.service.setSessionId('session');h.service.addConversationTurn('Me','First');await h.service.finish();
 h.service.addConversationTurn('Them','Second');await h.service.finish();
 assert.equal(h.entries.length,2);assert.equal(h.latest.length,2);
 assert.equal(h.events.filter(e=>e.channel==='insights-feed'&&!e.data.reset).length,2);
 assert.equal(h.entries[0].data.summary[0],'Decision made');
});
test('late model results from a previous session are neither saved nor published',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));await h.service.setSessionId('old');h.service.addConversationTurn('Me','Old turn');
 const flight=h.service.scheduler.flush();await new Promise(r=>setImmediate(r));h.service.resetConversationHistory();await h.service.setSessionId('new');
 resolve({content:'**Summary Overview**\n- Old result'});await flight;
 assert.equal(h.entries.length,0);assert.equal(h.latest.length,0);
 assert.equal(h.events.filter(e=>e.channel==='summary-update').length,0);
});
test('provider failure never appends the previous insight as a new successful update',async()=>{
 const h=setup(async()=>{throw new Error('Provider unavailable');});await h.service.setSessionId('session');h.service.addConversationTurn('Me','Pending');
 await h.service.finish();assert.equal(h.entries.length,0);assert.equal(h.latest.length,0);
});

test('selected insight history revalidates session ownership after the IPC ownership check',async()=>{
 const h=setup();h.controls.owner='different-owner';
 await assert.rejects(h.service.getFeed(null,'session-owned-by-owner'),/unavailable for the current account/);
 assert.equal(h.controls.feedReads,0);
});
test('account switch during selected-history session lookup blocks reading persisted insight data',async()=>{
 const h=setup();let resolve;h.controls.lookup=()=>new Promise(done=>{resolve=done;});
 const pending=h.service.getFeed(null,'session');h.controls.owner='different-owner';resolve({id:'session',uid:'owner'});
 await assert.rejects(pending,/unavailable for the current account/);
 assert.equal(h.controls.feedReads,0);
});
