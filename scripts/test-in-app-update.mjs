import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {shelfAction} from './shelf-actions.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5209,strictPort:true},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const target of ['windows','android']) {
    const context=await browser.newContext({viewport:{width:target==='android'?390:1100,height:844},...(target==='android'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'}:{})});
    const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:5209');await page.locator('.shelf').waitFor();
    await page.evaluate(async target=>{
      const {useAppUpdate}=await import('/src/store/appUpdate.ts');
      const {parseUpdateManifest}=await import('/src/engine/appUpdate.ts');
      const {useUpdateDownload}=await import('/src/store/updateDownload.ts');
      window.__download=useUpdateDownload;window.__calls=[];
      const release=parseUpdateManifest({version:'9.0.0',notes:'测试应用内更新',downloads:{windows:'https://fixture.test/update.exe',android:'https://fixture.test/update.apk'},sha256:{android:'a'.repeat(64)},platforms:{'windows-x86_64':{url:'https://fixture.test/update.exe',signature:'test-signature'}}});
      useAppUpdate.getState().configure('https://fixture.test/update.json',false);useAppUpdate.setState({manifest:release});
      if(target==='windows') {
        window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback(){},invoke:async(command,args)=>{
          window.__calls.push(command);
          if(command==='download_app_update') {
            args.onEvent.onmessage({status:'downloading',version:args.version,bytes:500,total:1000,message:''});
            await new Promise((resolve,reject)=>{window.__finishDownload=resolve;window.__rejectDownload=reject;});
          }
          if(command==='cancel_app_update') window.__rejectDownload?.('已取消');
        }};
      } else {
        window.__nativeState={status:'idle',version:'',bytes:0,total:0,message:''};
        window.ReadingTreeNativeUpdate={
          start(url,version,hash){window.__calls.push('download_app_update');window.__nativeState={status:'downloading',version,bytes:500,total:1000,message:''};return JSON.stringify(window.__nativeState);},
          status(){return JSON.stringify(window.__nativeState);},
          cancel(){window.__calls.push('cancel_app_update');window.__nativeState={status:'idle',version:'',bytes:0,total:0,message:''};return JSON.stringify(window.__nativeState);},
          install(){window.__calls.push('install_app_update');return JSON.stringify({...window.__nativeState,status:'ready',message:'已请求系统安装确认'});},
        };
        window.__finishDownload=()=>{window.__nativeState={status:'ready',version:'9.0.0',bytes:1000,total:1000,message:'校验完成'};useUpdateDownload.getState().refresh();};
      }
    },target);
    await shelfAction(page,'检查更新');
    await page.getByRole('button',{name:'应用内下载',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__calls.length),0);
    await page.getByRole('button',{name:'确认开始下载',exact:true}).click();
    await page.getByRole('progressbar',{name:'更新下载进度'}).waitFor();
    assert.equal(await page.evaluate(()=>window.__calls.includes('install_app_update')),false);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await shelfAction(page,'检查更新');
    await page.getByRole('button',{name:'取消下载',exact:true}).waitFor();
    await page.evaluate(()=>window.__finishDownload());
    await page.getByRole('button',{name:'安装更新',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__calls.includes('install_app_update')),false);
    await page.getByRole('button',{name:'安装更新',exact:true}).click();
    await page.getByRole('dialog',{name:'检查更新',exact:true}).getByRole('button',{name:'暂不更新',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__calls.includes('install_app_update')),false);
    await page.getByRole('button',{name:'安装更新',exact:true}).click();
    await page.getByRole('button',{name:target==='windows'?'确认安装并重启':'确认打开系统安装',exact:true}).click();
    await page.waitForFunction(()=>window.__calls.includes('install_app_update'));
    if(target==='windows') await page.evaluate(()=>window.__download.setState({status:'ready'}));
    await page.getByRole('button',{name:'移除安装包',exact:true}).click();
    await page.getByRole('button',{name:'应用内下载',exact:true}).waitFor();
    await page.getByRole('button',{name:'应用内下载',exact:true}).click();await page.getByRole('button',{name:'确认开始下载',exact:true}).click();
    await page.getByRole('button',{name:'取消下载',exact:true}).click();
    await page.waitForFunction(()=>window.__download.getState().status==='idle');
    assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x==='install_app_update').length),1);
    assert.equal(await page.getByRole('button',{name:'浏览器下载（备用）',exact:true}).count(),1);
    if(target==='windows') {
      await page.evaluate(()=>{window.__TAURI_INTERNALS__.invoke=async command=>{if(command==='download_app_update')throw '签名校验失败';};});
      await page.getByRole('button',{name:'应用内下载',exact:true}).click();await page.getByRole('button',{name:'确认开始下载',exact:true}).click();
      await page.getByText('签名校验失败',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'安装更新',exact:true}).count(),0);
    }
    await page.screenshot({path:`.tmp/in-app-update-${target}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${target}: explicit download confirmation, progress, panel reopen, separate install confirmation, cancellation, browser fallback${target==='windows'?', signature failure blocks install':''}`);
    await context.close();
  }
}finally{await browser.close();await server.close();}
