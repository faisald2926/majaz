import {randomUUID} from 'node:crypto';
import {fingerprint,approved} from './approval.mjs';
import {search} from './search.mjs';
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,`${label}: أدخل نصًا بين 1 و${max} حرف.`);return value.trim();}
const clone=v=>structuredClone(v);
function validateDoc(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'المصدر غير صالح.');
  const sourceTitle=text(input.sourceTitle,160,'عنوان المصدر');
  const mode=input.mode??'correlated';
  if(!['correlated','independent'].includes(mode))fail(400,'نوع المصدر غير صالح.');
  if(mode==='independent'&&input.independentDeclared!==true)fail(400,'صرّح بأن كل بطاقة مستقلة في معناها قبل اختيار هذا الوضع.');
  if(!Array.isArray(input.cards)||input.cards.length<1||input.cards.length>20)fail(400,'المصدر يحتاج بين بطاقة واحدة و20 بطاقة.');
  const cards=input.cards.map(c=>{if(!c||typeof c!=='object'||Array.isArray(c))fail(400,'البطاقة غير صالحة.');return {id:c.id,title:text(c.title,160,'عنوان البطاقة'),text:text(c.text,20000,'نص البطاقة')};});
  if(cards.reduce((n,c)=>n+c.title.length+c.text.length,sourceTitle.length)>20000)fail(400,'الحد الإجمالي للمصدر 20000 حرف.');
  return {sourceTitle,mode,independentDeclared:mode==='independent',cards};
}
export class Library{
  constructor(state){this.state=state?clone(state):{childAge:9,policyVersion:'1',revision:randomUUID(),documents:[],saved:[],requests:[]};}
  snapshot(){return clone(this.state);}
  changed(){this.state.revision=randomUUID();}
  configure(patch){
    const age=patch.childAge??this.state.childAge,policy=patch.policyVersion??this.state.policyVersion;
    if(!Number.isInteger(age)||age<4||age>17)fail(400,'العمر عدد صحيح بين 4 و17 عامًا.');text(policy,80,'نسخة السياسة');
    if(age!==this.state.childAge||policy!==this.state.policyVersion){this.state.childAge=age;this.state.policyVersion=policy;this.refresh();}
    return this.parent();
  }
  create(input){
    const valid=validateDoc(input);
    if(this.state.documents.length>=50)fail(400,'بلغت المكتبة حد 50 مصدرًا.');
    const doc={...valid,id:randomUUID(),cards:valid.cards.map(c=>({...c,id:randomUUID(),version:randomUUID(),approval:null,previous:null}))};
    this.state.documents.push(doc);this.refresh();return clone(doc);
  }
  locate(id){for(const doc of this.state.documents){const card=doc.cards.find(c=>c.id===id);if(card)return {doc,card};}fail(404,'البطاقة غير متاحة.');}
  refresh(){for(const doc of this.state.documents)for(const card of doc.cards){const hash=fingerprint(this.state,doc,card);if(card.fingerprint!==hash){card.fingerprint=hash;card.version=randomUUID();card.approval=null;}}this.changed();}
  edit(id,patch){
    const doc=this.state.documents.find(d=>d.id===id);if(!doc)fail(404,'المصدر غير موجود.');
    const valid=validateDoc({...doc,...patch});const used=new Set();
    const previousContext={sourceTitle:doc.sourceTitle,mode:doc.mode,independentDeclared:doc.independentDeclared,cardOrder:doc.cards.map(c=>c.title)};
    const next=valid.cards.map(c=>{const old=doc.cards.find(o=>o.id===c.id);if(c.id&&!old)fail(400,'بطاقة لا تنتمي إلى المصدر.');if(c.id&&used.has(c.id))fail(400,'معرّف بطاقة مكرر.');used.add(c.id);return old?{...old,title:c.title,text:c.text,previous:old.title!==c.title||old.text!==c.text?{title:old.title,text:old.text}:old.previous}:{...c,id:randomUUID(),version:randomUUID(),approval:null,previous:null};});
    const contextChanged=doc.sourceTitle!==valid.sourceTitle||doc.mode!==valid.mode||JSON.stringify(doc.cards.map(c=>c.id))!==JSON.stringify(next.map(c=>c.id));
    Object.assign(doc,{...valid,cards:next,...(contextChanged?{previousContext}:{})});this.refresh();return clone(doc);
  }
  approve(id,version){const {doc,card}=this.locate(id);if(version!==card.version)fail(409,'تغيرت النسخة؛ راجع البطاقة مرة أخرى.');card.approval=fingerprint(this.state,doc,card);this.changed();return this.parent();}
  revoke(id){const {card}=this.locate(id);card.approval=null;this.changed();return this.parent();}
  remove(id){if(!this.state.documents.some(d=>d.id===id))fail(404,'المصدر غير موجود.');this.state.documents=this.state.documents.filter(d=>d.id!==id);this.changed();}
  allowed(){return this.state.documents.flatMap(doc=>doc.cards.filter(c=>approved(this.state,doc,c)).map(c=>({id:c.id,version:c.version,title:c.title,text:c.text})));}
  search(query=''){if(typeof query!=='string'||query.length>200)fail(400,'البحث لا يتجاوز 200 حرف.');return search(this.allowed(),query);}
  exportChild(){return {cards:this.allowed()};}
  read(id,version){const {doc,card}=this.locate(id);if(!approved(this.state,doc,card)||(version&&version!==card.version))fail(409,'البطاقة تحتاج موافقة حديثة من ولي الأمر.');return {id:card.id,version:card.version,title:card.title,text:card.text};}
  save(id,version){this.read(id,version);if(!this.state.saved.includes(id))this.state.saved.push(id);this.changed();return {saved:true};}
  saved(){const ids=new Set(this.state.saved);return {cards:this.allowed().filter(c=>ids.has(c.id))};}
  request(topic,consent){if(consent!==true)fail(400,'أكّد إرسال طلب الموضوع إلى ولي الأمر.');if(this.state.requests.length>=100)fail(429,'قائمة الطلبات ممتلئة؛ راجع ولي الأمر.');this.state.requests.push({id:randomUUID(),topic:text(topic,160,'الموضوع'),status:'pending',createdAt:new Date().toISOString()});this.changed();return {status:'requested'};}
  resolve(id){const request=this.state.requests.find(r=>r.id===id);if(!request)fail(404,'الطلب غير موجود.');request.status='reviewed';this.changed();return this.parent();}
  parent(){return {...this.snapshot(),documents:this.state.documents.map(d=>({...clone(d),cards:d.cards.map(c=>{const {approval,fingerprint:hash,...safe}=clone(c);return {...safe,status:approved(this.state,d,c)?'approved':'pending'};})})),pending:this.state.documents.reduce((n,d)=>n+d.cards.filter(c=>!approved(this.state,d,c)).length,0)};}
  exportParent(){return {format:'majaz-1',childAge:this.state.childAge,policyVersion:this.state.policyVersion,documents:this.state.documents.map(d=>({sourceTitle:d.sourceTitle,mode:d.mode,independentDeclared:d.independentDeclared,cards:d.cards.map(c=>({title:c.title,text:c.text}))}))};}
  import(data){
    if(!data||!Array.isArray(data.documents)||data.documents.length<1||data.documents.length>50||this.state.documents.length+data.documents.length>50)fail(400,'ملف المكتبة غير صالح أو أكبر من الحد.');
    const docs=data.documents.map(validateDoc);for(const doc of docs)this.create({...doc,cards:doc.cards.map(({title,text})=>({title,text}))});return this.parent();
  }
}
