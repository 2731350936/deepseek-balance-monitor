/**
 * Simple interval timer with overlap protection.
 * If a callback is still running when the next tick fires,
 * that tick is silently skipped.
 */
export class IntervalTimer {
  private handle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /** Start periodic execution */
  start(callback: () => Promise<void>, intervalMs: number): void {
    this.stop();
    this.handle = setInterval(async () => {
      if (this.isRunning) {
        return; // skip overlapping ticks
      }
      this.isRunning = true;
      try {
        await callback();
      } catch {
        // Callback handles its own errors; timer just keeps ticking
      } finally {
        this.isRunning = false;
      }
    }, intervalMs);
  }

  /** Stop and nullify the timer */
  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}
