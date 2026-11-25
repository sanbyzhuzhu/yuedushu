import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;console.log('✓ '+m)};
try{
 await page.goto('http://127.0.0.1:5197');
 const cases=await page.evaluate(async()=>{
  const {parseWebList}=await import('/src/engine/networkLibrary.ts');
  const c=parseWebList(`<title>好讀</title><a href="?M=hd&P=history">歷史</a><a href="?M=book&P=435">吶喊</a><a href="?M=book&P=AB435">有声书</a><div>魯迅《吶喊》<input value="下載 epub 檔" onclick="DownloadEpub('A435')"><input value="下載直式 epub 檔" onclick="DownloadVEpub('AV435')"></div><button onclick="DownloadEpub('../../x')">坏路径</button><button onclick="DownloadEpub('BAD');evil()">坏脚本</button>`, 'https://haodoo.net/?M=book&P=435');
  const n=parseWebList(`<h1>好讀二代</h1><article><h2 class="wp-block-post-title"><a href="?p=100">藏书</a></h2><a href="?product=101">下载页面</a><a href="?product=101&add-to-cart=101">购物车</a><a href="/book.epub">公开文件</a></article><a class="wp-block-query-pagination-next" href="?query-0-page=2">下页</a>`, 'https://haodoo.org/');
  return {c,n};
 });
 ok(cases.c.entries.filter(e=>e.download).length===2,'only known complete download calls become EPUB links');
 ok(cases.c.entries[0].url==='https://haodoo.net/PDB/A/435.epub','classic EPUB uses verified public path');
 ok(cases.c.entries[0].filename==='吶喊.epub','download keeps book title');
 ok(!cases.c.entries.some(e=>e.url.includes('AB435')),'audio entries are omitted');
 ok(cases.n.entries.length===3&&!cases.n.entries.some(e=>e.url.includes('add-to-cart')),'org browses public detail pages and never adds to cart');
 ok(cases.n.next==='https://haodoo.org/?query-0-page=2','org catalog pagination preserved');
 for(const [file,url] of [['haodoo-net.html','https://haodoo.net/'],['haodoo-category.html','https://haodoo.net/?M=hd&P=100'],['haodoo-detail.html','https://haodoo.net/?M=book&P=435'],['haodoo-org.html','https://haodoo.org/'],['haodoo-org-detail.html','https://haodoo.org/?p=128001']]){
  const path='.tmp/comfort/'+file;if(!fs.existsSync(path))continue;
  const c=await page.evaluate(async({text,url})=>(await import('/src/engine/networkLibrary.ts')).parseWebList(text,url),{text:fs.readFileSync(path,'utf8'),url});
  ok(c.entries.length>0,'live saved '+file+': '+c.entries.length+' entries');
  if(file==='haodoo-detail.html')ok(c.entries.some(e=>e.download&&e.url.endsWith('/A/435.epub')),'live detail exposes actual tested EPUB');
  if(file==='haodoo-org-detail.html')ok(c.entries.some(e=>e.url.includes('product=')),'live org book exposes download detail');
  if(file==='haodoo-org.html')ok(c.entries.some(e=>e.url.includes('p=128001')),'live org image-only book covers expose title and detail link');
 }
 console.log(`${checks} Haodoo checks passed.`);
}finally{await browser.close();await server.close()}
