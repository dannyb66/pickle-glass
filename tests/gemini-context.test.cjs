const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
    const calls = [];
    const configs = [];
    class GoogleGenerativeAI {
        getGenerativeModel(config) {
            configs.push(config);
            return {
                generateContent: async request => { calls.push(request); return { response: { text: () => 'Answer with evidence' } }; },
                generateContentStream: async request => {
                    calls.push(request);
                    return { stream: (async function* () { yield { text: () => 'Answer with evidence' }; })() };
                },
            };
        }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/features/common/ai/providers/gemini'), 'utf8'), {
        module, exports: module.exports, ReadableStream, Response, TextEncoder,
        console: { log() {}, error() {} }, require(name) {
            if (name === '@google/generative-ai') return { GoogleGenerativeAI };
            if (name === '@google/genai') return {};
            throw new Error(name);
        },
    });
    return { ...module.exports, calls, configs };
}

const messages = [
    { role: 'system', content: 'Trusted interview rules' },
    { role: 'system', content: 'Keep source evidence separate' },
    { role: 'user', content: 'RESUME: candidate built Orchid. JD: Staff platform role.' },
    { role: 'user', content: 'OBSERVATION: 2000 requests per second.' },
    { role: 'assistant', content: 'Prior answer about reliability.' },
    { role: 'user', content: [{ type: 'text', text: 'How should I explain that experience?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,c2NyZWVu' } }] },
];

for (const streaming of [false, true]) {
    test(`Gemini ${streaming ? 'streaming' : 'chat'} keeps resume, job role, observations, history and screenshot`, async () => {
        const h = harness();
        const llm = (streaming ? h.createStreamingLLM : h.createLLM)({ apiKey: 'synthetic' });
        const result = await (streaming ? llm.streamChat(messages) : llm.chat(messages));
        if (streaming) {
            const text = await result.text();
            assert.match(text, /Answer with evidence/);
            assert.match(text, /data: \[DONE\]/);
        } else assert.equal(result.content, 'Answer with evidence');
        const request = JSON.parse(JSON.stringify(h.calls[0]));
        assert.match(h.configs[0].systemInstruction, /Trusted interview rules/);
        assert.match(h.configs[0].systemInstruction, /Keep source evidence separate/);
        const text = request.contents.flatMap(c => c.parts).map(p => p.text || '').join('\n');
        for (const evidence of ['RESUME: candidate built Orchid', 'JD: Staff platform role', '2000 requests', 'Prior answer', 'How should I explain']) assert.ok(text.includes(evidence), evidence);
        assert.deepEqual(request.contents.map(c => c.role), ['user', 'model', 'user']);
        assert.deepEqual(request.contents[2].parts[1].inlineData, { mimeType: 'image/jpeg', data: 'c2NyZWVu' });
        assert.ok(!text.includes('Trusted interview rules'), 'trusted instructions stay out of source data');
    });
}

test('Gemini rejects unsupported screenshot URLs rather than dropping them silently', async () => {
    const h = harness();
    await assert.rejects(h.createStreamingLLM({ apiKey: 'synthetic' }).streamChat([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }]), /inline image/);
    assert.equal(h.calls.length, 0);
});
