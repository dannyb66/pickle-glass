import { LitElement, html, css } from '../assets/lit-core-2.7.4.min.js';

export class ConversationFeed extends LitElement {
    static properties = { page: {type:Object}, liveEntry: {type:Object}, kind: {type:String}, completed: {type:Boolean}, sessions:{state:true}, entries:{state:true}, unread:{state:true}, hasMore:{state:true}, loading:{state:true}, error:{state:true} };
    static styles = css`
        :host { display:flex; flex-direction:column; min-height:0; max-height:100%; overflow:hidden; color:white; }
        .feed { flex:1 1 auto; overflow-y:auto; overflow-anchor:none; max-height:420px; min-height:0; padding:8px 12px; }
        article { user-select:text; border-bottom:1px solid #ffffff30; padding:12px 0; overflow-wrap:anywhere; }
        time { color:#bbb; font-size:11px; } h4 { margin:8px 0; font-size:calc(13px * var(--ai-response-scale, 1)); }
        .body { line-height:1.5; font-size:calc(13px * var(--ai-response-scale, 1)); white-space:pre-wrap; } .body:has(p) {white-space:normal;}
        pre { overflow-x:auto; } img {max-width:100%;} .screenshots img {width:90px;height:60px;object-fit:contain;margin:4px;}
        button { background:#ffffff18; color:white; border:1px solid #777; border-radius:5px; padding:6px 10px; margin:3px; cursor:pointer; }
        .notice { padding:6px; text-align:center; } select {max-width:95%;background:#333;color:white;border:1px solid #777;} .error {color:#ffb7b7;font-size:12px;} .empty {color:#bbb;padding:12px;}
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
    render() {
        return html`<div class="notice"><label>Session <select aria-label="History session" @focus=${this.refreshSessions} @change=${this.selectSession} .value=${this.sessionId || ''}>
            ${(this.sessions||[]).map(s=>html`<option value=${s.id} ?selected=${s.id===this.sessionId}>${s.title || s.session_type || 'Session'} · ${s.started_at?.toDate ? s.started_at.toDate().toLocaleString() : new Date(Number(s.started_at)*1000).toLocaleString()}</option>`)}
        </select></label></div><div class="feed" tabindex="0" @scroll=${this.onScroll} aria-label=${this.kind==='ask'?'Ask history':'Insight history'}>
            ${this.hasMore ? html`<button @click=${this.loadOlder} ?disabled=${this.loading}>${this.loading?'Loading…':'Load older'}</button>`:''}
            ${this.error ? html`<div class="error">${this.error}</div>`:''}
            ${!this.entries.length ? html`<div class="empty">${this.kind==='ask'?'Ask about your screen or audio.':'No insights yet…'}</div>`:''}
            ${this.entries.map(entry=>html`<article data-entry-id=${entry.id}>
                <time>${new Date(entry.timestamp).toLocaleTimeString()}</time>
                <button aria-label="Copy entry" @click=${()=>navigator.clipboard.writeText(this.kind==='ask' ? entry.answer || '' : this.insightText(entry.data)).catch(error=>{this.error=error.message;})}>Copy</button>
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
