// Run after build:renderer: node_modules/.bin/electron tests/panel-interaction.electron.cjs
// Real production HTML/bundle and native Chromium input; all provider APIs are synthetic.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-panel-qa-'));
app.setPath('userData', path.join(temporary, 'user-data'));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stub = `<base href="${pathToFileURL(path.join(root, 'src/ui/app/')).href}"><script>
window.qa={listeners:{},sent:[],state:{phase:'idle',sessionId:null,autoEnabled:true,data:null}};
const group=name=>new Proxy({}, {get:(_,key)=> {
  if(key==='getState')return async()=>qa.state;
  if(key==='getFeed')return async()=>({entries:[],hasMore:false,sessionId:'synthetic'});
  if(key==='getFeedSessions')return async()=>[{id:'synthetic',title:'Synthetic session',started_at:1}];
  if(key==='getAttachments')return async()=>({attachments:[]});
  if(key==='sendMessage')return async text=>{qa.sent.push(text);return {success:true}};
  if(key.startsWith('on'))return callback=>{qa.listeners[name+'.'+key]=callback};
  if(key.startsWith('removeOn'))return callback=>{const keyName=name+'.on'+key.slice(8);if(qa.listeners[keyName]===callback)delete qa.listeners[keyName]};
  return ()=>{};
}});
window.api=new Proxy({}, {get:(_,name)=>group(name)});
</script>`;
const fixture = path.join(temporary, 'panels.html');
fs.writeFileSync(fixture, fs.readFileSync(path.join(root, 'src/ui/app/content.html'), 'utf8').replace('<head>', '<head>'+stub));
const getView = `document.querySelector('pickle-glass-app').shadowRoot.querySelector('ask-view, listen-view')`;
async function evaluate(win, expression) { return win.webContents.executeJavaScript(expression, true); }
async function geometry(win, type) {
    return evaluate(win, `(()=>{const e=${getView},c=${type==='ask' ? "e.shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed')" : "e.shadowRoot.querySelector('summary-view').shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed')"};return {viewport:innerHeight,viewHeight:e.getBoundingClientRect().height,top:c.scrollTop,height:c.clientHeight,total:c.scrollHeight,bottom:c.getBoundingClientRect().bottom,inputBottom:e.shadowRoot.querySelector('.text-input-container')?.getBoundingClientRect().bottom,footerBottom:e.shadowRoot.querySelector('.analysis-meta')?.getBoundingClientRect().bottom}})()`);
}
async function wheel(win, type) {
    const before = await geometry(win, type);
    const point = await evaluate(win, `(()=>{const e=${getView},c=${type==='ask' ? "e.shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed')" : "e.shadowRoot.querySelector('summary-view').shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed')"};const r=c.getBoundingClientRect();return{x:Math.round(r.left+100),y:Math.round(r.top+Math.min(80,r.height/2))}})()`);
    for(let attempt=0;attempt<3;attempt++){
        app.focus({steal:true});win.moveTop();win.focus();win.webContents.focus();
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseWheel',...point,deltaX:0,deltaY:180});
        await pause(300);
        if((await geometry(win,type)).top>before.top)break;
    }
    const after=await geometry(win,type); assert.ok(after.top>before.top, `${type}: native wheel must scroll: ${JSON.stringify({before,after,point})}`);
}
async function run(type, glass = false) {
    const win = new BrowserWindow({width:type==='ask'?600:400,height:500,frame:false,show:false,webPreferences:{backgroundThrottling:false}});
    win.webContents.on('console-message', (_event, level, message, line, source) => {if(level>=2) console.error('Renderer:',message,source,line);});
    try {
        await win.loadFile(fixture, {query:{view:type,...(glass ? {glass:'true'} : {})}});
        await pause(250);
        app.focus({steal:true}); win.show(); win.focus(); win.webContents.focus(); win.webContents.debugger.attach('1.3');
        await evaluate(win, `(async()=>{const e=${getView};${type==='ask' ? `e.currentQuestion='Synthetic question';e.currentResponse=Array(100).fill('Synthetic long answer about queue fairness.').join('\\n\\n');e.isStreaming=true;e.showTextInput=true;` : `e.analysisState={phase:'updated',sessionId:'synthetic',autoEnabled:true,data:{summary:Array(5).fill('Synthetic insight '.repeat(180)),topic:{header:'Topic',bullets:[]},actions:[],followUps:[]}};`}await e.updateComplete})()`);
        await evaluate(win, `(async()=>{const e=${getView};${type==='ask' ? `e.liveEntry={id:'synthetic',timestamp:1,question:e.currentQuestion,answer:e.currentResponse,status:'streaming'};await e.updateComplete;` : `const summary=e.shadowRoot.querySelector('summary-view');summary.feedPage={sessionId:'synthetic',entries:[{id:'insight',timestamp:1,data:e.analysisState.data}]};await summary.updateComplete;`}await new Promise(r=>requestAnimationFrame(r))})()`);
        await pause(100);
        const initial = await geometry(win,type);
        assert.ok(initial.viewHeight<=initial.viewport+1, `${type}: panel must fit the actual app window: ${JSON.stringify(initial)}`);
        assert.ok(initial.total>initial.height, `${type}: long content must overflow its scroll viewport`);
        assert.ok(initial.bottom<=initial.viewport+1, `${type}: scroller must stay inside the window`);
        if(type==='ask')assert.ok(initial.inputBottom<=initial.viewport+1, 'Ask composer must stay visible');
        else assert.ok(initial.footerBottom<=initial.viewport+1, 'Insights footer must stay visible');
        await evaluate(win, `(()=>{const e=${getView},c=${type==='ask' ? "e.shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed')" : "e.shadowRoot.querySelector('summary-view').shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed')"};c.scrollTop=100})()`);
        await wheel(win,type);
        await evaluate(win, `(()=>{const e=${getView};qa.listeners['${type==='ask'?'askView.onScrollResponseDown':'insights.onScrollDown'}']()})()`);
        const afterKeyboard=await geometry(win,type);
        assert.ok(afterKeyboard.top>280, `${type}: shortcut must scroll`);
        if(type==='ask') {
            await evaluate(win, `(()=>{const e=${getView};e.shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed').scrollTop=200;e.currentResponse+='\\n\\nMore streamed content.';e.liveEntry={...e.liveEntry,answer:e.currentResponse}})()`);
            await pause(100);
            assert.equal((await geometry(win,type)).top,200,'Streaming preserves the reading position');
            await evaluate(win, `(()=>{const e=${getView};qa.listeners['askView.onAskStateUpdate']({}, {currentResponse:e.currentResponse,currentQuestion:e.currentQuestion,isStreaming:true,isLoading:false,showTextInput:false})})()`);
            await pause(100);
            assert.ok((await geometry(win,type)).inputBottom<=500,'Composer remains visible while streaming');
            assert.equal(await evaluate(win, `getComputedStyle((${getView}).shadowRoot.querySelector('.text-input-container')).opacity`),'1','Composer is not hidden by stream state');
            await evaluate(win, `qa.listeners['askView.onShowTextInput']({}, {})`);
            await pause(100);
            assert.equal(await evaluate(win, `(${getView}).shadowRoot.activeElement?.id`),'textInput','Composer receives DOM focus');
            await win.webContents.debugger.sendCommand('Input.insertText',{text:'Follow-up draft'});
            assert.equal(await evaluate(win, `(${getView}).shadowRoot.querySelector('#textInput').value`),'Follow-up draft','Typing works without clicking the composer');
            await evaluate(win, `(()=>{const e=${getView};qa.listeners['askView.onAskStateUpdate']({}, {currentResponse:e.currentResponse+' More tokens.',currentQuestion:e.currentQuestion,isStreaming:true,isLoading:false})})()`);
            await pause(100);
            assert.equal(await evaluate(win, `(${getView}).shadowRoot.querySelector('#textInput').value`),'Follow-up draft','Incoming tokens preserve the unsent draft');
            // A control deliberately focused inside Chat must not lose focus on each token.
            await evaluate(win, `(()=>{const e=${getView};e.shadowRoot.querySelector('.copy-button').focus();qa.listeners['askView.onAskStateUpdate']({}, {currentResponse:e.currentResponse+' More tokens.',isStreaming:true,isLoading:false})})()`);
            await pause(100);
            assert.equal(await evaluate(win, `(${getView}).shadowRoot.activeElement?.classList.contains('copy-button')`),true,'Stream updates do not steal focus from other controls');
            const other=new BrowserWindow({width:200,height:100,show:true});
            try {
                await other.loadURL('about:blank'); other.focus(); await pause(150);
                for(let attempt=0;attempt<5&&!win.isFocused();attempt++){app.focus({steal:true});win.show();win.moveTop();win.focus();win.webContents.focus();await pause(200);}
                assert.equal(win.isFocused(),true,'Ask window can regain native focus');
                assert.equal(await evaluate(win, `(${getView}).shadowRoot.activeElement?.id`),'textInput','Returning to Ask restores composer focus');
                assert.equal(await evaluate(win, `(${getView}).shadowRoot.querySelector('#textInput').value`),'Follow-up draft','Switching windows preserves the draft');
            } finally {other.destroy();}
            await evaluate(win, `(()=>{const e=${getView};e.isStreaming=false;e.isLoading=false;qa.listeners['askView.onShowTextInput']({}, {submit:true})})()`);
            await pause(100);
            assert.equal(await evaluate(win, `qa.sent.at(-1).text`),'Follow-up draft','Cmd+Enter submits the actual draft');
            await evaluate(win, `(()=>{const e=${getView},c=e.shadowRoot.querySelector('conversation-feed').shadowRoot.querySelector('.feed');c.scrollTop=c.scrollHeight;e.currentResponse+='\\n\\nFollowing the newest output.';e.liveEntry={...e.liveEntry,answer:e.currentResponse}})()`);
            await pause(100);
            const bottom=await geometry(win,type);
            assert.ok(bottom.total-bottom.top-bottom.height<2,'Streaming follows when already at the bottom');
        } else {
            await evaluate(win, `(()=>{const e=${getView};e.analysisState={...e.analysisState,phase:'analyzing',progress:'Updated status'}})()`);
            await pause(100);
            assert.equal((await geometry(win,type)).top,afterKeyboard.top,'Insights status updates preserve reading position');
        }
        for(const height of [320,700]) {
            win.setSize(type==='ask'?600:400,height);
            await pause(100);
            const resized=await geometry(win,type);
            assert.ok(resized.viewHeight<=resized.viewport+1, `${type}: resize to ${height} stays bounded`);
            if(type==='ask')assert.ok(resized.inputBottom<=resized.viewport+1,'Composer stays visible after resize');
        }
        win.hide();win.show();win.focus();await pause(150);
        if(type==='ask')assert.equal(await evaluate(win, `(${getView}).shadowRoot.activeElement?.id`),'textInput','Reopening Ask restores typing focus');
        console.log(`PASS ${type}${glass ? ' (glass appearance)' : ''}: production layout, native wheel, shortcuts, updates and resize`,JSON.stringify(initial));
    } finally { win.destroy(); }
}
app.whenReady().then(async()=>{try{for(const glass of [false,true]){await run('ask',glass);await run('listen',glass)}app.quit()}catch(error){console.error(error);app.exit(1)}});
process.on('exit',()=>fs.rmSync(temporary,{recursive:true,force:true}));
