const {app,BrowserWindow}=require('electron'); const assert=require('node:assert/strict');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:650,height:800,webPreferences:{nodeIntegration:true,contextIsolation:false}});
try{
 await win.loadURL('file://'+process.cwd()+'/src/ui/common/ConversationFeed.js');
 const result=await win.webContents.executeJavaScript(`(async()=>{
 document.body.innerHTML='';
 window.api={askView:{getFeedSessions:async()=>[{id:'session',title:'Test',started_at:1}],getFeed:async()=>({entries:[],hasMore:false,sessionId:'session'})}};
 await import('file://${process.cwd()}/src/ui/common/ConversationFeed.js');
 const feed=document.createElement('conversation-feed');document.body.append(feed);
 const make=(n)=>({id:'entry-'+String(n).padStart(2,'0'),timestamp:n+1,question:'Question '+n,answer:'Answer '+n+'\\n'+('Long content\\n'.repeat(10)),status:'complete'});
 feed.page={sessionId:'session',entries:Array.from({length:20},(_,i)=>make(i+20)),hasMore:true,cursor:{timestamp:21,id:'entry-20'}};
 await feed.updateComplete;await new Promise(r=>requestAnimationFrame(r));
 const panel=feed.shadowRoot.querySelector('.feed');
 const initial=feed.shadowRoot.querySelectorAll('article').length;
 panel.scrollTop=100;feed.onScroll();const before=panel.scrollTop;
 feed.liveEntry=make(40);await feed.updateComplete;
 const preserved=panel.scrollTop===before;const notice=feed.unread>0;
 feed.latest();const follows=panel.scrollHeight-panel.scrollTop-panel.clientHeight<5;
 panel.scrollTop=100;feed.onScroll();const oldHeight=panel.scrollHeight;const oldTop=panel.scrollTop;
 feed.page={sessionId:'session',entries:Array.from({length:20},(_,i)=>make(i)),prepend:true,hasMore:false};await feed.updateComplete;
 const prependPreserved=Math.abs(panel.scrollTop-(oldTop+panel.scrollHeight-oldHeight))<2;
 const total=feed.shadowRoot.querySelectorAll('article').length;
 feed.page={sessionId:'second',entries:[make(1)],reset:true};await feed.updateComplete;
 return {initial,preserved,notice,follows,prependPreserved,total,resetCount:feed.shadowRoot.querySelectorAll('article').length};
 })()`);
 assert.deepEqual(result,{initial:20,preserved:true,notice:true,follows:true,prependPreserved:true,total:41,resetCount:1});
 console.log('PASS Electron feeds: chronological append, preserved scroll, new-update notice, follow latest, older-page prepend, session isolation');
}catch(e){console.error(e);process.exitCode=1;}finally{win.destroy();app.quit();}});
