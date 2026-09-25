const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const sql = new DatabaseSync(':memory:');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));


require('./test-services.cjs').prepare(sql);const db = {prepare(query){ let values=[]; const stmt={bind(...v){values=v;return stmt;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return stmt;},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements) result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const cache={};
function load(file){file=path.resolve(file);const external=require('./test-services.cjs').mock(file,db,sql,typeof bucket==='undefined'?undefined:bucket);if(external)return external;if(cache[file])return cache[file].exports;const loadedModule={exports:{}};cache[file]=loadedModule;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts'):require(name),loadedModule,loadedModule.exports);return loadedModule.exports;}
const estimate=load('app/api/estimates/route.ts'), award=load('app/api/estimates/award/route.ts'), approval=load('app/api/estimates/approval/route.ts'), delivery=load('app/api/delivery/route.ts'), calc=load('lib/estimate-calculations.ts'), planning=load('lib/planning.ts');
const request=body=>new Request('https://test.invalid/api',{method:'POST',headers:{'Content-Type':'application/json','x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'},body:JSON.stringify(body)});
(async()=>{
 const data={...calc.makeDefaultEstimate(),clientName:'Test client',projectName:'Test job',site:'Test site'};
 let response=await estimate.POST(request({data,status:'Draft'}));assert.equal(response.status,201);const id=(await response.json()).estimate.id;
 // V1: award requires an approved, immutable estimate revision.
 response=await award.POST(request({estimateId:id}));assert.equal(response.status,422,'Draft estimates cannot be awarded');
 response=await approval.POST(request({estimateId:id,action:'submit'}));assert.equal(response.status,200,await response.clone().text());
 response=await estimate.PUT(new Request('https://test.invalid/api',{method:'PUT',headers:{'Content-Type':'application/json','x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'},body:JSON.stringify({id,data:{...data,areaM2:2000}})}));assert.equal(response.status,409,'Estimates in review are locked');
 response=await approval.POST(request({estimateId:id,action:'approve'}));assert.equal(response.status,200,await response.clone().text());
 const approvedSell=(await (await approval.GET(new Request('https://test.invalid/api?estimateId='+id,{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json()).revisions[0].sellPrice;
 response=await estimate.PUT(new Request('https://test.invalid/api',{method:'PUT',headers:{'Content-Type':'application/json','x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'},body:JSON.stringify({id,data:{...data,areaM2:3000}})}));assert.equal(response.status,200,'Editing after approval starts a new draft');
 response=await award.POST(request({estimateId:id}));assert.equal(response.status,201,await response.clone().text());const awarded=await response.json();const jobId=awarded.job.id;
 assert.equal(awarded.job.approvedBudget.sellRate,approvedSell,'Award uses the frozen approved revision, not the later working draft');
 let payload=await (await delivery.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json();const job=payload.jobs.find(j=>j.id===jobId);const baseline=structuredClone(job.metadata.approvedBudget);
 response=await delivery.POST(request({kind:'jobs',record:{...job,metadata:{...job.metadata,approvedBudget:{totalCost:1},po:'PO1',siteContact:'Contact',permit:'Permit',tmp:'TMP',tgs:'TGS',occupancyStart:'19:00',occupancyFinish:'06:00'}}}));assert.equal(response.status,200);assert.deepEqual((await response.json()).record.metadata.approvedBudget,baseline);
 const worker={id:'worker-test',name:'Test worker',status:'Active',metadata:{competencyExpiry:'2027-12-31'}};
 await db.prepare('INSERT INTO workers (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(worker.id,'roadworx-sydney',worker.name,worker.status,JSON.stringify(worker.metadata),new Date().toISOString()).run();
 let shift={id:'',name:'Night works',status:'Planned',metadata:{jobId,date:'2026-10-01',start:'20:00',finish:'04:00',assignments:[{resourceId:worker.id,name:worker.name,category:'workers',role:'Worker',hours:8,rate:60,payload:0,trips:0}],checks:{}}};
 response=await delivery.POST(request({kind:'shifts',record:shift}));assert.equal(response.status,201);shift=(await response.json()).record;
 payload=await (await delivery.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json();assert.equal(payload.shifts[0].metadata.assignments[0].resourceId,worker.id);assert.deepEqual(payload.jobs[0].metadata.approvedBudget,baseline);
 const overlap={...shift,id:'overlap',name:'Next morning',metadata:{...shift.metadata,date:'2026-10-02',start:'03:00',finish:'05:00'}};
 assert(planning.shiftWarnings(overlap,payload.jobs,payload.shifts,[worker]).some(w=>w.includes('overlaps')));
 assert(planning.shiftWarnings(shift,payload.jobs,[],[{...worker,metadata:{competencyExpiry:'2026-09-30'}}]).some(w=>w.includes('expired')));
 assert(planning.shiftWarnings({...shift,metadata:{...shift.metadata,start:'18:00'}},payload.jobs,[],[worker]).some(w=>w.includes('occupancy')));
 response=await delivery.POST(request({kind:'shifts',record:{...shift,status:'Ready'}}));assert.equal(response.status,422);
 const readyRecord={...shift,status:'Ready',metadata:{...shift.metadata,checks:Object.fromEntries(planning.CHECKS.map(c=>[c,true]))}};
 assert.equal((await delivery.POST(request({kind:'shifts',record:readyRecord}))).status,422,'Missing IMS pack must block even checked readiness');
 const now=new Date().toISOString();
 sql.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?)').run('ims-file','roadworx-sydney','Evidence.pdf','active','{}',now);
 sql.prepare('INSERT INTO ims_documents (id,organisation_id,title,document_type,status,storage_attachment_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('ims-evidence','roadworx-sydney','Evidence','Policy','Approved','ims-file',now,now);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM job_ims_items WHERE job_id=?').get(jobId).n,15);
 sql.prepare("UPDATE job_ims_items SET status='Approved',linked_document_id='ims-evidence' WHERE job_id=?").run(jobId);
 response=await delivery.POST(request({kind:'shifts',record:{...shift,status:'Ready',metadata:{...shift.metadata,checks:Object.fromEntries(planning.CHECKS.map(c=>[c,true]))}}}));assert.equal(response.status,200);
 response=await award.POST(request({estimateId:id}));assert.equal((await response.json()).alreadyAwarded,true);
 assert.equal((await (await delivery.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json()).jobs.length,1);
 console.log('PASS: estimate → award → job → shift → assigned resource → reload; protected baseline; overnight overlap; expired competency; occupancy; readiness gate; repeat award; award blocked without approval; review lock; approved revision frozen against later edits.');
})().catch(e=>{console.error(e);process.exitCode=1;});
