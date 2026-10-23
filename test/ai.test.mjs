import test from 'node:test';
import assert from 'node:assert/strict';
import {draft,aiStatus} from '../src/ai.mjs';
import {createApp} from '../server.mjs';
const env={MAJAZ_AI_ENABLED:'true',OPENAI_API_KEY:'mock-openai-only',ANTHROPIC_API_KEY:'mock-claude-only'};
const cards={cards:[{title:'الماء',text:'الماء مهم للنباتات.'}]};
const input=provider=>({provider,sourceText:'نص تعليمي مؤلف.',consent:true,noPersonalData:true,childAge:9,childToken:'do-not-send'});
const output=(provider,value=cards)=>provider==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}]};
const response=value=>new Response(JSON.stringify(value));

test('provider metadata reports separate configuration without exposing credentials',()=>{
  const result=aiStatus({env});assert.equal(result.available,true);
  assert.deepEqual(result.providers.map(p=>[p.id,p.configured,p.available]),[['openai',true,true],['anthropic',true,true]]);
  assert.equal(JSON.stringify(result).includes('mock-'),false);
  assert.equal(aiStatus({env:{...env,MAJAZ_AI_ENABLED:'false'}}).available,false);
  assert.equal(aiStatus({env:{...env,ANTHROPIC_API_KEY:''}}).providers[1].available,false);
});
test('drafts require explicit provider, sending consent, data declaration, activation and own key',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw new Error();};
  for(const [value,settings,status] of [[{...input('openai'),consent:false},env,400],[{...input('openai'),noPersonalData:false},env,400],[input('openai'),{...env,MAJAZ_AI_ENABLED:'false'},503],[input('openai'),{...env,OPENAI_API_KEY:''},503],[input('other'),env,400],[input('gemini'),env,503]])await assert.rejects(draft(value,{env:settings,fetchImpl}),e=>e.status===status);
  assert.equal(calls,0);
});
for(const provider of ['openai','anthropic'])test(provider+' uses its fixed endpoint, own key and structured output without child metadata',async()=>{
  let requests=0;
  const result=await draft(input(provider),{env,fetchImpl:async(url,options)=>{
    requests++;const body=JSON.parse(options.body);
    assert.equal(options.redirect,'error');assert.equal(JSON.stringify(body).includes('do-not-send'),false);assert.equal('childAge' in body,false);
    if(provider==='openai'){
      assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);assert.equal(options.headers['x-api-key'],undefined);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
    }else{
      assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],env.ANTHROPIC_API_KEY);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['anthropic-version'],'2023-06-01');assert.equal(body.output_config.format.type,'json_schema');
    }
    return response(output(provider));
  }});
  assert.equal(requests,1);assert.deepEqual(result,{provider,status:'draft',...cards});
});
test('invalid, incomplete, refused and oversized upstream output never becomes a draft',async()=>{
  const invalid=[{}, {cards:[]}, {cards:[{title:'أ',text:'ب',approval:true}]}, {cards:Array.from({length:21},()=>({title:'أ',text:'ب'}))}, {cards:[{title:'أ',text:'ب'.repeat(20001)}]}];
  for(const provider of ['openai','anthropic'])for(const value of invalid)await assert.rejects(draft(input(provider),{env,fetchImpl:async()=>response(output(provider,value))}),e=>e.status===502);
  for(const [provider,value,status] of [['openai',{status:'incomplete',output:[]},502],['openai',{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'refused'}]}]},422],['anthropic',{stop_reason:'refusal',content:[]},422],['anthropic',{stop_reason:'max_tokens',content:[]},502]])await assert.rejects(draft(input(provider),{env,fetchImpl:async()=>response(value)}),e=>e.status===status);
  await assert.rejects(draft(input('openai'),{env,fetchImpl:async()=>new Response('x'.repeat(300000))}),e=>e.status===502);
});
test('provider failure never exposes its response, retries or silently switches provider',async()=>{
  let calls=0;
  await assert.rejects(draft(input('openai'),{env,fetchImpl:async()=>{calls++;return new Response('mock-openai-only private upstream',{status:401});}}),e=>e.status===502&&!e.message.includes('private')&&!e.message.includes('mock-'));
  assert.equal(calls,1);
});
test('timeouts cover stalled headers and stalled response bodies',async()=>{
  await assert.rejects(draft(input('openai'),{env,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),e=>e.status===504);
  await assert.rejects(draft(input('anthropic'),{env,timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))}),e=>e.status===504);
});
test('only parent can request drafts, generation leaves library unchanged and quota bounds costs',async t=>{
  let calls=0;const server=createApp({persist:false,aiOptions:{env,fetchImpl:async()=>{calls++;return response(output('openai'));}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(route,token,body)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const keys=await (await call('/api/setup',null,{})).json(),parent='/api/parent/'+keys.libraryId,child='/api/child/'+keys.libraryId;
  for(const action of ['ai','draft']){
    assert.equal((await call(parent+'/'+action,keys.childToken,action==='draft'?input('openai'):undefined)).status,403);
    assert.equal((await call(child+'/'+action,keys.childToken,action==='draft'?input('openai'):undefined)).status,action==='ai'?405:404);
  }
  const before=await (await call(parent+'/library',keys.parentToken)).json();
  for(let i=0;i<5;i++)assert.equal((await call(parent+'/draft',keys.parentToken,input('openai'))).status,200);
  assert.equal((await call(parent+'/draft',keys.parentToken,input('openai'))).status,429);assert.equal(calls,5);
  assert.deepEqual(await (await call(parent+'/library',keys.parentToken)).json(),before);
  assert.deepEqual(await (await call(child+'/search',keys.childToken)).json(),{cards:[]});
});
