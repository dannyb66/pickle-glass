import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import '../../common/ResponseFontControls.js';

import '../../common/ConversationFeed.js';

export class SummaryView extends LitElement {
    static styles = css`
        :host {
            display: flex;
            flex-direction:column;
            min-height:0;
            width: 100%;
        }

        conversation-feed { flex:1; min-height:0; }
        .text-size-toolbar { flex-shrink:0; }
        /* Inherit font styles from parent */

        /* highlight.js 스타일 추가 */
        .insights-container pre {
            background: rgba(0, 0, 0, 0.4) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            margin: 8px 0 !important;
            overflow-x: auto !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
        }

        .insights-container code {
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important;
            font-size: calc(11px * var(--ai-response-scale, 1)) !important;
            background: transparent !important;
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
        }

        .insights-container pre code {
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
            display: block !important;
        }

        .insights-container p code {
            background: rgba(255, 255, 255, 0.1) !important;
            padding: 2px 4px !important;
            border-radius: 3px !important;
            color: #ffd700 !important;
        }

        .hljs-keyword {
            color: #ff79c6 !important;
        }
        .hljs-string {
            color: #f1fa8c !important;
        }
        .hljs-comment {
            color: #6272a4 !important;
        }
        .hljs-number {
            color: #bd93f9 !important;
        }
        .hljs-function {
            color: #50fa7b !important;
        }
        .hljs-variable {
            color: #8be9fd !important;
        }
        .hljs-built_in {
            color: #ffb86c !important;
        }
        .hljs-title {
            color: #50fa7b !important;
        }
        .hljs-attr {
            color: #50fa7b !important;
        }
        .hljs-tag {
            color: #ff79c6 !important;
        }

        .insights-container {
            overflow-y: auto;
            padding: 12px 16px 16px 16px;
            position: relative;
            z-index: 1;
            box-sizing: border-box;
            height: 100%;
            min-height: 0;
            max-height: 100%;
            overscroll-behavior: contain;
            flex: 1;
        }

        .text-size-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }

        /* Visibility handled by parent component */

        .insights-container::-webkit-scrollbar {
            width: 8px;
        }
        .insights-container::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1);
            border-radius: 4px;
        }
        .insights-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 4px;
        }
        .insights-container::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5);
        }

        insights-title {
            color: rgba(255, 255, 255, 0.8);
            font-size: calc(15px * var(--ai-response-scale, 1));
            font-weight: 500;
            font-family: 'Helvetica Neue', sans-serif;
            margin: 12px 0 8px 0;
            display: block;
        }

        .insights-container h4 {
            color: #ffffff;
            font-size: calc(12px * var(--ai-response-scale, 1));
            font-weight: 600;
            margin: 12px 0 8px 0;
            padding: 4px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: default;
        }

        .insights-container h4:hover {
            background: transparent;
        }

        .insights-container h4:first-child {
            margin-top: 0;
        }

        .outline-item {
            color: #ffffff;
            font-size: calc(11px * var(--ai-response-scale, 1));
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            transition: background-color 0.15s ease;
            cursor: pointer;
            word-wrap: break-word;
        }

        .outline-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .request-item {
            color: #ffffff;
            font-size: calc(12px * var(--ai-response-scale, 1));
            line-height: 1.2;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: default;
            word-wrap: break-word;
            transition: background-color 0.15s ease;
        }

        .request-item.clickable {
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .request-item.clickable:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: translateX(2px);
        }

        /* 마크다운 렌더링된 콘텐츠 스타일 */
        .markdown-content {
            color: #ffffff;
            font-size: calc(11px * var(--ai-response-scale, 1));
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            word-wrap: break-word;
            transition: all 0.15s ease;
        }

        .markdown-content:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: translateX(2px);
        }

        .markdown-content p {
            margin: 4px 0;
        }

        .markdown-content ul,
        .markdown-content ol {
            margin: 4px 0;
            padding-left: 16px;
        }

        .markdown-content li {
            margin: 2px 0;
        }

        .markdown-content a {
            color: #8be9fd;
            text-decoration: none;
        }

        .markdown-content a:hover {
            text-decoration: underline;
        }

        .markdown-content strong {
            font-weight: 600;
            color: #f8f8f2;
        }

        .markdown-content em {
            font-style: italic;
            color: #f1fa8c;
        }

        .empty-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100px;
            color: rgba(255, 255, 255, 0.6);
            font-size: calc(12px * var(--ai-response-scale, 1));
            font-style: italic;
        }
    `;

    static properties = {
        feedPage: {type:Object},
        structuredData: { type: Object },
        sessionId: { type: String },
        requestError: { type: String, state: true },
        isVisible: { type: Boolean },
        hasCompletedRecording: { type: Boolean },
    };

    constructor() {
        super();
        this.structuredData = {
            summary: [],
            topic: { header: '', bullets: [] },
            actions: [],
            followUps: [],
        };
        this.feedEpoch=0;
        this.sessionId = null;
        this.requestError = '';
        this.isVisible = true;
        this.hasCompletedRecording = false;

        // 마크다운 라이브러리 초기화
        this.marked = null;
        this.hljs = null;
        this.isLibrariesLoaded = false;
        this.DOMPurify = null;
        this.isDOMPurifyLoaded = false;

        this.loadLibraries();
    }

    connectedCallback() {
        super.connectedCallback();
        if (window.api) {
            this.feedListener = (event,page) => { this.feedPage=page; this.structuredData=page.entries?.at(-1)?.data || this.structuredData; };
            window.api.summaryView.onFeed(this.feedListener);
            this.reloadFeed();
            this._summaryListener = (event, data) => {
                if (data.sessionId !== this.sessionId) return;
                this.structuredData = data;
                this.requestUpdate();
            };
            window.api.summaryView.onSummaryUpdate(this._summaryListener);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.feedEpoch++;
        if (window.api) {
            window.api.summaryView.removeOnSummaryUpdate(this._summaryListener);
            if(this.feedListener) window.api.summaryView.removeOnFeed(this.feedListener);
        }
    }

    // Handle session reset from parent
    resetAnalysis({reload=true}={}) {
        this.feedEpoch++;
        this.requestError = '';
        this.feedPage={entries:[],sessionId:null,reset:true};
        if(reload)this.reloadFeed();
        this.structuredData = {
            summary: [],
            topic: { header: '', bullets: [] },
            actions: [],
            followUps: [],
        };
        this.requestUpdate();
    }

    async reloadFeed() {
        const epoch=this.feedEpoch;
        try {
            const page=await window.api?.summaryView.getFeed();
            if(page&&epoch===this.feedEpoch){this.feedPage={...page,reset:true};this.structuredData=page.entries?.at(-1)?.data || this.structuredData;}
        } catch(error){if(epoch===this.feedEpoch)this.requestError=error.message;}
    }

    async loadLibraries() {
        try {
            if (!window.marked) {
                await this.loadScript('../assets/marked-4.3.0.min.js');
            }

            if (!window.hljs) {
                await this.loadScript('../assets/highlight-11.9.0.min.js');
            }

            if (!window.DOMPurify) {
                await this.loadScript('../assets/dompurify-3.0.7.min.js');
            }

            this.marked = window.marked;
            this.hljs = window.hljs;
            this.DOMPurify = window.DOMPurify;

            if (this.marked && this.hljs) {
                this.marked.setOptions({
                    highlight: (code, lang) => {
                        if (lang && this.hljs.getLanguage(lang)) {
                            try {
                                return this.hljs.highlight(code, { language: lang }).value;
                            } catch (err) {
                                console.warn('Highlight error:', err);
                            }
                        }
                        try {
                            return this.hljs.highlightAuto(code).value;
                        } catch (err) {
                            console.warn('Auto highlight error:', err);
                        }
                        return code;
                    },
                    breaks: true,
                    gfm: true,
                    pedantic: false,
                    smartypants: false,
                    xhtml: false,
                });

                this.isLibrariesLoaded = true;
                console.log('Markdown libraries loaded successfully');
            }

            if (this.DOMPurify) {
                this.isDOMPurifyLoaded = true;
            window.dispatchEvent(new Event('ai-markdown-ready'));
                console.log('DOMPurify loaded successfully in SummaryView');
            }
        } catch (error) {
            console.error('Failed to load libraries:', error);
        }
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    parseMarkdown(text) {
        if (!text) return '';

        if (!this.isLibrariesLoaded || !this.marked) {
            return text;
        }

        try {
            return this.marked(text);
        } catch (error) {
            console.error('Markdown parsing error:', error);
            return text;
        }
    }

    handleMarkdownClick(originalText) {
        this.handleRequestClick(originalText);
    }

    renderMarkdownContent() {
        if (!this.isLibrariesLoaded || !this.marked) {
            return;
        }

        const markdownElements = this.shadowRoot.querySelectorAll('[data-markdown-id]');
        markdownElements.forEach(element => {
            const originalText = element.getAttribute('data-original-text');
            if (originalText) {
                try {
                    let parsedHTML = this.parseMarkdown(originalText);

                    if (this.isDOMPurifyLoaded && this.DOMPurify) {
                        parsedHTML = this.DOMPurify.sanitize(parsedHTML);

                        if (this.DOMPurify.removed && this.DOMPurify.removed.length > 0) {
                            console.warn('Unsafe content detected in insights, showing plain text');
                            element.textContent = '⚠️ ' + originalText;
                            return;
                        }
                    }

                    element.innerHTML = parsedHTML;
                } catch (error) {
                    console.error('Error rendering markdown for element:', error);
                    element.textContent = originalText;
                }
            }
        });
    }

    async handleRequestClick(requestText, originSessionId = this.sessionId) {
        console.log('🔥 Analysis request clicked:', requestText);

        if (window.api) {
            this.requestError = '';
            try {
                const result = await window.api.summaryView.sendQuestionFromSummary(requestText, originSessionId);

                if (result.success) {
                    console.log('✅ Question sent to AskView successfully');
                } else {
                    this.requestError = result.error;
                    console.error('❌ Failed to send question to AskView:', result.error);
                }
            } catch (error) {
                this.requestError = error.message;
                console.error('❌ Error in handleRequestClick:', error);
            }
        }
    }

    getSummaryText() {
        const data = this.shadowRoot?.querySelector('conversation-feed')?.entries?.at(-1)?.data || this.structuredData || { summary: [], topic: { header: '', bullets: [] }, actions: [] };
        let sections = [];

        if (data.summary && data.summary.length > 0) {
            sections.push(`Current Summary:\n${data.summary.map(s => `• ${s}`).join('\n')}`);
        }

        if (data.topic && data.topic.header && data.topic.bullets.length > 0) {
            sections.push(`\n${data.topic.header}:\n${data.topic.bullets.map(b => `• ${b}`).join('\n')}`);
        }

        if (data.actions && data.actions.length > 0) {
            sections.push(`\nActions:\n${data.actions.map(a => `▸ ${a}`).join('\n')}`);
        }

        if (data.followUps && data.followUps.length > 0) {
            sections.push(`\nFollow-Ups:\n${data.followUps.map(f => `▸ ${f}`).join('\n')}`);
        }

        return sections.join('\n\n').trim();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('sessionId') && this.requestError) this.requestError = '';
        this.renderMarkdownContent();
        this.dispatchEvent(new CustomEvent('insights-content-resized', { bubbles: true, composed: true }));
    }

    render() {
        if (!this.isVisible) return html``;
        return html`<div class="text-size-toolbar"><response-font-controls></response-font-controls></div>
            ${this.requestError ? html`<p role="alert" style="color:#fca5a5;font-size:12px">${this.requestError}</p>` : ''}
            <conversation-feed @feed-question=${event => this.handleRequestClick(event.detail.text, event.detail.sessionId)} .completed=${this.hasCompletedRecording} kind="insights" .page=${this.feedPage}></conversation-feed>`;
    }
}

customElements.define('summary-view', SummaryView);
