// Real GET wrapper, permissions, entitlements, scope and seam against in-memory SQLite.
// Session authentication is substituted; mysql2 IN-array expansion is adapted explicitly.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');db.function('JSON_UNQUOTE',x=>x);
let actor,reads=[],passed=0;
db.exec(`CREATE TABLE jobs(id TEXT,organisation_id TEXT,name TEXT,business_unit_id TEXT,status TEXT,project_manager_user_id TEXT);
 CREATE TABLE project_members(organisation_id TEXT,project_id TEXT,user_id TEXT,active INTEGER);
 CREATE TABLE users(id TEXT,organisation_id TEXT,name TEXT);
 CREATE TABLE business_units(id TEXT,organisation_id TEXT,name TEXT,is_default INTEGER,sort_order INTEGER);
 CREATE TABLE program_activities(id TEXT,organisation_id TEXT,project_id TEXT,name TEXT,start_date TEXT,duration_days INTEGER,predecessor_id TEXT,status TEXT,sequence INTEGER,responsible TEXT);
 CREATE TABLE shifts(id TEXT,organisation_id TEXT,name TEXT,status TEXT,project_id TEXT,shift_date TEXT,start_time TEXT,finish_time TEXT,metadata TEXT);
 CREATE TABLE organisation_profiles(organisation_id TEXT,timezone TEXT);
 CREATE TABLE organisation_entitlements(organisation_id TEXT,module TEXT,status TEXT,valid_until TEXT);
 CREATE TABLE workers(id TEXT,organisation_id TEXT,name TEXT,status TEXT,metadata TEXT);
 CREATE TABLE worker_competencies(organisation_id TEXT,worker_id TEXT,competency_type TEXT,expiry_date TEXT,status TEXT);
 CREATE TABLE plant(id TEXT,organisation_id TEXT,name TEXT,status TEXT,metadata TEXT,safety_hold INTEGER,legacy_synced_at TEXT,active INTEGER,compliance_expiry TEXT,next_service_date TEXT);`);
function read(sql,args=[]){assert.match(sql,/^SELECT /);reads.push({sql,args});let i=0;const flat=[];sql=sql.replace(/\?/g,()=>{const a=args[i++];flat.push(...(Array.isArray(a)?a:[a]));return Array.isArray(a)?a.map(()=>'?').join(','):'?';});return db.prepare(sql).all(...flat);}
const database={prepare(sql){return {bind(...args){return {all:async()=>({results:read(sql,args)}),first:async()=>read(sql,args)[0]??null};}}}};
const cache={},mocks={
 'lib/platform/database.ts':{database},'lib/platform/sql.ts':{query:async(s,a)=>read(s,a)},
 'lib/authz.ts':{requireActor:async(_req,_db,permission,module)=>{if(!actor)throw Object.assign(Error('Unauthenticated'),{status:401});if(!load('lib/platform/permissions.ts').roleAllows(actor.role,permission,module))throw Object.assign(Error('Unauthorised'),{status:403});return actor;},authError:e=>Response.json({error:e.message},{status:e.status||500})},
};
function load(file){file=path.resolve(file);const key=path.relative(process.cwd(),file).replaceAll('\\','/');if(mocks[key])return mocks[key];if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const {GET}=load('app/api/projects/program/portfolio/route.ts'),{ROLES,can}=load('lib/platform/permissions.ts'),{MODULES}=load('lib/platform/modules.ts');
function reset(role='admin',projects='active',operations='active'){
 for(const name of ['jobs','project_members','users','business_units','program_activities','shifts','organisation_profiles','organisation_entitlements','workers','worker_competencies','plant'])db.exec(`DELETE FROM ${name}`);
 actor={userId:'u',email:'not-returned@example.invalid',organisationId:'A',role};reads=[];
 db.exec(`INSERT INTO jobs VALUES ('one','A','Accessible project',NULL,'Active',NULL),('two','A','RESTRICTED PROJECT','d2','Active',NULL),('foreign','B','FOREIGN PROJECT','fb','Active',NULL);
 INSERT INTO project_members VALUES ('A','one','u',1),('B','two','u',1);
 INSERT INTO users VALUES ('u','A','Project engineer'),('u','B','FOREIGN USER');
 INSERT INTO business_units VALUES ('d1','A','Civil',1,1),('d2','A','Other division',0,2),('fb','B','FOREIGN DIVISION',1,1);
 INSERT INTO program_activities VALUES ('a','A','one','Activity','2026-10-06',1,NULL,'planned',1,'user:u'),('b','A','two','RESTRICTED ACTIVITY','2026-10-06',1,NULL,'planned',1,NULL),('f','B','one','FOREIGN ACTIVITY','2026-10-06',1,NULL,'planned',1,NULL);
 INSERT INTO organisation_profiles VALUES ('A','UTC');
 INSERT INTO workers VALUES ('w','A','Worker','Active','{}'),('fw','B','FOREIGN WORKER','Active','{}');`);
 for(const moduleKey of MODULES)db.prepare('INSERT INTO organisation_entitlements VALUES (?,?,?,NULL)').run('A',moduleKey,moduleKey==='projects'?projects:moduleKey==='operations'?operations:'active');
 const meta=p=>JSON.stringify({jobId:p,date:'2026-10-06',start:'08:00',finish:'16:00',assignments:[{category:'workers',resourceId:'w'}]});
 const insert=db.prepare('INSERT INTO shifts VALUES (?,?,?,?,?,NULL,NULL,NULL,?)');insert.run('s1','A','Visible shift','Planned','one',meta('one'));insert.run('s2','A','RESTRICTED SHIFT','Planned','two',meta('two'));insert.run('fs','B','FOREIGN SHIFT','Planned','one',meta('one'));
}
async function get(params=''){const r=await GET(new Request('http://local/api/projects/program/portfolio?start=2026-10-06'+params));assert.equal(r.headers.get('Cache-Control'),'private, no-store');return {status:r.status,body:await r.json()};}
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 for(const role of [...ROLES,'unknown'])for(const projects of ['active','read_only','disabled'])for(const operations of ['active','read_only','disabled'])await test(`${role}/${projects}/${operations}`,async()=>{
  reset(role,projects,operations);const r=await get(),permitted=can(role,'project.view');assert.equal(r.status,!permitted?403:projects==='disabled'?404:200);
  assert(!JSON.stringify(r.body).includes('FOREIGN'));if(r.status!==200){assert(!reads.some(q=>q.sql.includes('FROM jobs')));return;}
  const scoped=['project_engineer','site_engineer'].includes(role),ops=can(role,'schedule.view')&&operations!=='disabled';assert.equal(r.body.projects.length,scoped?1:2);assert.equal(r.body.operations,ops);assert.equal(r.body.counts.shifts,ops?scoped?1:2:null);
  if(scoped)assert(!JSON.stringify(r.body).includes('RESTRICTED'));if(!ops)assert(!reads.some(q=>q.sql.includes('FROM shifts')||q.sql.includes('FROM workers')));
 });
 const matrix=passed;
 await test('unauthenticated GET is private 401 without queries',async()=>{reset();actor=null;assert.equal((await get()).status,401);assert.equal(reads.length,0);});
 await test('inactive member excluded; recorded PM included',async()=>{reset('project_engineer');db.exec("UPDATE project_members SET active=0 WHERE organisation_id='A'");assert.equal((await get()).body.counts.projects,0);db.exec("UPDATE jobs SET project_manager_user_id='u' WHERE id='one'");assert.equal((await get()).body.counts.projects,1);});
 await test('restricted bookings do not change scoped payload',async()=>{reset('site_engineer');const before=(await get()).body;db.exec("UPDATE shifts SET name='CHANGED SECRET',metadata='{}' WHERE id='s2'");assert.deepEqual((await get()).body,before);});
 await test('foreign records do not change authorised payload',async()=>{reset();const before=(await get()).body;db.exec("UPDATE shifts SET metadata='{}' WHERE organisation_id='B';DELETE FROM program_activities WHERE organisation_id='B';DELETE FROM business_units WHERE organisation_id='B';");assert.deepEqual((await get()).body,before);});
 await test('unknown, inaccessible and foreign project filters agree',async()=>{reset('project_engineer');const a=await get('&projectId=two'),b=await get('&projectId=foreign'),c=await get('&projectId=missing');assert.deepEqual(a,b);assert.deepEqual(b,c);assert.equal(a.body.counts.projects,0);});
 await test('foreign/unknown division filters agree',async()=>{reset();assert.deepEqual(await get('&divisionId=fb'),await get('&divisionId=missing'));});
 await test('conflicts survive division and project filters',async()=>{reset();const a=await get('&divisionId=d1&projectId=one');assert.equal(a.body.projects.length,1);assert(a.body.projects[0].shifts[0].issues.some(i=>i.code==='WORKER_DOUBLE_BOOKED'));});
 await test('legacy project fallback and inconsistent link fail closed',async()=>{reset();db.exec("UPDATE shifts SET project_id=NULL WHERE id='s1'");assert.equal((await get()).body.projects[0].shifts.length,1);db.exec("UPDATE shifts SET project_id='two' WHERE id='s1'");assert(!(JSON.stringify((await get()).body).includes('Visible shift')));});
 await test('responsible name requires same-tenant active project membership',async()=>{reset();assert.equal((await get()).body.projects[0].activities[0].responsibleName,'Project engineer');db.exec("UPDATE project_members SET active=0 WHERE organisation_id='A'");assert.equal((await get()).body.projects[0].activities[0].responsibleName,null);});
 await test('service overdue warns and safety hold blocks',async()=>{reset();db.exec(`INSERT INTO plant VALUES ('p','A','Plant','Active','{}',1,'synced',1,'2027-01-01','2026-01-01')`);db.prepare('UPDATE shifts SET metadata=? WHERE id=?').run(JSON.stringify({jobId:'one',date:'2026-10-06',start:'08:00',finish:'16:00',assignments:[{category:'plant',resourceId:'p'}]}),'s1');const issues=(await get()).body.projects[0].shifts[0].issues;assert(issues.some(i=>i.code==='PLANT_SERVICE_OVERDUE'&&i.severity==='warn'));assert(issues.some(i=>i.code==='RESOURCE_UNAVAILABLE'&&i.severity==='block'));});
 await test('expired active entitlement remains readable',async()=>{reset();db.exec("UPDATE organisation_entitlements SET valid_until='2000-01-01' WHERE module IN ('projects','operations')");const r=await get();assert.equal(r.status,200);assert.equal(r.body.operations,true);});
 await test('invalid date error is private and generic',async()=>{reset();const r=await GET(new Request('http://local/api/projects/program/portfolio?start=2026-02-30&projectId=foreign'));assert.equal(r.status,400);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await r.json(),{error:'Enter a valid start date.'});});
 console.log(`PASS ${passed} boundary cases (${matrix} role/entitlement combinations + ${passed-matrix} targeted regressions); real route/guards/SQL with local SQLite adapter, substituted authentication`);
 db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
