/** Display-only normalization: stored text and annotation anchors stay untouched. */
export function prepareReadingHtml(html: string, keepStyle = true): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(doc.body.querySelectorAll<HTMLElement>('*'));
  // Keep only typographic intent. Book CSS must never resize the reader or leak into its UI.
  const properties = ['font-size', 'font-weight', 'font-style', 'text-align', 'text-decoration', 'vertical-align', 'width', 'height'];
  const styles = new Map<HTMLElement, CSSStyleDeclaration>();
  const styleFor = (el: HTMLElement) => {
    if (!styles.has(el)) styles.set(el, doc.createElement('span').style);
    return styles.get(el)!;
  };
  if (keepStyle) {
    for (const tag of Array.from(doc.querySelectorAll('style'))) {
      try {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(tag.textContent || '');
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          let matches: NodeListOf<HTMLElement>;
          try { matches = doc.body.querySelectorAll<HTMLElement>(rule.selectorText); } catch { continue; }
          for (const el of matches) for (const prop of properties) {
            const value = rule.style.getPropertyValue(prop);
            if (value) styleFor(el).setProperty(prop, value);
          }
        }
      } catch { /* A broken stylesheet must not prevent reading. */ }
    }
  }
  for (const el of elements) {
    for (const prop of properties) {
      const value = el.style?.getPropertyValue(prop);
      if (value && (keepStyle || prop === 'width' || prop === 'height')) styleFor(el).setProperty(prop, value);
    }
  }
  const pixels = (value: string) => {
    const match = /^(\d+(?:\.\d+)?)(px|pt)$/i.exec(value);
    return match ? Number(match[1]) * (match[2].toLowerCase() === 'pt' ? 4 / 3 : 1) : 0;
  };
  // Infer the book's normal body size, weighted by directly owned text (not nested copies).
  const weights = new Map<number, number>();
  for (const el of elements) {
    const px = pixels(styles.get(el)?.fontSize || '');
    if (!px || el.closest('h1,h2,h3,h4,h5,h6,sup,sub,small')) continue;
    const chars = Array.from(el.childNodes).filter((n) => n.nodeType === 3).reduce((n, t) => n + (t.textContent?.trim().length || 0), 0);
    weights.set(px, (weights.get(px) || 0) + chars);
  }
  const base = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] || 16;
  doc.querySelectorAll('style,script,link,iframe,object,embed,base,meta').forEach((el) => el.remove());
  for (const el of elements) {
    const source = styles.get(el);
    el.removeAttribute('style'); el.removeAttribute('size'); el.removeAttribute('face'); el.removeAttribute('color');
    for (const attr of Array.from(el.attributes)) if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    if (el.tagName === 'A') {
      const href = el.getAttribute('href')?.trim() ?? '';
      if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^https?:\/\//i.test(href)) el.removeAttribute('href');
      el.removeAttribute('target');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (keepStyle && source) {
      const px = pixels(source.fontSize);
      if (px && !el.closest('sup,sub,small')) el.style.fontSize = `calc(var(--reader-font-size) * ${Math.max(.65, Math.min(2.5, px / base)).toFixed(3)})`;
      else if (/^(?:0?\.\d+|[12](?:\.\d+)?)(?:em|%)$/.test(source.fontSize)) el.style.fontSize = source.fontSize;
      if (/^(bold|[6-9]00)$/.test(source.fontWeight)) el.style.fontWeight = source.fontWeight;
      if (/^(italic|oblique)$/.test(source.fontStyle)) el.style.fontStyle = source.fontStyle;
      if (/^(center|right|end)$/.test(source.textAlign)) el.style.textAlign = source.textAlign;
      if (/^(underline|line-through)$/.test(source.textDecoration)) el.style.textDecoration = source.textDecoration;
      if (/^(super|sub)$/.test(source.verticalAlign)) el.style.verticalAlign = source.verticalAlign;
    }
    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement;
      const width = source?.width || img.getAttribute('width') || '';
      const height = source?.height || img.getAttribute('height') || '';
      const small = (v: string) => /^(?:\d+(?:\.\d+)?)(?:px)?$/.test(v) && Number.parseFloat(v) <= 40 && Number.parseFloat(v) > 0;
      const inline = !!el.closest('sup,sub,[epub\\:type="noteref"],[role="doc-noteref"]') || small(width) || small(height) || small(img.getAttribute('width') || '') || small(img.getAttribute('height') || '') || /^(?:[012](?:\.\d+)?)em$/.test(height) || /^(?:[012](?:\.\d+)?)em$/.test(width);
      img.removeAttribute('width'); img.removeAttribute('height'); img.removeAttribute('srcset'); img.removeAttribute('sizes');
      if (inline) {
        img.dataset.readerInline = '1';
        img.style.height = '1em'; img.style.width = 'auto';
      } else {
        // Never stretch an image to the page. Preserve intended small illustrations.
        if (/^\d+(?:\.\d+)?(?:px|em)?$/.test(width)) img.style.width = /^\d+(?:\.\d+)?$/.test(width) ? `${width}px` : width;
        if (!width && /^\d+(?:\.\d+)?(?:px|em)?$/.test(height)) img.style.height = /^\d+(?:\.\d+)?$/.test(height) ? `${height}px` : height;
      }
    }
  }
  return doc.body.innerHTML;
}
