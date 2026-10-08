import test from 'node:test';
import assert from 'node:assert/strict';
import { Library } from '../src/corpus.mjs';
const fixture = (mode='correlated') => {
  const lib=new Library();
  lib.configure({childAge:9,policyVersion:'1'});
  const doc=lib.create({sourceTitle:'علوم مؤلفة',mode,independentDeclared:mode==='independent',cards:[{title:'الشمس',text:'تمد الشمس النباتات بالضوء.'},{title:'خاص سري',text:'عبارة الكنـز الخاصة غير المعتمدة'}]});
  return {lib,doc};
};
// A broken filter would leak private titles, text, hashes, or counts.
test('child search and export serialize approved cards only, with no private fields or global counts',()=>{
  const {lib,doc}=fixture();lib.approve(doc.cards[0].id,doc.cards[0].version);
  assert.deepEqual(lib.search('الكنـز'),{cards:[]});
  const output=JSON.stringify(lib.exportChild());
  for(const secret of ['خاص سري','الكنـز','approval','hash','policyVersion','sourceTitle']) assert.equal(output.includes(secret),false,secret);
  assert.deepEqual(lib.search('الشمس').cards.map(c=>c.title),['الشمس']);
});
test('correlated edits invalidate all sibling approvals and stale reads return 409',()=>{
  const {lib,doc}=fixture();for(const c of doc.cards)lib.approve(c.id,c.version);
  const first=lib.read(doc.cards[0].id);lib.edit(doc.id,{cards:[{id:doc.cards[0].id,title:'الشمس',text:'ضوء مختلف'},{id:doc.cards[1].id,title:'خاص سري',text:'عبارة الكنـز الخاصة غير المعتمدة'}]});
  assert.deepEqual(lib.search(''),{cards:[]});assert.throws(()=>lib.read(first.id,first.version),e=>e.status===409);
});
test('independent declared cards retain unchanged sibling approval, source context change invalidates all',()=>{
  const {lib,doc}=fixture('independent');for(const c of doc.cards)lib.approve(c.id,c.version);
  lib.edit(doc.id,{cards:[{id:doc.cards[0].id,title:'عنوان جديد',text:doc.cards[0].text},{id:doc.cards[1].id,title:doc.cards[1].title,text:doc.cards[1].text}]});
  assert.deepEqual(lib.search('').cards.map(c=>c.title),['خاص سري']);
  lib.edit(doc.id,{sourceTitle:'سياق آخر'});assert.deepEqual(lib.search(''),{cards:[]});
});
test('age, policy and correlated order changes require new review',()=>{
  for(const patch of [{childAge:10},{policyVersion:'2'}]){const {lib,doc}=fixture();lib.approve(doc.cards[0].id,doc.cards[0].version);lib.configure(patch);assert.deepEqual(lib.search(''),{cards:[]});}
  const {lib,doc}=fixture();lib.approve(doc.cards[0].id,doc.cards[0].version);lib.edit(doc.id,{cards:[doc.cards[1],doc.cards[0]]});assert.deepEqual(lib.search(''),{cards:[]});
});
test('import never trusts approval, tokens or role from supplied JSON',()=>{
  const {lib,doc}=fixture();lib.approve(doc.cards[0].id,doc.cards[0].version);
  const copy=new Library();copy.import({documents:[doc],parentToken:'forged',role:'parent'});
  assert.deepEqual(copy.exportChild(),{cards:[]});
});
test('stale approval is rejected and independent mode requires declaration',()=>{
  const {lib,doc}=fixture();assert.throws(()=>lib.approve(doc.cards[0].id,'old'),e=>e.status===409);
  assert.throws(()=>lib.create({sourceTitle:'مصدر',mode:'independent',cards:[{title:'أ',text:'ب'}]}),e=>e.status===400);
});
