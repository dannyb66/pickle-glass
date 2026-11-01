const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const images = ['Zmlyc3Q=', 'c2Vjb25k'];
const messages = [{role:'system', content:'Read both screenshots'}, {role:'user',content:[
    {type:'text',text:'Compare'}, ...images.map(data => ({type:'image_url',image_url:{url:`data:image/jpeg;base64,${data}`}}))
]}];
function load(name, overrides={}) {
    const module = {exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,`../src/features/common/ai/providers/${name}.js`),'utf8'), {
        module, exports:module.exports, ReadableStream, Response, TextEncoder, TextDecoder, Buffer,
        console:{log(){},warn(){},error(){}},
        fetch:overrides.fetch,
        require: id => id in overrides ? overrides[id] : (id === '../factory.js' ? {} : require(id)),
    });
    return module.exports;
}
test('OpenAI keeps multiple screenshots in request order', async () => {
    let body;
    const provider = load('openai', {fetch:async (url, options) => {body=JSON.parse(options.body); return {ok:true};}});
    await provider.createStreamingLLM({apiKey:'synthetic'}).streamChat(messages);
    assert.deepEqual(body.messages[1].content.slice(1).map(p=>p.image_url.url.split(',')[1]), images);
});
test('Anthropic translates every screenshot to a JPEG image block', async () => {
    let payload;
    class Anthropic { constructor() {this.messages={create:async value => {payload=value; return (async function*(){})();}};} }
    const provider=load('anthropic', {'@anthropic-ai/sdk':{Anthropic}});
    await (await provider.createStreamingLLM({apiKey:'synthetic'}).streamChat(messages)).text();
    const blocks=payload.messages[0].content.filter(p=>p.type==='image');
    assert.deepEqual(Array.from(blocks,p=>p.source.data),images);
    assert.ok(blocks.every(p=>p.source.media_type==='image/jpeg'));
});
test('Gemini preserves JPEG MIME type and screenshot order', async () => {
    let payload;
    class GoogleGenerativeAI {getGenerativeModel(){return {generateContentStream:async value=>{payload=value;return {stream:(async function*(){})()};}};}}
    const provider=load('gemini', {'@google/generative-ai':{GoogleGenerativeAI},'@google/genai':{}});
    await (await provider.createStreamingLLM({apiKey:'synthetic'}).streamChat(messages)).text();
    const blocks=payload.contents[0].parts.filter(p=>p.inlineData);
    assert.deepEqual(Array.from(blocks,p=>p.inlineData.data),images);
    assert.ok(blocks.every(p=>p.inlineData.mimeType==='image/jpeg'));
});
test('Ollama preserves all screenshots for vision models', () => {
    const provider=load('ollama');
    const converted=provider.convertMessagesToOllamaFormat(messages);
    assert.deepEqual(Array.from(converted[1].images),images);
});
