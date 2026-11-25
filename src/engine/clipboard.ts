/** Preserve the reader selection even when the legacy clipboard fallback needs focus. */
export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error('请先选择文字');
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Older WebViews may reject clipboard permissions; try their native editing command. */ }
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const active = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text; field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('系统暂不允许复制，请检查剪贴板权限');
  } finally {
    field.remove(); active?.focus({ preventScroll: true });
    selection?.removeAllRanges(); for (const range of ranges) selection?.addRange(range);
  }
}
