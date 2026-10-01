// Synthetic data only. Runs report arithmetic and the real SQL read service against SQLite.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');db.function('JSON_UNQUOTE',x=>x);
let actor={organisationId:'tenant-a',userId:'user-a',role:'accounts'},scope=null,entitlements={reports:'active',commercial:'active',projects:'active',estimating:'active',dockets:'active'};
const calls=[];
async function query(sql,params=[]){calls.push({sql,params});const flat=[];let n=0;sql=sql.replace(/\?/g,()=>{const p=params[n++];if(Array.isArray(p)){flat.push(...p);return p.map(()=>'?').join(',');}flat.push(p);return '?';});return db.prepare(sql).all(...flat);}
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;
 const m={exports:{}};cache[file]=m;
 const mocks={
  '@/lib/platform/context':{actorContext:{getStore:()=>actor}},
  '@/lib/platform/http':{need:c=>{if(!load('lib/platform/permissions.ts').can(actor.role,c))throw Object.assign(new Error('Forbidden'),{status:403});},fail:(status,message)=>{throw Object.assign(new Error(message),{status});},api:(options,fn)=>({options,fn})},
  '@/lib/platform/entitlements':{getEntitlements:async()=>entitlements,usable:(e,m)=>['active','read_only'].includes(e[m])},
  '@/lib/platform/project-access':{projectScope:async()=>scope},
  '@/lib/platform/sql':{query,tx:async fn=>fn({})},
 };
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(n=>mocks[n]??(n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n)),m,m.exports);return m.exports;
}
const {buildDivisionalPnl,pnlPeriod}=load('lib/platform/divisional-pnl.ts');
function renderReport(data,role='accounts'){
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),h=React.createElement;
 const kit={useSession:()=>({can:c=>load('lib/platform/permissions.ts').can(role,c),module:()=>true}),useApi:()=>({data,error:null,loading:false,refresh:()=>{}}),
  Section:({title,description,children})=>h('section',null,h('h2',null,title),h('p',null,description),children),Field:({label,children})=>h('label',null,label,children),field:'control',Btn:({children,variant,...props})=>{void variant;return h('button',props,children);},Loading:()=>null,ErrorState:()=>null,money:n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n)};
 const m={exports:{}},code=ts.transpileModule(fs.readFileSync('components/v1/divisional-pnl.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(n=>n==='./kit'?kit:require(n),m,m.exports);
 const NativeDate=Date;
 global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[data.period.end+'T12:00:00Z']));}};
 try{return renderToStaticMarkup(h(m.exports.DivisionalPnlPanel));}finally{global.Date=NativeDate;}
}
const input={start:'2026-09-01',end:'2026-09-30',divisionId:null,divisions:[{id:'a',name:'Civil',code:'CV'},{id:'b',name:'Roads',code:'RD'}],projects:[{id:'p1',name:'Job 1',divisionId:'a',baseline:200,baselineId:'b1',estimateId:'e1',costToDate:40},{id:'p2',name:'Job 2',divisionId:'b',baseline:null,baselineId:null,estimateId:null,costToDate:10}],sources:[],revenueAvailable:true,costsAvailable:true};
const source=(id,patch={})=>({id,projectId:'p1',date:'2026-09-10',kind:'invoice',status:'issued',amount:100,reference:id,sourceType:'client_invoice',sourceId:id,sourceLine:'',category:'revenue',costCode:null,description:id,...patch});
input.sources=[source('i1'),source('i2',{projectId:'p2',amount:50,status:'part_paid'}),source('i3',{status:'draft',amount:900}),source('i4',{status:'void',amount:900}),source('i5',{status:'paid',amount:-10}),source('outside',{date:'2026-10-01',amount:900}),source('c1',{kind:'cost',sourceType:'docket',sourceLine:'L1',status:'actual',amount:30}),source('c2',{kind:'cost',sourceType:'docket',sourceLine:'L2',status:'actual',amount:10}),source('reverse',{kind:'cost',sourceType:'docket',status:'reversed',amount:900}),source('payroll',{kind:'cost',sourceType:'payroll',status:'actual',amount:900}),source('orphan',{projectId:'missing',amount:7})];
input.sources.push({...input.sources[6],id:'duplicate'});
let r=buildDivisionalPnl(input);assert.deepEqual(r.totals,{revenue:147,directCosts:40,grossProfit:null,grossMarginPct:null,overheads:null,netResult:null});assert.equal(r.sources.filter(s=>s.exclusion).length,5);assert.equal(r.divisions.find(d=>d.id==='unallocated').revenue,7);assert.equal(r.accountingActuals,null);assert.equal(r.reconciliation,'not_reconciled');assert.equal(r.allocation.amount,null);assert.equal(r.eliminations.amount,null);
// A plausible GST-inclusive, exclusive, zero or credit amount never establishes
// the unknown cost basis. Keep source sums unchanged and withhold profitability.
for(const cost of [0,30,100,110,-11]){
 const unknown=buildDivisionalPnl({...input,sources:[source('bill',{amount:200}),source('cost',{kind:'cost',status:'actual',sourceType:'docket',amount:cost})]});
 assert.equal(unknown.totals.revenue,200);assert.equal(unknown.totals.directCosts,cost);
 assert.equal(unknown.totals.grossProfit,null);assert.equal(unknown.totals.grossMarginPct,null);
 assert(unknown.divisions.every(d=>d.grossProfit===null&&d.grossMarginPct===null));
 assert.deepEqual(unknown.taxBasis,{revenue:'ex_gst',directCosts:'unknown'});assert.equal(unknown.profitability.available,false);assert.match(unknown.profitability.reason,/GST basis.*unknown/);
 assert.equal(unknown.sources.find(s=>s.kind==='invoice').taxBasis,'ex_gst');assert.equal(unknown.sources.find(s=>s.kind==='cost').taxBasis,'unknown');
}
assert.equal(buildDivisionalPnl({...input,divisionId:'a'}).totals.revenue,90);assert.equal(buildDivisionalPnl({...input,divisionId:'b'}).totals.revenue,50);assert.equal(buildDivisionalPnl({...input,revenueAvailable:false}).totals.grossProfit,null);assert.equal(buildDivisionalPnl({...input,costsAvailable:false}).totals.directCosts,null);
assert.equal(buildDivisionalPnl({...input,sources:[source('cent1',{amount:.1}),source('cent2',{amount:.2})]}).totals.revenue,.3);
assert.throws(()=>pnlPeriod('2026-02-30','2026-03-01'));assert.throws(()=>pnlPeriod('2026-09-30','2026-09-01'));assert.throws(()=>pnlPeriod('2024-01-01','2026-01-01'));pnlPeriod('2024-02-29','2024-02-29');
assert.throws(()=>buildDivisionalPnl({...input,divisionId:'foreign'}));assert.throws(()=>buildDivisionalPnl({...input,sources:[source('nan',{amount:NaN})]}));
db.exec(`CREATE TABLE business_units(id TEXT,organisation_id TEXT,name TEXT,code TEXT,is_default INTEGER,sort_order INTEGER);
CREATE TABLE jobs(id TEXT,organisation_id TEXT,name TEXT,business_unit_id TEXT);
CREATE TABLE client_invoices(id TEXT,organisation_id TEXT,project_id TEXT,invoice_date TEXT,status TEXT,amount_ex_gst REAL,invoice_number TEXT);
CREATE TABLE cost_transactions(id TEXT,organisation_id TEXT,project_id TEXT,transaction_date TEXT,status TEXT,amount REAL,source_id TEXT,source_type TEXT,source_line TEXT,category TEXT,cost_code TEXT,description TEXT);
CREATE TABLE project_baselines(id TEXT,organisation_id TEXT,project_id TEXT,budget_total REAL,estimate_id TEXT,revision INTEGER,created_at TEXT);
CREATE TABLE dockets(id TEXT,organisation_id TEXT,links TEXT,work_date TEXT,amount REAL,docket_no TEXT,status TEXT);
INSERT INTO business_units VALUES ('a','tenant-a','Civil','CV',1,0),('b','tenant-a','Roads','RD',0,1),('foreign','tenant-b','Private','P',1,0);
INSERT INTO jobs VALUES ('p1','tenant-a','Job 1','a'),('p2','tenant-a','Job 2','b'),('p3','tenant-a','Legacy',NULL),('secret','tenant-b','Private job','foreign');
INSERT INTO client_invoices VALUES ('i1','tenant-a','p1','2026-09-01','issued',100,'INV-1'),('i2','tenant-a','p2','2026-09-30','paid',50,'INV-2'),('i3','tenant-a','p3','2026-09-10','draft',999,'DRAFT'),('foreign-i','tenant-b','p1','2026-09-10','paid',99999,'PRIVATE');
INSERT INTO cost_transactions VALUES ('c1','tenant-a','p1','2026-09-01','actual',30,'d1','docket','L1','labour','100','Synthetic labour'),('c2','tenant-a','p2','2026-08-01','actual',10,'d2','docket','L1','plant','200','Synthetic plant'),('fc','tenant-b','p1','2026-09-01','actual',99999,'fd','docket','L1','other','500','PRIVATE');
INSERT INTO project_baselines VALUES ('base','tenant-a','p1',200,'estimate',1,'2026-08-01'),('revision','tenant-a','p1',250,'estimate',2,'2026-09-01'),('future','tenant-a','p2',700,'future-est',1,'2026-10-01'),('foreign-base','tenant-b','p1',99999,'private',1,'2026-08-01');
INSERT INTO dockets VALUES ('d1','tenant-a','{"jobId":"p1"}','2026-09-01',30,'D1','approved'),('unposted','tenant-a','{}','2026-09-04',20,'UNPOSTED','approved'),('foreign-d','tenant-b','{}','2026-09-04',99999,'PRIVATE','approved');`);
(async()=>{
 const service=load('lib/seams/divisional-pnl.ts').divisionalPnl;
 r=await service(input.start,input.end,null);assert.equal(r.totals.revenue,150);assert.equal(r.totals.directCosts,30);assert.equal(r.projects.find(p=>p.id==='p1').baseline,200);assert.equal(r.projects.find(p=>p.id==='p2').baseline,null);assert.equal(r.projects.find(p=>p.id==='p2').costToDate,10);assert.equal(r.projects.find(p=>p.id==='p3').divisionId,'a');assert(!JSON.stringify(r).includes('PRIVATE'));assert(!JSON.stringify(r).includes('99999'));assert.equal(r.sources.filter(s=>s.status==='not_posted').length,1);assert.equal(r.sources.find(s=>s.id==='unposted').divisionId,'unallocated');assert.equal(r.sources.find(s=>s.id==='unposted').exclusion,'Approved docket has no active posted cost');
 assert.equal(r.coverage.comparableTaxBasis,false);assert.equal(r.totals.grossProfit,null);assert.equal(r.totals.grossMarginPct,null);
 const html=renderReport(r);assert(html.includes('Not reconciled'));assert(html.includes('Net result'));assert(html.includes('$150.00'));assert(html.includes('$30.00'));assert(!html.includes('$120.00'));assert(html.includes('Gross profit and margin are unavailable'));assert(html.includes('GST basis unknown'));assert(html.includes('Approved docket has no active posted cost'));assert.equal(renderReport(r,'read_only'),'');
 if(process.argv.includes('--demo')){fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/divisional-pnl-synthetic.json',JSON.stringify(r,null,2));fs.writeFileSync('outputs/divisional-pnl-synthetic.html',`<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic P&amp;L preview</title><style>body{font:14px system-ui;background:#f8fafc;color:#172033;margin:36px}main{max-width:1300px;margin:auto}section{background:white;border:1px solid #cbd5e1;border-radius:16px;padding:24px}h1{font-size:16px;color:#92400e}h2{font-size:24px}form{display:flex;gap:12px;align-items:end;flex-wrap:wrap}label{display:grid;gap:4px}input,select,button{padding:10px;border:1px solid #cbd5e1;border-radius:6px;background:white}button{cursor:default}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{padding:10px;text-align:left;border-bottom:1px solid #e2e8f0;vertical-align:top}thead,tbody tr:last-child{background:#f1f5f9}details{margin:16px 0;border:1px solid #cbd5e1;padding:14px;border-radius:8px}summary{font-weight:600;cursor:pointer}dt{font-weight:600;margin-top:12px}dd{margin:4px 0;color:#475569}li{margin:8px 0}.sr-only{display:none}</style><main><h1>Synthetic fixture preview — implemented report component, simplified test styling; controls are inactive. No client figures.</h1>${html}</main></html>`);}
 // All legal LONGTEXT legacy shapes must be safe, including invalid JSON whose
 // text mentions an allowed project. Never widen restricted access to unallocated.
 const insertDocket=db.prepare('INSERT INTO dockets VALUES (?,?,?,?,?,?,?)');
 const badLinks=['','   ','{','{"jobId":"p1"','not json'];
 for(const [n,links] of badLinks.entries())insertDocket.run(`bad-${n}`,'tenant-a',links,'2026-09-04',23,`BAD-${n}`,'approved');
 for(const [n,links] of ['null','[]','"p1"','{"jobId":null}'].entries())insertDocket.run(`shape-${n}`,'tenant-a',links,'2026-09-04',24,`SHAPE-${n}`,'approved');
 insertDocket.run('allowed-unposted','tenant-a','{"jobId":"p1"}','2026-09-04',25,'ALLOWED','approved');
 insertDocket.run('other-unposted','tenant-a','{"jobId":"p2"}','2026-09-04',26,'OTHER','approved');
 insertDocket.run('foreign-malformed','tenant-b','{','2026-09-04',99999,'PRIVATE','approved');
 r=await service(input.start,input.end,null);assert.equal(r.totals.revenue,150);assert.equal(r.totals.directCosts,30);assert(!JSON.stringify(r).includes('PRIVATE'));
 for(let n=0;n<badLinks.length;n++){const row=r.sources.find(s=>s.id===`bad-${n}`);assert(row);assert.equal(row.divisionId,'unallocated');assert.equal(row.amount,23);assert(row.exclusion);assert.match(row.description,/invalid project links/);}
 for(let n=0;n<4;n++){const row=r.sources.find(s=>s.id===`shape-${n}`);assert(row);assert.equal(row.divisionId,'unallocated');assert(row.exclusion);}
 const unallocated=await service(input.start,input.end,'unallocated');assert(unallocated.sources.some(s=>s.id==='bad-0'));assert(unallocated.sources.every(s=>s.exclusion));assert.equal(unallocated.totals.directCosts,0);
 scope=['p1'];r=await service(input.start,input.end,null);assert.equal(r.totals.revenue,100);assert.deepEqual(r.availableDivisions.map(d=>d.id),['a']);assert.equal(r.projects.length,1);assert(!r.sources.some(s=>s.id==='unposted'));assert(r.sources.some(s=>s.id==='allowed-unposted'));assert(!r.sources.some(s=>s.id.startsWith('bad-')||s.id.startsWith('shape-')||s.id==='other-unposted'||s.id==='foreign-malformed'));await assert.rejects(service(input.start,input.end,'b'),e=>e.status===404);await assert.rejects(service(input.start,input.end,'unallocated'),e=>e.status===404);
 scope=[];r=await service(input.start,input.end,null);assert.equal(r.sources.length,0);assert.equal(r.projects.length,0);
 scope=null;await assert.rejects(service(input.start,input.end,'foreign'),e=>e.status===404);
 for(const role of ['field','scheduler','read_only','project_engineer']){actor.role=role;const before=calls.length;await assert.rejects(service(input.start,input.end,null),e=>e.status===403);assert.equal(calls.length,before);}
 actor.role='accounts';entitlements.commercial='disabled';calls.length=0;r=await service(input.start,input.end,null);assert.equal(r.totals.revenue,null);assert(!calls.some(c=>c.sql.includes('FROM client_invoices')));
 entitlements.commercial='read_only';entitlements.projects='disabled';calls.length=0;r=await service(input.start,input.end,null);assert.equal(r.totals.revenue,150);assert.equal(r.totals.directCosts,null);assert.equal(r.projects.length,0);assert(!calls.some(c=>c.sql.includes('FROM cost_transactions')||c.sql.includes('FROM project_baselines')));
 entitlements.reports='disabled';await assert.rejects(service(input.start,input.end,null),e=>e.status===404);entitlements.reports='active';await assert.rejects(service('invalid',input.end,null),e=>e.status===400);
 const route=load('app/api/reports/divisional-pnl/route.ts');assert.deepEqual(route.GET.options,{permission:'read',module:'reports',capability:'commercial.view'});
 console.log('PASS: divisional P&L source sums, unknown-tax profitability suppression, malformed legacy JSON, exclusions, cents, periods, lineage, unallocated evidence, tenant SQL isolation, scoped projects, roles, module degradation, component output and route contract.');
})().catch(e=>{console.error(e);process.exitCode=1;});
