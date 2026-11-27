import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {shelfAction} from './shelf-actions.mjs';
const vite=await createServer({server:{host:'127.0.0.1',port:5211,strictPort:true},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const uploads=[];
const senderServer=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('src-tauri/src/wifi_upload.html'));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  res.setHeader('Content-Type','application/json');
  if(req.url==='/pair'){const input=JSON.parse(bytes);if(input.code!=='12345678'){res.writeHead(401).end(JSON.stringify({error:'配对码不正确'}));return;}res.end(JSON.stringify({token:'fixture-token'}));return;}
  if(req.headers.authorization!=='Bearer fixture-token'){res.writeHead(401).end('{}');return;}
  if(req.url.startsWith('/upload?')){const file={id:'upload-'+uploads.length,name:new URL(req.url,'http://test').searchParams.get('name'),bytes};uploads.push(file);res.end(JSON.stringify({id:file.id,status:'queued'}));return;}
  res.end(JSON.stringify({transfers:uploads.map(file=>({...file,bytes:undefined,status:'imported',message:'已入架：'+file.name}))}));
});
await new Promise(resolve=>senderServer.listen(0,'127.0.0.1',resolve));
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
    let next=1;const callbacks=new Map(),listeners=new Map();
    const snapshot={revision:0,running:false,urls:[],code:'',transfers:[]};const files=new Map();window.__wifiCalls=[];
    const signal=()=>{snapshot.revision++;for(const item of listeners.values())if(item.event==='wifi-transfer')callbacks.get(item.handler)?.({event:item.event,id:item.id,payload:null});};
    window.__wifiIncoming=(name,text)=>{const id='wifi-'+next++;const bytes=new TextEncoder().encode(text);files.set(id,bytes);snapshot.transfers.push({id,name,size:bytes.length,received:bytes.length,status:'queued',message:''});signal();};
    window.__wifiSnapshot=snapshot;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(_event,id){listeners.delete(id);}};
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=next++;callbacks.set(id,fn);return id;},unregisterCallback(id){callbacks.delete(id);},async invoke(command,args={}){
      if(command==='plugin:event|listen'){const id=next++;listeners.set(id,{id,...args});return id;}
      if(command==='plugin:event|unlisten')return;
      if(command.startsWith('wifi_'))window.__wifiCalls.push(command);
      if(command==='wifi_state')return structuredClone(snapshot);
      if(command==='wifi_start'){Object.assign(snapshot,{revision:snapshot.revision+1,running:true,urls:['http://192.168.1.20:18231/'],code:'12345678'});return structuredClone(snapshot);}
      if(command==='wifi_stop'){Object.assign(snapshot,{revision:snapshot.revision+1,running:false,urls:[],code:''});return structuredClone(snapshot);}
      if(command==='wifi_take'){const result=snapshot.transfers.filter(f=>f.status==='queued');for(const f of result)f.status='importing';return structuredClone(result);}
      if(command==='wifi_read_chunk'){const bytes=files.get(args.id).slice(args.offset,args.offset+262144);return window.__wifiJsonBytes?Array.from(bytes):bytes.buffer;}
      if(command==='wifi_complete'){const file=snapshot.transfers.find(f=>f.id===args.id);Object.assign(file,{status:args.success?'imported':'failed',message:args.message});files.delete(args.id);signal();return structuredClone(snapshot);}
      throw Error('Unmocked native command: '+command);
    }};
  });
  await page.goto('http://127.0.0.1:5211');await page.waitForFunction(()=>window.__rtLib?.getState().ready);
  assert.equal(await page.evaluate(()=>window.__wifiCalls.includes('wifi_start')),false);
  await shelfAction(page,'Wi-Fi 传书');await page.getByRole('button',{name:'开启 Wi-Fi 传书',exact:true}).click();
  await page.getByText('12345678',{exact:true}).waitFor();await page.getByText('http://192.168.1.20:18231/',{exact:true}).waitFor();
  for(const width of [320,390,1100]){await page.setViewportSize({width,height:844});assert.ok(await page.getByRole('dialog',{name:'Wi-Fi 传书'}).evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
  await page.evaluate(()=>window.__wifiIncoming('无线传书测试.txt','第一章\n\n这本书通过局域网传入。'));
  await page.getByText('已入架：《无线传书测试》',{exact:true}).waitFor();
  await page.evaluate(async()=>{const {applyWifiSnapshot,useWifiTransfer}=await import('/src/store/wifiTransfer.ts');const current=useWifiTransfer.getState();applyWifiSnapshot({revision:current.revision-1,running:false,urls:[],code:'',transfers:[]});});
  await page.getByText('已入架：《无线传书测试》',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__rtLib.getState().books.filter(b=>b.title==='无线传书测试').length),1);
  await page.evaluate(()=>{window.__wifiJsonBytes=true;window.__wifiIncoming('兼容通道书.txt','第一章\n\n备用 IPC 通道内容。');});
  await page.getByText('已入架：《兼容通道书》',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__rtLib.getState().books.filter(b=>b.title==='兼容通道书').length),1);
  await page.evaluate(()=>{window.__wifiJsonBytes=false;});
  await page.evaluate(()=>window.__wifiIncoming('损坏的书.epub','not a zip file'));
  await page.getByText('未完成',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__rtLib.getState().books.some(b=>b.title==='损坏的书')),false);
  await page.screenshot({path:'.tmp/wifi-transfer-receiver.png'});
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'阅读《无线传书测试》',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__wifiSnapshot.running),false);
  await page.reload();await page.getByRole('button',{name:'阅读《无线传书测试》',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS receiver: explicit start, pairing address/code, phone/desktop fit, real local import, damaged book rejected, close stops reception, book persists after restart');
  const sender=await browser.newPage({viewport:{width:390,height:844}});const senderErrors=[];sender.on('pageerror',e=>senderErrors.push(String(e)));
  await sender.goto(`http://127.0.0.1:${senderServer.address().port}`);
  await sender.getByLabel('输入阅读树上显示的 8 位配对码').fill('00000000');await sender.getByRole('button',{name:'连接阅读树',exact:true}).click();await sender.getByText('配对码不正确',{exact:true}).waitFor();
  await sender.getByLabel('输入阅读树上显示的 8 位配对码').fill('12345678');await sender.getByRole('button',{name:'连接阅读树',exact:true}).click();
  await sender.locator('#send').waitFor({state:'visible'});
  await sender.locator('#books').setInputFiles([{name:'中文书名.txt',mimeType:'text/plain',buffer:Buffer.from('中文正文')},{name:'second.md',mimeType:'text/markdown',buffer:Buffer.from('# 第二册\n正文')}]);
  await sender.getByRole('button',{name:'上传并入架',exact:true}).click();await sender.getByText('本次已入架 2 / 2 本，可返回阅读树查看。',{exact:true}).waitFor();
  assert.equal(uploads.length,2);assert.equal(uploads[0].name,'中文书名.txt');assert.equal(uploads[0].bytes.toString(),'中文正文');
  assert.ok(await sender.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await sender.screenshot({path:'.tmp/wifi-transfer-sender.png'});assert.deepEqual(senderErrors,[]);
  console.log('PASS sender page: wrong code, pairing, actual HTTP raw-file upload, multi-file sequencing, Unicode filenames, final imported acknowledgement, mobile fit');
  const web=await browser.newPage();await web.goto('http://127.0.0.1:5211');await web.waitForFunction(()=>window.__rtLib?.getState().ready);await shelfAction(web,'Wi-Fi 传书');
  await web.getByText('请使用电脑版或安卓版阅读树接收，网页版暂不支持开启接收服务。',{exact:true}).waitFor();await web.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await web.getByRole('dialog',{name:'Wi-Fi 传书'}).count(),0);
  console.log('PASS unsupported browser build explains native reception requirement and can close normally');
}finally{await browser.close();await vite.close();await new Promise(resolve=>senderServer.close(resolve));}
