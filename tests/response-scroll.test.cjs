const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness(top) {
    let Ask;
    const source = fs.readFileSync(require.resolve('../src/ui/ask/AskView.js'), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class AskView', 'class AskView');
    let scrollTop = top;
    const content = { scrollHeight: 1000, clientHeight: 200, querySelectorAll: () => [] };
    Object.defineProperty(content, 'scrollTop', { get: () => scrollTop, set: value => { scrollTop = Math.max(0, Math.min(value, content.scrollHeight - content.clientHeight)); } });
    vm.runInNewContext(source, {
        LitElement: class {}, html() {}, css() {}, window: {}, console: { log() {}, error() {} },
        customElements: { define: (_name, constructor) => { Ask = constructor; } },
        parser_write: () => { content.scrollHeight += 100; }, parser_end() {},
    });
    Ask.prototype.loadLibraries = () => {};
    const view = new Ask();
    Object.assign(view, { smdParser: {}, smdContainer: content, currentResponse: 'new streamed text', isStreaming: true, isLoading: false, hljs: null });
    return { view, content };
}
test('streaming Chat preserves the reading position after the user scrolls up', () => {
    const { view, content } = harness(100);
    view.renderStreamingMarkdown(content);
    assert.equal(content.scrollHeight, 1100);
    assert.equal(content.scrollTop, 100);
});
test('Chat continues following new output when already at the bottom', () => {
    const { view, content } = harness(800);
    view.renderStreamingMarkdown(content);
    assert.equal(content.scrollTop, 900);
});
