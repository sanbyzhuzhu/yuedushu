self.onmessage = (event: MessageEvent<{ id: number; value: string; pattern: string; replacement: string }>) => {
  try { self.postMessage({ id: event.data.id, value: event.data.value.replace(new RegExp(event.data.pattern, 'g'), event.data.replacement) }); }
  catch { self.postMessage({ id: event.data.id, error: '书源的替换正则无效' }); }
};
