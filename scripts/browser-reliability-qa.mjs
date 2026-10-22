// Optional browser regressions: authored fixtures, real localhost HTTP, controlled response delays.
// The five-second scheduler and visibility events are simulated; this is not a browser timing certification.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/fysl9/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const server=createApp({persist:false});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
const results=[];
const call=async(route,token,body)=>{
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.ok,true,`Fixture HTTP ${response.status}`);return response.json();
};
async function fixture(){
  const keys=await call('/api/setup',null,{}),parent=`/api/parent/${keys.libraryId}`;
  const doc=await call(parent+'/documents',keys.parentToken,{sourceTitle:'مصدر اختبار مؤلف',cards:[{title:'بطاقة اختبار',text:'نص اختبار لا يمثل استخدامًا فعليًا.'}]});
  await call(parent+'/approve',keys.parentToken,{id:doc.cards[0].id,version:doc.cards[0].version});
  const page=await browser.newPage();page.setDefaultTimeout(3000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const original=window.setInterval;
    window.setInterval=(fn,ms,...args)=>{if(ms===5000){window.__testPoll=()=>fn(...args);return original(()=>{},2147483647);}return original(fn,ms,...args);};
  });
  await page.goto(`${base}/?role=child&library=${keys.libraryId}#token=${keys.childToken}`);
  await page.locator('.explore-card').waitFor();
  return {page,errors,revoke:()=>call(parent+'/revoke',keys.parentToken,{id:doc.cards[0].id})};
}
async function hold(page,pattern){
  let captured,release,finished,deliveryError;
  const ready=new Promise(r=>captured=r),gate=new Promise(r=>release=r),done=new Promise(r=>finished=r);
  await page.route(pattern,async route=>{
    const response=await route.fetch();captured();await gate;
    try{await route.fulfill({response});}catch(error){deliveryError=error;}finally{finished();}
  },{times:1});
  return {ready,release:async({allowAborted=false}={})=>{release();await done;if(deliveryError&&!allowAborted)throw deliveryError;await page.waitForTimeout(100);}};
}
async function check(name,run){
  const f=await fixture();
  try{await run(f);assert.deepEqual(f.errors,[]);results.push({name,passed:true});}
  catch(error){results.push({name,passed:false,error:error.message});}
  finally{await f.page.close();}
}
try{
  await check('A read response received after hiding the page cannot restore its card',async({page})=>{
    const delayed=await hold(page,'**/read?*');
    await page.getByRole('button',{name:'اقرأ البطاقة ←'}).click();await delayed.ready;
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await delayed.release();
    assert.equal(await page.getByRole('heading',{name:'المكتبة متوقفة مؤقتًا'}).count(),1);
    assert.equal(await page.getByText('نص اختبار لا يمثل استخدامًا فعليًا.',{exact:true}).count(),0);
  });
  await check('A delayed read cannot overwrite the topic form after navigation',async({page})=>{
    const delayed=await hold(page,'**/read?*');
    await page.getByRole('button',{name:'اقرأ البطاقة ←'}).click();await delayed.ready;
    await page.getByRole('button',{name:'✧  اطلب موضوعًا'}).click();
    await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).fill('كيف تتكون السحب؟');
    await delayed.release();
    assert.equal(await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).inputValue(),'كيف تتكون السحب؟');
    assert.equal(await page.locator('.reading-text').count(),0);
  });
  await check('Revision polling preserves an unsent topic and its consent',async({page,revoke})=>{
    await page.getByRole('button',{name:'✧  اطلب موضوعًا'}).click();
    await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).fill('كيف تتكون السحب؟');
    await page.getByRole('checkbox').check();await revoke();
    await page.evaluate(()=>window.__testPoll());
    assert.equal(await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).inputValue(),'كيف تتكون السحب؟');
    assert.equal(await page.getByRole('checkbox').isChecked(),true);
  });
  await check('Revocation detected by polling invalidates a previously requested read',async({page,revoke})=>{
    const delayed=await hold(page,'**/read?*');
    await page.getByRole('button',{name:'اقرأ البطاقة ←'}).click();await delayed.ready;await revoke();
    await page.evaluate(()=>window.__testPoll());await delayed.release();
    assert.equal(await page.locator('.reading-text,.explore-card').count(),0);
  });
  await check('A failed status check invalidates a previously requested read',async({page})=>{
    await page.route('**/status',route=>route.abort('failed'));
    const delayed=await hold(page,'**/read?*');
    await page.getByRole('button',{name:'اقرأ البطاقة ←'}).click();await delayed.ready;
    await page.evaluate(()=>window.__testPoll());await delayed.release();
    assert.equal(await page.getByRole('heading',{name:'توقف العرض حتى نتحقق'}).count(),1);
    assert.equal(await page.locator('.reading-text,.explore-card').count(),0);
  });
  await check('A hung status response pauses content after the request deadline',async({page})=>{
    const delayed=await hold(page,'**/status');
    await page.evaluate(()=>{void window.__testPoll();});await delayed.ready;
    try{
      await page.getByRole('heading',{name:'توقف العرض حتى نتحقق'}).waitFor({timeout:12000});
      assert.equal(await page.locator('.reading-text,.explore-card').count(),0);
    }finally{await delayed.release({allowAborted:true});}
  });
  await check('An unsent topic survives hiding and revalidating the page',async({page})=>{
    await page.getByRole('button',{name:'✧  اطلب موضوعًا'}).click();
    await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).fill('كيف تتكون السحب؟');
    await page.getByRole('checkbox').check();
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'الموضوع الذي يشد فضولك'}).inputValue(),'كيف تتكون السحب؟');
    assert.equal(await page.getByRole('checkbox').isChecked(),true);
  });
  console.log(JSON.stringify({date:new Date().toISOString(),liveGemini:false,results},null,2));
  if(results.some(r=>!r.passed))process.exitCode=1;
}finally{await browser.close();await new Promise(r=>server.close(r));}
