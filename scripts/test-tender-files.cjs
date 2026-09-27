const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const sql=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
require('./test-services.cjs').prepare(sql);const db={prepare(query){let values=[];const stmt={bind(...v){values=v;return stmt},async first(){return sql.prepare(query).get(...values)||null},async all(){return {results:sql.prepare(query).all(...values)}},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}}}};return stmt},async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
const files=new Map(),bucket={async put(k,b,opts){files.set(k,{body:b,writeHttpMetadata(h){h.set('Content-Type',opts.httpMetadata.contentType)}})},async get(k){return files.get(k)}};
const cache={};function load(file){file=path.resolve(file);const external=require('./test-services.cjs').mock(file,db,sql,typeof bucket==='undefined'?undefined:bucket);if(external)return external;if(cache[file])return cache[file].exports;const loadedModule={exports:{}};cache[file]=loadedModule;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts'):require(name),loadedModule,loadedModule.exports);return loadedModule.exports}
const headers={'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'};
const req=(method='GET',body)=>new Request('https://test.invalid/api/invoices',{method,headers:{...headers,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
(async()=>{
 const tender=load('app/api/tenders/route.ts'),processDoc=load('app/api/tenders/process/route.ts'),estimate=load('app/api/tenders/estimate/route.ts'),store=load('lib/tender-db.ts'),context=load('lib/platform/context.ts');
 const now=new Date().toISOString(),org='roadworx-sydney';
 for(const [id,tenant] of [['tender-a',org],['tender-b',org],['foreign','other-org']])sql.prepare('INSERT INTO opportunities VALUES (?,?,?,?,?,?)').run(id,tenant,id,'Lead','{}',now);
 sql.prepare('INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)').run('field-user',org,'field@example.invalid','Field','field',now);
 const request=(op,extra='')=>new Request('https://test.invalid/api/tenders?opportunityId='+op+extra,{headers});
 const upload=async(name,op='tender-a')=>{const form=new FormData();form.set('opportunityId',op);form.set('file',new File(['Client: Council\nScope: pave road'],name,{type:'text/csv'}));const r=await tender.POST(req('POST',form));assert.equal(r.status,201,await r.clone().text());return (await r.json()).document;};
 const one=await upload('first.csv'),two=await upload('second.csv'),other=await upload('other.csv','tender-b');
 let r=await tender.GET(request('tender-a'));assert.equal((await r.json()).documents.length,2);assert.equal(files.size,3);
 for(const doc of [one,two]){for(const body of [{action:'start'},{action:'page',page:{ref:'page 1',text:'Client: Council',method:'csv',confidence:95},total:1},{action:'finish'}]){r=await processDoc.POST(req('POST',{opportunityId:'tender-a',documentId:doc.id,...body}));assert.equal(r.status,200);}}
 let pack=await (await tender.GET(request('tender-a'))).json();const field=pack.documents[0].fields[0];r=await processDoc.POST(req('POST',{opportunityId:'tender-a',documentId:one.id,action:'field',fieldId:field.id,status:'Confirmed'}));assert.equal(r.status,200);
 r=await estimate.POST(req('POST',{opportunityId:'tender-a'}));assert.equal(r.status,201,await r.clone().text());const estimateId=(await r.json()).estimateId,before=sql.prepare('SELECT metadata FROM estimates WHERE id=?').get(estimateId).metadata;
 r=await tender.DELETE(req('DELETE',{opportunityId:'tender-a',documentIds:[one.id,other.id]}));assert.equal(r.status,404,'Mixed pack selection must fail as a whole');assert.equal((await (await tender.GET(request('tender-a'))).json()).documents.length,2);
 r=await tender.DELETE(req('DELETE',{opportunityId:'foreign',documentIds:[one.id]}));assert.equal(r.status,404,'Cross-tenant pack denied');
 for(const method of ['DELETE','PATCH']){r=await tender[method](new Request('https://test.invalid',{method,headers:{'Content-Type':'application/json','x-test-user-id':'field-user','x-test-user-email':'field@example.invalid'},body:JSON.stringify({opportunityId:'tender-a',documentIds:[one.id]})}));assert.equal(r.status,403,'Field cannot remove or restore files');}
 r=await tender.DELETE(req('DELETE',{opportunityId:'tender-a',documentIds:[]}));assert.equal(r.status,400);
 r=await tender.DELETE(req('DELETE',{opportunityId:'tender-a',documentIds:[one.id,two.id]}));assert.equal(r.status,200);pack=await (await tender.GET(request('tender-a'))).json();assert.equal(pack.documents.length,0);assert.equal(pack.removedDocuments.length,2);assert(!JSON.stringify(pack).includes('tenders/'));assert.equal(files.size,3,'Originals retained for undo and history');
 assert.equal((await tender.GET(request('tender-a','&fileId='+one.id))).status,404);
 assert.equal((await processDoc.POST(req('POST',{opportunityId:'tender-a',documentId:one.id,action:'start'}))).status,404);
 // Simulate a request that read the doc before removal but saves afterwards.
 await context.actorContext.run({userId:'test-owner',email:'admin@example.invalid',organisationId:org,role:'admin'},()=>store.saveTender({...one,processingStatus:'Late processing'},'page'));
 assert.equal((await (await tender.GET(request('tender-a'))).json()).documents.length,0,'Late processing must not resurrect removed files');
 // Even legacy cached findings cannot recreate estimates from removed files.
 sql.prepare('UPDATE opportunities SET metadata=? WHERE id=?').run(JSON.stringify({tenderReview:{fields:[{label:'Client',value:'STALE',status:'Confirmed'}]}}),'tender-a');
 r=await estimate.POST(req('POST',{opportunityId:'tender-a'}));assert.equal(r.status,422);assert.equal(sql.prepare('SELECT metadata FROM estimates WHERE id=?').get(estimateId).metadata,before,'Existing estimate remains unchanged');
 r=await tender.PATCH(req('PATCH',{opportunityId:'tender-a',documentIds:[one.id,two.id]}));assert.equal(r.status,200);pack=await (await tender.GET(request('tender-a'))).json();assert.equal(pack.documents.length,2);assert.equal(pack.removedDocuments.length,0);assert.equal(pack.documents[0].fields[0].status,'Confirmed');assert.equal((await tender.GET(request('tender-a','&fileId='+one.id))).status,200);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE name IN ('tender.files.removed','tender.files.restored')").get().n,2);
 console.log('PASS tender multi-upload, bulk remove/restore, mixed-pack atomic refusal, tenant and role isolation, hidden originals, late processing safety, confirmed fields restored, estimate/history preservation, stale finding exclusion and audit');
})().catch(e=>{console.error(e);process.exitCode=1;});
