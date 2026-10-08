import test from 'node:test';import assert from 'node:assert/strict';import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createApp} from '../server.mjs';
test('failed persistence publishes neither approval nor rotated child credential',async t=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'majaz-transaction-'));let broken=false;
  const server=createApp({dataDir,writeFile:(...args)=>{if(broken)throw new Error('forced disk failure');writeFileSync(...args);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dataDir,{recursive:true,force:true});});
  const call=(route,token,body)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const k=await (await call('/api/setup',null,{})).json(),p=`/api/parent/${k.libraryId}`,c=`/api/child/${k.libraryId}`;
  const doc=await (await call(p+'/documents',k.parentToken,{sourceTitle:'قراءة',cards:[{title:'شمس',text:'ضوء'}]})).json();broken=true;
  assert.equal((await call(p+'/approve',k.parentToken,{id:doc.cards[0].id,version:doc.cards[0].version})).status,500);
  assert.deepEqual(await (await call(c+'/search',k.childToken)).json(),{cards:[]});
  assert.equal((await call(p+'/childlink',k.parentToken,{})).status,500);
  assert.equal((await call(c+'/status',k.childToken)).status,200);
});
