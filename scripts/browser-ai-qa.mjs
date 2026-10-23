// Authored text and mocked provider responses; real local server and browser. No live API call.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/fysl9/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=process.env.AI_QA_OUTPUT||'qa/ai-providers';mkdirSync(folder,{recursive:true});
const calls=[];
const server=createApp({persist:false,aiOptions:{env:{MAJAZ_AI_ENABLED:'true',OPENAI_API_KEY:'mock-openai',ANTHROPIC_API_KEY:'mock-claude'},fetchImpl:async(url,options)=>{
  calls.push({provider:url.includes('openai')?'openai':'anthropic',body:JSON.parse(options.body)});
  const text=JSON.stringify({cards:[{title:'مسودة تعليمية مؤلفة',text:'نص مؤلف للاختبار، يراجعه البالغ.'}]});
  return new Response(JSON.stringify(url.includes('openai')?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:{stop_reason:'end_turn',content:[{type:'text',text}]}));
}}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE||'C:/Users/fysl9/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base);await page.getByRole('button',{name:'ابدأ مكتبتك',exact:true}).click();
  await page.getByRole('heading',{name:'معرفة تبدأ باختيارك'}).waitFor();
  const credentials=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith('majaz:parent:')))));
  const library=new URL(page.url()).searchParams.get('library');
  const child=await context.newPage();child.on('pageerror',e=>errors.push(e.message));
  await child.goto(`${base}/?role=child&library=${library}#token=${credentials.childToken}`);
  await child.getByRole('heading',{name:'أي سؤال يدور في بالك؟'}).waitFor();
  assert.equal(await child.getByText('مساعدة اختيارية في إعداد مسودة',{exact:false}).count(),0);
  const childCards=()=>child.evaluate(async()=>{const u=new URL(location.href),cred=JSON.parse(sessionStorage.getItem(`majaz:child:${u.searchParams.get('library')}`));return (await (await fetch(`/api/child/${u.searchParams.get('library')}/search`,{headers:{Authorization:'Bearer '+cred.token}})).json()).cards.length;});
  const source=page.getByRole('textbox',{name:'النص التعليمي لإعداد المسودة'}),consent=page.getByRole('checkbox',{name:'موافقة البالغ على إرسال النص التعليمي'}),provider=page.getByRole('combobox',{name:'مزود المسودة'});
  for(const id of ['openai','anthropic']){
    await page.getByRole('button',{name:'+ أضف مصدرًا',exact:true}).click();
    await page.locator('summary').filter({hasText:'مساعدة اختيارية في إعداد مسودة'}).click();
    await provider.selectOption(id);await source.fill('نص تعليمي مؤلف للاختبار فقط.');
    assert.equal(await consent.isChecked(),false);await consent.check();
    await page.getByRole('button',{name:'أنشئ مسودة للمراجعة'}).click();
    await page.getByRole('button',{name:'استخدم المسودة واستبدل بطاقات المحرر'}).waitFor();
    assert.equal(await childCards(),0);
    const editorInputs=page.locator('dialog .editor-card input');assert.equal(await editorInputs.count(),1);assert.equal(await editorInputs.first().inputValue(),'');
    checks.push(id+': preview does not modify editor, library or child content');
    if(id==='openai'){
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.getByRole('button',{name:'استخدم المسودة واستبدل بطاقات المحرر'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:folder+'/preview-mobile.png',fullPage:true});
      await page.setViewportSize({width:1440,height:1100});
      await provider.selectOption('anthropic');assert.equal(await consent.isChecked(),false);
      assert.equal(await page.getByRole('button',{name:'استخدم المسودة واستبدل بطاقات المحرر'}).count(),0);
      checks.push('Changing provider invalidates preview and sending consent');
      await provider.selectOption('openai');await consent.check();await page.getByRole('button',{name:'أنشئ مسودة للمراجعة'}).click();
      await page.getByRole('button',{name:'استخدم المسودة واستبدل بطاقات المحرر'}).waitFor();
    }
    await page.getByRole('button',{name:'استخدم المسودة واستبدل بطاقات المحرر'}).scrollIntoViewIfNeeded();
    await page.screenshot({path:folder+'/'+id+'-preview.png',fullPage:true});
    await page.getByRole('button',{name:'استخدم المسودة واستبدل بطاقات المحرر'}).click();
    assert.equal(await editorInputs.first().inputValue(),'مسودة تعليمية مؤلفة');
    if(id==='openai'){await page.getByRole('button',{name:'إلغاء',exact:true}).click();continue;}
    await page.locator('dialog input').first().fill('مصدر مؤلف للاختبار');
    await page.getByRole('button',{name:'احفظ كمسودة',exact:true}).click();
    await page.getByText('تحتاج مراجعة',{exact:true}).waitFor();assert.equal(await childCards(),0);
    await page.getByRole('button',{name:'راجع واعتمد'}).click();await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'اعتمد هذه النسخة'}).click();assert.equal(await childCards(),1);
    checks.push('Applied AI draft remains pending after save; only explicit parent approval exposes it');
  }
  assert.equal(calls.filter(c=>c.provider==='openai').length,2);assert.equal(calls.filter(c=>c.provider==='anthropic').length,1);
  assert.equal(JSON.stringify(calls).includes('childToken'),false);assert.deepEqual(errors,[]);
  const body=await page.locator('body').innerText();assert.equal(body.includes('mock-openai'),false);assert.equal(body.includes('mock-claude'),false);
  checks.push('Parent UI exposes no API keys; child has no AI controls; no page errors; 390px fits');
  const result={date:new Date().toISOString(),liveProviderCall:false,checks,errors};
  writeFileSync(folder+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
  console.log(JSON.stringify({errors,providerCalls:calls.map(c=>c.provider),notice:await page.locator('#notice').textContent(),error:error.message}));
  await page.screenshot({path:folder+'/failure.png',fullPage:true});
  throw error;
}finally{await browser.close();await new Promise(r=>server.close(r));}
