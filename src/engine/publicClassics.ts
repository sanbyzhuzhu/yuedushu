import type { Catalog, CatalogEntry } from './networkLibrary';
import { MAX_DOWNLOAD_BYTES, requestBytes, secureUrl } from './networkLibrary';
import { escapeHtml } from './importExtra';

export const CLASSICS_PRESETS = [
  { title: '中文维基文库', url: 'https://zh.wikisource.org/', detail: '经典原文 · 选择篇章入架' },
  { title: '中华诗词', url: 'https://api.github.com/repos/chinese-poetry/chinese-poetry/contents', detail: '唐诗宋词 · 按选集下载' },
  { title: 'Kanripo 汉籍', url: 'https://api.github.com/orgs/kanripo/repos?per_page=30&page=1', detail: '汉籍原文 · 按卷下载' },
  { title: '中国哲学书电子化计划', url: 'https://ctext.org/zh', detail: '先秦典籍 · 目录与原站阅读' },
  { title: 'GITenberg', url: 'https://api.github.com/orgs/GITenberg/repos?per_page=30&page=1', detail: '公版英文书 · 浏览文件入架' },
  { title: 'Standard Ebooks', url: 'https://standardebooks.org/ebooks?sort=newest&per-page=12', detail: '精校英文经典 · EPUB 入架' },
] as const;
const WIKI = 'https://zh.wikisource.org/';
const texts = ['論語', '道德經', '孟子', '莊子', '詩經', '史記', '孫子兵法', '三國演義', '西遊記', '紅樓夢'];
const ctextBooks = [['論語', 'analects'], ['孟子', 'mengzi'], ['荀子', 'xunzi'], ['大學', 'daxue'], ['中庸', 'zhong-yong'], ['道德經', 'dao-de-jing'], ['莊子', 'zhuangzi'], ['墨子', 'mozi'], ['韓非子', 'hanfeizi'], ['孫子兵法', 'art-of-war']];
export function wikiPage(title: string) { return WIKI + 'w/api.php?action=parse&prop=text&format=json&page=' + encodeURIComponent(title); }
function entry(title: string, url: string, download = false, textPage?: CatalogEntry['textPage']): CatalogEntry { return { title, url: secureUrl(url), download, ...(textPage ? { textPage } : {}) }; }
function doc(text: string) { return new DOMParser().parseFromString(text, 'text/html'); }
function githubWebsite(url: URL) { return 'https://github.com/' + url.pathname.replace(/^\/repos\//, '').replace(/\/contents.*$/, ''); }

export function publicRoot(address: string): Catalog | undefined {
  const url = new URL(address);
  if (url.origin === new URL(WIKI).origin && url.pathname === '/') return { title: '中文维基文库', entries: [entry('典籍总目录 · 经史子集与各家著作', wikiPage('Portal:典籍')), ...texts.map(t => entry(t, wikiPage(t)))], website: WIKI, notice: '典籍总目录收录更多作品，按分类逐层浏览；下方保留常读经典快捷入口。' };
  if (url.origin === 'https://ctext.org' && /^\/(?:zh)?\/?$/.test(url.pathname)) return { title: '中国哲学书电子化计划', entries: ctextBooks.map(([t,p]) => entry(t, 'https://ctext.org/' + p + '/zh')), website: 'https://ctext.org/zh', notice: '浏览公开目录；若原站要求验证，请在原站阅读或下载后导入。' };
}
export function normalizePublicUrl(address: string) {
  const url = new URL(secureUrl(address));
  if (!['zh.wikisource.org','ctext.org','api.github.com','standardebooks.org'].includes(url.hostname)) throw new Error('请选择预置公版书库');
  if (url.hostname === 'zh.wikisource.org' && url.pathname.startsWith('/wiki/')) return wikiPage(decodeURIComponent(url.pathname.slice(6)));
  return url.href;
}
export function parsePublicCatalog(text: string, address: string): Catalog {
  const url = new URL(address);
  if (url.hostname === 'zh.wikisource.org') {
    const data = JSON.parse(text);
    if (data.query?.categorymembers) {
      const category = url.searchParams.get('cmtitle') || '分类';
      const entries = data.query.categorymembers.filter((p: {ns:number}) => [0,14,100].includes(p.ns)).map((p:{title:string;ns:number})=>entry(p.title.replace(/^(Category|Portal):/,''), p.ns===14 ? wikiCategory(p.title) : wikiPage(p.title)));
      const next = new URL(url); for(const [key,value] of Object.entries(data.continue || {})) next.searchParams.set(key,String(value));
      return {title:category.replace(/^Category:/,''),entries,...(data.continue?{next:next.href}:{}),website:WIKI+'wiki/'+encodeURIComponent(category),notice:'分类包含作品和子分类，每页最多 50 项；点击进入，下一页继续浏览。'};
    }
    if (data.error || !data.parse?.text?.['*']) throw new Error('维基文库作品暂不可读取，请在原站查看。');
    const title = String(data.parse.title), root = doc(data.parse.text['*']);
    if (/^(Portal|分類|Category):/.test(title) || ['四庫全書','四部叢刊'].includes(title)) {
      root.querySelectorAll('.mw-editsection,.noprint,nav').forEach(el=>el.remove());
      const groups: {title:string;entries:CatalogEntry[]}[] = [{title:'总览',entries:[]}];
      const seen=new Set<string>();
      for(const node of Array.from(root.querySelectorAll('h2,h3,h4,a[href]'))) {
        if (/^H[234]$/.test(node.tagName)) {groups.push({title:node.textContent?.trim()||'分类',entries:[]});continue;}
        const href=node.getAttribute('href')||'';if(!href.startsWith('/wiki/')||node.classList.contains('new'))continue;
        let target:string;try{target=decodeURIComponent(href.slice(6).split('#')[0]);}catch{continue;}
        if(!target||target===title||/^(作者|Author|File|檔案|文件|Help|Template|Wikisource|Special|Talk|讨论):/i.test(target)||seen.has(target))continue;
        seen.add(target);groups[groups.length-1].entries.push(entry(node.textContent?.trim()||target,/^(Category|分類):/.test(target)?wikiCategory(target.replace(/^分類:/,'Category:')):wikiPage(target)));
      }
      const section=url.searchParams.get('rtsection');
      const nonempty=groups.filter(g=>g.entries.length);
      const chosen=section===null?null:nonempty[Number(section)];
      const offset=Math.max(0,Number(url.searchParams.get('rtoffset'))||0);
      const all=chosen?.entries || nonempty.map((g,i)=>{const link=new URL(address);link.searchParams.set('rtsection',String(i));link.searchParams.delete('rtoffset');return entry(g.title+' · '+g.entries.length+' 项',link.href)});
      const next=new URL(address);next.searchParams.set('rtoffset',String(offset+50));
      return {title:chosen?title+' · '+chosen.title:title,entries:all.slice(offset,offset+50),...(offset+50<all.length?{next:next.href}:{}),website:WIKI+'wiki/'+encodeURIComponent(title),notice:'按原站栏目整理作品目录，点击进入作品或子目录；每页最多 50 项，可筛选本页、返回上层与继续翻页。'};
    }
    const seen = new Set<string>(), chapters: CatalogEntry[] = [];
    for (const a of Array.from(root.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') || ''; if (!href.startsWith('/wiki/') || a.classList.contains('new')) continue;
      const target = decodeURIComponent(href.slice(6).split('#')[0]);
      if (!target.startsWith(title + '/') || seen.has(target)) continue;
      seen.add(target); chapters.push(entry(a.textContent?.trim() || target, wikiPage(target), true, 'wikisource'));
    }
    const page = WIKI + 'wiki/' + encodeURIComponent(title);
    return { title, entries: chapters.length ? chapters : [entry(title + ' · 本篇', address, true, 'wikisource')], ...(chapters.length ? { chapterBook: { title, chapters } } : {}), website: page, notice: '仅下载所选篇章；版权与版本说明请见原站。' };
  }
  if (url.hostname === 'api.github.com') {
    const data = JSON.parse(text); if (!Array.isArray(data)) throw new Error('GitHub 目录暂不可读取');
    const org = url.pathname.startsWith('/orgs/'); const poetry = url.pathname.startsWith('/repos/chinese-poetry/chinese-poetry/'); const kan = url.pathname.startsWith('/repos/kanripo/');
    const entries: CatalogEntry[] = [];
    for (const item of data) {
      if (org && (url.pathname.includes('/kanripo/') ? /^KR\w+$/.test(item.name) : /_\d+$/.test(item.name))) entries.push(entry(item.description?.split('--')[0]?.trim() || item.name.replace(/_/g,' '), item.url + '/contents'));
      else if (!org && item.type === 'dir' && !item.name.startsWith('.') && (!poetry || !['images','loader','rank','strains','error'].includes(item.name))) entries.push(entry(item.name, item.url));
      else if (!org && item.type === 'file' && item.download_url && item.size <= MAX_DOWNLOAD_BYTES) {
        const poem = poetry && /\.json$/.test(item.name) && !/^(authors|rank|strains|表情|index)/i.test(item.name);
        const book = !poetry && /\.(epub|txt|md|html?|pdf|mobi|azw3)$/i.test(item.name) && !/^(README|LICENSE|CONTRIBUTING|metadata)/i.test(item.name);
        if (poem || book) entries.push({ ...entry(item.name.replace(/\.json$/, ' · 诗词选集'), item.download_url, true, poem ? 'poetry' : kan && /\.txt$/.test(item.name) ? 'kanripo' : undefined), filename: item.name });
      }
    }
    entries.sort((a,b)=>Number(a.download)-Number(b.download)||a.title.localeCompare(b.title,'zh-CN',{numeric:true}));
    const next = new URL(url); next.searchParams.set('page', String(Number(url.searchParams.get('page') || 1)+1));
    const chapters = entries.filter(e=>e.textPage==='kanripo');
    return { title: poetry ? '中华诗词 · ' + decodeURIComponent(url.pathname.split('/contents')[1] || '选集') : kan ? 'Kanripo · ' + url.pathname.split('/')[3] : url.pathname.includes('/kanripo/') ? 'Kanripo 汉籍' : 'GITenberg', entries, ...(org && data.length===Number(url.searchParams.get('per_page') || 30) ? { next: next.href } : {}), ...(chapters.length ? {chapterBook:{title:'Kanripo · '+url.pathname.split('/')[3],chapters}} : {}), website: org ? 'https://github.com/' + url.pathname.split('/')[2] : githubWebsite(url), notice: '按需下载文件，不下载整个仓库。GitHub 接口有访问频率限制；诗词 JSON 会整理为可读选集。' };
  }
  const root = doc(text), entries: CatalogEntry[] = [], seen = new Set<string>();
  if (url.hostname === 'standardebooks.org') {
    const title = root.querySelector('h1')?.textContent?.trim() || 'Standard Ebooks';
    const compatible = root.querySelector('a[href*="/downloads/"][href$=".epub"]');
    if (compatible) {
      const href = secureUrl(compatible.getAttribute('href')!, address);
      entries.push({...entry(title, href, true),filename:title+'.epub'});
    } else for (const a of Array.from(root.querySelectorAll('.ebooks-list a[href]'))) {
      const href = secureUrl(a.getAttribute('href')!, address), path = new URL(href).pathname;
      if (new URL(href).origin!==url.origin || !/^\/ebooks\/[^/]+\/[^/]+/.test(path) || !a.textContent?.trim() || seen.has(href)) continue;
      seen.add(href);entries.push(entry(a.textContent.trim(),href));
    }
    const next = root.querySelector('a[rel="next"]')?.getAttribute('href') || Array.from(root.querySelectorAll('.pagination a[href]')).find(a=>Number(new URL(a.getAttribute('href')!, address).searchParams.get('page'))===Number(url.searchParams.get('page') || 1)+1)?.getAttribute('href');
    let nextUrl: string | undefined;
    if (next) { const target = new URL(secureUrl(next,address)); for (const [key,value] of url.searchParams) if (key!=='page' && !target.searchParams.has(key)) target.searchParams.set(key,value); if(target.origin===url.origin)nextUrl=target.href; }
    return { title, entries, ...(nextUrl ? {next:nextUrl} : {}), website: address, notice:'下载兼容 EPUB 版本；作品的公版状态因地区而异，请参考原站版权说明。' };
  }
  if (url.hostname === 'ctext.org') {
    if (/challenges\.cloudflare|Checking the security|captcha/i.test(text)) throw new Error('原站要求浏览器验证，请用下方原站链接打开，完成验证后阅读；本应用不绕过验证。');
    const title = root.querySelector('h1')?.textContent?.trim() || root.title.replace(/ - .*/, '');
    const prefix = url.pathname.split('/').filter(Boolean)[0];
    for (const a of Array.from(root.querySelectorAll('a[href]'))) {
      const raw = a.getAttribute('href')!; if (raw.startsWith('#')) continue;
      let href: string; try { href = secureUrl(raw,'https://ctext.org/'); } catch { continue; } const path = new URL(href).pathname;
      if (new URL(href).origin!==url.origin || !path.startsWith('/'+prefix+'/') || !path.endsWith('/zh') || href===address || seen.has(href) || !a.textContent?.trim()) continue;
      seen.add(href);entries.push(entry(a.textContent.trim(),href,true,'ctext'));
    }
    return {title,entries:entries.length?entries:[entry(title+' · 本篇',address,true,'ctext')],...(entries.length?{chapterBook:{title,chapters:entries}}:{}),website:address,notice:'只读取所选公开篇章；若原站要求验证，请在原站打开。'};
  }
  throw new Error('请选择预置公版书库，或使用网页书单 / GitHub 仓库类型。');
}
export function wikiCategory(title: string) {
  return WIKI+'w/api.php?action=query&list=categorymembers&format=json&cmlimit=50&cmtitle='+encodeURIComponent(title);
}

export function publicTextHtml(text: string, item: CatalogEntry): {title:string;html:string} {
  let title = item.title, html = '';
  if (item.textPage==='poetry') {
    const data = JSON.parse(text); const poems = Array.isArray(data) ? data : Array.isArray(data.chapters) ? data.chapters : [data];
    if (poems.length>5000) throw new Error('选集超过 5000 篇，请选择更小的文件');
    html = poems.map((p: Record<string, unknown>)=>{
      const paragraphs = p.paragraphs || p.content || p.contents;
      const lines = typeof paragraphs==='string' ? paragraphs.split('\n') : Array.isArray(paragraphs) ? paragraphs : [];
      if (!lines.length || lines.some(l=>typeof l!=='string')) return '';
      return '<h2>'+escapeHtml(String(p.title||p.rhythmic||p.chapter||p.section||'诗篇'))+'</h2>'+(p.author?'<p>'+escapeHtml(String(p.author))+'</p>':'')+lines.map(l=>'<p>'+escapeHtml(l)+'</p>').join('');
    }).join('');
  } else if (item.textPage==='kanripo') {
    title = /^#\+TITLE:\s*(.+)$/m.exec(text)?.[1]?.trim() || title;
    html = text.replace(/^#.*$/gm,'').replace(/<pb:[^>]*>/g,'').replace(/¶/g,'').split(/\n\s*\n/).filter(x=>x.trim()).map(x=>/^\*+\s/.test(x)?'<h2>'+escapeHtml(x.replace(/^\*+\s*/,''))+'</h2>':'<p>'+escapeHtml(x.trim().replace(/\n/g,''))+'</p>').join('');
  } else {
    const data = item.textPage==='wikisource' ? JSON.parse(text) : null;
    if (data?.error) throw new Error('此维基文库篇章暂不可读取');
    const root = doc(data ? data.parse?.text?.['*'] || '' : text);
    if (/challenges\.cloudflare|Checking the security|captcha/i.test(text)) throw new Error('原站要求验证，请在原站阅读。');
    root.querySelectorAll('script,style,nav,header,footer,.noprint,.mw-editsection,#headerContainer,.sisterproject,.catlinks').forEach(el=>el.remove());
    const nodes = item.textPage==='wikisource' ? Array.from(root.querySelectorAll('.mw-parser-output')).slice(0,1) : Array.from(root.querySelectorAll('.ctext')).filter(el=>el.textContent?.trim());
    html = nodes.flatMap(node=>Array.from(node.querySelectorAll('h1,h2,h3,p,li,dd'))).map(node=>'<'+(/H[123]/.test(node.tagName)?'h2':'p')+'>'+escapeHtml(node.textContent?.trim()||'')+'</'+(/H[123]/.test(node.tagName)?'h2':'p')+'>').join('');
    if (!html && nodes.length) html=nodes.map(n=>'<p>'+escapeHtml(n.textContent?.trim()||'')+'</p>').join('');
  }
  if (!html.replace(/<[^>]*>/g,'').trim()) throw new Error('未找到可读正文，请在原站查看此资料。');
  return {title,html};
}
export async function downloadPublicText(book: CatalogEntry, chapters: CatalogEntry[], signal: AbortSignal, progress?: (message:string)=>void): Promise<File> {
  if (!chapters.length || chapters.length>10000) throw new Error('每次请选择 1–10000 篇');
  const parts: string[] = []; let bytes=0, outputBytes=0, title=book.title;
  for (let i=0;i<chapters.length;i++) {
    signal.throwIfAborted(); const item=chapters[i]; progress?.('正在下载 '+(i+1)+' / '+chapters.length+'：'+item.title);
    const target=new URL(item.url);
    if (!item.textPage || !['zh.wikisource.org','ctext.org','raw.githubusercontent.com'].includes(target.hostname)) throw new Error('不支持的正文来源');
    const r=await requestBytes(item.url,{signal});bytes+=r.data.length;if(bytes>MAX_DOWNLOAD_BYTES)throw new Error('所选正文超过 256 MiB，请减少篇数');
    const parsed=publicTextHtml(new TextDecoder().decode(r.data),item);if(chapters.length===1)title=parsed.title;
    const part='<h1>'+escapeHtml(parsed.title)+'</h1>'+parsed.html+'<p>来源：'+escapeHtml(item.url)+'</p>';
    outputBytes+=new TextEncoder().encode(part).length;if(outputBytes>MAX_DOWNLOAD_BYTES)throw new Error('合并正文超过 256 MiB，请减少篇数');
    parts.push(part);
  }
  signal.throwIfAborted();
  return new File(['<!doctype html><html><head><meta charset="utf-8"><title>'+escapeHtml(title)+'</title></head><body>',...parts,'</body></html>'],title.replace(/[\\/:*?"<>|]/g,'_')+'.html',{type:'text/html'});
}
