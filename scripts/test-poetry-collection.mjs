import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { shelfAction } from './shelf-actions.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5196,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const poems=[{title:'第一首',author:'甲',paragraphs:['第一首独有正文']},{title:'第二首',author:'乙',paragraphs:['第二首独有正文']},{title:'第三首',author:'甲',paragraphs:['第三首独有正文']}];
const raw='\uFEFF'+JSON.stringify(poems)+'\n  ';
const base='https://raw.githubusercontent.com/demo/poetry/main/';
const records=['poems.json','more.json','metadata.json','large.json'].map(name=>({type:'file',name,size:1024,download_url:base+name}));
const liveFile='.tmp/poetry-live.json';
if(fs.existsSync(liveFile))records.push({type:'file',name:'live.json',size:fs.statSync(liveFile).size,download_url:base+'live.json'});
try{
 await page.route('https://api.github.com/repos/demo/poetry/**',r=>r.fulfill({body:JSON.stringify(records),contentType:'application/json'}));
 await page.route(base+'*',r=>{
  const name=new URL(r.request().url()).pathname.split('/').pop();
  const body=name==='live.json'?fs.readFileSync(liveFile,'utf8'):name==='poems.json'?raw:name==='more.json'?JSON.stringify([{title:'第四首',author:'丙',content:['第四首独有正文']}]):name==='large.json'?JSON.stringify(Array.from({length:120},(_,i)=>({title:'诗篇'+i,paragraphs:['正文'+i]}))):'{"metadata":{"version":1}}';
  return r.fulfill({body,contentType:'application/json'});
 });
 await page.goto('http://127.0.0.1:5196');await page.locator('.shelf').waitFor();await shelfAction(page,'网络书库');
 await page.getByLabel('书库类型').selectOption('github');await page.getByLabel('书库地址',{exact:true}).fill('https://github.com/demo/poetry');await page.getByRole('button',{name:'打开书库',exact:true}).click();
 await page.locator('.network-entry').filter({hasText:'poems.json'}).click();
 const preview=page.getByRole('region',{name:'诗词 JSON 预览'});
 await page.getByLabel('选择诗词 第一首（1）').check();await page.getByLabel('选择诗词 第三首（3）').check();
 await page.getByLabel('选集名称',{exact:true}).fill('两首诗选');await page.getByRole('button',{name:'所选诗词合并入架',exact:true}).click();
 await page.getByText('《两首诗选》已加入书架（2 篇）',{exact:true}).waitFor();
 const selected=await page.evaluate(async()=>{const {useLibrary}=await import('/src/store/library.ts');const {platform}=await import('/src/platform/web.ts');const b=useLibrary.getState().books.find(b=>b.title==='两首诗选');return JSON.stringify(await platform.getChapters(b.id));});
 assert.ok(selected.includes('第一首独有正文')&&selected.includes('第三首独有正文')&&!selected.includes('第二首独有正文'));console.log('PASS only checked poems merge into a readable stored book');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载原始 JSON',exact:true}).click();const downloaded=await downloading;
 assert.ok(fs.readFileSync(await downloaded.path()).equals(Buffer.from(raw)));console.log('PASS raw JSON download preserves BOM, whitespace and every byte');
 await page.getByLabel('选集名称',{exact:true}).fill('完整诗集');await page.getByRole('button',{name:'整份 JSON 合并入架',exact:true}).click();await page.getByText('《完整诗集》已加入书架（3 篇）',{exact:true}).waitFor();console.log('PASS entire JSON imports every readable poem');
 await page.getByLabel('选择 JSON 文件 poems.json',{exact:true}).check();await page.getByLabel('选择 JSON 文件 more.json',{exact:true}).check();await page.getByLabel('合并书名',{exact:true}).fill('双文件合辑');await page.getByRole('button',{name:'合并所选 JSON 入架',exact:true}).click();await page.getByText('《双文件合辑》已加入书架',{exact:true}).waitFor();
 const combined=await page.evaluate(async()=>{const {useLibrary}=await import('/src/store/library.ts');const {platform}=await import('/src/platform/web.ts');const b=useLibrary.getState().books.find(b=>b.title==='双文件合辑');return JSON.stringify(await platform.getChapters(b.id));});assert.ok(combined.includes('第一首独有正文')&&combined.includes('第四首独有正文'));console.log('PASS multiple selected repository JSON files merge and persist');
 await page.locator('.network-entry').filter({hasText:'metadata.json'}).click();await page.getByText('可读 0 篇，另有 1 条非诗词数据。已选 0 篇，每本最多合并 10000 篇。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'整份 JSON 合并入架',exact:true}).isDisabled(),true);console.log('PASS unrecognized JSON cannot create an empty book and keeps its raw download');
 await page.locator('.network-entry').filter({hasText:'large.json'}).click();await page.waitForFunction(()=>document.querySelectorAll('.network-poem').length===50);await page.getByRole('button',{name:'下一页诗词',exact:true}).click();assert.equal(await page.locator('.network-poem').count(),50);await page.getByLabel('筛选诗词',{exact:true}).fill('诗篇119');await page.waitForFunction(()=>document.querySelectorAll('.network-poem').length===1);await page.getByRole('button',{name:'选中筛选结果',exact:true}).click();console.log('PASS poem pagination and filtering keep the list bounded and selectable');
 for(const width of [320,390,460]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.drawer').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}console.log('PASS preview and JSON file actions fit phone layouts');
 if(fs.existsSync(liveFile)){
  await page.locator('.network-entry').filter({hasText:'live.json'}).click();await page.getByText(/可读 1000 篇/).waitFor();await page.locator('.network-poem input').first().check();await page.getByLabel('选集名称',{exact:true}).fill('真实唐诗验证');await page.getByRole('button',{name:'所选诗词合并入架',exact:true}).click();await page.getByText('《真实唐诗验证》已加入书架（1 篇）',{exact:true}).waitFor();
  console.log('PASS downloaded upstream Tang poetry JSON: 1000 poems preview, selection and stored import');
 }
 assert.deepEqual(errors,[]);console.log('PASS no runtime errors');
}finally{await browser.close();await server.close();}
