import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {shelfAction} from './shelf-actions.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5201,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5201');
 const fixture=JSON.stringify({parse:{title:'Portal:典籍',text:{'*':'<div class="mw-parser-output"><h2>經部</h2>'+Array.from({length:65},(_,i)=>'<a href="/wiki/典籍'+i+'">典籍'+i+'</a>').join('')+'<h2>史部</h2><a href="/wiki/Category:史部">史部分类</a><a href="/wiki/Portal:史書">史书门户</a><a href="/wiki/作者:某人">作者</a></div>'}}});
 const r=await page.evaluate(async raw=>{const m=await import('/src/engine/publicClassics.ts');const url=m.wikiPage('Portal:典籍');const root=m.parsePublicCatalog(raw,url);const first=m.parsePublicCatalog(raw,root.entries[0].url);const second=m.parsePublicCatalog(raw,first.next);const category=m.parsePublicCatalog(JSON.stringify({query:{categorymembers:[{title:'史記',ns:0},{title:'Category:正史',ns:14},{title:'作者:司馬遷',ns:102}]},continue:{cmcontinue:'abc|史記',continue:'-||'}}),m.wikiCategory('Category:史部'));return {root,first,second,category}},fixture);
 assert.equal(r.root.entries.length,2);assert.equal(r.first.entries.length,50);assert.equal(r.second.entries.length,15);assert.equal(r.category.entries.length,2);assert.ok(r.category.next.includes('cmcontinue='));assert.ok(r.category.entries[1].url.includes('categorymembers'));assert.ok(!r.first.chapterBook);
 console.log('PASS portal grouping, 50-item pagination, category continuation, namespace filtering and no accidental portal download');
 await page.route('https://zh.wikisource.org/w/api.php**',route=>{assert.ok(!new URL(route.request().url()).searchParams.has('rtsection'));return route.fulfill({contentType:'application/json',body:fixture})});
 await shelfAction(page,'网络书库');await page.locator('.network-discover summary').click();await page.locator('.network-presets button').filter({hasText:'中文维基文库'}).click();
 await page.locator('.network-entry').filter({hasText:'典籍总目录'}).click();await page.locator('.network-entry').filter({hasText:'經部'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.network-entry').length===50);await page.getByRole('button',{name:'下一页目录',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.network-entry').length===15);
 await page.getByRole('button',{name:'返回上层',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.network-entry').length===50);
 console.log('PASS public UI portal -> section -> next page -> back; local pagination parameters never sent to MediaWiki');
 if(fs.existsSync('.tmp/public-classics/portal.txt')){
  const live=await page.evaluate(async raw=>{const m=await import('/src/engine/publicClassics.ts');const root=m.parsePublicCatalog(raw,m.wikiPage('Portal:典籍'));let count=0;for(const e of root.entries){const c=m.parsePublicCatalog(raw,e.url);count+=c.entries.length;}return {root,count}},fs.readFileSync('.tmp/public-classics/portal.txt','utf8').replace(/\u0000/g,''));
  assert.ok(live.root.entries.length>5&&live.count>100);console.log('PASS actual portal: '+live.root.entries.length+' sections, '+live.count+' displayed entries');
 }
}finally{await browser.close();await server.close()}
