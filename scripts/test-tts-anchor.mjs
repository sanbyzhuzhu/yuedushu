import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5199');
  const result = await page.evaluate(async () => {
    const { applyQuote } = await import('/src/engine/annotate.ts');
    const { chapterParas } = await import('/src/engine/tts.ts');
    const root = document.createElement('div');
    root.innerHTML = '<h1>标题</h1><p>第一段<strong>加粗</strong>文字。</p><p>第二段 <mark class="hl">已有笔记</mark>文字。</p><p>下一句。</p>';
    document.body.append(root);
    const before = root.textContent;
    const hits = ['标题', '第一段加粗文字。第二段已有笔记文字。', '下一句。'].map((exact) => {
      root.querySelectorAll('.tts-current').forEach((m) => m.replaceWith(...m.childNodes));
      root.normalize();
      const found = applyQuote(root, { exact, prefix: '', suffix: '' }, { id: 'tts-current', color: 'amber', hasNote: false });
      const marks = root.querySelectorAll('[data-aid="tts-current"]');
      marks.forEach((m) => { m.className = 'tts-current'; m.removeAttribute('data-aid'); });
      return found && Array.from(marks).map((m) => m.textContent).join('').replace(/\s/g, '') === exact;
    });
    const sentences = chapterParas('<h1>标题</h1><p>第一句。第二句<strong>加粗</strong>！“第三句？”</p><p>第四段没有句号</p><p>第五段。</p>', undefined, true);
    return { hits, sentences, unchanged: before === root.textContent, note: root.querySelector('mark.hl')?.textContent };
  });
  assert.deepEqual(result.hits, [true, true, true]);
  assert.equal(result.unchanged, true);
  assert.equal(result.note, '已有笔记');
  assert.deepEqual(result.sentences, ['标题', '第一句。', '第二句加粗！', '“第三句？”', '第四段没有句号', '第五段。']);
  console.log('✓ Consecutive TTS anchors span paragraphs, inline formatting and notes without losing text');
} finally { await browser.close(); }
