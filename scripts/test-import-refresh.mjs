import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {shelfAction,shelfSort,shelfView} from './shelf-actions.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5210,strictPort:true},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const probe=process.argv.includes('--probe');
try {
  const page=await browser.newPage({viewport:{width:1100,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5210');await page.waitForFunction(()=>window.__rtLib?.getState().ready);
  await page.evaluate(async()=>{
    const {platform}=await import('/src/platform/web.ts');
    await platform.kvSet('nodes',[{id:'literature',name:'文学',parentId:null}]);
    for(let i=0;i<65;i++){
      const id='refresh-old-'+i;
      await platform.putBook({id,title:'旧书 '+String(i).padStart(3,'0'),author:'测试',format:'txt',size:10,addedAt:100+i,updatedAt:100+i,nodeId:'literature'},[{title:'正文',html:'<p>测试正文</p>',chars:4}]);
      await platform.kvSet('progress:'+id,{chapter:0,page:0,pages:1,pct:1,updatedAt:100+i});
    }
  });
  await page.reload();await page.locator('.cell').first().waitFor();
  await shelfSort(page,'title');
  await page.locator('.side-item').filter({hasText:'文学'}).click();
  await page.getByLabel('搜索书名或作者').fill('旧书');
  await page.getByRole('button',{name:'读完',exact:true}).click();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.locator('.shelf > input[type=file]').setInputFiles({name:'即时入架书.txt',mimeType:'text/plain',buffer:Buffer.from('第一章\n\n刚加入的新书正文。')});
  await page.getByText('已导入 1 本',{exact:true}).waitFor();
  await page.waitForTimeout(100);
  const local={visible:await page.getByRole('button',{name:'阅读《即时入架书》',exact:true}).count(),query:await page.getByLabel('搜索书名或作者').inputValue(),first:await page.locator('.cell-title').first().textContent()};
  if(probe)console.log('BEFORE local import:',JSON.stringify(local));
  else {assert.equal(local.visible,1);assert.equal(local.query,'');assert.equal(local.first,'即时入架书');console.log('PASS local import clears obstructing search/category/status and reveals the book on page one, without changing preferred sort');}
  const race=await page.evaluate(async()=>{
    const {platform}=await import('/src/platform/web.ts');const lib=window.__rtLib;
    const original=platform.listBooks;const snapshot=await original();let finish;
    platform.listBooks=()=>new Promise(resolve=>{finish=()=>resolve(snapshot);});
    try {
      const loading=lib.getState().init();
      const book=await lib.getState().importFile(new File(['新书正文'],'并发入架书.txt'));
      finish();await loading;
      return {visible:lib.getState().books.some(b=>b.id===book.id),saved:(await original()).some(b=>b.id===book.id),duplicates:new Set(lib.getState().books.map(b=>b.id)).size!==lib.getState().books.length};
    }finally{platform.listBooks=original;}
  });
  if(probe)console.log('BEFORE late library reload:',JSON.stringify(race));
  else {assert.ok(race.visible&&race.saved&&!race.duplicates);console.log('PASS delayed library loading cannot erase a newly committed import or create duplicate IDs');}
  const batch=await page.evaluate(async()=>{
    const lib=window.__rtLib;const slow=new File(['第二本内容'],'慢速第二本.txt');const read=slow.arrayBuffer.bind(slow);let finish;
    const started=new Promise(resolve=>{Object.defineProperty(slow,'arrayBuffer',{value:()=>new Promise(done=>{finish=()=>read().then(done);resolve();})});});
    const work=lib.getState().importFiles([new File(['第一本内容'],'批量第一本.txt'),slow],()=>{});
    await started;const firstVisible=lib.getState().books.some(b=>b.title==='批量第一本');finish();await work;
    return {firstVisible,allVisible:['批量第一本','慢速第二本'].every(title=>lib.getState().books.some(b=>b.title===title))};
  });
  if(probe)console.log('BEFORE slow batch:',JSON.stringify(batch));
  if(!probe){
    assert.ok(batch.firstVisible&&batch.allVisible);console.log('PASS the first committed book appears while the next book is still parsing');
    await shelfView(page,'列表');await page.getByLabel('搜索书名或作者').fill('不会匹配新书');
    await page.route('https://refresh.fixture/book.txt',route=>route.fulfill({contentType:'text/plain',body:'第一章\n\n网络新书内容。'}));
    await shelfAction(page,'网络书库');await page.getByRole('tab',{name:'链接导入',exact:true}).click();
    await page.getByLabel('文件下载链接',{exact:true}).fill('https://refresh.fixture/book.txt');
    await page.getByLabel('文件名（可选，含扩展名）',{exact:true}).fill('网络即时书.txt');
    await page.getByRole('button',{name:'下载并加入书架',exact:true}).click();
    await page.getByText('《网络即时书》已加入书架',{exact:true}).waitFor();
    await page.getByRole('dialog',{name:'网络书库',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'阅读《网络即时书》',exact:true}).waitFor();
    assert.equal(await page.locator('.row-title').first().textContent(),'网络即时书');
    assert.equal(await page.locator('.shelf-sort').count(),0);
    await page.getByRole('button',{name:'排列',exact:true}).click();assert.equal(await page.getByLabel('排序方式').inputValue(),'title');await page.getByRole('button',{name:'完成',exact:true}).click();
    console.log('PASS network acquisition refreshes the list immediately while preserving the chosen title sort');
    await page.getByLabel('搜索书名或作者').fill('旧书');
    await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['第一章\n\n拖入正文。'],'拖入即时书.txt'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));});
    await page.getByRole('button',{name:'阅读《拖入即时书》',exact:true}).waitFor();
    console.log('PASS drag-in import uses the same immediate shelf reveal');
    await page.getByLabel('搜索书名或作者').fill('旧书');await page.getByRole('button',{name:'读完',exact:true}).click();
    await page.getByRole('button',{name:'阅读《旧书 000》',exact:true}).click();await page.locator('.reader').waitFor();
    await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['第一章\n\n阅读期间收书。'],'阅读中接收书.txt'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));});
    await page.waitForFunction(()=>window.__rtLib.getState().books.some(b=>b.title==='阅读中接收书'));
    await page.evaluate(()=>window.readingTreeBack());
    await page.getByRole('button',{name:'阅读《阅读中接收书》',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.row-title')?.textContent==='阅读中接收书');
    assert.equal(await page.locator('.row-title').first().textContent(),'阅读中接收书');
    console.log('PASS imports received while reading appear on return, even when saved shelf preferences would exclude them');
    const deletion=await page.evaluate(async()=>{
      const {platform}=await import('/src/platform/web.ts');const lib=window.__rtLib;const original=platform.listBooks;const snapshot=await original();let finish;
      platform.listBooks=()=>new Promise(resolve=>{finish=()=>resolve(snapshot);});
      try{const loading=lib.getState().init();await lib.getState().removeBook('refresh-old-0');finish();await loading;return lib.getState().books.some(b=>b.id==='refresh-old-0');}finally{platform.listBooks=original;}
    });assert.equal(deletion,false);console.log('PASS delayed reads do not resurrect books removed during loading');
    await page.screenshot({path:'.tmp/import-refresh-fixed.png'});assert.deepEqual(errors,[]);
  }
}finally{await browser.close();await server.close();}
