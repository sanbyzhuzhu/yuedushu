import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { shelfAction } from './shelf-actions.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5203,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5203');
 const checks=await page.evaluate(async()=>{
  const net=await import('/src/engine/networkLibrary.ts');const rules=await import('/src/engine/sourceRules.ts');const legacy=await import('/src/engine/legacySource.ts');
  const checks=[];const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
  const doc=new DOMParser().parseFromString('<div class="r"><a href="/first">第一</a><a href="/second">第二</a><a href="/third">第三</a><span>作者甲</span></div>','text/html');const signal=new AbortController().signal;
  check(await rules.sourceRuleValue(doc,'.r@tag.a.1@text',signal)==='第二','node indexes and chain selectors');
  check(legacy.legacyElements(doc,'class.r@tag.a!0:-1').length===1,'node exclusions preserve original negative indexes');
  check(await rules.sourceRuleValue(doc,'#absent@text||.r span@text',signal)==='作者甲','CSS alternatives choose first nonempty result');
  check(await rules.sourceRuleValue(doc,'.r@tag.a.0@text&&.r@tag.a.-1@text',signal)==='第一\n第三','combination rules retain order');
  check(await rules.sourceRuleValue(doc,'.r@tag.a.0:2@text',signal)==='第一\n第三','multiple indexes select only requested nodes');
  const meta=new DOMParser().parseFromString('<meta property="og:novel:book_name" content="诗集"><a href="/book/1">书</a>','text/html');
  check(await rules.sourceRuleValue(meta,'[property=og:novel:book_name]@content',signal)==='诗集','Jsoup-style unquoted attribute values normalize to browser CSS');
  check(legacy.legacyElements(meta,'a[href^="/book/"]').length===1,'CSS attribute prefix operators remain selectors');
  check(await rules.sourceRuleValue(doc,'.r span@text||',signal)==='作者甲','trailing empty fallback does not reject a usable selector');
  check(await rules.sourceRuleValue(doc,'.//a[2]/text()',signal)==='第二','native XPath extracts relative text');
  check(await rules.sourceRuleValue({a:{list:[{name:'诗'}]}},'$.a.list[0].name',signal)==='诗','JSONPath selects data without script evaluation');
  check(await rules.sourceRuleValue(doc,'.r span@text##^作者##',signal)==='甲','regex replacement runs in a bounded worker');
  const calls=[],realFetch=window.fetch;
  const html=s=>s.replace(/[^\x00-\x7f]/g,c=>'&#'+c.charCodeAt(0)+';');
  window.fetch=async(url,init)=>{
   if(!String(url).includes('.test'))return realFetch(url,init);calls.push({url:String(url),method:init.method,headers:init.headers,body:init.body,credentials:init.credentials});
   const u=new URL(url);let body='',type='text/html; charset=gbk';
   if(u.pathname==='/search')body='<table class="results"><tr><th>标题</th></tr><tr><td><a href="/book">书名：西游记</a></td><td>作者：吴承恩</td></tr></table>';
   else if(u.pathname==='/book')body='<a href="/wrong">广告</a><div class="detail"><a href="/toc?page=1">目录</a></div>';
   else if(u.pathname==='/toc')body='<div id="toc"><a href="/c1.html">第一章</a>'+(u.searchParams.get('page')==='2'?'<a href="/c2.html">第二章</a>':'')+'</div><a class="next" href="/toc?page='+ (u.searchParams.get('page')==='1'?'2':'1')+'">下一页</a>';
   else if(u.pathname==='/c1.html')body='<div id="content"><p>正文一甲</p><p>广告水印</p><script>unsafe()</script></div><a class="next" href="/c1_2.html">下一页</a>';
   else if(u.pathname==='/c1_2.html')body='<div id="content"><p>正文一乙</p></div><a class="next" href="/c2.html">下一章</a>';
   else if(u.pathname==='/c2.html')body='<div id="content"><p>正文二</p></div>';
   else if(u.hostname==='json.test'){
    type='application/json; charset=utf-8';
    body=JSON.stringify(u.pathname==='/api'?{data:{list:[{id:1,name:'三国',writer:'罗贯中'}]}}:u.pathname==='/book/1'?{data:{chapters:[{title:'第一回',url:'/chapter/1'}]}}:{data:{body:'<p>三国公开正文</p>'}});
   }else if(u.hostname==='legacy.test'){
    body=u.pathname==='/s.php'?'<div class="result"><a href="/oldbook">红楼梦</a><span>曹雪芹</span></div>':u.pathname==='/oldbook'?'<div id="list"><a>重复头部</a><a href="/oldchapter">第一回</a></div>':'<div id="content">旧版正文<br>第二段<script>unsafe()</script></div>';
   }else if(u.hostname==='xpath.test')body=u.pathname==='/find'?'<div class="book"><a href="/xbook">论语</a><span>孔子</span></div>':u.pathname==='/xbook'?'<ul id="list"><li><a href="/xchapter">学而</a></li></ul>':'<div id="content"><p>学而时习之。</p></div>';
   else throw new Error('Unknown test URL '+url);
   return new Response(type.startsWith('application/json')?body:html(body),{headers:{'Content-Type':type}});
  };
  window.__sourceTestFetch=window.fetch;
  try{
   const raw={bookSourceName:'POST GBK',bookSourceUrl:'http://source.test/',searchUrl:'/search,{method:"POST",charset:"gbk",body:"q={{key}}&page={{page}}"}',header:'{"User-Agent":"ReaderTest","Referer":"http://source.test/"}',ruleSearch:{bookList:'class.results@tag.tr!0',name:'tag.td.0@tag.a@text##^书名：',author:'tag.td.1@text##作者：',bookUrl:'tag.a.0@href'},ruleBookInfo:{init:'.detail',tocUrl:'a@href'},ruleToc:{chapterList:'#toc a',chapterName:'@text',chapterUrl:'@href',nextTocUrl:'.next@href'},ruleContent:{content:'#content@html##广告',replaceRegex:'##水印',nextContentUrl:'.next@href'}};
   window.__sourceTestRaw=raw;
   const parsed=net.parseSources(JSON.stringify([raw]));check(parsed.sources.length===1,'modern source imports POST, GBK, headers and declarative rules');const source=parsed.sources[0];
   const found=await net.searchSource(source,'西游记',1,signal);check(found.length===1&&found[0].title==='西游记'&&found[0].author==='吴承恩','POST GBK search extracts book and author');
   check(calls[0].body==='q=%CE%F7%D3%CE%BC%C7&page=1'&&calls[0].headers['User-Agent']==='ReaderTest'&&calls[0].credentials==='omit','anonymous POST sends GBK form and ordinary headers');
   const toc=await net.sourceChapters(source,found[0],signal);check(toc.length===2&&toc[1].title==='第二章','detail scope, paginated TOC, deduplication and loop stopping');
   const file=await net.downloadChapters(source,found[0],toc.slice(0,1),signal,()=>{});const text=await file.text();check(text.includes('正文一甲')&&text.includes('正文一乙')&&!text.includes('水印')&&!text.includes('广告')&&!text.includes('<script>')&&!calls.some(c=>c.url.endsWith('/c2.html')),'same-chapter pages merge without following next chapter or keeping scripts');
   const {useLibrary}=await import('/src/store/library.ts');const {platform}=await import('/src/platform/web.ts');const stored=await useLibrary.getState().importFile(file);check((await platform.getChapters(stored.id)).length===1,'full enhanced source flow stores exactly the selected chapter');
   const old={bookSourceName:'旧版',bookSourceUrl:'http://legacy.test/',ruleSearchUrl:'/s.php@searchkey=searchKey|char=gbk',httpUserAgent:'LegacyReader',ruleSearchList:'class.result',ruleSearchName:'tag.a@text',ruleSearchNoteUrl:'tag.a@href',ruleSearchAuthor:'tag.span@text',ruleChapterUrl:'',ruleChapterList:'id.list@tag.a!0',ruleChapterName:'text',ruleContentUrl:'href',ruleBookContent:'id.content@textNodes'};
   const oldSource=net.parseSources(JSON.stringify([old])).sources[0];const oldBooks=await net.searchSource(oldSource,'红楼梦',1,signal);const oldToc=await net.sourceChapters(oldSource,oldBooks[0],signal);const oldText=await (await net.downloadChapters(oldSource,oldBooks[0],oldToc,signal,()=>{})).text();check(oldText.includes('旧版正文')&&oldText.includes('第二段')&&!oldText.includes('unsafe()'),'legacy 2.x fields, POST template and textNodes complete the reading flow');
   const jsonSource=net.parseSources(JSON.stringify([{bookSourceName:'JSON',bookSourceUrl:'http://json.test/',searchUrl:'/api?q={{key}}',ruleSearch:{bookList:'$.data.list[*]',name:'$.name',author:'$.author||$.writer',bookUrl:'http://json.test/book/{{$.id}}'},ruleBookInfo:{init:'$.data'},ruleToc:{chapterList:'$.data.chapters[*]',chapterName:'$.title',chapterUrl:'$.url'},ruleContent:{content:'$.data.body'}}])).sources[0];
   const jsonBooks=await net.searchSource(jsonSource,'三国',1,signal);const jsonToc=await net.sourceChapters(jsonSource,jsonBooks[0],signal);const jsonText=await(await net.downloadChapters(jsonSource,jsonBooks[0],jsonToc,signal,()=>{})).text();check(jsonBooks[0].author==='罗贯中'&&jsonText.includes('三国公开正文'),'JSONPath, fallback fields and URL templates complete search to content');
   const xp=net.parseSources(JSON.stringify([{bookSourceName:'XPath',bookSourceUrl:'http://xpath.test/',searchUrl:'/find?q={{key}}',ruleSearch:{bookList:'//div[@class="book"]',name:'.//a/text()',bookUrl:'.//a/@href',author:'normalize-space(.//span)'},ruleToc:{chapterList:'//*[@id="list"]/li',chapterName:'.//a/text()',chapterUrl:'.//a/@href'},ruleContent:{content:'//*[@id="content"]/p/text()'}}])).sources[0];check(!!xp,'XPath source imports');const xpBooks=await net.searchSource(xp,'论语',1,signal);const xpToc=await net.sourceChapters(xp,xpBooks[0],signal);const xpText=await(await net.downloadChapters(xp,xpBooks[0],xpToc,signal,()=>{})).text();check(xpText.includes('学而时习之'),'native XPath completes search, TOC and content');
   for(const patch of[{loginUrl:'https://login.test/'},{header:'{"Cookie":"secret"}'},{header:'{"Authorization":"secret"}'},{searchUrl:'/search,{method:"POST",body:"password=secret"}'},{ruleContent:{content:'<js>window.__executed=true</js>'}}])check(net.parseSources(JSON.stringify([{...raw,...patch}])).sources.length===0,'login/auth/script source excluded');
   check(!window.__executed,'imported scripts are never evaluated');
   const abort=new AbortController();const work=legacy.replaceSourceText('a'.repeat(1000)+'!', '^(a+)+$', '',abort.signal);abort.abort();let canceled=false;try{await work}catch{canceled=true}check(canceled,'cancelled expensive replacement terminates the worker');
   let timedOut=false;try{await legacy.replaceSourceText('a'.repeat(1000)+'!','^(a+)+$','',signal)}catch(e){timedOut=e.message.includes('超时')}check(timedOut,'pathological regex is terminated by timeout');
   check(await legacy.replaceSourceText('作者：李白','作者：','',signal)==='李白','worker recovers after cancellation and timeout');
  }finally{window.fetch=realFetch}
  return checks;
 });checks.forEach(c=>console.log('PASS '+c));assert.ok(checks.length>=20);console.log(checks.length+' lightweight source engine checks passed');
 await page.evaluate(()=>{window.fetch=window.__sourceTestFetch;});
 await shelfAction(page,'网络书库');await page.getByRole('tab',{name:'阅读书源'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导入书源 JSON / TXT'&&!b.disabled));
 const fixture=await page.evaluate(()=>window.__sourceTestRaw);
 await page.locator('.drawer input[type=file]').setInputFiles({name:'post-gbk.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([fixture]))});
 await page.getByText('已导入 1 个兼容书源',{exact:true}).waitFor();await page.getByLabel('搜索书名 / 作者').fill('西游记');await page.getByRole('button',{name:'搜索书源',exact:true}).click();
 await page.getByRole('button',{name:'搜索下一页（当前 1）',exact:true}).click();await page.getByRole('button',{name:'搜索下一页（当前 2）',exact:true}).waitFor();
 await page.locator('.network-entry').filter({hasText:'西游记'}).click();await page.getByText('目录共 2 章。每次最多下载 10000 章，总正文最多 256 MiB，可分批收藏。',{exact:true}).waitFor();
 await page.getByLabel('下载章数',{exact:true}).fill('1');await page.getByRole('button',{name:'下载所选章节',exact:true}).click();await page.getByText('《西游记 · 1–1章》已加入书架',{exact:true}).waitFor();console.log('PASS actual UI import, POST GBK search, next search page, TOC and selected chapter storage');
 await page.locator('.drawer input[type=file]').setInputFiles({name:'login.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{...fixture,bookSourceName:'登录源',loginUrl:'https://login.test/',header:'{"Cookie":"secret"}'}]))});
 await page.getByRole('alert').filter({hasText:'登录书源不导入'}).waitFor();
 const saved=await page.evaluate(async()=>{const {platform}=await import('/src/platform/web.ts');return await platform.kvGet('networkSources')});assert.equal(saved.length,1);assert.ok(!JSON.stringify(saved).includes('secret'));console.log('PASS rejected login source never reaches persisted source storage');
}finally{await browser.close();await server.close()}
