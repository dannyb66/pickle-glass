const {app}=require('electron');const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
app.whenReady().then(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glass-feed-'));const root=process.cwd();const sqlite=require(root+'/src/features/common/services/sqliteClient');
try{
 const filename=path.join(dir,'test.db');sqlite.connect(filename);await sqlite.synchronizeSchema();
 const sessions=require(root+'/src/features/common/repositories/session/sqlite.repository');const id=sessions.create('synthetic');
 sqlite.getDb().prepare('INSERT INTO ai_messages(id,session_id,role,content) VALUES(?,?,?,?)').run('legacy',id,'user','Old question');
 sqlite.getDb().exec('DROP TABLE feed_entries');await sqlite.synchronizeSchema();
 assert.equal(sqlite.getDb().prepare('SELECT content FROM ai_messages WHERE id=?').get('legacy').content,'Old question');
 const mocks={'../../services/sqliteClient':sqlite,'../../services/authService':{getCurrentUser:()=>({isLoggedIn:false}),getCurrentUserId:()=> 'synthetic'},'../../services/interviewContextService':{isLocalSession:()=>false},'../../services/firebaseClient':{},'../firestoreConverter':{createEncryptedConverter:()=>({})},'firebase/firestore':{}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(root+'/src/features/common/repositories/feed/index.js','utf8'),{module,exports:module.exports,require:id=>mocks[id]||require(id)});
 const feed=module.exports;await feed.save(id,'ask',{id:'first',timestamp:1,question:'Q',answer:'A',status:'complete'});
 await feed.save(id,'insights',{id:'insight',timestamp:2,data:{summary:['Insight']}});
 sqlite.close();sqlite.connect(filename);await sqlite.synchronizeSchema();assert.equal((await feed.list(id,'ask')).entries[0].answer,'A');
 sessions.deleteWithRelatedData(id);assert.equal(sqlite.getDb().prepare('SELECT count(*) AS n FROM feed_entries').get().n,0);
 console.log('PASS native Electron SQLite: schema upgrade preserves old messages, feeds survive reopen, session deletion cleans both feeds');
}catch(e){console.error(e);process.exitCode=1;}finally{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});app.quit();}});
