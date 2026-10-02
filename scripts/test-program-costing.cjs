// Actual route handlers and SQL against synthetic SQLite; auth/entitlements and MySQL transport are test adapters.
const ts=require('typescript'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');
let actor={organisationId:'org',userId:'user',role:'admin'},readonly=false;const events=[];
const cache={};const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const sql=s=>s.replace(/ FOR UPDATE/g,'').replace("LEFT(CONCAT(name,' (copy)'),180)","substr(name||' (copy)',1,180)");
const query=async(s,args=[])=>s.includes('project_members')||s.includes('FROM audit_log')?[]:db.prepare(sql(s)).all(...args);
const mocks={
 'lib/platform/context.ts':{actorContext:{getStore:()=>actor}},
 'lib/platform/route.ts':{withActor:(fn,permission,module)=>{assert.equal(module,'projects');return async r=>readonly&&r.method!=='GET'?Response.json({error:'Read only'},{status:403}):fn(r)}},
 'lib/platform/sql.ts':{query,one:async(...args)=>(await query(...args))[0]||null,exec:async(s,args=[])=>db.prepare(sql(s)).run(...args).changes,tx:async fn=>{db.exec('BEGIN');try{const out=await fn(db);db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}},uuid:()=>crypto.randomUUID(),nowIso:()=>new Date().toISOString()},
 'lib/platform/audit.ts':{audit:async e=>events.push(e)},
 'lib/platform/project-access.ts':{assertProjectAccess:async id=>{if(!db.prepare('SELECT id FROM jobs WHERE id=? AND organisation_id=?').get(id,actor.organisationId))fail(404,'Project not found.')},projectFilter:async()=>''},
 'lib/seams/project-control.ts':{canSeeMoney:async()=>load('lib/platform/permissions.ts').can(actor.role,'commercial.view')},
};
function load(file){file=path.resolve(file);const key=path.relative(process.cwd(),file).replaceAll('\\','/');if(mocks[key])return mocks[key];if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
db.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY,organisation_id TEXT,name TEXT,stage TEXT,status TEXT,metadata TEXT,source_estimate_revision_id TEXT);
CREATE TABLE program_activities(id TEXT PRIMARY KEY,organisation_id TEXT,project_id TEXT,name TEXT,start_date TEXT,duration_days INTEGER,predecessor_id TEXT,responsible TEXT,work_package TEXT,resource_requirement TEXT,planned_quantity DECIMAL(15,2),quantity_unit TEXT,production_per_day DECIMAL(15,2),status TEXT,sequence INTEGER,revision INTEGER,created_by TEXT,created_at TEXT,updated_at TEXT);`);
const baseline={approvedBudget:{directCost:14000},estimateSnapshot:{items:[{id:'item-1',description:'Synthetic production',unit:'t',quantity:100,productivity:25,rate:150,rateBasis:'hour'}]},sourceRevisionId:'approved-r1'};
const baselineText=JSON.stringify(baseline);for(const [id,org] of [['project','org'],['foreign','other']])db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)').run(id,org,id,'active','Awarded',baselineText,'approved-r1');
// Verify additive migration preserves legacy rows and leaves unknown inputs null.
db.prepare("INSERT INTO program_activities(id,organisation_id,project_id,name,start_date,duration_days,status,revision,planned_quantity,production_per_day) VALUES ('legacy','org','project','Legacy','2026-10-03',1,'planned',1,0,0)").run();
const migration=fs.readFileSync('migrations/mysql/0025_program_activity_costing.sql','utf8');assert.equal(migration.split('--> statement-breakpoint').length,5);db.exec(migration.replaceAll('--> statement-breakpoint',''));
assert.equal(db.prepare("SELECT direct_cost_rate FROM program_activities WHERE id='legacy'").get().direct_cost_rate,null);
const route=load('app/api/projects/program/route.ts'),{activityPreview}=load('lib/seams/activity-preview.ts');
const send=async(method,payload,query='')=>{const r=await route[method](new Request('http://synthetic.test/api/projects/program'+query,{method,...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})}));return {status:r.status,body:await r.json()}};
const form={projectId:'project',name:'Synthetic work',startDate:'2026-10-03',durationDays:1,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'Unallocated',plannedQuantity:100,quantityUnit:'t',productionPerDay:200,status:'planned',productiveHoursPerDay:8,directCostRate:150,costRateBasis:'hour',sourceEstimateRevisionId:'approved-r1',sourceEstimateItemId:'item-1'};
const preview=r=>activityPreview({quantity:r.planned_quantity,unit:r.quantity_unit,productionPerDay:r.production_per_day,productiveHoursPerDay:r.productive_hours_per_day,rate:r.direct_cost_rate,rateBasis:r.cost_rate_basis});
(async()=>{
 let result=await send('POST',form);assert.equal(result.status,200,JSON.stringify(result.body));const id=result.body.id;
 if(process.argv.includes('--serve')){require('node:http').createServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3104');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=chunks.length?JSON.parse(Buffer.concat(chunks)):null;const response=await send(req.method,payload,req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'');res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(response.body));}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}}).listen(3105,'127.0.0.1',()=>console.log('Synthetic programme route listening at 127.0.0.1:3105'));return;}

 const get=async()=>(await send('GET',null,'?projectId=project')).body;
 let feed=await get(),row=feed.activities.find(r=>r.id===id);assert.equal(row.revision,1);assert.equal(row.source_estimate_item_id,'item-1');assert.equal(preview(row).productiveHours,4);assert.equal(preview(row).directCost,600);assert.equal(feed.estimateItems[0].revisionId,'approved-r1');
 // Save/reload repeated quantity edit: calculations use the persisted contract, not component memory.
 result=await send('POST',{...form,id,revision:1,plannedQuantity:125});assert.equal(result.status,200);row=(await get()).activities.find(r=>r.id===id);assert.equal(preview(row).productiveHours,5);assert.equal(preview(row).directCost,750);
 assert.equal((await send('POST',{...form,id,revision:1,plannedQuantity:999})).status,409);assert.equal(db.prepare('SELECT planned_quantity FROM program_activities WHERE id=?').get(id).planned_quantity,125);
 const persisted=JSON.stringify(row);const cancelled={...row,direct_cost_rate:999};assert.notEqual(cancelled.direct_cost_rate,row.direct_cost_rate);assert.equal(JSON.stringify((await get()).activities.find(r=>r.id===id)),persisted);
 for(const change of [{sourceEstimateItemId:'foreign-item'},{sourceEstimateRevisionId:'foreign-revision'},{sourceEstimateRevisionId:null},{directCostRate:-1},{productiveHoursPerDay:25},{directCostRate:1.234}])assert.equal((await send('POST',{...form,id,revision:2,...change})).status,400,JSON.stringify(change));
 assert.equal((await send('POST',{...form,projectId:'foreign'})).status,404);
 assert.equal((await send('GET',null,'?projectId=foreign')).status,404);
 assert.equal((await send('POST',{...form,id,revision:2,plannedQuantity:0,directCostRate:0,productiveHoursPerDay:0,productionPerDay:0})).status,200);row=(await get()).activities.find(r=>r.id===id);assert.equal(row.direct_cost_rate,0);assert.equal(row.productive_hours_per_day,0);assert.equal(row.planned_quantity,0);assert.equal(preview(row).directCost,null);
 assert.equal((await send('POST',{...form,id,revision:3,plannedQuantity:null,productionPerDay:null,productiveHoursPerDay:null,directCostRate:null,sourceEstimateItemId:null,sourceEstimateRevisionId:null})).status,200);row=(await get()).activities.find(r=>r.id===id);for(const key of ['planned_quantity','production_per_day','productive_hours_per_day','direct_cost_rate','source_estimate_item_id'])assert.equal(row[key],null);assert.equal(preview(row).directCost,null);
 assert.equal((await send('POST',{...form,id,revision:4,directCostRate:0,costRateBasis:'unit'})).status,200);row=(await get()).activities.find(r=>r.id===id);assert.equal(preview(row).directCost,0);
 // Older clients omit new fields: preserve, not reset. Field roles see and edit non-financial inputs only.
 const legacy={...form,id,revision:5};for(const k of ['productiveHoursPerDay','directCostRate','costRateBasis','sourceEstimateRevisionId','sourceEstimateItemId'])delete legacy[k];
 actor.role='project_engineer';feed=await get();row=feed.activities.find(r=>r.id===id);assert.equal(feed.canViewCosts,false);assert.deepEqual(feed.estimateItems,[]);for(const k of ['direct_cost_rate','cost_rate_basis','source_estimate_item_id','source_estimate_revision_id'])assert.equal(Object.hasOwn(row,k),false);
 assert.equal((await send('POST',{...legacy,directCostRate:9})).status,403);
 assert.equal((await send('POST',{...legacy,productiveHoursPerDay:7})).status,200);const hidden=db.prepare('SELECT * FROM program_activities WHERE id=?').get(id);assert.equal(hidden.direct_cost_rate,0);assert.equal(hidden.cost_rate_basis,'unit');assert.equal(hidden.source_estimate_item_id,'item-1');assert.equal(hidden.productive_hours_per_day,7);
 actor.role='read_only';assert.equal((await send('POST',{...legacy,revision:6})).status,403);actor.role='admin';readonly=true;assert.equal((await send('POST',{...form,id,revision:6})).status,403);readonly=false;
 const duplicate=await send('PATCH',{action:'duplicate',projectId:'project',id});assert.equal(duplicate.status,200,JSON.stringify(duplicate.body));const copy=(await get()).activities.find(r=>r.id===duplicate.body.id);for(const k of ['direct_cost_rate','cost_rate_basis','source_estimate_item_id','source_estimate_revision_id','productive_hours_per_day'])assert.equal(copy[k],hidden[k]);
 assert.equal(db.prepare("SELECT metadata FROM jobs WHERE id='project'").get().metadata,baselineText);assert(events.some(e=>e.after?.costingChanged?.includes('direct_cost_rate')));assert(!JSON.stringify(events).includes('approvedBudget'));
 db.prepare("UPDATE jobs SET stage='closed' WHERE id='project'").run();assert.equal((await send('POST',{...form,id,revision:6})).status,409);
 console.log('PASS persisted programme route: additive migration, create/read/edit/reload, duplicate, old client preservation, null/zero, stale revision, source validation, tenancy guards, financial redaction/write denial, read-only, closed project, baseline and audit protection');
 db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
