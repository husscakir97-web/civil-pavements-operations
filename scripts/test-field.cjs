const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const sql = new DatabaseSync(':memory:');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));


require('./test-services.cjs').prepare(sql);const db = {prepare(query){ let values=[]; const stmt={bind(...v){values=v;return stmt;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return stmt;},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements) result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};

const cache={};
function load(file){file=path.resolve(file);const external=require('./test-services.cjs').mock(file,db,sql,typeof bucket==='undefined'?undefined:bucket);if(external)return external;if(cache[file])return cache[file].exports;const loadedModule={exports:{}};cache[file]=loadedModule;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('./')?load(path.resolve(path.dirname(file),name)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts'):require(name),loadedModule,loadedModule.exports);return loadedModule.exports;}
const estimate=load('app/api/estimates/route.ts'), award=load('app/api/estimates/award/route.ts'), delivery=load('app/api/delivery/route.ts'), calc=load('lib/estimate-calculations.ts'), planning=load('lib/planning.ts');
const request=body=>new Request('https://test.invalid/api',{method:'POST',headers:{'Content-Type':'application/json','x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'},body:JSON.stringify(body)});

const field=load('app/api/field/route.ts'), fns=load('lib/field.ts');
function req(body,email='admin@example.invalid'){return new Request('https://test.invalid/api',{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-test-user-id':email,'x-test-user-email':email},...(body?{body:JSON.stringify(body)}:{})});}
(async()=>{
 const data={...calc.makeDefaultEstimate(),clientName:'Field test client',projectName:'Field job',site:'Site'};
 let res=await estimate.POST(request({data,status:'Draft'}));const eid=(await res.json()).estimate.id;
 res=await award.POST(request({estimateId:eid}));const jobId=(await res.json()).job.id;
 const job=(await (await delivery.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json()).jobs[0],baseline=structuredClone(job.metadata.approvedBudget);
 let shift={id:'',name:'Field test shift',status:'Planned',metadata:{jobId,date:'2026-10-01',start:'20:00',finish:'04:00',tonnes:100,area:400,assignments:[{resourceId:'w1',category:'workers',name:'Worker',role:'Worker',hours:8,rate:60,payload:0,trips:0}],materialCost:10000}};
 res=await delivery.POST(request({kind:'shifts',record:shift}));assert.equal(res.status,201);shift=(await res.json()).record;
 let draft=fns.initialField(shift);
 res=await field.POST(req({shiftId:shift.id,revision:0,action:'save',data:draft}));assert.equal(res.status,201);let saved=(await res.json()).record;assert.equal(saved.revision,1);
 res=await field.POST(req({shiftId:shift.id,revision:1,action:'submit',data:draft}));assert.equal(res.status,422);
 draft={...draft,arrival:'2026-10-01T20:00',departure:'2026-10-02T04:00',productionStart:'2026-10-01T21:00',productionFinish:'2026-10-02T03:00',preStart:true,tonnes:'100',area:'400',trips:'5',loads:'5',wastage:'0',materialCost:'10000',otherCost:'0',diary:'All work complete',clientName:'Client',clientDeclinedReason:'Client departed before completion',supervisorName:'Supervisor',supervisorSignature:'data:image/png;base64,TEST',reviewed:true,resources:[{...draft.resources[0],attendance:'Present',hours:8}],checks:[{time:'2026-10-01T21:00',temperature:150,result:'Accepted'}],delays:[{start:'2026-10-01T22:00',finish:'2026-10-01T22:30',cause:'Supply',party:'Supplier'}]};
 assert.deepEqual(fns.incomplete(draft),[]);
 res=await field.POST(req({shiftId:shift.id,revision:1,action:'save',data:draft}));assert.equal(res.status,200);
 let getReq=new Request('https://test.invalid/api?shiftId='+shift.id,{headers:req().headers});
 let loaded=await (await field.GET(getReq)).json();assert.deepEqual(loaded.record.data,{...draft,pricingReviewRequired:false});assert.deepEqual(loaded.record.job.metadata.approvedBudget,baseline);
 res=await field.POST(req({shiftId:shift.id,revision:1,action:'save',data:draft}));assert.equal(res.status,409);
 res=await field.POST(req({shiftId:shift.id,revision:2,action:'submit',data:draft},'worker@example.com'));assert.equal(res.status,403);
 res=await field.POST(req({shiftId:shift.id,revision:2,action:'submit',data:draft}));assert.equal(res.status,200);
 res=await field.POST(req({shiftId:shift.id,revision:3,action:'save',data:draft}));assert.equal(res.status,409);
 res=await field.POST(req({shiftId:shift.id,revision:3,action:'amend',reason:'Correction',data:draft},'worker@example.com'));assert.equal(res.status,403);
 res=await field.POST(req({shiftId:shift.id,revision:3,action:'amend',data:draft}));assert.equal(res.status,400);
 res=await field.POST(req({shiftId:shift.id,revision:3,action:'amend',reason:'Correct weighbridge tally',data:{...draft,tonnes:'101'}}));assert.equal(res.status,200);
 loaded=await (await field.GET(getReq)).json();assert.equal(loaded.history.length,4);assert.equal(JSON.parse(loaded.history.find(h=>h.action==='submit').snapshot).data.tonnes,'100');assert.equal(loaded.record.data.tonnes,'101');
 const payload=await (await delivery.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json();assert.equal(payload.shifts[0].status,'Completed');assert.deepEqual(payload.jobs[0].metadata.approvedBudget,baseline);
 const m=fns.fieldMetrics(draft,shift,job);assert.equal(m.actualCost,10480);assert.equal(m.rows.find(r=>r[0]==='Delay hours')[2],.5);assert.equal(m.rows.find(r=>r[0]==='Labour hours')[2],8);
 assert(fns.invalidField({...draft,departure:'2026-10-01T19:00'}).length);
 assert.equal((await field.GET(new Request('https://test.invalid/api'))).status,401);
 console.log('PASS: estimate → award → plan → progressive save → reload → review → supervisor submission → locked original → authorised amendment with immutable history; denied anonymous/unauthorised/stale writes; actual costs; overnight times; original budget retained.');
})().catch(e=>{console.error(e);process.exitCode=1;});
