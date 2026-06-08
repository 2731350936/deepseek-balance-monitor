"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntervalTimer = void 0;
/**
 * Simple interval timer with overlap protection.
 * If a callback is still running when the next tick fires,
 * that tick is silently skipped.
 */
class IntervalTimer {
    constructor() {
        this.handle = null;
        this.isRunning = false;
    }
    /** Start periodic execution */
    start(callback, intervalMs) {
        this.stop();
        this.handle = setInterval(async () => {
            if (this.isRunning) {
                return; // skip overlapping ticks
            }
            this.isRunning = true;
            try {
                await callback();
            }
            catch {
                // Callback handles its own errors; timer just keeps ticking
            }
            finally {
                this.isRunning = false;
            }
        }, intervalMs);
    }
    /** Stop and nullify the timer */
    stop() {
        if (this.handle !== null) {
            clearInterval(this.handle);
            this.handle = null;
        }
    }
}
exports.IntervalTimer = IntervalTimer;
//# sourceMappingURL=intervalTimer.js.map