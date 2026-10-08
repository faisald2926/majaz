import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Library,fail} from './src/corpus.mjs';
import {issue,authorized} from './src/auth.mjs';
import {addDemo} from './src/demo.mjs';
import {draft,DEFAULT_MODEL} from './src/gemini.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export function createApp({persist=true,dataDir=path.join(root,'data'),writeFile=writeFileSync}={}){
  const entries=new Map();const rates=new Map();
  const save=candidates=>{if(!persist)return;mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'libraries.json');writeFile(file+'.tmp',JSON.stringify([...candidates].map(([id,e])=>({id,parentHash:e.parentHash,childHash:e.childHash,state:e.lib.snapshot()}))),{mode:0o600});renameSync(file+'.tmp',file);};
  if(persist&&existsSync(path.join(dataDir,'libraries.json'))){
    try{for(const e of JSON.parse(readFileSync(path.join(dataDir,'libraries.json'),'utf8')))entries.set(e.id,{parentHash:e.parentHash,childHash:e.childHash,lib:new Library(e.state)});}
    catch{throw new Error('تعذر قراءة بيانات المكتبة المحلية. راجع النسخة الاحتياطية قبل تشغيل الخادم.');}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try{
      const port=server.address().port;const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];if(!hosts.includes(req.headers.host))fail(403,'عنوان الخادم غير مسموح.');
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(!url.pathname.startsWith('/api/')){
        if(req.method!=='GET')fail(405,'الطريقة غير مسموحة.');
        const files={'/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/styles.css':'styles.css','/logo.svg':'logo.svg'};const filename=files[url.pathname];if(!filename)fail(404,'الصفحة غير موجودة.');
        res.writeHead(200,{'Content-Type':filename.endsWith('.mjs')?'text/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'});res.end(readFileSync(path.join(root,'public',filename)));return;
      }
      if(!['GET','POST'].includes(req.method))fail(405,'الطريقة غير مسموحة.');
      let body={};if(req.method==='POST'){
        if(req.headers.origin!==`http://${req.headers.host}`)fail(403,'مصدر الطلب غير مسموح.');
        if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']??''))fail(415,'أرسل البيانات بصيغة JSON.');
        const limit=url.pathname.endsWith('/import')?4*1024*1024:128*1024;const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'الطلب أكبر من الحد.');chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'تعذر قراءة JSON.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'صيغة المدخلات غير صالحة.');
        const address=req.socket.remoteAddress;const bucket=rates.get(address)??{count:0,until:Date.now()+60000};if(Date.now()>bucket.until){bucket.count=0;bucket.until=Date.now()+60000;}bucket.count++;rates.set(address,bucket);if(bucket.count>120)fail(429,'طلبات كثيرة؛ انتظر دقيقة.');
      }
      if(url.pathname==='/api/setup'&&req.method==='POST'){
        if(entries.size>=50)fail(429,'بلغ الخادم الحد المحلي للمكتبات.');const p=issue(),c=issue(),id=randomUUID(),lib=new Library();if(body.demo===true)addDemo(lib);const entry={parentHash:p.hash,childHash:c.hash,lib},next=new Map(entries);next.set(id,entry);save(next);entries.set(id,entry);send(201,{libraryId:id,parentToken:p.token,childToken:c.token});return;
      }
      const route=/^\/api\/(parent|child)\/([a-f0-9-]{36})\/([a-z]+)$/.exec(url.pathname);if(!route)fail(403,'رابط الدور غير صالح أو غير مصرح.');
      const [,role,id,action]=route,current=entries.get(id);if(!current||!authorized(req,current[role+'Hash']))fail(403,'هذا الرابط لا يمنح صلاحية الوصول إلى هذا الدور.');
      // Publish a mutation only after the candidate snapshot has been saved successfully.
      const e=req.method==='POST'?{...current,lib:new Library(current.lib.snapshot())}:current;
      const lib=e.lib;let result;
      const method=expected=>{if(req.method!==expected)fail(405,'الطريقة غير مسموحة.');};
      if(role==='child'){
        if(['search','export','saved','read','status'].includes(action))method('GET');else method('POST');
        if(action==='search')result=lib.search(url.searchParams.get('q')??'');
        else if(action==='export')result=lib.exportChild();else if(action==='saved')result=lib.saved();
        else if(action==='status')result={revision:lib.state.revision};
        else if(action==='read'){const version=url.searchParams.get('version');if(!version)fail(400,'نسخة البطاقة مطلوبة.');result=lib.read(url.searchParams.get('id'),version);}
        else if(action==='save'){if(typeof body.version!=='string')fail(400,'نسخة البطاقة مطلوبة.');result=lib.save(body.id,body.version);}
        else if(action==='request')result=lib.request(body.topic,body.consent);else fail(404,'المسار غير موجود.');
      }else{
        if(['library','export','ai'].includes(action))method('GET');else method('POST');
        if(action==='library')result=lib.parent();else if(action==='export')result=lib.exportParent();
        else if(action==='ai')result={available:Boolean(process.env.GEMINI_API_KEY),model:process.env.GEMINI_MODEL||DEFAULT_MODEL};
        else if(action==='documents')result=lib.create(body);else if(action==='edit')result=lib.edit(body.id,body.patch??{});
        else if(action==='approve')result=lib.approve(body.id,body.version);else if(action==='revoke')result=lib.revoke(body.id);
        else if(action==='configure')result=lib.configure(body);else if(action==='import')result=lib.import(body);
        else if(action==='childlink'){const c=issue();e.childHash=c.hash;result={childToken:c.token};}
        else if(action==='remove'){lib.remove(body.id);result={removed:true};}else if(action==='resolve')result=lib.resolve(body.id);
        else if(action==='draft')result=await draft({...body,childAge:lib.state.childAge});else fail(404,'المسار غير موجود.');
      }
      if(req.method==='POST'&&action!=='draft'){const next=new Map(entries);next.set(id,e);save(next);entries.set(id,e);}send(200,result);
    }catch(error){if(!res.headersSent)send(error.status??500,{error:error.status?error.message:'حدث خطأ في الخادم. لم تكتمل العملية.'});else res.end();}
  });return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||3173);createApp().listen(port,'127.0.0.1',()=>console.log(`مجاز: http://127.0.0.1:${port}`));}
