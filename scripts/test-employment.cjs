// Disposable SQLite regression: production services/routes, no network or live data.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const sql=new DatabaseSync(':memory:');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
require('./test-services.cjs').prepare(sql);
sql.exec(fs.readFileSync('migrations/mysql/0026_planning_v0_1.sql','utf8'));
const db={prepare(query){let values=[];const stmt={bind(...v){values=v;return stmt;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return stmt;},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const queries=[];
function statement(query,params=[]){queries.push(query);const args=[];query=query.replace(/ FOR UPDATE/g,'');
  let index=0;query=query.replace(/\?/g,()=>{const p=params[index++];if(Array.isArray(p)){args.push(...p);return p.map(()=>'?').join(',');}args.push(p===undefined?null:p);return '?';});
  return {stmt:sql.prepare(query),args};
}
const typedSql={query:async(q,p)=>{const {stmt,args}=statement(q,p);return stmt.all(...args);},one:async(q,p)=>{const {stmt,args}=statement(q,p);return stmt.get(...args)||null;},exec:async(q,p)=>{const {stmt,args}=statement(q,p);return Number(stmt.run(...args).changes);},tx:async fn=>{sql.exec('BEGIN');try{const v=await fn({});sql.exec('COMMIT');return v;}catch(e){sql.exec('ROLLBACK');throw e;}},nowIso:()=>new Date().toISOString(),uuid:()=>crypto.randomUUID()};
const cache={};
function load(file){file=path.resolve(file);if(file.endsWith(path.join('lib','platform','sql.ts')))return typedSql;const external=require('./test-services.cjs').mock(file,db,sql);if(external)return {...external,getPool:()=>({})};if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const E=load('lib/v1/employment.ts'),mapping=load('lib/v1/resource-mapping.ts'),resources=load('lib/modules/operations/resources.ts'),imports=load('lib/modules/operations/resource-import.ts'),planning=load('lib/modules/estimating/planning.ts'),calc=load('lib/estimate-calculations.ts');
const context=load('lib/platform/context.ts').actorContext;
const actor={userId:'test-owner',email:'admin@example.invalid',organisationId:'roadworx-sydney',role:'admin'};
const req=(body,method='POST',url='https://test.invalid/api')=>new Request(url,{method,headers:{'Content-Type':'application/json','x-test-user-id':actor.userId,'x-test-user-email':actor.email},...(method==='GET'?{}:{body:JSON.stringify(body)})});
const worker=id=>sql.prepare('SELECT * FROM workers WHERE id=?').get(id);
const csv=text=>new File([text],'workers.csv',{type:'text/csv'});
(async()=>{
 for(const [input,want] of [['FULL-TIME','full_time'],['full_time','full_time'],['Full time','full_time'],['Part Time','part_time'],['part-time','part_time'],['part_time','part_time'],['casual','casual'],['permanent','employee'],['employee','employee'],['subcontractor','contractor'],['labor hire','labour hire'],['Seasonal?','Seasonal?'],[' ',null]])assert.equal(E.normaliseEmploymentType(input),want);
 assert.match(E.employmentLabel('employee'),/unspecified/);assert.match(E.employmentLabel('Seasonal?'),/Review.*Seasonal/);
 for(const value of ['constructor','toString','__proto__']){
  assert.equal(E.normaliseEmploymentType(value),value);
  assert.equal(E.employmentLabel(value),`Review employment type: ${value}`);
  assert.equal(E.knownEmploymentType(value),false);
  assert.equal(E.employeeAssumption(value),undefined);
 }
 assert.equal(E.workerEmployment({employment_type:'casual',legacy_synced_at:'now'},{employmentType:'full_time'}),'casual');
 assert.equal(E.workerEmployment({employment_type:null,legacy_synced_at:'now'},{employmentType:'full_time'}),null);
 assert.equal(E.workerEmployment({employment_type:null},{employmentType:'full time'}),'full_time');
 for(const type of ['full time','part_time','casual','permanent','contractor','labour hire','Seasonal?']){
  const mapped=mapping.mapWorker({id:'w',name:'Worker',status:'Active',metadata:{employmentType:type}});
  assert.equal(mapped.columns.employment_type,E.normaliseEmploymentType(type));
  assert.equal(mapped.issues.some(i=>i.field==='employmentType'),type==='Seasonal?');
 }
 console.log('PASS aliases, unspecified, unknown review and typed authority');
 await context.run(actor,async()=>{
  const {id}=await resources.saveWorker(null,null,{firstName:'Jordan',employeeNumber:'EMP-1',status:'Active',employmentType:'Full time',hourlyRate:61});
  assert.equal(worker(id).employment_type,'full_time');assert.equal(JSON.parse(worker(id).metadata).employmentType,'full_time');
  for(const value of [undefined,'',null,'   ']){await resources.saveWorker(id,worker(id).revision,{firstName:'Jordan',status:'Active',employmentType:value});assert.equal(worker(id).employment_type,'full_time');}
  await assert.rejects(resources.saveWorker(id,0,{firstName:'Jordan',status:'Active',employmentType:'casual'}),/changed by someone/);
  sql.prepare('UPDATE workers SET employment_type=?,metadata=? WHERE id=?').run('Seasonal?',JSON.stringify({employmentType:'full_time'}),id);
  await resources.saveWorker(id,worker(id).revision,{firstName:'Jordan',status:'Active',employmentType:'Seasonal?',employeeNumber:'EMP-1'});
  assert.equal(worker(id).employment_type,'Seasonal?');assert.equal(JSON.parse(worker(id).metadata).employmentType,'Seasonal?');
  await assert.rejects(resources.saveWorker(null,null,{firstName:'Bad',status:'Active',employmentType:'arbitrary'}),/recognised/);
  const blank=csv('Employee number,Employment type\nEMP-1,\n');const preview=await imports.previewResourceSpreadsheet(blank,'workers');
  assert.equal(preview.rows[0].action,'update');assert.equal(preview.rows[0].values.employmentType,'Seasonal?');assert.match(preview.rows[0].warnings.join(' '),/Review/);
  assert.equal((await imports.applyResourceSpreadsheet(blank,'workers')).summary.updated,1);assert.equal(worker(id).employment_type,'Seasonal?');
  const file=csv('First name,Employee number,Employment type\nJordan,EMP-1,part time\nCasey,EMP-2,full-time\nSam,EMP-3,permanent\nLee,EMP-4,casual\nPat,EMP-5,contractor\nBo,EMP-6,labor hire\nBad,EMP-7,mystery\n');
  const p=await imports.previewResourceSpreadsheet(file,'workers');assert.deepEqual(p.rows.map(r=>r.values.employmentType),['part_time','full_time','employee','casual','contractor','labour hire','mystery']);assert.equal(p.summary.error,1);
  const result=await imports.applyResourceSpreadsheet(file,'workers');assert.equal(result.summary.updated,1);assert.equal(result.summary.created,5);assert.equal(result.summary.failed,0);
  assert.equal((await imports.applyResourceSpreadsheet(file,'workers')).summary.created,0,'repeat import updates, never duplicates');
  const staleSync=load('lib/v1/resource-sync.ts').workerStatements(actor.organisationId,{id,name:'Jordan',status:'Active',metadata:{employmentType:'full_time',employeeNumber:'EMP-1'}},[],new Date().toISOString(),()=>crypto.randomUUID());
  for(const s of staleSync.statements)await typedSql.exec(s.sql,s.params);
  assert.equal(worker(id).employment_type,'part_time','legacy SQL itself cannot overwrite an already-typed classification');
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(await imports.resourceTemplate('workers'));assert.match(book.getWorksheet('Data').getCell('G2').value,/full_time/);assert.match(book.getWorksheet('Data').getCell('G2').dataValidation.formulae[0],/part_time/);
  const choices=await planning.searchResources(actor.organisationId,'worker','part time',20);assert.equal(choices[0].id,id);assert.match(choices[0].detail,/Part-time/);assert.deepEqual(Object.keys(choices[0]).sort(),['detail','id','label','type']);
  const doc={activities:[{requirements:[{resourceRef:{type:'worker',id}}]}]};const labels=await planning.resourceLabels(actor.organisationId,doc);assert.deepEqual(labels['worker:'+id],choices[0]);
  const pickerQueries=queries.filter(q=>/SELECT id,name,employee_number/.test(q));assert(pickerQueries.length);assert(pickerQueries.every(q=>!/(rate|metadata|phone|email)/.test(q)),'no financial/contact fields in picker SQL');
  const legacy=load('app/api/os/records/route.ts');
  sql.prepare('UPDATE workers SET metadata=? WHERE id=?').run(JSON.stringify({employmentType:'full_time'}),id);
  for(const patch of [{phone:'0400000000'},{employmentType:''},{employmentType:'full_time'}]){const r=await legacy.PUT(req({module:'resources',resourceType:'workers',id,name:'Jordan',status:'Active',metadata:patch},'PUT'));assert.equal(r.status,200,await r.clone().text());assert.equal(worker(id).employment_type,'part_time');}
  const delivery=load('app/api/delivery/route.ts');sql.prepare('UPDATE workers SET metadata=? WHERE id=?').run(JSON.stringify({employmentType:'full_time'}),id);
  const loaded=await (await delivery.GET(req(null,'GET'))).json();assert.equal(loaded.workers.find(w=>w.id===id).metadata.employmentType,'part_time');
  console.log('PASS worker create/edit, blank/unknown preservation, stale revision, CSV preview/apply/repeat, template, legacy round-trip and picker identity');
  await context.run({...actor,role:'scheduler'},async()=>{const listed=await resources.listWorkers();assert(listed.workers.every(w=>!('hourly_rate' in w)));const p=await imports.previewResourceSpreadsheet(csv('First name,Hourly rate,Employment type\nNoPay,98765,casual'),'workers');assert.equal(p.rows[0].values.hourlyRate,null);assert(!p.availableFields.some(f=>f.key==='hourlyRate'));await resources.saveWorker(id,worker(id).revision,{firstName:'Jordan',status:'Active',employmentType:'casual',hourlyRate:9999});assert.notEqual(Number(worker(id).hourly_rate),9999);});
  assert.equal(await planning.canLinkResources(actor.organisationId,{role:'field'}),false);
  console.log('PASS rate redaction and nonfinancial classification; field cannot link resources');
 });
 const original=calc.makeDefaultEstimate();const baseline=calc.calculateEstimate(original);
 assert(!('employmentTypeAssumption' in calc.normaliseEstimateData(original).labour[0]),'old estimates acquire no default assumption');
 for(const type of ['full_time','part_time','casual']){const data=calc.normaliseEstimateData({...original,labour:original.labour.map(l=>({...l,employmentTypeAssumption:type}))});assert(data.labour.every(l=>l.employmentTypeAssumption===type));assert.deepEqual(calc.calculateEstimate(data),baseline);assert.deepEqual(calc.normaliseEstimateData(JSON.parse(JSON.stringify(data))),data);}
 assert.equal(calc.normaliseEstimateData({...original,labour:[{...original.labour[0],employmentTypeAssumption:'contractor'}]}).labour[0].employmentTypeAssumption,undefined);
 console.log('PASS estimate assumption round-trip, absent historical property, contractor exclusion and identical monetary totals');
 const estimate=load('app/api/estimates/route.ts'),approval=load('app/api/estimates/approval/route.ts');
 const data={...original,clientName:'Fixture client',projectName:'Fixture project',site:'Disposable site'};
 let response=await estimate.POST(req({data,status:'Draft'}));assert.equal(response.status,201,await response.clone().text());const estimateId=(await response.json()).estimate.id;
 response=await approval.POST(req({estimateId,action:'submit'}));assert.equal(response.status,200,await response.clone().text());
 response=await approval.POST(req({estimateId,action:'approve'}));assert.equal(response.status,200,await response.clone().text());
 const old=sql.prepare('SELECT * FROM estimate_revisions WHERE estimate_id=?').get(estimateId);
 const changed={...data,labour:data.labour.map(l=>({...l,employmentTypeAssumption:'part_time'}))};
 for(let i=0;i<2;i++){response=await estimate.PUT(req({id:estimateId,data:changed},'PUT'));assert.equal(response.status,200,await response.clone().text());const read=await (await estimate.GET(req(null,'GET','https://test.invalid/api?id='+estimateId))).json();assert.equal(read.estimate.data.labour[0].employmentTypeAssumption,'part_time');assert.deepEqual(read.estimate.totals,calc.calculateEstimate(data));}
 response=await approval.POST(req({estimateId,action:'submit'}));assert.equal(response.status,200,await response.clone().text());
 const snapshots=sql.prepare('SELECT * FROM estimate_revisions WHERE estimate_id=? ORDER BY revision_number').all(estimateId);
 assert.equal(snapshots[0].snapshot,old.snapshot,'approved historical snapshot bytes unchanged');assert.equal(snapshots[0].totals,old.totals);
 assert.equal(JSON.parse(snapshots[1].snapshot).data.labour[0].employmentTypeAssumption,'part_time');assert.equal(snapshots[1].totals,old.totals);
 console.log('PASS estimate API repeated save/reload, new review snapshot and byte-identical old approved snapshot/totals');
 const planRoute=load('app/api/planning/route.ts'),P=load('lib/v1/planning.ts');
 sql.prepare("UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND module NOT IN ('core','estimating')").run(actor.organisationId);
 let before=queries.length;response=await planRoute.GET(req(null,'GET','https://test.invalid/api/planning?lookup=worker'));assert.equal(response.status,403);assert(!queries.slice(before).some(q=>/FROM workers/.test(q)),'forbidden picker does not query workers');
 response=await planRoute.POST(req({action:'create-plan',name:'Standalone fixture'}));assert.equal(response.status,200,await response.clone().text());const created=await response.json();
 const activity=P.blankActivity('activity','Standalone','activity01');activity.durationDays=1;activity.hoursPerDay=8;activity.requirements=[{id:'required01',kind:'labour',name:'Proposed crew',quantity:2,rate:42,rateBasis:'hour',resourceRef:null}];
 const document={activities:[activity],dependencies:[],sharedCosts:[]};
 response=await planRoute.POST(req({action:'save',scenarioId:created.scenario.id,expectedRevision:created.scenario.revision,document}));assert.equal(response.status,200,await response.clone().text());const saved=await response.json();assert.deepEqual(saved.document,document);assert.equal(saved.resourcesAvailable,false);assert.deepEqual(saved.resources,{});
 const linked=structuredClone(document);linked.activities[0].requirements[0].resourceRef={type:'worker',id:sql.prepare('SELECT id FROM workers LIMIT 1').get().id};
 response=await planRoute.POST(req({action:'save',scenarioId:created.scenario.id,expectedRevision:saved.scenario.revision,document:linked}));assert.equal(response.status,403,'standalone cannot add links');
 response=await planRoute.GET(req(null,'GET','https://test.invalid/api/planning?scenarioId='+created.scenario.id));assert.equal(response.status,200);assert.deepEqual((await response.json()).document,document);
 console.log('PASS standalone Planning save/reload, Operations-off forbidden lookup and new link rejection');
 sql.prepare("UPDATE organisation_entitlements SET status='active' WHERE organisation_id=? AND module='operations'").run(actor.organisationId);
 response=await planRoute.POST(req({action:'save',scenarioId:created.scenario.id,expectedRevision:saved.scenario.revision,document:linked}));assert.equal(response.status,200,await response.clone().text());const linkedSaved=await response.json();assert.equal(linkedSaved.document.activities[0].requirements[0].rate,42);assert.equal(linkedSaved.document.activities[0].requirements[0].name,'Proposed crew');
 assert.deepEqual(Object.keys(Object.values(linkedSaved.resources)[0]).sort(),['detail','id','label','type']);
 sql.prepare("UPDATE users SET role='read_only' WHERE id=?").run(actor.userId);before=queries.length;response=await planRoute.GET(req(null,'GET','https://test.invalid/api/planning?lookup=worker'));assert.equal(response.status,403);assert(!queries.slice(before).some(q=>/FROM workers/.test(q)));
 console.log('PASS permitted worker linking preserves rate/name, and read-only lookup is denied before resource queries');
 sql.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
