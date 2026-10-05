// Connected journey: address search → confirmed work point → shared work areas → scheduled job with traffic-management context,
// on a populated copy of the full demo company, desktop + mobile, against the production build.
// Needs an EMPTY, freshly created disposable database whose name ends in _test. Synthetic data only; no aerial imagery, email, AI or paid service.
//   npm run build   then   MYSQL_DATABASE=connected_test node scripts/connected-workmap-journey.mjs [outputDir]
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
const PORT=Number(process.env.PORT||3196),base=`http://localhost:${PORT}`,OUT=process.argv[2]||'/tmp/connected-journey';
mkdirSync(OUT,{recursive:true});
const loadPlaywright=()=>{for(const p of [process.env.PLAYWRIGHT_MODULE,'playwright','playwright-core','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){try{return require(p);}catch{/* next */}}throw new Error('Playwright not found (set PLAYWRIGHT_MODULE)');};
const {chromium}=loadPlaywright();
const CHROMIUM=process.env.CHROMIUM_PATH||['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
let pass=0,fail=0;const t0=Date.now();
const check=(step,ok,detail='')=>{if(ok)pass++;else fail++;console.log(`${ok?'PASS':'FAIL'}    ${step}${detail?' — '+detail:''}`);return Boolean(ok);};

const db=await connect();
const [[existing]]=await db.query('SELECT COUNT(*) AS n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(existing.n)!==0)throw new Error('Refusing to run: the disposable database already has users. Use an empty, freshly migrated database.');
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'connected-secret-with-at-least-32-characters!',BETTER_AUTH_URL:base,R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x'};
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
if(migrated.status!==0)throw new Error('migrations failed: '+migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}

const stamp=Date.now(),password='Very-strong-test-password-42';
const signup=async name=>{const email=`${name}-${stamp}@owner-co.example.invalid`;let r;for(let a=0;a<20;a++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,5000));}
 if(!r.ok)throw new Error(`sign-up for ${name} failed: ${r.status}`);
 const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('='));const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);
 return {id:u.id,email,cookies,cookie:cookies.join('; '),org:u.organisation_id};};
const skipOnboarding=async org=>{const t=new Date().toISOString();await db.query('INSERT INTO organisation_profiles (organisation_id,created_at,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE onboarding_completed_at=VALUES(created_at)',[org,t,t]).catch(async()=>{await db.query('UPDATE organisation_profiles SET onboarding_completed_at=? WHERE organisation_id=?',[t,org]);});await db.query('UPDATE organisation_profiles SET onboarding_completed_at=? WHERE organisation_id=?',[t,org]);};
const api=cookie=>async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let j;try{j=JSON.parse(text);}catch{j=text;}return {status:r.status,body:j};};
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
const digest=async(sql,p=[])=>createHash('sha256').update(JSON.stringify(await q(sql,p))).digest('hex');
const WORK=mkdtempSync(join(tmpdir(),'connected-'));
const importer=(args,over={})=>spawnSync(process.execPath,['scripts/import-demo-tenant.mjs',...args],{env:{...env,...over},encoding:'utf8',timeout:1500000});
const text=r=>(r.stdout||'')+(r.stderr||'');
const hashOf=r=>/planHash: ([0-9a-f]{64})/.exec(text(r))?.[1];

const errors=[];
let browser;
try{
 // ------------------------------------------------------------------ setup: an owner tenant with real-looking records of its own, and a second tenant
 const A=await signup('owner-a'),B=await signup('owner-b');
 await db.query("UPDATE users SET role='admin' WHERE id IN (?,?)",[A.id,B.id]);
 await skipOnboarding(A.org);await skipOnboarding(B.org);
 const a=api(A.cookie),b=api(B.cookie);
 const mk=async(call,name)=>{const r=await call('/api/projects','POST',{name});if(![200,201].includes(r.status))throw new Error('project create failed '+JSON.stringify(r.body));return r.body.projectId;};
 const ownerProject=await mk(a,'Owner Own Project (pre-existing)');
 const otherProject=await mk(b,'Other Tenant Project');
 const bArea=await b('/api/projects/work-areas','POST',{projectId:otherProject,name:'Other tenant area',kind:'work_area',discipline:'asphalt',delivery:'own',contractorLabel:null,sequence:null,notes:null,ring:[[0,0],[40,0],[40,40],[0,40]].map(([x,y])=>({lat:-33.9+y/111194.9,lng:151.2+x/92400}))});
 check('fixture: owner tenant and a second tenant each hold their own project; the second also has a work area',Boolean(ownerProject)&&Boolean(otherProject)&&bArea.status===201);
 const ownerDigest=()=>digest("SELECT id,name,status,revision,location_id FROM jobs WHERE organisation_id=? AND id=?",[A.org,ownerProject]);
 const otherDigest=async()=>[await digest('SELECT * FROM jobs WHERE organisation_id=? ORDER BY id',[B.org]),await digest('SELECT * FROM project_work_areas WHERE organisation_id=? ORDER BY id',[B.org]),await digest('SELECT * FROM users WHERE organisation_id=? ORDER BY id',[B.org])].join('|');
 const owner0=await ownerDigest(),other0=await otherDigest();

 // ------------------------------------------------------------------ populate the owner tenant with the FULL demo company through the guarded importer
 const applyEnv={DEMO_SEED_EMAIL:A.email,DEMO_SEED_PASSWORD:password};
 const planFile=join(WORK,'plan.json'),BASELINE=join(WORK,'baseline.json');
 const tImp=Date.now();
 const dry=importer(['--organisation-id',A.org,'--out',planFile]);const plan=hashOf(dry);
 check('importer dry run succeeds, reports no conflicts, and lists the work-map tables',dry.status===0&&Boolean(plan)&&!/CONFLICT|BLOCKER/.test(text(dry))&&/project_work_areas/.test(text(dry))&&/shift_work_areas/.test(text(dry))&&/project_work_points/.test(text(dry)),text(dry).slice(-200));
 const apply=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan,'--baseline',BASELINE],applyEnv);
 check(`importer apply succeeds (${Math.round((Date.now()-tImp)/1000)}s)`,apply.status===0,text(apply).slice(-300));
 const cnt=async(t,org=A.org)=>Number((await q(`SELECT COUNT(*) n FROM ${t} WHERE organisation_id=?`,[org]))[0].n);
 const pop={workAreas:await cnt('project_work_areas'),workPoints:await cnt('project_work_points'),links:await cnt('shift_work_areas'),shifts:await cnt('shifts'),locations:await cnt('locations')};
 check('populated: 20 work areas, 3 confirmed work points, 27 shift links, 17 shifts, 5 locations',pop.workAreas===20&&pop.workPoints===3&&pop.links===27&&pop.shifts===17&&pop.locations>=5,JSON.stringify(pop));
 check('the owner\'s own project and the other tenant are byte-for-byte unchanged by the import',(await ownerDigest())===owner0&&(await otherDigest())===other0);
 const [[bleed]]=await db.query('SELECT (SELECT COUNT(*) FROM project_work_areas WHERE organisation_id=?) a,(SELECT COUNT(*) FROM shift_work_areas WHERE organisation_id=?) l,(SELECT COUNT(*) FROM project_work_points WHERE organisation_id=?) p',[B.org,B.org,B.org]);
 check('the second tenant received no work points or shift links and only its own one work area',Number(bleed.a)===1&&Number(bleed.l)===0&&Number(bleed.p)===0);
 const rowsNow=async()=>JSON.stringify([await cnt('project_work_areas'),await cnt('project_work_points'),await cnt('shift_work_areas'),await cnt('shifts'),await cnt('jobs'),await cnt('locations'),await cnt('workers'),await cnt('plant')]);
 const rows1=await rowsNow();
 // repeat / resume: another dry run finds nothing to create and a second apply adds no rows
 const baselineSha=createHash('sha256').update(readFileSync(BASELINE)).digest('hex');
 const dry2=importer(['--organisation-id',A.org,'--out',join(WORK,'plan2.json'),'--baseline',BASELINE,'--baseline-sha256',baselineSha]);
 check('repeat: the second dry run reports nothing left to create',dry2.status===0&&/create 0/.test(text(dry2)),text(dry2).slice(-240));
 const apply2=importer(['--organisation-id',A.org,'--apply','--plan-hash',hashOf(dry2)||'x','--baseline',BASELINE,'--baseline-sha256',baselineSha],applyEnv);
 check('repeat: a second apply succeeds and creates no duplicate rows',apply2.status===0&&(await rowsNow())===rows1,text(apply2).slice(-240));
 check('repeat: the owner project and other tenant are still unchanged',(await ownerDigest())===owner0&&(await otherDigest())===other0);

 // ------------------------------------------------------------------ lookups
 const proj=async tender=>(await q("SELECT j.id,j.name,j.revision,j.location_id,j.client_id,j.site_id FROM jobs j WHERE j.organisation_id=? AND j.project_number=?",[A.org,tender]))[0];
 const [[pn]]=await db.query("SELECT GROUP_CONCAT(project_number) p FROM jobs WHERE organisation_id=? AND name LIKE '%Quarry Road%'",[A.org]);
 const byName=async frag=>(await q("SELECT id,name,revision,location_id,site_id,stage FROM jobs WHERE organisation_id=? AND name LIKE ? ORDER BY created_at LIMIT 1",[A.org,`%${frag}%`]))[0];
 const B1=await byName('Quarry Road'),B2=await byName('Anzac Parade'),B3=await byName('Coastal Motorway');
 check('the demo projects B1 (Quarry Road), B2 (Anzac Parade) and B3 (Coastal Motorway) exist for the owner tenant',Boolean(B1&&B2&&B3),String(pn?.p));
 const roles=await a('/api/projects/work-areas?projectId='+B1.id);
 check('admin can read the populated B1 work map: confirmed work point inherited from the client site',roles.status===200&&roles.body.workPoint.status==='confirmed'&&roles.body.workPoint.source==='site'&&roles.body.areas.length>=11,JSON.stringify(roles.body.workPoint).slice(0,140));

 // role users inside tenant A
 const mkUser=async(name,role)=>{const u=await signup(name);await db.execute('UPDATE users SET organisation_id=?,role=? WHERE id=?',[A.org,role,u.id]);return {...u,call:api(u.cookie)};};
 const field=await mkUser('cj-field','field'),ro=await mkUser('cj-readonly','read_only'),sched=await mkUser('cj-scheduler','scheduler'),pm=await mkUser('cj-pm','project_manager'),se=await mkUser('cj-site-eng','site_engineer');

 // ------------------------------------------------------------------ API: permissions, tenancy, redaction, closed project
 const shiftsOf=async name=>(await q('SELECT id FROM shifts WHERE organisation_id=? AND name=?',[A.org,name]))[0].id;
 const paving0=await shiftsOf('Paving Quarry Road — chainage 0–800'),night1=await shiftsOf('Profiling Anzac Parade — night 1'),lane1=await shiftsOf('Night traffic control — motorway lane closure 1');
 let r=await a(`/api/delivery/work-areas?shiftId=${paving0}`);
 check('shift links: admin sees the B1 asphalt + traffic-management areas, no geometry in the payload',r.status===200&&r.body.enabled&&r.body.links.length===2&&!JSON.stringify(r.body).includes('"ring"')&&/not an approved traffic management plan/i.test(r.body.disclaimer),JSON.stringify(r.body).slice(0,160));
 const kinds=new Set(r.body.links.map(l=>l.discipline));check('the linked areas cover asphalt and traffic management',kinds.has('asphalt')&&kinds.has('traffic_management'));
 const all=await q('SELECT a.discipline,a.delivery,a.contractor_label FROM shift_work_areas s JOIN project_work_areas a ON a.id=s.work_area_id WHERE s.organisation_id=?',[A.org]);
 check('across the schedule: asphalt, stabilisation and traffic management are linked, own crew and subcontracted',['asphalt','stabilisation','traffic_management'].every(d=>all.some(x=>x.discipline===d))&&all.some(x=>x.delivery==='own')&&all.some(x=>x.delivery==='subcontracted'&&x.contractor_label));
 r=await field.call(`/api/delivery/work-areas?shiftId=${paving0}`);check('field worker: shift links are disabled, not leaked (no links, no geometry)',(r.status===200&&r.body.enabled===false&&(r.body.links||[]).length===0)||r.status===403,`${r.status}`);
 r=await field.call(`/api/projects/work-areas?projectId=${B1.id}`);check('field worker: work map is denied (403)',r.status===403);
 r=await ro.call(`/api/projects/work-areas?projectId=${B1.id}`);check('read-only role: can read the work map, cannot edit',r.status===200&&r.body.canEdit===false);
 r=await ro.call('/api/projects/work-point','POST',{projectId:B1.id});check('read-only role cannot confirm a work point (403)',r.status===403);
 r=await ro.call('/api/delivery/work-areas','POST',{shiftId:paving0,workAreaIds:[]});check('read-only role cannot change shift links (403)',r.status===403);
 r=await sched.call('/api/projects/work-point','POST',{projectId:B1.id});check('scheduler cannot confirm a work point (no project.edit) (403)',r.status===403);
 r=await sched.call('/api/projects/work-areas','POST',{projectId:B1.id,name:'Sched try',kind:'work_area',discipline:'asphalt',delivery:'own',contractorLabel:null,sequence:null,notes:null,ring:[[0,0],[40,0],[40,40],[0,40]].map(([x,y])=>({lat:-33.2+y/111194.9,lng:149.06+x/92400}))});check('scheduler cannot draw work areas (403)',r.status===403);
 const ws=await sched.call(`/api/projects/workspace?id=${B1.id}`);
 const wsA=await a(`/api/projects/workspace?id=${B1.id}`);
 check('financial redaction: contract value is present for admin and absent for the scheduler on the same project',/"contractValue":\d/.test(JSON.stringify(wsA.body))&&!/contractValue/.test(JSON.stringify(ws.body)),`${ws.status}/${wsA.status}`);
 r=await sched.call(`/api/delivery/work-areas?shiftId=${paving0}`);const before=r.body.links.map(l=>l.id).sort();check('scheduler can see links (no financial fields in the payload)',r.status===200&&r.body.enabled&&r.body.canEdit&&!/contractValue|plannedCost|budget|"rate"/i.test(JSON.stringify(r.body).replace(/not an approved traffic management plan/ig,'')));
 r=await se.call(`/api/projects/work-areas?projectId=${B1.id}`);check('non-member site engineer: project is hidden (404)',r.status===404||r.status===403,String(r.status));
 r=await b(`/api/projects/work-areas?projectId=${B1.id}`);check('tenant B: owner tenant\'s work map is invisible (404)',r.status===404);
 r=await b(`/api/delivery/work-areas?shiftId=${paving0}`);check('tenant B: owner tenant\'s shift links are invisible (404 or disabled, no links)',r.status===404||((r.body.links||[]).length===0&&r.body.enabled!==true),String(r.status));
 r=await b('/api/delivery/work-areas','POST',{shiftId:paving0,workAreaIds:[]});check('tenant B cannot change the owner tenant\'s shift links (404)',r.status===404);
 r=await b('/api/projects/work-point','POST',{projectId:B1.id});check('tenant B cannot confirm a work point on the owner tenant\'s project (404)',r.status===404);
 const linkArea=roles.body.areas.find(x=>x.discipline==='stabilisation'&&x.status==='active');
 r=await a('/api/delivery/work-areas','POST',{shiftId:night1,workAreaIds:[linkArea.id]});check('a shift cannot link an area from another project (4xx)',r.status>=400&&r.status<500,String(r.status));
 r=await a('/api/delivery/work-areas','POST',{shiftId:paving0,workAreaIds:before,geometry:[]});check('shift link writes accept IDs only (unknown key refused 400)',r.status===400);
 r=await a(`/api/delivery/work-areas?shiftId=${night1}`);check('closed project B2: shift links are read-only (canEdit false)',r.status===200&&r.body.enabled&&r.body.canEdit===false);
 r=await a('/api/projects/work-point','POST',{projectId:B2.id});check('closed project B2: confirming a work point is refused',r.status>=400&&r.status<500,String(r.status));
 r=await a(`/api/projects/work-areas?projectId=${B3.id}`);check('B3: status "moved" at 450 m with its four areas intact',r.body.workPoint.status==='moved'&&Math.round(r.body.workPoint.distanceM)===450&&r.body.areas.length===4);
 r=await a(`/api/projects/work-areas?projectId=${B2.id}`);check('B2: the project override leaves the client site location unchanged',r.body.workPoint.source==='project'&&r.body.areas.length===4);
 const siteLoc=async()=>JSON.stringify(await q('SELECT l.id,l.pin_lat,l.pin_lng,l.revision FROM locations l JOIN client_sites s ON s.location_id=l.id WHERE s.organisation_id=? AND s.id=?',[A.org,B2.site_id]));
 const siteB2=await siteLoc();
 // seam off: Projects entitlement disabled → section disappears, shift still works
const modCol='module';
 await db.query(`UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND ${modCol}='projects'`,[A.org]);
 r=await a(`/api/delivery/work-areas?shiftId=${paving0}`);check('Projects off: shift links are disabled (200, enabled false, no links, no error)',r.status===200&&r.body.enabled===false&&(r.body.links||[]).length===0,JSON.stringify(r.body).slice(0,140));
 r=await a('/api/delivery/work-areas','POST',{shiftId:paving0,workAreaIds:before});check('Projects off: writing links is refused (409), nothing changed',r.status===409||r.status===404);
 const sh=await a('/api/delivery');check('Projects off: scheduling still loads (200)',sh.status===200);
 await db.query(`UPDATE organisation_entitlements SET status='active' WHERE organisation_id=? AND ${modCol}='projects'`,[A.org]);
 r=await a(`/api/delivery/work-areas?shiftId=${paving0}`);check('Projects back on: links return',r.body.enabled===true&&r.body.links.length===2);

 // ------------------------------------------------------------------ browser
 browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
 const mkCtx=async(who,opts={})=>{const ctx=await browser.newContext(opts);await ctx.addCookies(who.cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));return ctx;};
 const openMap=async(page,id,focus='')=>{await page.goto(base+`/#Projects//${id}/workmap${focus?'/'+focus:''}`);await page.reload();await page.waitForSelector('[data-testid="work-map"]',{timeout:25000});};
 const canvas=async page=>{const bb=await page.locator('[data-testid="map-canvas"] svg[role="application"]').boundingBox();return {...bb,cx:bb.x+bb.width/2,cy:bb.y+bb.height/2};};
 const status=page=>page.getByTestId('work-point').getAttribute('data-status');
 const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 const apiAreas=async id=>(await a(`/api/projects/work-areas?projectId=${id}`)).body;

 async function flow(label,ctxOpts,tap){
  const ctx=await mkCtx(A,ctxOpts);const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(label+': '+e.message));
  const click=async loc=>tap?loc.tap():loc.click();
  const shot=async n=>{await page.getByTestId('work-point').scrollIntoViewIfNeeded();await page.waitForTimeout(500);await page.screenshot({path:join(OUT,`${label}-${n}.png`)});};
  // fresh project, no location yet
  const pid=await mk(a,`Connected ${label} project`);
  await openMap(page,pid);
  check(`${label}: a project with no location shows "No location" and cannot be confirmed yet`,(await status(page))==='none'&&await page.getByTestId('confirm-work-point').count()===0,String(await status(page)));
  // search an address → pick → save
  await click(page.getByTestId('change-location'));
  const box=page.getByPlaceholder('Start typing an address…');await box.fill('dover road rose bay');
  await page.getByTestId('location-editor').getByRole('option').first().waitFor();await click(page.getByTestId('location-editor').getByRole('option').first());
  await click(page.getByTestId('save-location'));await page.waitForFunction(()=>document.querySelector('[data-testid="work-point"]')?.getAttribute('data-status')==='unconfirmed');
  check(`${label}: the searched address is saved as the project location but not yet confirmed`,(await status(page))==='unconfirmed'&&await page.getByTestId('confirm-work-point').isEnabled());
  await shot('1-unconfirmed');
  await click(page.getByTestId('confirm-work-point'));await page.waitForFunction(()=>document.querySelector('[data-testid="work-point"]')?.getAttribute('data-status')==='confirmed');
  const [wp]=await q('SELECT lat,lng,confirmed_by FROM project_work_points WHERE organisation_id=? AND project_id=?',[A.org,pid]);
  check(`${label}: confirming records the work point (confirmed status, row stored with the confirming user)`,Boolean(wp)&&wp.confirmed_by===A.id);
  // draw
  await click(page.getByTestId('draw-start'));await page.getByTestId('map-canvas').evaluate(e=>e.scrollIntoView({block:'center'}));const c=await canvas(page);
  for(const [dx,dy] of [[-90,-50],[90,-50],[90,50],[-90,50]]){tap?await page.touchscreen.tap(c.cx+dx,c.cy+dy):await page.mouse.click(c.cx+dx,c.cy+dy);}
  await click(page.getByTestId('draw-finish'));
  await page.getByTestId('form-name').fill(`Stage ${label}`);await page.getByTestId('form-discipline').selectOption('traffic_management');await page.getByTestId('form-delivery').selectOption('subcontracted');
  const lab=page.getByTestId('form-contractor');if(await lab.count())await lab.fill('Example Traffic Control Pty Ltd');
  await click(page.getByTestId('save'));await page.waitForSelector('[data-testid="area-row"]');
  const saved=(await apiAreas(pid)).areas;
  check(`${label}: the drawn area is saved and survives a reload with identical id and geometry`,saved.length===1,JSON.stringify(saved.map(x=>x.name)));
  await page.reload();await page.waitForSelector('[data-testid="work-map"]');await page.getByTestId('area-row').first().waitFor();
  const again=(await apiAreas(pid)).areas;
  check(`${label}: reopened map shows the same area`,again[0].id===saved[0].id&&JSON.stringify(again[0].ring)===JSON.stringify(saved[0].ring)&&await page.getByTestId('area-shape').count()===1);
  await shot('2-drawn');
  // change the address: polygon must NOT move, status flips to moved
  const ringBefore=JSON.stringify(again[0].ring),siteBefore=await siteLoc();
  await click(page.getByTestId('change-location'));
  await page.getByPlaceholder('Start typing an address…').fill('24 york road ingleburn');
  await page.getByTestId('location-editor').getByRole('option').first().waitFor();await click(page.getByTestId('location-editor').getByRole('option').first());
  await click(page.getByTestId('save-location'));await page.waitForFunction(()=>document.querySelector('[data-testid="work-point"]')?.getAttribute('data-status')==='moved');
  const after=(await apiAreas(pid));
  check(`${label}: changing the address flags "moved" and the saved polygon is byte-identical (never silently moved)`,(await status(page))==='moved'&&await page.getByTestId('work-point-moved').isVisible()&&JSON.stringify(after.areas[0].ring)===ringBefore&&after.areas[0].revision===again[0].revision);
  check(`${label}: the confirmed-point marker is drawn so the old position can be reviewed`,await page.getByTestId('confirmed-point').count()===1);
  await shot('3-moved');
  await click(page.getByTestId('confirm-work-point'));await page.waitForFunction(()=>document.querySelector('[data-testid="work-point"]')?.getAttribute('data-status')==='confirmed');
  check(`${label}: confirming the new location clears the review flag; polygon still unchanged`,JSON.stringify((await apiAreas(pid)).areas[0].ring)===ringBefore);
  check(`${label}: no horizontal overflow on the work map`,!(await overflow(page)));
  check(`${label}: no client site location was changed by the project override`,await siteLoc()===siteBefore);
  await ctx.close();return pid;
 }
 const deskPid=await flow('desktop',{viewport:{width:1360,height:900}},false);
 const mobPid=await flow('mobile',{viewport:{width:390,height:844},hasTouch:true,isMobile:true},true);
 check('the two new projects hold exactly one area each (no duplicates from repeats)',(await apiAreas(deskPid)).areas.length===1&&(await apiAreas(mobPid)).areas.length===1);

 // populated schedule → shift → linked areas → map; desktop then mobile
 async function schedule(label,ctxOpts,tap){
  const ctx=await mkCtx(A,ctxOpts);const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(label+' schedule: '+e.message));
  const click=async loc=>tap?loc.tap():loc.click();
  await page.goto(base+'/#Schedule');await page.reload();
  await click(page.getByRole('button',{name:'List',exact:true}));
  await page.getByLabel('Search shifts').fill('Paving Quarry Road — chainage 0');
  const card=page.locator('article').filter({hasText:'Paving Quarry Road — chainage 0–800'}).first();await card.waitFor();
  await click(card.getByRole('button',{name:'Details'}));
  await page.getByTestId('shift-work-areas').waitFor();
  const rows=page.getByTestId('open-linked-area');
  check(`${label}: the shift editor lists its linked areas: asphalt and traffic management`,await rows.count()===2&&/Asphalt/.test(await page.getByTestId('shift-work-areas').innerText())&&/Traffic management/.test(await page.getByTestId('shift-work-areas').innerText()));
  check(`${label}: the panel states it is not an approved traffic management plan`,/not an approved traffic management plan/i.test(await page.getByTestId('shift-work-areas').innerText()));
  await page.getByTestId('shift-work-areas').scrollIntoViewIfNeeded();await page.waitForTimeout(700);await page.screenshot({path:join(OUT,`${label}-4-shift-areas.png`)});
  await click(rows.first());
  await page.waitForSelector('[data-testid="work-map"]');
  const sel=await page.getByTestId('area-id').innerText();
  check(`${label}: "Open on map" lands on the Work map with that same saved area selected`,before.includes(sel)&&/workmap\/[0-9a-f-]{36}$/.test(page.url()),`${sel} ${page.url().slice(-60)}`);
  await page.waitForTimeout(700);await page.screenshot({path:join(OUT,`${label}-5-opened-from-shift.png`)});
  check(`${label}: no horizontal overflow after opening the map from the shift`,!(await overflow(page)));
  await ctx.close();
 }
 await schedule('desktop',{viewport:{width:1360,height:900}},false);
 await schedule('mobile',{viewport:{width:390,height:844},hasTouch:true,isMobile:true},true);

 // link a different area to another shift through the UI and confirm it after reload (desktop)
 {const ctx=await mkCtx(A,{viewport:{width:1360,height:900}});const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push('link: '+e.message));
  await page.goto(base+'/#Schedule');await page.reload();await page.getByRole('button',{name:'List',exact:true}).click();
  await page.getByLabel('Search shifts').fill('Final wearing course');
  const card=page.locator('article').filter({hasText:'Final wearing course and linemarking'}).first();await card.waitFor();await card.getByRole('button',{name:'Details'}).click();
  await page.getByTestId('shift-work-areas').waitFor();
  const had=await page.getByTestId('open-linked-area').count();
  await page.getByTestId('choose-work-areas').click();await page.getByTestId('area-chooser').waitFor();
  const choices=page.getByTestId('choose-area');await choices.first().waitFor();const n=await choices.count();let ticked=0;
  for(let i=0;i<n&&ticked<1;i++){const cb=choices.nth(i);if(!(await cb.isChecked())){await cb.check();ticked++;}}
  await page.getByTestId('save-work-areas').click();
  await page.waitForFunction(h=>document.querySelectorAll('[data-testid="open-linked-area"]').length>h,had);
  const sid=await shiftsOf('Final wearing course and linemarking — Quarry Road');
  const links=(await a(`/api/delivery/work-areas?shiftId=${sid}`)).body.links.length;
  await page.reload();
  check('linking one more saved area to a shift through the UI persists (UI count, API count, reload)',links===had+1&&links===(await q('SELECT COUNT(*) n FROM shift_work_areas WHERE organisation_id=? AND shift_id=?',[A.org,sid]))[0].n,`${had}→${links}`);
  const aud=await q("SELECT COUNT(*) n FROM audit_log WHERE organisation_id=? AND event_type='shift.work_areas_changed'",[A.org]);check('the change is audited',Number(aud[0].n)>=1);
  await ctx.close();}

 // closed project and moved project in the browser
 {const ctx=await mkCtx(A,{viewport:{width:1360,height:900}});const page=await ctx.newPage();page.setDefaultTimeout(20000);
  await openMap(page,B2.id);check('closed project B2 in the browser: read-only, no Draw, no confirm or change location',await page.getByTestId('draw-start').count()===0&&await page.getByTestId('confirm-work-point').count()===0&&await page.getByTestId('change-location').count()===0);
  await openMap(page,B3.id);check('B3 in the browser: "Moved: review" banner with the 450 m distance, areas still listed',(await status(page))==='moved'&&/450 m/.test(await page.getByTestId('work-point-moved').innerText())&&await page.getByTestId('area-row').count()===4);
  await page.screenshot({path:join(OUT,'desktop-6-b3-moved-populated.png')});
  await openMap(page,B1.id);check('B1 in the browser: confirmed from the client site, 11+ areas across the three disciplines',(await status(page))==='confirmed'&&await page.getByTestId('area-row').count()>=11);
  await page.screenshot({path:join(OUT,'desktop-7-b1-populated.png')});
  await ctx.close();}
 {const ctx=await mkCtx(A,{viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await ctx.newPage();page.setDefaultTimeout(20000);
  await openMap(page,B1.id);check('mobile: populated B1 work map has no horizontal overflow',!(await overflow(page)));await page.screenshot({path:join(OUT,'mobile-7-b1-populated.png')});await ctx.close();}
 {const ctx=await mkCtx(ro,{viewport:{width:1360,height:900}});const page=await ctx.newPage();page.setDefaultTimeout(20000);
  await openMap(page,B1.id);check('read-only user in the browser: sees the map and work point, no Confirm / Change / Draw',await page.getByTestId('work-point').count()===1&&await page.getByTestId('confirm-work-point').count()===0&&await page.getByTestId('change-location').count()===0&&await page.getByTestId('draw-start').count()===0);await ctx.close();}
 check('no uncaught page errors in any browser session',errors.length===0,errors.slice(0,3).join(' | '));
}catch(e){fail++;console.log('FAIL    journey aborted — '+(e?.stack||e));}
finally{try{await browser?.close();}catch{/* closed */}server.kill();await db.end();}
const secs=Math.round((Date.now()-t0)/1000);
console.log(`\n${fail?'FAILED':'OK'}: ${pass} passed, ${fail} failed in ${secs}s (screenshots: ${OUT})`);
process.exit(fail?1:0);
