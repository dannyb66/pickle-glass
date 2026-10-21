import { html, css, LitElement } from '../assets/lit-core-2.7.4.min.js';

const STORAGE_KEY = 'ai-response-font-percent';
const CHANGE_EVENT = 'ai-response-font-preference-changed';
const MIN_PERCENT = 75;
const MAX_PERCENT = 150;
function normalize(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, Math.round(number))) : 100;
}
function readPreference() {
    try { return normalize(localStorage.getItem(STORAGE_KEY)); } catch { return 100; }
}

export class ResponseFontControls extends LitElement {
    static properties = { percent: { type: Number, state: true } };
    static styles = css`
        :host { display: inline-flex; flex-shrink: 0; }
        .controls { display: inline-flex; align-items: center; gap: 2px; }
        button { border: 1px solid rgba(255,255,255,.2); border-radius: 4px;
            background: rgba(255,255,255,.06); color: rgba(255,255,255,.9);
            font: 11px system-ui, sans-serif; height: 22px; min-width: 24px;
            padding: 0 4px; cursor: pointer; }
        button:hover { background: rgba(255,255,255,.16); }
        button:focus-visible { outline: 2px solid #70b7ff; outline-offset: 1px; }
        button:disabled { opacity: .4; cursor: default; }
        .reset { min-width: 36px; font-variant-numeric: tabular-nums; }
    `;
    constructor() {
        super();
        this.percent = readPreference();
        this.handlePreferenceChange = event => {
            if (event.type === 'storage' && event.key !== STORAGE_KEY && event.key !== null) return;
            this.applyPreference(event.type === CHANGE_EVENT ? event.detail : readPreference());
        };
    }
    connectedCallback() {
        super.connectedCallback();
        window.addEventListener(CHANGE_EVENT, this.handlePreferenceChange);
        window.addEventListener('storage', this.handlePreferenceChange);
        // Defer the resize notification until the parent has finished rendering.
        this.updateComplete.then(() => { if (this.isConnected) this.applyPreference(readPreference()); });
    }
    disconnectedCallback() {
        window.removeEventListener(CHANGE_EVENT, this.handlePreferenceChange);
        window.removeEventListener('storage', this.handlePreferenceChange);
        super.disconnectedCallback();
    }
    applyPreference(value) {
        this.percent = normalize(value);
        document.documentElement.style.setProperty('--ai-response-scale', String(this.percent / 100));
        this.dispatchEvent(new CustomEvent('response-font-size-changed', { bubbles: true, composed: true }));
    }
    setPercent(value) {
        const percent = normalize(value);
        try { localStorage.setItem(STORAGE_KEY, String(percent)); } catch { /* Keep working when storage is unavailable. */ }
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: percent }));
    }
    render() {
        return html`<div class="controls" role="group" aria-label="AI response text size">
            <button type="button" title="Decrease AI response font size" aria-label="Decrease AI response font size"
                ?disabled=${this.percent <= MIN_PERCENT} @click=${() => this.setPercent(this.percent - 5)}>A−</button>
            <button type="button" class="reset" title="Reset AI response font size to 100%" aria-label="Reset AI response font size to 100%"
                @click=${() => this.setPercent(100)}>${this.percent}%</button>
            <button type="button" title="Increase AI response font size" aria-label="Increase AI response font size"
                ?disabled=${this.percent >= MAX_PERCENT} @click=${() => this.setPercent(this.percent + 5)}>A+</button>
        </div>`;
    }
}
customElements.define('response-font-controls', ResponseFontControls);
