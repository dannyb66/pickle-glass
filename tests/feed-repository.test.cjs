const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
// Use Node's SQLite for the offline SQL checks; the app uses better-sqlite3 in Electron.
let DatabaseSync;
try { ({DatabaseSync}=require('node:sqlite')); } catch { /* SQLite SQL test requires Node 22+; Electron smoke checks cover the native runtime. */ }
const schema=require('../src/features/common/config/schema');
function harness(isCloud=false, isLocal=false){
 const db=DatabaseSync ? new DatabaseSync(':memory:') : {exec(){},close(){}};
 db.exec(`CREATE TABLE feed_entries (${schema.feed_entries.columns.map(c=>`${c.name} ${c.type}`).join(',')})`);
 const calls=[];const remote=new Map();
 const firestore={collection:(db,p)=>({path:p,withConverter(){return this;}}),doc:(col,id)=>({col,id}),
  setDoc:async(ref,data)=>{calls.push(data);remote.set(ref.id,data);},
  orderBy:(...args)=>({orderBy:args}),documentId:()=> '__name__',startAfter:(...args)=>({cursor:args}),limit:n=>({limit:n}),
  query:(col,...constraints)=>({col,constraints}),getDocs:async q=>({docs:[...remote.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,21).map(data=>({data:()=>data}))})};
 const mocks={'../../services/interviewContextService':{isLocalSession:()=>isLocal},'../../services/sqliteClient':{getDb:()=>db},'../../services/authService':{getCurrentUser:()=>({isLoggedIn:isCloud}),getCurrentUserId:()=> 'owner'},
 '../../services/firebaseClient':{getFirestoreInstance:()=>({})},'../firestoreConverter':{createEncryptedConverter:()=>({})},'firebase/firestore':firestore};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/features/common/repositories/feed/index.js'),'utf8'),{module,exports:module.exports,require:id=>mocks[id]||require(id)});
 return {repo:module.exports,db,calls};
}
test('SQLite feed pages preserve timestamp ties, isolate sessions, and upsert streamed answers', {skip: !DatabaseSync && 'Requires Node 22+ node:sqlite'},async()=>{
 const {repo,db}=harness();
 for(let n=0;n<45;n++)await repo.save('session','ask',{id:`entry-${String(n).padStart(2,'0')}`,timestamp:100,answer:String(n)});
 await repo.save('other','ask',{id:'other',timestamp:100});await repo.save('session','insights',{id:'insight',timestamp:100});
 const newest=await repo.list('session','ask');assert.equal(newest.entries.length,20);assert.equal(newest.hasMore,true);
 const middle=await repo.list('session','ask',newest.cursor);const oldest=await repo.list('session','ask',middle.cursor);
 const ids=[...oldest.entries,...middle.entries,...newest.entries].map(e=>e.id);
 assert.equal(new Set(ids).size,45);assert.equal(oldest.hasMore,false);
 await repo.save('session','ask',{id:'entry-44',timestamp:100,answer:'updated'});
 assert.equal((await repo.list('session','ask')).entries.at(-1).answer,'updated');
 db.close();
});
test('Firebase feed routing stores the same entry representation and returns ordered history',async()=>{
 const {repo,calls,db}=harness(true);
 await repo.save('session','ask',{id:'a',timestamp:10,answer:'earlier'});
 await repo.save('session','ask',{id:'b',timestamp:20,answer:'later'});
 const page=await repo.list('session','ask');assert.deepEqual(Array.from(page.entries,e=>e.answer),['earlier','later']);
 assert.equal(calls[0].uid,'owner');assert.equal(typeof calls[0].data_json,'string');db.close();
});

test('signed-in interview session feeds remain local', {skip: !DatabaseSync && 'Requires Node 22+ node:sqlite'}, async()=>{
 const {repo,calls,db}=harness(true,true);
 await repo.save('interview','ask',{id:'local',question:'Private interview'});
 assert.equal(calls.length,0);assert.equal((await repo.list('interview','ask')).entries.length,1);db.close();
});
