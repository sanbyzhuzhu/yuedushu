/** Older Android WebViews support AbortController but lack this newer method. */
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.prototype.throwIfAborted !== 'function') {
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
    configurable: true,
    writable: true,
    value: function (this: AbortSignal) {
      if (this.aborted) throw this.reason ?? new DOMException('已取消', 'AbortError');
    },
  });
}
