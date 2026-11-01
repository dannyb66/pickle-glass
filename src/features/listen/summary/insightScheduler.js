// One request at a time; pending text is measured from the last successful snapshot.
class InsightScheduler {
    constructor({ run, turns = 5, seconds = 30, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
        Object.assign(this, { run, turns, seconds, now, setTimer, clearTimer });
        this.reset();
    }
    reset() {
        this.clearTimer(this.timer);
        this.generation = (this.generation || 0) + 1;
        this.retryNotBefore = 0;
        this.timer = null; this.pending = 0; this.firstPending = null; this.flight = null;
    }
    acknowledge(count) {
        this.pending = Math.max(0, this.pending - count);
        if (!this.pending) this.firstPending = null;
        this.schedule();
    }
    configure({ turns, seconds }) {
        this.turns = turns; this.seconds = seconds;
        if (this.pending) { this.schedule(); if (this.pending >= this.turns && this.now() >= this.retryNotBefore) void this.flush(); }
    }
    add() {
        if (!this.pending) this.firstPending = this.now();
        this.pending++;
        this.schedule();
        if (this.pending >= this.turns && this.now() >= this.retryNotBefore) void this.flush();
    }
    schedule(delay) {
        this.clearTimer(this.timer);
        this.timer = null;
        if (!this.pending || this.flight) return;
        const wait = delay ?? Math.max(0, this.retryNotBefore - this.now(), this.seconds * 1000 - (this.now() - this.firstPending));
        this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, wait);
        this.timer?.unref?.();
    }
    async flush(final = false) {
        if (this.flight) {
            await this.flight;
            if (final && this.pending) return this.flush(false);
            return;
        }
        if (!this.pending) return;
        this.clearTimer(this.timer); this.timer = null;
        const count = this.pending, generation = this.generation;
        // Capture synchronous additions during run as pending work for the next snapshot.
        this.pending = 0; this.firstPending = null;
        let success = false;
        this.flight = Promise.resolve(this.run()).then(result => { success = !!result; }).catch(() => {});
        await this.flight;
        if (generation !== this.generation) return;
        this.flight = null;
        this.retryNotBefore = success ? 0 : this.now() + this.seconds * 1000;
        if (!success) { this.pending += count; this.firstPending ??= this.now(); }
        if (success && this.pending >= this.turns) return this.flush();
        this.schedule(success ? undefined : this.seconds * 1000);
    }
}
module.exports = InsightScheduler;
