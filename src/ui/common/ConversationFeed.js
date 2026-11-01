import { LitElement, html, css } from '../assets/lit-core-2.7.4.min.js';

export class ConversationFeed extends LitElement {
    static properties = { page: {type:Object}, liveEntry: {type:Object}, kind: {type:String}, completed: {type:Boolean}, sessions:{state:true}, entries:{state:true}, unread:{state:true}, hasMore:{state:true}, loading:{state:true}, error:{state:true}, copiedEntryId:{state:true} };
    static styles = css`
        :host { display:flex; flex-direction:column; min-height:0; max-height:100%; overflow:hidden; color:white; }
        .feed { flex:1 1 auto; overflow-y:auto; overflow-anchor:none; max-height:420px; min-height:0; padding:8px 12px; }
        article { user-select:text; border-bottom:1px solid #ffffff30; padding:12px 0; overflow-wrap:anywhere; }
        .session-toolbar { display:flex; align-items:center; gap:8px; padding:6px 12px; border-bottom:1px solid #ffffff12; text-align:left; flex-shrink:0; }
        .session-label { color:#aaa; font:500 9px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; letter-spacing:.07em; text-transform:uppercase; }
        .session-picker { flex:1; min-width:0; max-width:100%; box-sizing:border-box; padding:4px 6px; border-radius:5px; border:1px solid #ffffff18; background:#ffffff08; color:#ccc; font:400 10px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; text-overflow:ellipsis; cursor:pointer; }
        .session-picker:hover { border-color:#ffffff40; }
        .session-picker option { background:#282828; color:#eee; }
        .entry-meta { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; }
        time { color:#999; font:400 10px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-variant-numeric:tabular-nums; }
        .copy-entry { display:inline-flex; align-items:center; justify-content:center; gap:4px; min-height:24px; margin:0; padding:3px 6px; border:1px solid transparent; border-radius:5px; background:transparent; color:#aaa; font:400 10px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        .copy-entry:hover { background:#ffffff0c; border-color:#ffffff20; color:#eee; }
        .copy-entry.copied { color:#a8d5bc; }
        .copy-entry svg { width:12px; height:12px; flex-shrink:0; }
        .copy-entry:focus-visible, .session-picker:focus-visible { outline:2px solid #a8b8d8; outline-offset:2px; }
        h4 { margin:8px 0; font-size:calc(13px * var(--ai-response-scale, 1)); }
        .body { line-height:1.5; font-size:calc(13px * var(--ai-response-scale, 1)); white-space:pre-wrap; } .body:has(p) {white-space:normal;}
        pre { overflow-x:auto; } img {max-width:100%;} .screenshots img {width:90px;height:60px;object-fit:contain;margin:4px;}
        button { background:#ffffff18; color:white; border:1px solid #777; border-radius:5px; padding:6px 10px; margin:3px; cursor:pointer; }
        .notice { padding:6px; text-align:center; }  .error {color:#ffb7b7;font-size:12px;} .empty {color:#bbb;padding:12px;}
    `;
    constructor() {
        super(); this.entries=[]; this.kind='ask'; this.unread=0; this.hasMore=false; this.follow=true; this.loading=false; this.cursor=null; this.ownerEpoch=0;
    }
    connectedCallback() {
        super.connectedCallback();
        this.ownerListener=()=>{this.ownerEpoch++;this.sessions=[];this.page={entries:[],sessionId:null,reset:true};this.liveEntry=null;this.archive=false;};
        window.api?.interview?.onOwnerChanging?.(this.ownerListener);
        this.markdownReadyListener=()=>this.requestUpdate('markdownReady', false);
        window.addEventListener('ai-markdown-ready', this.markdownReadyListener);
    }
    disconnectedCallback() {
        window.api?.interview?.removeOnOwnerChanging?.(this.ownerListener);
        window.removeEventListener('ai-markdown-ready', this.markdownReadyListener);
        this.ownerEpoch++;
        clearTimeout(this.copyTimer);
        super.disconnectedCallback();
    }
    willUpdate(changed) {
        if (changed.has('page') && this.page?.sessionId && !this.sessions?.length) this.refreshSessions();
        const panel=this.shadowRoot?.querySelector('.feed');
        if(panel)this.follow=panel.scrollHeight-panel.scrollTop-panel.clientHeight < 32;
        this.oldHeight=panel?.scrollHeight || 0; this.oldTop=panel?.scrollTop || 0; this.prepending=false;
        this.ignoredPage=this.archive && changed.has('page') && this.page && !this.page.selected && !this.page.reset && this.page.sessionId !== this.sessionId;
        if (this.ignoredPage) return;
        if (changed.has('page') && this.page) {
            const page=this.page;
            if (page.reset && !page.selected) this.archive=false;
            if ((page.sessionId || page.reset) && page.sessionId !== this.sessionId) {
                this.sessionId=page.sessionId; this.entries=[]; this.follow=true; this.unread=0; this.cursor=null;
            }
            const byId=new Map(this.entries.map(e=>[e.id,e]));
            (page.entries || []).forEach(e=>byId.set(e.id,e));
            this.entries=[...byId.values()].sort((a,b)=>a.timestamp-b.timestamp || a.id.localeCompare(b.id));
            this.prepending=!!page.prepend;
            if (page.prepend || !this.cursor) {this.cursor=page.cursor;this.hasMore=!!page.hasMore;}
            this.loading=false;
        }
        if (changed.has('liveEntry') && this.liveEntry && !this.archive) {
            const byId=new Map(this.entries.map(e=>[e.id,e])); byId.set(this.liveEntry.id,this.liveEntry);
            this.entries=[...byId.values()].sort((a,b)=>a.timestamp-b.timestamp || a.id.localeCompare(b.id));
        }
        if (!this.follow && !this.prepending && (changed.has('page') || changed.has('liveEntry'))) this.unread++;
    }
    updated(changed) {
        this.shadowRoot.querySelectorAll('.body').forEach(node=>{
            const text=node.sourceText || '';
            if (window.marked && window.DOMPurify) node.innerHTML=window.DOMPurify.sanitize(window.marked.parse(text));
            else node.textContent=text;
        });
        this.dispatchEvent(new CustomEvent('feed-resized', { bubbles:true, composed:true }));
        const panel=this.shadowRoot.querySelector('.feed');
        if (!this.ignoredPage && (changed.has('page') || changed.has('liveEntry') || changed.has('markdownReady'))) {
            if (this.prepending) panel.scrollTop=this.oldTop + panel.scrollHeight-this.oldHeight;
            else if (this.follow) panel.scrollTop=panel.scrollHeight;
            else panel.scrollTop=this.oldTop;
        }
    }
    async refreshSessions() {
        const epoch=this.ownerEpoch;
        try { const sessions=await window.api[this.kind==='ask'?'askView':'summaryView'].getFeedSessions();if(epoch===this.ownerEpoch)this.sessions=sessions; }
        catch(error) {this.error=error.message;}
    }
    async selectSession(event) {
        const epoch=this.ownerEpoch;
        try {
            this.archive=true;
            const page=await window.api[this.kind==='ask'?'askView':'summaryView'].getFeed(null,event.target.value);
            if(epoch===this.ownerEpoch)this.page={...page,selected:true,reset:true};
        } catch(error) {this.error=error.message;}
    }
    get naturalHeight() {
        const panel=this.shadowRoot?.querySelector('.feed');
        const notices=[...this.shadowRoot?.querySelectorAll('.notice') || []].reduce((sum,node)=>sum+node.offsetHeight,0);
        return Math.min(420, panel?.scrollHeight || 80) + notices;
    }
    scrollByAmount(amount) {
        const panel=this.shadowRoot.querySelector('.feed');panel.scrollTop+=amount;this.onScroll();
    }
    onScroll() {
        const panel=this.shadowRoot.querySelector('.feed');
        this.follow=panel.scrollHeight-panel.scrollTop-panel.clientHeight < 32;
        if (this.follow && this.unread) this.unread=0;
    }
    latest() { this.follow=true; this.unread=0; const panel=this.shadowRoot.querySelector('.feed');panel.scrollTop=panel.scrollHeight; }
    async loadOlder() {
        if (this.loading) return;
        this.loading=true; this.error='';
        const epoch=this.ownerEpoch;
        try {
            const api=this.kind==='ask' ? window.api.askView : window.api.summaryView;
            const page=await api.getFeed(this.cursor,this.sessionId);
            if(epoch===this.ownerEpoch)this.page={...page,prepend:true,selected:true};
        } catch (error) {this.error=error.message;this.loading=false;}
    }
    navigate(direction) {
        const panel=this.shadowRoot.querySelector('.feed'); const cards=[...this.shadowRoot.querySelectorAll('article')];
        const top=panel.getBoundingClientRect().top;
        let target=direction<0 ? [...cards].reverse().find(card=>card.getBoundingClientRect().top < top-4)
            : cards.find(card=>card.getBoundingClientRect().top > top+4);
        if (target) {this.follow=false;panel.scrollTop+=target.getBoundingClientRect().top-top;}
        else if (direction<0 && this.hasMore) void this.loadOlder();
    }
    insightText(data) {
        if (!data) return '';
        return ['**Current Summary**', ...(data.summary||[]).map(t=>`- ${t}`),
            data.topic?.header ? `\n**${data.topic.header}**` : '', ...(data.topic?.bullets||[]).map(t=>`- ${t}`),
            data.topic?.explanation || ''].join('\n');
    }
    sessionDate(session) {
        const date=session.started_at?.toDate ? session.started_at.toDate() : new Date(Number(session.started_at)*1000);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    }
    async copyEntry(entry) {
        const epoch=this.ownerEpoch;
        try {
            await navigator.clipboard.writeText(this.kind==='ask' ? entry.answer || '' : this.insightText(entry.data));
            if(epoch!==this.ownerEpoch)return;
            this.copiedEntryId=entry.id;
            clearTimeout(this.copyTimer);
            this.copyTimer=setTimeout(()=>{this.copiedEntryId=null;},1500);
        } catch(error) {if(epoch===this.ownerEpoch)this.error=error.message;}
    }
    render() {
        return html`<div class="session-toolbar notice"><label class="session-label" for="history-session">Session</label><select id="history-session" class="session-picker" aria-label="History session" @focus=${this.refreshSessions} @change=${this.selectSession} .value=${this.sessionId || ''}>
            ${(this.sessions||[]).map(s=>html`<option value=${s.id} ?selected=${s.id===this.sessionId}>${s.title || s.session_type || 'Session'} · ${this.sessionDate(s)}</option>`)}
        </select></div><div class="feed" tabindex="0" @scroll=${this.onScroll} aria-label=${this.kind==='ask'?'Ask history':'Insight history'}>
            ${this.hasMore ? html`<button @click=${this.loadOlder} ?disabled=${this.loading}>${this.loading?'Loading…':'Load older'}</button>`:''}
            ${this.error ? html`<div class="error">${this.error}</div>`:''}
            ${!this.entries.length ? html`<div class="empty">${this.kind==='ask'?'Ask about your screen or audio.':'No insights yet…'}</div>`:''}
            ${this.entries.map(entry=>html`<article data-entry-id=${entry.id}>
                <div class="entry-meta">
                    <time title=${new Date(entry.timestamp).toLocaleString()}>${new Date(entry.timestamp).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time>
                    <button class="copy-entry ${this.copiedEntryId===entry.id ? 'copied' : ''}" aria-label="Copy entry" title="Copy entry" @click=${()=>this.copyEntry(entry)}>
                        ${this.copiedEntryId===entry.id ? html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>` : html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M10 3H4a1 1 0 0 0-1 1v6"/></svg>`}
                        <span aria-live="polite">${this.copiedEntryId===entry.id ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
                ${this.kind==='ask' ? html`<h4>${entry.question || 'Screen question'}</h4>
                    <div class="screenshots">${(entry.attachments||[]).map(a=>html`<img src=${a.thumbnail} alt="Attached screenshot" />`)}</div>
                    <div class="body" .sourceText=${entry.answer || (entry.status==='streaming'?'Thinking…':'')}></div>
                    ${entry.status==='failed'||entry.status==='cancelled'||entry.status==='interrupted' ? html`<div class="error">${entry.status}: ${entry.error||'Request did not complete. Submit your draft to retry.'}</div>`:''}`
                : html`<div class="body" .sourceText=${this.insightText(entry.data)}></div>
                    ${[...(entry.data?.actions||[]), ...(this.completed ? entry.data?.followUps||[] : [])].map(text=>html`<button @click=${()=>this.dispatchEvent(new CustomEvent('feed-question',{detail:{text,sessionId:this.sessionId},bubbles:true,composed:true}))}>${text}</button>`)}`}
            </article>`)}
        </div>
        ${this.unread ? html`<div class="notice"><button @click=${this.latest}>${this.kind==='ask'?'New answers':'New insights'} ↓</button></div>`:''}`;
    }
}
customElements.define('conversation-feed',ConversationFeed);
