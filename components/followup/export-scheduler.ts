export class ExportCapacityError extends Error {
  readonly retryAfter = 2;
  constructor() { super('طابور التقارير مشغول. أعد المحاولة بعد ثوانٍ؛ لم يُنشأ تقرير.'); }
}
type Waiter = {start: () => void; cancel: () => void};
/** Bounded per-runtime FIFO; requests stay attached, never become background jobs. */
export class ExportScheduler {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  constructor(private readonly concurrency: number, private readonly maxQueued: number, private readonly maxWaitMs: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueued) || maxQueued < 0 || maxWaitMs < 1) throw Error('Invalid export scheduler limits');
  }
  get snapshot() { return {active: this.active, queued: this.waiting.length}; }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DOMException('تم إلغاء إعداد التقرير', 'AbortError');
    if (this.active < this.concurrency) return this.activate();
    if (this.waiting.length >= this.maxQueued) throw new ExportCapacityError();
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const remove = () => { const index = this.waiting.indexOf(waiter); if (index >= 0) this.waiting.splice(index, 1); };
      const abort = () => { if (settled) return; settled = true; remove(); cleanup(); reject(new DOMException('تم إلغاء إعداد التقرير', 'AbortError')); };
      const waiter: Waiter = {
        start: () => { if (settled) return; settled = true; cleanup(); resolve(this.activate()); },
        cancel: abort,
      };
      const timer = setTimeout(() => { if (settled) return; settled = true; remove(); cleanup(); reject(new ExportCapacityError()); }, this.maxWaitMs);
      this.waiting.push(waiter);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) abort();
    });
  }
  private activate() {
    this.active++;
    let released = false;
    return () => { if (released) return; released = true; this.active--; this.waiting.shift()?.start(); };
  }
  async run<T>(work: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try { if(signal?.aborted)throw new DOMException('تم إلغاء إعداد التقرير','AbortError');return await work(); } finally { release(); }
  }
  cancelWaiting() { for (const waiter of [...this.waiting]) waiter.cancel(); }
}
