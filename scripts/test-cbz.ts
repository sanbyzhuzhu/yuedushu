/** CBZ 漫画包解析冒烟测试（V0.3.2）：esbuild 打包后 Node 运行 */
import { zipSync, strToU8 } from 'fflate';
import { parseCbz } from '../src/engine/cbz';

// 1×1 PNG（标准红点，base64）
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ FAIL ${name}`);
  }
}

async function main(): Promise<void> {
  // 乱序命名 + 干扰文件：验证自然排序与过滤
  const zip = zipSync({
    'p10.jpg': pngBytes(),
    'p2.png': pngBytes(),
    'readme.txt': strToU8('not an image'),
    '__MACOSX/p2.png': pngBytes(),
    'cover.gif': pngBytes(),
  });

  const r = await parseCbz(zip.buffer as ArrayBuffer, '测试漫画');

  ok(r.chapters.length === 3, `页数=${r.chapters.length}（排除 readme 与 __MACOSX）`);
  // 自然排序：cover.gif < p2.png < p10.jpg（numeric: 2 < 10）
  ok((r.chapters[0]?.html ?? '').includes('data:image/gif'), '自然排序：cover.gif 首页');
  ok((r.chapters[1]?.html ?? '').includes('data:image/png'), 'p2.png 第二页');
  ok((r.chapters[2]?.html ?? '').includes('data:image/jpeg'), 'p10.jpg 第三页');
  ok(r.chapters[0]?.title === '第 1 页' && r.chapters[2]?.title === '第 3 页', '页码标题');
  ok((r.chapters[0]?.html ?? '').includes('comic-page'), 'comic-page 类（样式锚点）');
  ok(r.cover === undefined, 'Node 环境封面跳过（无 canvas）');
  ok(r.title === '测试漫画', `标题回退=${r.title}`);

  // 空 zip（无图片）→ 明确报错
  const empty = zipSync({ 'readme.txt': strToU8('x') });
  let threw = '';
  try {
    await parseCbz(empty.buffer as ArrayBuffer, 'x');
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  ok(threw.includes('未找到图片'), `空包报错：${threw.slice(0, 24)}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
