/** Real-book reproduction plus isolated fixtures; pass a private EPUB path optionally. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({server:{host:'127.0.0.1',port:5198,strictPort:true}}); await server.listen();
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++;console.log('✓ '+m)};
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const settings=async patch=>{await page.evaluate(async patch=>(await import('/src/store/settings.ts')).useSettings.getState().set(patch),patch);await page.waitForTimeout(200)};
try {
 await page.goto('http://127.0.0.1:5198');await page.locator('.shelf').waitFor();
 await page.evaluate(async()=>{
  const {platform}=await import('/src/platform/web.ts');
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=1400;const ctx=canvas.getContext('2d');ctx.fillStyle='#ded0ac';ctx.fillRect(0,0,900,1400);const src=canvas.toDataURL();
  const html=`<style>body{background:red} .fixed {font:16px/4 serif;margin-left:-40px} img {width:100%;height:100%}</style><h1>阅读舒适度</h1><p class="fixed"><span style="font-size:16px;line-height:80px">字号应随设置变化</span><sup><img src="${src}" width="16" height="16"></sup></p><div><img src="${src}" width="900"></div>`+'<p style="font-size:16px">'+ '一窗晴日，半盏清茶，静心读书。'.repeat(150)+'</p>';
  await platform.putBook({id:'comfort',title:'阅读舒适度',author:'测试',format:'epub',size:1,addedAt:1,nodeId:null},[{title:'第一章',html,chars:2200}]);
  await platform.kvSet('annotations:comfort',{list:[{id:'note',bookId:'comfort',kind:'highlight',chapter:0,exact:'字号应随设置变化',prefix:'',suffix:'',color:'red',note:'已有笔记',createdAt:1}],deleted:[]});
 });
 await page.reload();await page.getByRole('button',{name:'阅读《阅读舒适度》',exact:true}).click();await page.waitForFunction(()=>window.__rtPag?.pages>1);
 for(const warmth of [5,30,60]) {
  await settings({warmth});
  const data=await page.locator('.warm-layer').evaluate(el=>({color:getComputedStyle(el).backgroundColor,stage:el.parentElement.className,pointer:getComputedStyle(el).pointerEvents}));
  const alpha=Number(data.color.match(/,\s*([\d.]+)\)$/)?.[1]);
  ok(Math.abs(alpha-warmth*.003)<.003&&data.stage==='reader-stage'&&data.pointer==='none',`warmth ${warmth} uses gentle ${alpha} opacity only over reading stage`);
 }
 await settings({warmth:0});ok(await page.locator('.warm-layer').count()===0,'warmth reset removes tint completely');
 for(const flow of ['horizontal','vertical']){
  await settings({flow,fontSize:28,lineHeight:1.8,decorFrame:true,pageMarginX:36,pageMarginY:44});
  const data=await page.evaluate(()=>{
   const root=document.querySelector('.page-inner'),span=root.querySelector('p span'),small=root.querySelector('sup img'),big=root.querySelector('div img');
   return {font:parseFloat(getComputedStyle(span).fontSize),line:parseFloat(getComputedStyle(span).lineHeight),small:small.getBoundingClientRect().height,big:big.getBoundingClientRect().height,limit:parseFloat(root.style.getPropertyValue('--reader-image-height')),style:root.querySelectorAll('style').length,mark:root.querySelector('mark')?.textContent};
  });
  ok(data.font===28,flow+' fixed 16px text follows 28px');ok(data.line<=51,flow+' source line-height is removed');ok(data.small<=29,flow+' footnote icon remains inline');ok(data.big<=data.limit+1,flow+' large image fits reading height');ok(data.style===0&&data.mark==='字号应随设置变化',flow+' CSS scoped away and note preserved');
  await page.evaluate(()=>window.__rtPag.goTo(0));await page.waitForTimeout(600);
  const sequence=[];for(let i=0;i<3;i++){await page.touchscreen.tap(flow==='horizontal'?380:10,400);await page.waitForTimeout(300);sequence.push(await page.evaluate(()=>window.__rtPag.page));}
  ok(sequence.join(',')==='1,2,3',flow+' one tap advances one page: '+sequence.join(','));
 }
 await settings({flow:'horizontal',readMode:'paged',fontSize:28,pageMarginX:36});
 const lastPage=await page.evaluate(()=>{
  const pag=window.__rtPag;pag.goTo(pag.pages-1);
  const outer=document.querySelector('.page-outer');
  return {actual:outer.scrollLeft,expected:pag.page*pag.step};
 });
 ok(Math.abs(lastPage.actual-lastPage.expected)<1,'last page reaches its full offset without browser clamping at the margin');
 await settings({flow:'horizontal',readMode:'scroll',fontSize:32});await page.locator('.scroll-ch-body').waitFor();
 ok(await page.locator('.scroll-ch-body p span').first().evaluate(el=>getComputedStyle(el).fontSize)==='32px','scroll text follows font setting');
 ok(await page.locator('.scroll-ch-body div img').evaluate(el=>el.getBoundingClientRect().width<=318),'scroll image fits mobile width');
 await settings({paraSpacing:1});ok(await page.locator('.scroll-ch-body p').first().evaluate(el=>parseFloat(getComputedStyle(el).marginBottom))===32,'scroll paragraph spacing follows the reading setting');
 await settings({readMode:'paged',keepBookCss:false});ok(await page.locator('.page-inner p span').first().evaluate(el=>getComputedStyle(el).fontSize)==='32px','uniform style applies to already imported book');
 if(process.argv[2]){
  const bytes=fs.readFileSync(process.argv[2]);
  await page.reload();await page.locator('.shelf').waitFor();
  await settings({keepBookCss:true});
  const result=await page.evaluate(async bytes=>{
   const lib=(await import('/src/store/library.ts')).useLibrary;const book=await lib.getState().importFile(new File([new Uint8Array(bytes)],'巴拉吉预言.epub'));
   const platform=(await import('/src/platform/web.ts')).platform;const chapters=await platform.getChapters(book.id);const index=chapters.findIndex(c=>c.title.includes('说明')||c.title.includes('說明'));
   await platform.kvSet('progress:'+book.id,{chapter:index,page:0,pages:1,pct:0,updatedAt:Date.now()});return {title:book.title,index};
  },Array.from(bytes));
  ok(result.index>=0,'real EPUB important notes chapter located');
  await settings({flow:'horizontal',readMode:'paged',fontSize:19,keepBookCss:true});
  await page.getByRole('button',{name:`阅读《${result.title}》`,exact:true}).click();await page.locator('.page-inner p span').first().waitFor();
  for(const size of [19,28,36]){
   await settings({fontSize:size});
   const measured=await page.locator('.page-inner p span').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   ok(Math.abs(measured-size)<.1,`real EPUB notes body: requested ${size}, measured ${measured}`);
  }
  await settings({fontSize:24});fs.mkdirSync('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/balaji-comfort.png'});
  await settings({readMode:'scroll'});await page.locator('.scroll-ch-body img').first().waitFor({state:'attached'});
  const images=await page.locator('.scroll-ch-body img').evaluateAll(async imgs=>{
   await Promise.allSettled(imgs.map(img=>img.decode()));
   return imgs.map(img=>({w:img.getBoundingClientRect().width,h:img.getBoundingClientRect().height,natural:img.naturalWidth,limit:parseFloat(getComputedStyle(img).maxHeight)}));
  });
  ok(images.length>0&&images.every(img=>img.natural>0&&img.w<=318.5&&img.h<=img.limit+.5),`real EPUB ${images.length} illustrations fit mobile reading area`);
 }
 ok(errors.length===0,'no runtime errors: '+errors.join(';'));console.log(`${checks} reading comfort checks passed.`);
}finally{await browser.close();await server.close()}
