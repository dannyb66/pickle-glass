import { LitElement, html, css } from '../assets/lit-core-2.7.4.min.js';

export class PermissionHeader extends LitElement {
    static styles = css`
        :host {
            display: block;
            transition: opacity 0.3s ease-in, transform 0.3s ease-in;
            will-change: opacity, transform;
        }

        :host(.sliding-out) {
            opacity: 0;
            transform: translateY(-20px);
        }

        :host(.hidden) {
            opacity: 0;
            pointer-events: none;
        }

        * {
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: default;
            user-select: none;
            box-sizing: border-box;
        }

        .container {
            -webkit-app-region: drag;
            width: 320px;
            /* height is now set dynamically */
            padding: 18px 20px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .container::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 16px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .close-button {
            -webkit-app-region: no-drag;
            position: absolute;
            top: 10px;
            right: 10px;
            width: 14px;
            height: 14px;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 3px;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
            z-index: 10;
            font-size: 14px;
            line-height: 1;
            padding: 0;
        }

        .close-button:hover {
            background: rgba(255, 255, 255, 0.2);
            color: rgba(255, 255, 255, 0.9);
        }

        .close-button:active {
            transform: scale(0.95);
        }

        .title {
            color: white;
            font-size: 16px;
            font-weight: 500;
            margin: 0;
            text-align: center;
            flex-shrink: 0;
        }

        .form-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            margin-top: 12px;
        }

        .form-content.all-granted {
            flex-grow: 1;
            justify-content: center;
            margin-top: 0;
        }

        .subtitle {
            color: rgba(255, 255, 255, 0.7);
            font-size: 11px;
            font-weight: 400;
            text-align: center;
            margin-bottom: 12px;
            line-height: 1.3;
        }

        .permission-status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 12px;
            min-height: 20px;
        }

        .permission-item {
            display: flex;
            align-items: center;
            gap: 6px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 11px;
            font-weight: 400;
        }

        .permission-item.granted {
            color: rgba(34, 197, 94, 0.9);
        }

        .permission-icon {
            width: 12px;
            height: 12px;
            opacity: 0.8;
        }

        .check-icon {
            width: 12px;
            height: 12px;
            color: rgba(34, 197, 94, 0.9);
        }

        .action-button {
            -webkit-app-region: no-drag;
            width: 100%;
            height: 34px;
            background: rgba(255, 255, 255, 0.2);
            border: none;
            border-radius: 10px;
            color: white;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
            position: relative;
            overflow: hidden;
            margin-bottom: 6px;
        }

        .action-button::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 10px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .action-button:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.3);
        }

        .action-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .continue-button {
            -webkit-app-region: no-drag;
            width: 100%;
            height: 34px;
            background: rgba(34, 197, 94, 0.8);
            border: none;
            border-radius: 10px;
            color: white;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
            position: relative;
            overflow: hidden;
            margin-top: 4px;
        }

        .continue-button::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 10px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .continue-button:hover:not(:disabled) {
            background: rgba(34, 197, 94, 0.9);
        }

        .continue-button:disabled {
            background: rgba(255, 255, 255, 0.2);
            cursor: not-allowed;
        }
        
        /* ────────────────[ GLASS BYPASS ]─────────────── */
        :host-context(body.has-glass) .container,
        :host-context(body.has-glass) .action-button,
        :host-context(body.has-glass) .continue-button,
        :host-context(body.has-glass) .close-button {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            filter: none !important;
            backdrop-filter: none !important;
        }

        :host-context(body.has-glass) .container::after,
        :host-context(body.has-glass) .action-button::after,
        :host-context(body.has-glass) .continue-button::after {
            display: none !important;
        }

        :host-context(body.has-glass) .action-button:hover,
        :host-context(body.has-glass) .continue-button:hover,
        :host-context(body.has-glass) .close-button:hover {
            background: transparent !important;
        }
    `;

    static properties = {
        microphoneGranted: { type: String }, screenGranted: { type: String }, keychainGranted: { type: String },
        isChecking: { type: Boolean }, isContinuing: { type: Boolean }, isRestarting: { type: Boolean }, errorMessage: { type: String },
        continueCallback: { type: Function }, userMode: { type: String },
    };

    constructor() {
        super();
        this.microphoneGranted = 'unknown'; this.screenGranted = 'unknown'; this.keychainGranted = 'unknown';
        this.isChecking = false; this.isContinuing = false; this.isRestarting = false; this.errorMessage = '';
        this.continueCallback = null; this.userMode = 'unknown';
        this._connected = false; this._generation = 0; this._completed = false; this._autoContinueBlocked = false;
        this._focusListener = () => this.checkPermissions();
        this._visibilityListener = () => { if (document.visibilityState === 'visible') this.checkPermissions(); };
    }

    connectedCallback() {
        super.connectedCallback();
        this._connected = true; this._generation++; this._completed = false;
        this.isChecking = false; this.isContinuing = false; this._lastHeight = null;
        window.addEventListener('focus', this._focusListener);
        document.addEventListener('visibilitychange', this._visibilityListener);
        this.permissionCheckInterval = setInterval(() => this.checkPermissions(), 2000);
        this.checkPermissions();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._connected = false; this._generation++;
        clearInterval(this.permissionCheckInterval); this.permissionCheckInterval = null;
        window.removeEventListener('focus', this._focusListener);
        document.removeEventListener('visibilitychange', this._visibilityListener);
        this._resizeObserver?.disconnect(); this._resizeObserver = null;
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (!this._connected) return;
        const container = this.shadowRoot?.querySelector('.container');
        if (container && !this._resizeObserver && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this._requestResize());
            this._resizeObserver.observe(container);
        }
        this._requestResize();
    }

    _requestResize() {
        const height = this.shadowRoot?.querySelector('.container')?.getBoundingClientRect().height;
        if (!this._connected || !height || Math.ceil(height) === this._lastHeight) return;
        this._lastHeight = Math.ceil(height);
        this.dispatchEvent(new CustomEvent('request-resize', {
            detail: { height: this._lastHeight }, bubbles: true, composed: true,
        }));
    }

    _allGranted() {
        return ['local', 'firebase'].includes(this.userMode)
            && this.microphoneGranted === 'granted' && this.screenGranted === 'granted'
            && (this.userMode !== 'firebase' || this.keychainGranted === 'granted');
    }

    async checkPermissions({ autoContinue = true } = {}) {
        if (!this._connected || this.isChecking || this._completed) return;
        const generation = this._generation;
        const current = () => this._connected && generation === this._generation;
        this.isChecking = true;
        try {
            if (!window.api?.permissionHeader || !window.api.common) throw new Error('Glass permission service is unavailable. Restart Glass and try again.');
            const userState = await window.api.common.getCurrentUser();
            if (!current()) return;
            if (!['local', 'firebase'].includes(userState?.mode)) throw new Error('Could not determine the current account. Check again or restart Glass.');
            this.userMode = userState.mode;
            const permissions = await window.api.permissionHeader.checkSystemPermissions();
            if (!current()) return;
            if (permissions?.success === false) throw new Error(permissions.error || 'Permission check failed. Check again.');
            this.microphoneGranted = permissions.microphone || 'unknown';
            this.screenGranted = permissions.screen || 'unknown';
            this.keychainGranted = permissions.keychain || 'unknown';
            if (!this._autoContinueBlocked) this.errorMessage = '';
            if (autoContinue && this._allGranted() && !this._autoContinueBlocked) await this._continueOnce(generation);
        } catch (error) {
            if (current()) this.errorMessage = error.message || 'Permission check failed. Check again.';
        } finally {
            if (current()) this.isChecking = false;
        }
    }

    async handleCheckAgain() {
        this._autoContinueBlocked = false;
        await this.checkPermissions();
    }

    async _runAction(action) {
        if (!this._connected) return;
        const generation = this._generation;
        try {
            this.errorMessage = '';
            const result = await action();
            if (result?.success === false) throw new Error(result.error || 'Permission action failed. Please retry.');
            if (this._connected && generation === this._generation) await this.checkPermissions();
        } catch (error) {
            if (this._connected && generation === this._generation) this.errorMessage = error.message || 'Permission action failed. Please retry.';
        }
    }

    handleMicrophoneClick() {
        return this._runAction(() => window.api.permissionHeader.requestMicrophonePermission());
    }

    handleScreenClick() {
        return this._runAction(() => window.api.permissionHeader.openSystemPreferences('screen-recording'));
    }

    handleKeychainClick() {
        return this._runAction(() => window.api.permissionHeader.initializeEncryptionKey());
    }

    async handleRestart() {
        if (!this._connected || this.isRestarting) return;
        this.isRestarting = true;
        const generation = this._generation;
        try {
            this.errorMessage = '';
            const result = await window.api.permissionHeader.restartApplication();
            if (result?.success === false) throw new Error(result.error || 'Restart failed. Please retry.');
        } catch (error) {
            if (this._connected && generation === this._generation) {
                this.isRestarting = false;
                this.errorMessage = error.message || 'Restart failed. Please retry.';
            }
        }
    }

    async handleContinue() {
        if (this.isChecking || this.isContinuing) return;
        this._autoContinueBlocked = false;
        await this.checkPermissions({ autoContinue: false });
        if (!this.errorMessage && this._connected && this._allGranted()) await this._continueOnce(this._generation);
    }

    async _continueOnce(generation) {
        if (this.isContinuing || this._completed || !this._allGranted() || typeof this.continueCallback !== 'function') return;
        this.isContinuing = true;
        try {
            if (this.userMode === 'firebase') {
                const result = await window.api.permissionHeader.markKeychainCompleted();
                if (result?.success === false) throw new Error(result.error || 'Could not finish encryption setup.');
            }
            if (!this._connected || generation !== this._generation) return;
            const result = await this.continueCallback();
            if (!this._connected || generation !== this._generation) return;
            if (result === false || result?.success === false) throw new Error(result?.error || 'Could not finish setup. Press Continue to retry.');
            this._completed = true;
        } catch (error) {
            if (this._connected && generation === this._generation) {
                this.errorMessage = error.message || 'Could not finish setup. Press Continue to retry.';
                this._autoContinueBlocked = true;
            }
        } finally {
            if (generation === this._generation) this.isContinuing = false;
        }
    }

    handleClose() { window.api?.common.quitApplication(); }

    render() {
        const keychainRequired = this.userMode === 'firebase';
        const allGranted = this._allGranted();
        const blocked = [
            this.microphoneGranted !== 'granted' ? `Microphone: ${this.microphoneGranted}` : '',
            this.screenGranted !== 'granted' ? `Screen recording: ${this.screenGranted}` : '',
            keychainRequired && this.keychainGranted !== 'granted' ? `Encryption: ${this.keychainGranted}` : '',
        ].filter(Boolean);
        return html`
            <div class="container">
                <button class="close-button" @click=${this.handleClose} title="Quit Glass" aria-label="Quit Glass">×</button>
                <h1 class="title">Permission setup</h1>
                <div class="form-content">
                    <div class="subtitle">${allGranted ? 'Required permissions are granted.' : 'Glass needs microphone and Screen & System Audio Recording access to continue.'}</div>
                    <div class="permission-status" aria-label="Current permission status">
                        <span class="permission-item ${this.microphoneGranted === 'granted' ? 'granted' : ''}">Microphone ${this.microphoneGranted === 'granted' ? '✓' : '·'}</span>
                        <span class="permission-item ${this.screenGranted === 'granted' ? 'granted' : ''}">Screen ${this.screenGranted === 'granted' ? '✓' : '·'}</span>
                        ${keychainRequired ? html`<span class="permission-item ${this.keychainGranted === 'granted' ? 'granted' : ''}">Encryption ${this.keychainGranted === 'granted' ? '✓' : '·'}</span>` : ''}
                    </div>
                    ${blocked.length ? html`<p class="subtitle" role="status">Waiting for macOS: ${blocked.join('; ')}.</p>` : ''}
                    ${this.screenGranted !== 'granted' ? html`<p class="subtitle">Enable Glass in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Glass. If it still says denied, remove the old Glass entry and add /Applications/Glass.app again.</p>` : ''}
                    ${this.microphoneGranted !== 'granted' ? html`<button class="action-button" @click=${this.handleMicrophoneClick}>Grant microphone access</button>` : ''}
                    ${this.screenGranted !== 'granted' ? html`<button class="action-button" @click=${this.handleScreenClick}>Open screen recording settings</button>` : ''}
                    ${keychainRequired && this.keychainGranted !== 'granted' ? html`<button class="action-button" @click=${this.handleKeychainClick}>Enable encryption</button><p class="subtitle">Allow Glass to store its encryption key in Keychain.</p>` : ''}
                    <button class="action-button" @click=${this.handleCheckAgain} ?disabled=${this.isChecking || this.isContinuing}>${this.isChecking ? 'Checking…' : 'Check again'}</button>
                    <button class="action-button" @click=${this.handleRestart} ?disabled=${this.isContinuing || this.isRestarting}>${this.isRestarting ? 'Restarting…' : 'Restart Glass'}</button>
                    ${allGranted ? html`<button class="continue-button" @click=${this.handleContinue} ?disabled=${this.isContinuing || this.isChecking}>${this.isContinuing ? 'Finishing setup…' : 'Continue to Glass'}</button>` : ''}
                    ${this.errorMessage ? html`<p class="subtitle" role="alert" style="color: #ffb4ab; margin-top: 8px; margin-bottom: 0">${this.errorMessage}</p>` : ''}
                </div>
            </div>
        `;
    }
}

customElements.define('permission-setup', PermissionHeader);
