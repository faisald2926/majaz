import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('child-facing prototype cannot activate live Gemini through environment variables',async t=>{
  const oldKey=process.env.GEMINI_API_KEY,oldFetch=globalThis.fetch;
  process.env.GEMINI_API_KEY='test-placeholder-not-a-real-key';
  let outboundCalls=0;
  globalThis.fetch=async (...args)=>{outboundCalls++;throw new Error('External transport forbidden in this test');};
  const server=createApp({persist:false});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(route,token,body)=>oldFetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const keys=await (await call('/api/setup',null,{})).json();
  const parent=`/api/parent/${keys.libraryId}`;
  const result=await call(parent+'/draft',keys.parentToken,{sourceText:'نص مؤلف للاختبار',consent:true});
  assert.equal(outboundCalls,0,'Draft endpoint must not attempt an outbound request even with a configured key');
  assert.equal(result.status,503);
  const status=await (await call(parent+'/ai',keys.parentToken)).json();
  assert.equal(status.available,false);
  assert.match(status.reason,/18/);
  assert.equal((await call(parent+'/documents',keys.parentToken,{sourceTitle:'مصدر يدوي',cards:[{title:'بطاقة',text:'نص مؤلف'}]})).status,200);
});
