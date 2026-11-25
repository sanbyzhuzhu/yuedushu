/** 笔记分享卡片生成器（V0.3.1，参考 Anx Reader）：Canvas 绘制古典风引语卡 → PNG 下载 */
import type { Annotation, HighlightColor } from './types';
import { saveExport } from './fileExport';

const COLOR_DOT: Record<HighlightColor, string> = {
  red: '#B03A2E',
  green: '#5B6B3A',
  blue: '#2C5F7C',
  amber: '#A67C2E',
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      continue;
    }
    if (ctx.measureText(cur + ch).width > maxWidth) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur += ch;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length >= maxLines && (cur || text.length > lines.join('').length)) {
    // 省略号截断
    let last = lines[maxLines - 1];
    while (last.length > 2 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

export async function renderShareCard(
  bookTitle: string,
  author: string,
  ann: Annotation,
): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 宣纸底 + 轻噪点
  ctx.fillStyle = '#F3EEE0';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = i % 2 ? '#7A5230' : '#3A3630';
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  ctx.globalAlpha = 1;

  // 双线版框（朱砂外框 + 墨色内框）
  ctx.strokeStyle = 'rgba(176, 58, 46, 0.6)';
  ctx.lineWidth = 4;
  ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.strokeStyle = 'rgba(58, 54, 48, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(60, 60, W - 120, H - 120);

  const serif = '"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif';
  const kai = '"Kaiti SC","KaiTi","STKaiti","DFKai-SB","楷体",serif';

  // 书名
  ctx.fillStyle = '#7A5230';
  ctx.font = `34px ${serif}`;
  ctx.textAlign = 'center';
  ctx.fillText('读 书 笔 记', W / 2, 150);
  ctx.fillStyle = '#2A2723';
  ctx.font = `52px ${serif}`;
  const title = `《${bookTitle.slice(0, 18)}${bookTitle.length > 18 ? '…' : ''}》`;
  ctx.fillText(title, W / 2, 224);
  if (author) {
    ctx.fillStyle = '#7A5230';
    ctx.font = `32px ${serif}`;
    ctx.fillText(author.slice(0, 20), W / 2, 276);
  }

  // 划线色标 + 引语
  const dot = COLOR_DOT[ann.color] ?? COLOR_DOT.red;
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(W / 2, 336, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2A2723';
  ctx.font = `46px ${kai}`;
  ctx.textAlign = 'left';
  const quote = ann.exact.slice(0, 160);
  const qLines = wrapText(ctx, quote, W - 260, 12);
  let y = 420;
  for (const line of qLines) {
    ctx.fillText(line, 130, y);
    y += 76;
  }

  // 批注
  if (ann.note) {
    y += 24;
    ctx.fillStyle = dot;
    ctx.fillRect(130, y - 30, 5, Math.min(160, 40 + ann.note.length * 2));
    ctx.fillStyle = '#5B4A32';
    ctx.font = `36px ${serif}`;
    const nLines = wrapText(ctx, ann.note.slice(0, 100), W - 290, 4);
    for (const line of nLines) {
      ctx.fillText(line, 160, y + 12);
      y += 54;
    }
  }

  // 底部署名
  ctx.fillStyle = '#7A5230';
  ctx.font = `32px ${serif}`;
  ctx.textAlign = 'center';
  const date = new Date().toLocaleDateString('zh-CN');
  ctx.fillText(`${date} · 阅读树`, W / 2, H - 110);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string): Promise<string> {
  return saveExport(blob, filename);
}
