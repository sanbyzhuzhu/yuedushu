/** Read-only page geometry for real mouse/touch regression gestures. */
export async function handleOffset(page, endpoint = 'end') {
  return page.locator('.text-selection-handle.' + endpoint).evaluate((handle) => {
    const box = handle.getBoundingClientRect(), layer = handle.parentElement.getBoundingClientRect();
    const vertical = document.querySelector('.reader').dataset.flow === 'vertical';
    return { x: layer.left + parseFloat(handle.style.left) - box.left - 22 + (vertical ? 4 : 0),
      y: layer.top + parseFloat(handle.style.top) - box.top - 24 - (vertical ? 0 : 4) };
  });
}

export async function pageBoundary(page, direction, offset) {
  return page.evaluate(({ direction, offset }) => {
    const root = document.querySelector('.page-inner');
    const outer = document.querySelector('.page-outer');
    const vertical = getComputedStyle(root).writingMode === 'vertical-rl';
    const box = (vertical ? document.querySelector('.page-clip') : outer).getBoundingClientRect();
    const style = getComputedStyle(outer);
    const view = vertical ? box : { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight),
      top: box.top + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.paddingBottom) };
    const fragments = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        const rect = { left: Math.max(view.left, r.left), right: Math.min(view.right, r.right),
          top: Math.max(view.top, r.top), bottom: Math.min(view.bottom, r.bottom) };
        if (rect.right - rect.left > 1 && rect.bottom - rect.top > 1) fragments.push(rect);
      }
    }
    const r = direction > 0 ? fragments.at(-1) : fragments[0];
    if (!r) throw new Error('No visible text boundary');
    const x = (r.left + r.right) / 2;
    const y = vertical ? (direction > 0 ? r.bottom - 8 : r.top + 8) : (r.top + r.bottom) / 2;
    return { inside: { x: x - offset.x, y: y - offset.y },
      outside: { x: x - offset.x, y: (direction > 0 ? r.bottom + 14 : r.top - 14) - offset.y } };
  }, { direction, offset });
}
