const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
    const sockets = [];
    class Socket {
        static OPEN = 1;
        constructor(url, options) { this.url=url;this.options=options;this.readyState=1;this.sent=[];sockets.push(this); }
        send(data) { this.sent.push(JSON.parse(data)); }
        close() { this.readyState=3; }
        ping() { this.pings=(this.pings||0)+1; }
        receive(message) { this.onmessage({data:JSON.stringify(message)}); }
    }
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/features/common/ai/providers/openai.js'),'utf8'),{
        module,exports:module.exports,console,Buffer,setTimeout,clearTimeout,
        require(name) {
            if(name==='ws')return Socket;
            if(name==='openai')return class {};
            if(name==='portkey-ai')return {};
            if(name==='../factory.js')return {};
            return require(name);
        },
    });
    return {createSTT:module.exports.createSTT,sockets};
}

test('GA session configuration preserves the selected transcription model and has no retired beta header', async()=>{
    const {createSTT,sockets}=harness();
    const pending=createSTT({apiKey:'synthetic-only',model:'gpt-4o-mini-transcribe',language:'en'});
    const socket=sockets[0];socket.onopen();
    const request=socket.sent[0];
    assert.equal(socket.options.headers['OpenAI-Beta'],undefined);
    assert.equal(request.type,'session.update');assert.equal(request.session.type,'transcription');
    assert.equal(request.session.audio.input.format.type,'audio/pcm');
    assert.equal(request.session.audio.input.format.rate,24000);
    assert.equal(request.session.audio.input.transcription.model,'gpt-4o-mini-transcribe');
    socket.receive({type:'session.updated',session:{type:'transcription'}});
    const session=await pending;session.sendRealtimeInput('synthetic-pcm');
    assert.equal(socket.sent[1].type,'input_audio_buffer.append');
    assert.equal(socket.sent[1].audio,'synthetic-pcm');session.close();
    assert.equal(socket.sent.some(event=>event.type==='session.close'),false);
});

test('socket open and session.created do not report initialization success before server acknowledgement', async()=>{
    const {createSTT,sockets}=harness();let ready=false;
    const pending=createSTT({apiKey:'synthetic-only'}).then(session=>{ready=true;return session;});
    sockets[0].onopen();sockets[0].receive({type:'session.created',session:{type:'transcription'}});
    await Promise.resolve();await Promise.resolve();assert.equal(ready,false);
    sockets[0].receive({type:'session.updated',session:{type:'transcription'}});
    (await pending).close();assert.equal(ready,true);
});

test('server rejection and pre-configuration close reject initialization rather than yielding a broken session', async()=>{
    for(const event of ['error','close']){
        const {createSTT,sockets}=harness();const pending=createSTT({apiKey:'synthetic-only'});
        sockets[0].onopen();
        if(event==='error')sockets[0].receive({type:'error',error:{message:'Configuration rejected'}});
        else sockets[0].onclose({code:4000});
        await assert.rejects(pending,/rejected|closed before/);
    }
});

test('accepted sessions forward real transcript events and cannot send into a closed connection', async()=>{
    const {createSTT,sockets}=harness();const messages=[];
    const pending=createSTT({apiKey:'synthetic-only',callbacks:{onmessage:message=>messages.push(message)}});
    const socket=sockets[0];socket.onopen();socket.receive({type:'session.updated',session:{type:'transcription'}});
    const session=await pending;socket.receive({type:'conversation.item.input_audio_transcription.completed',transcript:'Synthetic transcript'});
    assert.equal(messages.at(-1).transcript,'Synthetic transcript');assert.equal(messages.at(-1).provider,'openai');
    socket.onclose({code:1000});assert.throws(()=>session.sendRealtimeInput('pcm'),/not ready/);
});
