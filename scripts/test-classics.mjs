import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {shelfAction} from './shelf-actions.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5199,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:360,height:800}});
let checks=0;function ok(v,m){assert.ok(v,m);checks++;console.log('PASS '+m)}
try {
 await page.goto('http://127.0.0.1:5199');
 const result=await page.evaluate(async()=>{
  const m=await import('/src/engine/publicClassics.ts');
  const wiki=m.parsePublicCatalog(JSON.stringify({parse:{title:'論語',text:{'*':'<div class="mw-parser-output"><a href="/wiki/論語/學而第一">學而</a><a href="/wiki/論語/學而第一">重复</a><a href="/wiki/作者:孔子">作者</a></div>'}}}),m.wikiPage('論語'));
  const poem=m.publicTextHtml(JSON.stringify([{title:'静夜思',author:'李白',paragraphs:['床前明月光','<script>bad()</script>']}]),{title:'唐诗',url:'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/a.json',download:true,textPage:'poetry'});
  const kan=m.publicTextHtml('#+TITLE: 周易\n#+PROPERTY: ID abc\n<pb:abc>¶\n** 乾\n\n天行健，¶\n君子以自強不息。',{title:'x',url:'https://raw.githubusercontent.com/kanripo/a/master/a.txt',download:true,textPage:'kanripo'});
  const ctext=m.parsePublicCatalog('<title>論語</title><a href="analects/xue-er/zh">學而</a><a href="https://evil.test/analects/x/zh">外站</a>', 'https://ctext.org/analects/zh');
  let challenge=false;try{m.parsePublicCatalog('<script src="https://challenges.cloudflare.com/test"></script>','https://ctext.org/analects/xue-er/zh')}catch{challenge=true}
  const org=m.parsePublicCatalog(JSON.stringify([{name:'KR1a0001',description:'周易--',url:'https://api.github.com/repos/kanripo/KR1a0001'},{name:'tools',url:'https://api.github.com/repos/kanripo/tools'}]),'https://api.github.com/orgs/kanripo/repos?per_page=2&page=1');
  const standard=m.parsePublicCatalog('<h1>The Book</h1><a href="/ebooks/a/b/downloads/book.epub">Compatible epub</a><a href="/ebooks/a/b/downloads/book_advanced.epub">Advanced epub</a>','https://standardebooks.org/ebooks/a/b');
  const poetry=m.parsePublicCatalog(JSON.stringify([{type:'file',name:'authors.tang.json',size:100,download_url:'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/authors.tang.json'},{type:'file',name:'poet.tang.0.json',size:100,download_url:'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/poet.tang.0.json'}]),'https://api.github.com/repos/chinese-poetry/chinese-poetry/contents/全唐诗');
  let empty=false;try{m.publicTextHtml('[]',{title:'empty',url:'https://raw.githubusercontent.com/a/b/master/a.json',download:true,textPage:'poetry'})}catch{empty=true}
  const controller=new AbortController();controller.abort();let cancelled=false;try{await m.downloadPublicText({title:'x',url:'',download:false},wiki.entries,controller.signal)}catch(e){cancelled=e.name==='AbortError'}
  return {wiki,poem,kan,ctext,challenge,org,standard,poetry,empty,cancelled,roots:[m.publicRoot('https://zh.wikisource.org/'),m.publicRoot('https://ctext.org/zh')],normalized:m.normalizePublicUrl('https://zh.wikisource.org/wiki/論語')};
 });
 ok(result.wiki.entries.length===1&&result.wiki.chapterBook.chapters.length===1,'Wiki chapters deduplicated and author links excluded');
 ok(result.poem.html.includes('李白')&&result.poem.html.includes('&lt;script&gt;')&&!result.poem.html.includes('<script>'),'poems keep author and escape markup');
 ok(result.kan.title==='周易'&&!result.kan.html.includes('PROPERTY')&&!result.kan.html.includes('<pb:')&&result.kan.html.includes('<h2>乾</h2>'),'Kanripo headers and page markers normalized');
 ok(result.ctext.entries[0].url==='https://ctext.org/analects/xue-er/zh'&&result.ctext.entries.length===1,'ctext root-relative links resolve correctly');
 ok(result.challenge,'ctext challenge produces actionable error');
 ok(result.org.entries.length===1&&result.org.entries[0].title==='周易'&&result.org.next.endsWith('page=2'),'GitHub book repositories paginated and titled');
 ok(result.standard.entries.length===1&&result.standard.entries[0].url.endsWith('/book.epub'),'Standard selects compatible EPUB');
 ok(result.poetry.entries.length===1&&result.poetry.entries[0].textPage==='poetry','poetry ignores author metadata files');
 ok(result.empty&&result.cancelled,'empty text and cancellation do not create books');
 ok(result.roots.every(r=>r.entries.length>=10)&&result.normalized.includes('action=parse'),'curated roots and pasted Wiki pages supported');
 for(const [name,url] of [['wiki','https://zh.wikisource.org/w/api.php?action=parse&page=論語&prop=text&format=json'],['kanripo','https://api.github.com/orgs/kanripo/repos?per_page=20&page=1'],['kanbook','https://api.github.com/repos/kanripo/KR1a0001/contents'],['poetry','https://api.github.com/repos/chinese-poetry/chinese-poetry/contents'],['gitenberg','https://api.github.com/orgs/GITenberg/repos?per_page=20&page=1'],['standard','https://standardebooks.org/ebooks?sort=newest&per-page=12'],['standarddetail','https://standardebooks.org/ebooks/ernst-junger/the-storm-of-steel/basil-creighton'],['ctext','https://ctext.org/analects/zh']]) {
  const file='.tmp/public-classics/'+name+'.txt';if(!fs.existsSync(file))continue;
  const c=await page.evaluate(async({text,url})=>(await import('/src/engine/publicClassics.ts')).parsePublicCatalog(text,url),{text:fs.readFileSync(file,'utf8'),url});
  ok(c.entries.length>0,'actual saved '+name+' exposes '+c.entries.length+' entries');
  if(name==='standard')ok(c.next.includes('page=2')&&c.next.includes('sort=newest')&&c.next.includes('per-page=12'),'Standard pagination retains chosen ordering');
  if(name==='wiki')console.log('Wiki first chapter',c.entries[0]);
 }
 for(const [name,type] of [['wikiread','wikisource'],['poemread','poetry'],['kantext','kanripo']]) {
  if(!fs.existsSync('.tmp/public-classics/'+name+'.txt'))continue;
  const raw=fs.readFileSync('.tmp/public-classics/'+name+'.txt','utf8');
  const parsed=await page.evaluate(async({raw,type})=>(await import('/src/engine/publicClassics.ts')).publicTextHtml(raw,{title:'sample',url:'https://example.test/',download:true,textPage:type}),{raw,type});
  ok(parsed.html.length>100&&(!parsed.html.includes('<script>')),'actual '+type+' contains readable sanitized text');
 }
 await shelfAction(page,'网络书库');await page.locator('.network-discover summary').click();
 for(const title of ['中文维基文库','中华诗词','Kanripo 汉籍','中国哲学书电子化计划','GITenberg','Standard Ebooks','书格'])ok(await page.locator('.network-presets').getByText(title,{exact:false}).count()>0,'preset '+title);
 await page.locator('.network-presets button').filter({hasText:'中文维基文库'}).click();await page.locator('.network-results').waitFor();
 ok(await page.locator('.network-entry').count()===11,'Wiki preset exposes full portal plus classic shortcuts');
 await page.route('https://zh.wikisource.org/w/api.php**',async route=>{
  const title=new URL(route.request().url()).searchParams.get('page');
  const file='.tmp/public-classics/'+(title==='論語'?'wiki':'wikiread')+'.txt';
  const fixture=JSON.stringify({parse:{title:title==='論語'?'論語':'論語/學而第一',text:{'*':title==='論語'?'<div class="mw-parser-output"><a href="/wiki/論語/學而第一">學而第一</a></div>':'<div class="mw-parser-output"><p>子曰：學而時習之，不亦說乎？</p></div>'}}});
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:fs.existsSync(file)?fs.readFileSync(file,'utf8'):fixture});
 });
 await page.locator('.network-entry').filter({hasText:'論語'}).click();await page.locator('.network-entry').filter({hasText:'學而第一'}).click();
 await page.locator('.network-message').waitFor();
 ok((await page.locator('.network-message').textContent()).includes('已加入书架'),'actual Wiki chapter imports through UI');
 await page.locator('.network-entry').filter({hasText:'學而第一'}).click();await page.getByText('所选章节已在书架中，无需重复下载',{exact:true}).waitFor();
 ok(await page.evaluate(()=>window.__rtLib.getState().books.length)===1,'repeat chapter download does not create duplicate book');
 await page.getByLabel('下载章数',{exact:true}).fill('10000');
 ok(await page.getByRole('button',{name:'下载所选章节',exact:true}).isEnabled(),'10000 chapters accepted by actual UI');
 await page.locator('.drawer-head button').click();
 await page.locator('.book-open').waitFor();
 ok(await page.locator('.book-open').count()>0,'downloaded chapter appears on shelf');
 await page.evaluate(async()=>{const p=(await import('/src/platform/web.ts')).platform;const book=window.__rtLib.getState().books[0];await p.kvSet('progress:'+book.id,{chapter:0,page:2,pages:8,pct:.42,updatedAt:Date.now()})});
 await page.reload();await page.locator('.cell-more').waitFor();
 const before=await page.evaluate(async()=>{const p=(await import('/src/platform/web.ts')).platform;const book=window.__rtLib.getState().books[0];return {book,progress:await p.kvGet('progress:'+book.id),content:await p.getChapters(book.id)}});
 await page.locator('.cell-more').first().click();await page.getByRole('button',{name:'标记已读完',exact:true}).click();
 await page.locator('.cell-sub').filter({hasText:'已读完'}).waitFor();
 await page.reload();await page.locator('.cell-sub').filter({hasText:'已读完'}).waitFor();
 ok(await page.evaluate(()=>window.__rtLib.getState().books[0].completed===true),'completed persists after reload');
 ok(await page.locator('.continue-reading').count()===0,'completed book removed from continue reading');
 await page.locator('.f-chips').getByRole('button',{name:'读完',exact:true}).click();
 ok(await page.locator('.book-open').count()===1,'manual completion included in done filter');
 await page.locator('.cell-more').first().click();await page.getByRole('button',{name:'标记未读完',exact:true}).click();
 await page.waitForFunction(()=>window.__rtLib.getState().books[0].completed===false);
 const after=await page.evaluate(async()=>{const p=(await import('/src/platform/web.ts')).platform;const book=window.__rtLib.getState().books[0];return {progress:await p.kvGet('progress:'+book.id),content:await p.getChapters(book.id)}});
 ok(JSON.stringify(before.progress)===JSON.stringify(after.progress)&&JSON.stringify(before.content)===JSON.stringify(after.content),'completion toggles preserve reading position and book content');
 await page.locator('.f-chips').getByRole('button',{name:'在读',exact:true}).click();await page.locator('.book-open').waitFor();
 ok(await page.locator('.book-open').count()===1,'undo completion returns book to reading filter');
 await page.locator('.f-chips').getByRole('button',{name:'全部',exact:true}).click();
 await shelfAction(page,'网络书库');await page.locator('.network-discover summary').click();
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile has no horizontal overflow');
 fs.mkdirSync('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/classics-mobile.png'});
 console.log(checks+' classics checks passed');
}finally{await browser.close();await server.close()}
