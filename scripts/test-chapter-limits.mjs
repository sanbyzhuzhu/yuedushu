import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:5202,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5202');
 const result=await page.evaluate(async()=>{
  const n=await import('/src/engine/networkLibrary.ts'),p=await import('/src/engine/publicClassics.ts');
  const item={title:'篇章',url:'https://raw.githubusercontent.com/kanripo/test/master/a.txt',download:true,textPage:'kanripo'};
  window.fetch=async(_url,options)=>{options.signal.throwIfAborted();return new Response('#+TITLE: 篇章\n\n古籍正文',{status:200})};
  const file=await p.downloadPublicText({title:'合集',url:'',download:false},Array(101).fill(item),new AbortController().signal);
  const large=n.parseGithub(JSON.stringify([{type:'file',name:'large.pdf',size:100*1024*1024,download_url:'https://raw.githubusercontent.com/a/b/main/large.pdf'},{type:'file',name:'oversize.pdf',size:257*1024*1024,download_url:'https://raw.githubusercontent.com/a/b/main/oversize.pdf'}]),'https://api.github.com/repos/a/b/contents');
  window.fetch=async()=>new Response('x',{status:200,headers:{'content-length':String(257*1024*1024)}});let sizeRejected=false;
  try{await n.downloadBook('https://example.test/oversize.txt','',new AbortController().signal)}catch(e){sizeRejected=e.message.includes('256')}
  const cancel=new AbortController();cancel.abort();let accepts10000=false,rejects10001=false;
  try{await p.downloadPublicText(item,Array(10000).fill(item),cancel.signal)}catch(e){accepts10000=e.name==='AbortError'}
  try{await p.downloadPublicText(item,Array(10001).fill(item),cancel.signal)}catch(e){rejects10001=e.message.includes('10000')}
  const controller=new AbortController();let sequentialCancelled=false;
  try{await n.downloadChapters(n.GXHJ_TEXT_SOURCE,item,Array(5000).fill({title:'章',url:'https://www.gxhj.com/txt/a/1.html',download:true}),controller.signal,()=>controller.abort())}catch(e){sequentialCancelled=controller.signal.aborted;}
  return {size:file.size,accepts10000,rejects10001,sequentialCancelled,sizeRejected,largeTitles:large.entries.map(e=>e.title),limit:n.MAX_DOWNLOAD_BYTES};
 });
  console.log(result);assert.ok(result.size>100);assert.ok(result.accepts10000&&result.rejects10001&&result.sequentialCancelled);
  assert.equal(result.limit,256*1024*1024);assert.deepEqual(result.largeTitles,['large.pdf']);assert.ok(result.sizeRejected);
 console.log('PASS 101-chapter batch succeeds, 10000 accepted, 10001 rejected, 5000-chapter batch remains cancellable');
}finally{await browser.close();await server.close()}
