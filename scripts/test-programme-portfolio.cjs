const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let actor,ops='active',projects,activities,shifts,divisions,members,queries=[];
const cache={};
const mocks={
 'lib/platform/sql.ts':{query:async(sql,args)=>{
  queries.push([sql,args]);assert.equal(args[0],'org');
  if(sql.startsWith('SELECT project_id AS id'))return [...members.filter(m=>m.user_id===args[1]&&m.active===1).map(m=>({id:m.project_id})),...projects.filter(p=>p.project_manager_user_id===args[3]).map(p=>({id:p.id}))];
  if(sql.includes('FROM jobs'))return projects.filter(p=>!args[1]||args[1].includes(p.id));
  if(sql.includes('FROM business_units'))return divisions;
  if(sql.includes('FROM program_activities'))return activities.filter(a=>args[1].includes(a.project_id));
  if(sql.includes('FROM project_members'))return members.filter(m=>args[1].includes(m.project_id));
  if(sql.includes('FROM shifts')){assert(sql.includes('project_id IN (?)'));return shifts.filter(s=>args[1].includes(s.project_id??s.metadata.jobId));}
  throw Error(sql);
 }},
 'lib/platform/context.ts':{actorContext:{getStore:()=>actor}},
 'lib/platform/entitlements.ts':{getEntitlements:async()=>({operations:ops}),usable:(e,m)=>['active','read_only'].includes(e[m])},
 'lib/platform/http.ts':{fail:(status,message)=>{throw Object.assign(Error(message),{status});}},
 'lib/platform/database.ts':{database:{prepare(sql){return {bind(){return {first:async()=>({timezone:'UTC'}),all:async()=>({results:sql.includes('FROM workers')?[{id:'w',name:'Worker',status:'Active',metadata:'{}'}]:[]})};}}}}},
};
function load(file){file=path.resolve(file);const key=path.relative(process.cwd(),file).replaceAll('\\','/');if(mocks[key])return mocks[key];if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const {programmePortfolio,portfolioShift,inPortfolioWindow,validDate}=load('lib/seams/programme-portfolio.ts');
function reset(){
 actor={organisationId:'org',userId:'u',role:'admin'};ops='active';queries=[];
 projects=[{id:'a',name:'Alpha',business_unit_id:null},{id:'b',name:'Beta',business_unit_id:'d2'}];
 divisions=[{id:'current-default',name:'Civil',is_default:1},{id:'d2',name:'Asphalt',is_default:0}];members=[{project_id:'a',user_id:'u',active:1,name:'Engineer'}];
 activities=[{id:'pre',project_id:'a',name:'Predecessor',start_date:'2026-10-01',duration_days:5,predecessor_id:null,status:'planned'}, {id:'next',project_id:'a',name:'Upcoming',start_date:'2026-10-01',duration_days:1,predecessor_id:'pre',status:'planned',responsible:'user:outsider'}];
 const shift=(id,project)=>({id,project_id:project,name:id,status:'Planned',shift_date:null,start_time:null,finish_time:null,metadata:{jobId:project,date:'2026-10-06',start:'08:00',finish:'16:00',assignments:[{id:'unstable',category:'workers',resourceId:'w'}]}});
 shifts=[shift('first','a'),shift('other','b')];
}
const run=(p={})=>programmePortfolio(actor,new URLSearchParams({start:'2026-10-06',...p}));
(async()=>{
 reset();let out=await run({divisionId:'current-default'});
 assert.equal(out.projects.length,1);assert.equal(out.projects[0].divisionName,'Civil');assert.equal(out.projects[0].activities[0].start,'2026-10-06');assert.equal(out.projects[0].activities[0].responsibleName,null);
 assert(out.projects[0].shifts[0].issues.some(i=>i.code==='WORKER_DOUBLE_BOOKED'));assert(!JSON.stringify(out).includes('already booked'));assert(!JSON.stringify(out).includes('metadata'));assert(!JSON.stringify(out).includes('unstable'));assert.equal(out.end,'2026-10-19');
 for(const role of ['project_engineer','site_engineer']){reset();actor.role=role;const before=await run();shifts[1].metadata.assignments=[];shifts[1].name='SECRET';shifts[1].metadata.date='2026-10-10';const after=await run();assert.deepEqual(before,after);assert.equal(after.projects.length,1);assert.match(after.coverage,/Limited/);assert(!JSON.stringify(after).includes('SECRET'));assert.equal((await run({projectId:'b'})).counts.projects,0);}
 for(const role of ['field','unknown']){reset();actor.role=role;await assert.rejects(run(),e=>e.status===403);assert.equal(queries.length,0);}
 reset();actor.role='project_engineer';members[0].active=0;assert.equal((await run()).projects.length,0);projects[0].project_manager_user_id='u';assert.equal((await run()).projects.length,1);
 for(const entitlement of ['active','read_only','disabled']){reset();ops=entitlement;out=await run();assert.equal(out.operations,entitlement!=='disabled');if(entitlement==='disabled'){assert.equal(out.counts.shifts,null);assert(!queries.some(([q])=>q.includes('FROM shifts')));}}
 reset();actor.role='accounts';out=await run();assert.equal(out.operations,false);assert.equal(out.counts.shifts,null);assert(out.projects.every(p=>p.shifts===null));
 reset();assert.equal((await run({projectId:'foreign'})).counts.projects,0);assert.equal((await run({divisionId:'foreign'})).counts.activities,0);
 reset();shifts[0].business_unit_id='stale';assert.equal((await run()).projects[0].divisionId,'current-default');divisions=[];assert.equal((await run()).projects[0].divisionName,'Unresolved division');assert(queries.every(([q])=>!/(INSERT|UPDATE|DELETE)/.test(q)));
 reset();shifts[0].metadata.jobId='b';out=await run();assert.equal(out.projects[0].shifts.length,0);assert.equal(out.projects[0].noShiftsMessage,'Upcoming activities; no shifts in this window');
 reset();shifts[0].metadata.date='2026-02-30';out=await run();assert.equal(out.projects[0].shifts[0].date,null);assert.equal(out.counts.shifts,1);
 reset();shifts[0].metadata.assignments.push({id:'regenerated',category:'workers',resourceId:'w'},{category:'plant',resourceId:'w'});shifts[0].metadata.requirements=[{category:'workers',role:'',quantity:2},{category:'plant',role:'',quantity:1}];out=await run();assert.equal(out.projects[0].shifts[0].assignmentCount,2);assert.equal(out.projects[0].shifts[0].shortage,1);
 reset();out=await run();assert.equal(out.projects[0].shifts[0].shortage,null);shifts[0].metadata.requirements=[];assert.equal((await run()).projects[0].shifts[0].shortage,0);
 reset();shifts[1].status='Draft';assert.equal((await run()).projects[0].shifts[0].issues[0].severity,'warn');
 reset();projects[1].status='Archived';out=await run();assert.equal(out.projects.length,1);assert(out.projects[0].shifts[0].issues.some(i=>i.code==='WORKER_DOUBLE_BOOKED'));
 reset();const base=portfolioShift(shifts[0],new Set(['a'])).input;
 assert(inPortfolioWindow({...base,date:'2026-10-05',start:'22:00',finish:'02:00'},'2026-10-06','2026-10-20'));
 assert(!inPortfolioWindow({...base,date:'2026-10-05',start:'22:00',finish:'00:00'},'2026-10-06','2026-10-20'));
 assert(!inPortfolioWindow({...base,date:'2026-10-20',start:'00:00',finish:'08:00'},'2026-10-06','2026-10-20'));
 assert(!validDate('2026-02-30'));await assert.rejects(run({start:'not-a-date'}),e=>e.status===400);
 reset();activities[0].predecessor_id='foreign';out=await run();assert(out.projects[0].programmeIssue);assert(!JSON.stringify(out).includes('foreign'));
 const route=fs.readFileSync('app/api/projects/program/portfolio/route.ts','utf8');assert(route.includes("permission:'read',module:'projects',capability:'project.view'"));assert(route.includes('private, no-store'));assert(!/export (const|function|async function) (POST|PUT|PATCH|DELETE)/.test(route));
 console.log('PASS portfolio scope, role/entitlement gates, private projection, cross-division conflicts, predecessor order, legacy links, default division, overnight endpoints, missing vs zero and resource deduplication');
})().catch(e=>{console.error(e);process.exitCode=1;});
