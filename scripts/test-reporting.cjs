const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync('drizzle/0000_jittery_forge.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/0001_pavement_os.sql','utf8'));
require('./test-services.cjs').prepare(sql);const db = {prepare(query){ let values=[]; const stmt={bind(...v){values=v;return stmt;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return stmt;},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements) result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
sql.exec(fs.readFileSync('drizzle/20260910105008_field.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/20260910110000_docket_enrichment.sql','utf8'));
const files=new Map(); const bucket={async put(k,b){files.set(k,b);},async get(k){return files.get(k);}};
const cache={};
function load(file){file=path.resolve(file);const external=require('./test-services.cjs').mock(file,db,sql,typeof bucket==='undefined'?undefined:bucket);if(external)return external;if(cache[file])return cache[file].exports;const loadedModule={exports:{}};cache[file]=loadedModule;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts'):require(name),loadedModule,loadedModule.exports);return loadedModule.exports;}
const reports=load('app/api/reports/route.ts'), records=load('app/api/os/records/route.ts'), delivery=load('app/api/delivery/route.ts'), dockets=load('app/api/dockets/route.ts');
const request=body=>new Request('https://test.invalid/api',{method:'POST',headers:{'Content-Type':'application/json','x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'},body:JSON.stringify(body)});
async function report(){const r=await reports.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}));assert.equal(r.status,200);return r.json();}
(async()=>{
 let p=await report();assert(Object.values(p.summary.counts).every(n=>n===0));assert.equal(p.summary.reviewCount,0);assert.equal(p.summary.forecastRevenue,0);
 let r=await records.POST(request({module:'opportunities',name:'Test tender',status:'Qualified',metadata:{estimatedValue:100000,probability:75}}));assert.equal(r.status,201);
 p=await report();assert.equal(p.summary.openOpportunities,1);assert.equal(p.summary.forecastRevenue,75000);
 r=await records.POST(request({module:'jobs',name:'Test job',status:'Active',metadata:{contractValue:90000}}));const job=(await r.json()).record;
 r=await delivery.POST(request({kind:'shifts',record:{id:'',name:'Test shift',status:'Draft',metadata:{jobId:job.id,date:'2099-09-10',start:'07:00',finish:'17:00',assignments:[]}}}));assert.equal(r.status,201);const shift=(await r.json()).record;
 assert.equal((await (await delivery.GET(new Request('https://test.invalid',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json()).shifts.length,1);p=await report();assert.equal(p.summary.counts.shifts,1);assert.equal(p.summary.upcomingShifts,1);
 const form=new FormData();form.set('records',JSON.stringify([{docketNo:'REPORT-TEST',workDate:'2026-09-10',status:'review',amount:123,sourceName:'test.csv'}]));form.set('file',new File(['docket,amount\nREPORT-TEST,123'],'test.csv',{type:'text/csv'}));r=await dockets.POST(new Request('https://test.invalid/api',{method:'POST',headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'},body:form}));assert.equal(r.status,200);assert.equal(files.size,1);
 p=await report();assert.equal(p.summary.reviewCount,1);assert.equal(p.summary.docketValue,123);
 sql.prepare('INSERT INTO field_records VALUES (?,?,?,?,?,?,?,?)').run(shift.id,'roadworx-sydney',1,'Submitted',JSON.stringify({tonnes:45,area:200}),'{}','{}',new Date().toISOString());
 p=await report();assert.equal(p.summary.counts.field_records,1);assert.equal(p.summary.completedFields,1);assert.equal(p.summary.actualTonnes,45);
 sql.prepare('INSERT INTO opportunities VALUES (?,?,?,?,?,?)').run('foreign','other-org','Foreign','Open','{}',new Date().toISOString());
 const operationsPayload=await (await records.GET(new Request('https://test.invalid?module=opportunities',{headers:{'x-test-user-id':'test-owner','x-test-user-email':'admin@example.invalid'}}))).json();assert(!operationsPayload.records.some(r=>r.id==='foreign'),'Generic operations records must remain organisation-scoped');
 const refreshed=await report();assert.deepEqual(refreshed.summary,p.summary);assert.equal(files.size,1);
 const {easternDate}=load('lib/reporting.ts');assert.equal(easternDate(new Date('2026-09-10T15:00:00Z')),'2026-09-11');assert.equal(easternDate(new Date('2026-12-10T13:30:00Z')),'2026-12-11');
 console.log('PASS: zero database; Reports 200; opportunity and pipeline; planned shift; docket upload/review badge source; field_records; refreshed saved values; organisation isolation; source retained; Australian Eastern date and daylight saving.');
})().catch(e=>{console.error(e);process.exit(1)});
