// Work map acceptance run: API contract, tenancy, roles, entitlements, closed projects, stale edits, invalid geometry,
// and the real editor (desktop mouse + mobile touch) against the production build. Synthetic data only; email, AI and
// live map providers are off. Needs an EMPTY, freshly migrated disposable database whose name ends in _test.
//   npm run build   then   MYSQL_DATABASE=workmap_test node scripts/work-map-journey.mjs [outputDir]
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_PATH, PORT (default 3188).
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {connect} from './mysql-config.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
const PORT=Number(process.env.PORT||3188),base=`http://localhost:${PORT}`,OUT=process.argv[2]||'/tmp/work-map-journey';
mkdirSync(OUT,{recursive:true});
const loadPlaywright=()=>{for(const p of [process.env.PLAYWRIGHT_MODULE,'playwright','playwright-core','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){try{return require(p);}catch{/* next */}}throw new Error('Playwright is not available: set PLAYWRIGHT_MODULE');};
const {chromium}=loadPlaywright();
const CHROMIUM=process.env.CHROMIUM_PATH||['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
let pass=0,fail=0;
const check=(step,ok,detail='')=>{if(ok)pass++;else fail++;console.log(`${ok?'PASS':'FAIL'}    ${step}${detail?' — '+detail:''}`);return Boolean(ok);};

const db=await connect();
const [[existing]]=await db.query('SELECT COUNT(*) AS n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(existing.n)!==0)throw new Error('Refusing to run: the disposable database already has users. Use an empty, freshly migrated database.');
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'workmap-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:base};
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
if(migrated.status!==0)throw new Error('migrations failed: '+migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}

const stamp=Date.now(),password='Very-strong-test-password-42';
const signup=async name=>{const email=`${name}-${stamp}@example.invalid`;let r;for(let a=0;a<20;a++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password,callbackURL:'/'})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,5000));}
 const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('='));const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);
 if(!u)throw new Error(`sign-up for ${name} failed: ${r.status}`);return {id:u.id,email,cookies,cookie:cookies.join('; '),org:u.organisation_id};};
// New accounts start in the first-run wizard; mark it complete so the browser lands in the workspace.
const skipOnboarding=async org=>{const t=new Date().toISOString();await db.query('INSERT INTO organisation_profiles (organisation_id,created_at,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE organisation_id=organisation_id',[org,t,t]);await db.query('UPDATE organisation_profiles SET legal_name=COALESCE(legal_name,?),onboarding_completed_at=COALESCE(onboarding_completed_at,?),updated_at=? WHERE organisation_id=?',['Work map test Pty Ltd',t,t,org]);};
const api=cookie=>async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json};};
const ring=(m,o={x:0,y:0},at={lat:-33.7960,lng:150.9050})=>[[0,0],[m,0],[m,m],[0,m]].map(([x,y])=>({lat:at.lat+(y+o.y)/111194.9,lng:at.lng+(x+o.x)/(111194.9*Math.cos(at.lat*Math.PI/180))}));
const PIN={lat:-33.7960,lng:150.9050};
const valid=(name,over={})=>({name,kind:'work_area',discipline:'asphalt',delivery:'own',contractorLabel:null,sequence:null,notes:null,ring:ring(40),...over});

try{
 // ------------------------------------------------------------------ setup: two organisations
 const A=await signup('wm-admin-a'),B=await signup('wm-admin-b'),a=api(A.cookie),b=api(B.cookie);
 const mkProject=async(call,name)=>{const r=await call('/api/projects','POST',{name});if(![200,201].includes(r.status))throw new Error('project create failed '+JSON.stringify(r.body));const id=r.body.projectId;const g=await call(`/api/projects/workspace?id=${id}`);
  const p=await call('/api/projects/workspace','PATCH',{id,revision:g.body.project.revision,location:{formattedAddress:'1 Example Road, Demo NSW',pin:PIN,source:'manual'}});if(p.status!==200)throw new Error('pin failed '+JSON.stringify(p.body));return id;};
 await skipOnboarding(A.org);
 const PA=await mkProject(a,'Work map project A'),PB=await mkProject(b,'Work map project B');
 const [[locBefore]]=await db.query('SELECT l.id,l.pin_lat,l.pin_lng,l.revision FROM locations l JOIN jobs j ON j.location_id=l.id WHERE j.id=?',[PA]);
 check('setup: project has an address pin',Number(locBefore.pin_lat)!==0);

 // ------------------------------------------------------------------ create / read / stable ID
 let r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('Stage A',{kind:'stage',sequence:1})});
 check('create returns 201 with a stable id and revision 1',r.status===201&&r.body.area?.id&&r.body.area.revision===1,JSON.stringify(r.body).slice(0,120));
 const areaA=r.body.area;
 r=await a(`/api/projects/work-areas?projectId=${PA}`);
 check('reload returns the same geometry (7 dp) and id',r.status===200&&r.body.areas.length===1&&r.body.areas[0].id===areaA.id&&JSON.stringify(r.body.areas[0].ring)===JSON.stringify(areaA.ring)&&r.body.areas[0].ring.length===4);
 check('response carries the disclaimer, limits, pin and canEdit',r.body.canEdit===true&&r.body.pin?.lat===PIN.lat&&/Not an approved traffic management plan/.test(r.body.disclaimer)&&r.body.limits.maxVertices===100);
 const [[row]]=await db.query('SELECT * FROM project_work_areas WHERE id=?',[areaA.id]);
 check('row is owned by the tenant and project, typed bounds stored',row.organisation_id===A.org&&row.project_id===PA&&Number(row.vertex_count)===4&&Number(row.min_lat)<Number(row.max_lat)&&row.created_by===A.id);
 r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('stage a')});
 check('duplicate active name (case-insensitive) is refused 409',r.status===409);
 r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('TC Zone',{discipline:'traffic_management',delivery:'subcontracted',contractorLabel:'Example TC Pty Ltd',ring:ring(40,{x:60,y:0})})});
 check('subcontracted traffic management area stores the subcontractor label',r.status===201&&r.body.area.delivery==='subcontracted'&&r.body.area.contractorLabel==='Example TC Pty Ltd');
 const tc=r.body.area;
 r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('Own crew',{delivery:'own',contractorLabel:'Ignored',ring:ring(40,{x:120,y:0})})});
 check('contractor label is dropped for own-crew work',r.status===201&&r.body.area.contractorLabel===null);

 // ------------------------------------------------------------------ invalid geometry
 const bad=async(label,over,codes=[422,400])=>{const x=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('Bad '+label,over)});check(`invalid geometry refused: ${label}`,codes.includes(x.status),`${x.status} ${JSON.stringify(x.body).slice(0,90)}`);};
 await bad('bow-tie',{ring:[[0,0],[40,40],[40,0],[0,40]].map(([x,y])=>ring(1)[0]&&({lat:PIN.lat+y/111194.9,lng:PIN.lng+x/92400}))});
 await bad('two points',{ring:ring(40).slice(0,2)});
 await bad('latitude 91',{ring:[{lat:91,lng:1},{lat:1,lng:1},{lat:1,lng:2}]});
 await bad('longitude 181',{ring:[{lat:1,lng:181},{lat:1,lng:1},{lat:1,lng:2}]});
 await bad('string coordinates',{ring:[{lat:'1',lng:'2'},{lat:1,lng:1},{lat:1,lng:2}]});
 await bad('null island',{ring:[{lat:0,lng:0},{lat:1,lng:1},{lat:1,lng:2}]});
 await bad('101 points',{ring:Array.from({length:101},(_,i)=>({lat:PIN.lat+0.0004*Math.sin(i/101*6.2832),lng:PIN.lng+0.0004*Math.cos(i/101*6.2832)}))});
 await bad('12 km wide',{ring:ring(12000)});
 await bad('sub-metre',{ring:ring(0.5)});
 await bad('empty name',{name:'  '});
 await bad('unknown discipline',{discipline:'tunnelling'});
 await bad('name too long',{name:'x'.repeat(161)});
 r=await a('/api/projects/work-areas','POST',{projectId:PA,name:'No ring'});
 check('missing fields refused',r.status===400);
 const [[cnt]]=await db.query('SELECT COUNT(*) n FROM project_work_areas WHERE project_id=?',[PA]);
 check('refused requests wrote nothing',Number(cnt.n)===3);

 // ------------------------------------------------------------------ update, stale revisions, audit
 r=await a('/api/projects/work-areas','PATCH',{id:areaA.id,revision:1,name:'Stage A (rev)',ring:ring(50)});
 check('update with the current revision succeeds and increments',r.status===200&&r.body.area.revision===2&&r.body.area.name==='Stage A (rev)'&&r.body.area.id===areaA.id);
 r=await a('/api/projects/work-areas','PATCH',{id:areaA.id,revision:1,name:'Stale write'});
 check('stale revision is refused 409 and nothing changes',r.status===409&&/changed by someone else/.test(r.body.error));
 const [[after]]=await db.query('SELECT name,revision FROM project_work_areas WHERE id=?',[areaA.id]);
 check('stale write left the record untouched',after.name==='Stage A (rev)'&&Number(after.revision)===2);
 r=await a('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,ring:[{lat:1,lng:1},{lat:1,lng:2}]});
 check('invalid geometry on update refused 422',r.status===422);
 r=await a('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,projectId:PB,name:'Stage A (rev)'});
 const [[still]]=await db.query('SELECT project_id FROM project_work_areas WHERE id=?',[areaA.id]);
 check('an area can never be moved to another project',still.project_id===PA);
 const [[locAfter]]=await db.query('SELECT pin_lat,pin_lng,revision FROM locations WHERE id=?',[locBefore.id]);
 check('address pin is untouched by work-area edits',Number(locAfter.pin_lat)===Number(locBefore.pin_lat)&&Number(locAfter.pin_lng)===Number(locBefore.pin_lng)&&Number(locAfter.revision)===Number(locBefore.revision));

 // ------------------------------------------------------------------ cross-tenant
 r=await b(`/api/projects/work-areas?projectId=${PA}`);check('tenant B cannot read tenant A\'s work map (404)',r.status===404);
 r=await b('/api/projects/work-areas','POST',{projectId:PA,...valid('Intruder')});check('tenant B cannot create in A\'s project (404)',r.status===404);
 r=await b('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,name:'Hijack'});check('tenant B cannot update A\'s area by known id (404)',r.status===404);
 r=await b('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,archive:true});check('tenant B cannot archive A\'s area by known id (404)',r.status===404);
 r=await b(`/api/projects/work-areas?projectId=${PB}`);check('tenant B sees only its own (empty) map',r.status===200&&r.body.areas.length===0);
 r=await fetch(base+`/api/projects/work-areas?projectId=${PA}`);check('unauthenticated request is refused',r.status===401);
 r=await fetch(base+'/api/projects/work-areas',{method:'POST',headers:{origin:'https://evil.invalid','Content-Type':'application/json',cookie:A.cookie},body:JSON.stringify({projectId:PA,...valid('csrf')})});check('cross-origin write is refused (CSRF)',r.status===403);
 const [[leak]]=await db.query('SELECT COUNT(*) n FROM project_work_areas WHERE organisation_id=?',[B.org]);check('no rows were written for tenant B',Number(leak.n)===0);

 // ------------------------------------------------------------------ roles and project membership
 const mkUser=async(name,role)=>{const u=await signup(name);await db.execute('UPDATE users SET organisation_id=?,role=? WHERE id=?',[A.org,role,u.id]);return {...u,call:api(u.cookie)};};
 const field=await mkUser('wm-field','field'),ro=await mkUser('wm-readonly','read_only'),se=await mkUser('wm-site-eng','site_engineer'),pe=await mkUser('wm-proj-eng','project_engineer'),pm=await mkUser('wm-pm','project_manager');
 r=await field.call(`/api/projects/work-areas?projectId=${PA}`);check('field worker is denied read (403) — field access is not broadened',r.status===403);
 r=await field.call('/api/projects/work-areas','POST',{projectId:PA,...valid('Field try')});check('field worker is denied write (403)',r.status===403);
 r=await ro.call(`/api/projects/work-areas?projectId=${PA}`);check('read-only role can view, canEdit false',r.status===200&&r.body.canEdit===false&&r.body.areas.length===3);
 r=await ro.call('/api/projects/work-areas','POST',{projectId:PA,...valid('RO try')});check('read-only role cannot create (403)',r.status===403);
 r=await ro.call('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,name:'RO edit'});check('read-only role cannot update (403)',r.status===403);
 r=await se.call(`/api/projects/work-areas?projectId=${PA}`);check('site engineer who is not a project member gets 404',r.status===404);
 await db.execute('INSERT INTO project_members (id,organisation_id,project_id,user_id,project_role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',[`pm-se-${stamp}`,A.org,PA,se.id,'site_engineer',new Date().toISOString(),new Date().toISOString()]).catch(async e=>{throw new Error('member insert: '+e.message);});
 r=await se.call(`/api/projects/work-areas?projectId=${PA}`);check('site engineer reads once added to the project',r.status===200&&r.body.canEdit===false);
 r=await se.call('/api/projects/work-areas','POST',{projectId:PA,...valid('SE try')});check('site engineer (view-only capability) cannot write (403)',r.status===403);
 r=await pe.call('/api/projects/work-areas','POST',{projectId:PA,...valid('PE try',{ring:ring(30,{x:0,y:80})})});check('project engineer who is not a member cannot write (404)',r.status===404);
 await db.execute('INSERT INTO project_members (id,organisation_id,project_id,user_id,project_role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',[`pm-pe-${stamp}`,A.org,PA,pe.id,'project_engineer',new Date().toISOString(),new Date().toISOString()]);
 r=await pe.call('/api/projects/work-areas','POST',{projectId:PA,...valid('PE area',{ring:ring(30,{x:0,y:80})})});check('project engineer member can write',r.status===201);
 r=await pm.call('/api/projects/work-areas','POST',{projectId:PA,...valid('PM area',{ring:ring(30,{x:60,y:80})})});check('project manager (organisation-wide) can write',r.status===201);

 // ------------------------------------------------------------------ entitlements
 const ent=async s=>{await db.execute("INSERT INTO organisation_entitlements (id,organisation_id,module,status,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status)",[`ent-${stamp}`,A.org,'projects',s,'test',new Date().toISOString(),new Date().toISOString()]);};
 await ent('read_only');
 r=await a(`/api/projects/work-areas?projectId=${PA}`);check('Projects read-only: map still readable',r.status===200);
 r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('Ent try',{ring:ring(30,{x:0,y:160})})});check('Projects read-only: writes refused',[402,403,409].includes(r.status),String(r.status));
 await ent('disabled');
 r=await a(`/api/projects/work-areas?projectId=${PA}`);check('Projects disabled: route 404s',r.status===404,String(r.status));
 await ent('active');
 r=await a(`/api/projects/work-areas?projectId=${PA}`);check('Projects re-enabled: data intact',r.status===200&&r.body.areas.length===5);

 // ------------------------------------------------------------------ limits
 const now=new Date().toISOString();const g=JSON.stringify(ring(10,{x:0,y:300}));
 const [[have]]=await db.query("SELECT COUNT(*) n FROM project_work_areas WHERE project_id=? AND status='active'",[PA]);
 for(let i=Number(have.n);i<200;i++)await db.execute('INSERT INTO project_work_areas (id,organisation_id,project_id,name,kind,discipline,delivery,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[`fill-${stamp}-${i}`,A.org,PA,`Filler ${i}`,'work_area','other','own',g,4,100,1,1,1,1,'active',1,now,now]);
 r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('Over limit',{ring:ring(30,{x:0,y:400})})});check('active-area cap (200) enforced',r.status===422&&/at most 200/.test(r.body.error),String(r.status));
 await db.execute("DELETE FROM project_work_areas WHERE id LIKE ?",[`fill-${stamp}-%`]);

 // ------------------------------------------------------------------ archive, audit
 r=await a('/api/projects/work-areas','PATCH',{id:tc.id,revision:1,archive:true});
 check('archive succeeds, status archived, revision bumped',r.status===200&&r.body.area.status==='archived'&&r.body.area.revision===2);
 const [[kept]]=await db.query('SELECT status,archived_by FROM project_work_areas WHERE id=?',[tc.id]);check('archived row is kept (never deleted)',kept.status==='archived'&&kept.archived_by===A.id);
 r=await a(`/api/projects/work-areas?projectId=${PA}`);check('archived areas are hidden by default',!r.body.areas.some(x=>x.id===tc.id));
 r=await a(`/api/projects/work-areas?projectId=${PA}&archived=1`);check('archived=1 lists them, flagged archived',r.body.areas.some(x=>x.id===tc.id&&x.status==='archived'));
 r=await a('/api/projects/work-areas','PATCH',{id:tc.id,revision:2,name:'Edit archived'});check('archived areas cannot be edited (409)',r.status===409);
 const [events]=await db.query("SELECT event_type,project_id,actor_user_id,entity_id,before_state,after_state FROM audit_log WHERE organisation_id=? AND event_type LIKE 'workmap.%' ORDER BY created_at",[A.org]);
 const kinds=new Set(events.map(e=>e.event_type));
 check('audit records created, updated and archived',kinds.has('workmap.area_created')&&kinds.has('workmap.area_updated')&&kinds.has('workmap.area_archived'),[...kinds].join(','));
 check('audit rows carry project, actor and entity ids',events.every(e=>e.project_id===PA&&e.actor_user_id&&e.entity_id));
 const upd=events.find(e=>e.event_type==='workmap.area_updated'&&e.entity_id===areaA.id);check('update audit has before and after geometry',upd&&JSON.parse(upd.before_state).ring?.length===4&&JSON.parse(upd.after_state).ring?.length===4);
 const [[refused]]=await db.query("SELECT COUNT(*) n FROM audit_log WHERE organisation_id=? AND summary LIKE '%Stale write%'",[A.org]);check('refused writes leave no audit rows',Number(refused.n)===0);

 // ------------------------------------------------------------------ closed project
 await db.execute("UPDATE jobs SET stage='closed',status='Closed' WHERE id=?",[PA]);
 r=await a(`/api/projects/work-areas?projectId=${PA}`);check('closed project: map still readable, closed and not editable',r.status===200&&r.body.closed===true&&r.body.canEdit===false);
 r=await a('/api/projects/work-areas','POST',{projectId:PA,...valid('Closed try',{ring:ring(30,{x:0,y:500})})});check('closed project: create refused (409)',r.status===409&&/closed/i.test(r.body.error));
 r=await a('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,name:'Closed edit'});check('closed project: update refused (409)',r.status===409);
 r=await a('/api/projects/work-areas','PATCH',{id:areaA.id,revision:2,archive:true});check('closed project: archive refused (409)',r.status===409);
 await db.execute("UPDATE jobs SET stage='setup',status='Planning' WHERE id=?",[PA]);

 // ------------------------------------------------------------------ browser: fresh empty project for the editor
 const PE=await mkProject(a,'Editor project');
 const browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
 const mkCtx=async(who,opts={})=>{const ctx=await browser.newContext(opts);await ctx.addCookies(who.cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));return ctx;};
 const errors=[];
 const open=async(page,id)=>{await page.goto(base+`/#Projects//${id}/workmap`);await page.reload();await page.waitForSelector('[data-testid="work-map"]',{timeout:20000});};
 const canvas=async page=>{const b=await page.locator('[data-testid="map-canvas"] svg[role="application"]').boundingBox();return {...b,cx:b.x+b.width/2,cy:b.y+b.height/2};};
 const selectRow=async(pg,name)=>{const row=pg.getByTestId('area-row').filter({hasText:name});if(await row.getAttribute('aria-pressed')!=='true')await row.click();};
 const apiAreas=async(id,arch=0)=>(await a(`/api/projects/work-areas?projectId=${id}&archived=${arch}`)).body.areas;

 // ---- desktop
 const dctx=await mkCtx(A,{viewport:{width:1280,height:900}});const page=await dctx.newPage();page.on('pageerror',e=>errors.push('desktop: '+e.message));
 page.on('dialog',d=>void d.accept());
 await open(page,PE);
 check('desktop: tab shows the operational-overview disclaimer',await page.getByText('Not an approved traffic management plan').first().isVisible());
 check('desktop: empty state, Draw area enabled (pin present)',await page.getByText('No work areas yet.').isVisible()&&await page.getByTestId('draw-start').isEnabled());
 check('desktop: project address pin is shown separately',await page.getByTestId('project-pin').count()===1&&await page.getByText('Project address pin (not edited here)').isVisible());
 check('desktop: basemap states no imagery is used',/no aerial imagery/i.test(await page.getByTestId('basemap-status').innerText()));
 await page.screenshot({path:`${OUT}/01-desktop-empty.png`});
 // draw
 let c=await canvas(page);
 await page.getByTestId('draw-start').click();
 for(const [dx,dy] of [[-120,-70],[120,-70],[120,70],[-120,70]])await page.mouse.click(c.cx+dx,c.cy+dy);
 check('desktop draw: four points placed',(await page.getByTestId('point-count').innerText()).startsWith('4'));
 await page.getByTestId('draw-undo').click();check('desktop draw: undo removes a point',(await page.getByTestId('point-count').innerText()).startsWith('3'));
 await page.mouse.click(c.cx-120,c.cy+70);
 await page.getByTestId('draw-finish').click();
 check('desktop draw: shape reports OK with an area',/Shape OK/.test(await page.getByTestId('shape-status').innerText()));
 check('desktop draw: Save disabled until named',await page.getByTestId('save').isDisabled());
 await page.getByTestId('form-name').fill('Test Stage 1');await page.getByTestId('form-kind').selectOption('stage');await page.getByTestId('form-discipline').selectOption('stabilisation');
 await page.screenshot({path:`${OUT}/02-desktop-drawing.png`});
 await page.getByTestId('save').click();await page.waitForSelector('[data-testid="area-row"]');
 let saved=await apiAreas(PE);
 check('desktop save: one active area persisted with the drawn 4 points',saved.length===1&&saved[0].ring.length===4&&saved[0].name==='Test Stage 1'&&saved[0].kind==='stage'&&saved[0].discipline==='stabilisation');
 const id1=saved[0].id,ring1=JSON.stringify(saved[0].ring);
 await page.reload();await page.waitForSelector('[data-testid="area-row"]');
 check('desktop reload: the same saved area (same id) reopens',await page.getByTestId('area-shape').count()===1&&(await apiAreas(PE))[0].id===id1);
 // select and edit; cancel leaves geometry unchanged
 await page.getByTestId('area-row').first().click();
 check('desktop select: stable id and revision shown',(await page.getByTestId('area-id').innerText())===id1);
 await page.getByTestId('area-edit').click();
 const v=page.locator('[data-testid="vertex"]').nth(1);const vb=await v.boundingBox();
 await page.mouse.move(vb.x+vb.width/2,vb.y+vb.height/2);await page.mouse.down();await page.mouse.move(vb.x+vb.width/2+60,vb.y+vb.height/2+40,{steps:6});await page.mouse.up();
 check('desktop edit: vertex drag marks the shape changed',await page.getByTestId('shape-status').isVisible());
 await page.screenshot({path:`${OUT}/03-desktop-editing.png`});
 await page.getByTestId('cancel').click();
 check('desktop cancel: nothing saved',JSON.stringify((await apiAreas(PE))[0].ring)===ring1&&(await apiAreas(PE))[0].revision===1);
 await page.getByTestId('area-edit').click();
 check('desktop cancel: editor reopens on the saved geometry (4 points)',(await page.getByTestId('point-count').innerText()).startsWith('4'));
 // insert via midpoint, then delete a vertex
 const mids=page.locator('[data-mid]');const mb=await mids.first().boundingBox();
 await page.mouse.click(mb.x+mb.width/2,mb.y+mb.height/2);
 check('desktop edit: tapping a mid-point inserts a vertex (5 points)',(await page.getByTestId('point-count').innerText()).startsWith('5'));
 check('desktop edit: new vertex selected, Delete point enabled',await page.getByTestId('vertex-delete').isEnabled());
 await page.getByTestId('vertex-delete').click();check('desktop edit: delete returns to 4 points',(await page.getByTestId('point-count').innerText()).startsWith('4'));
 // keyboard nudge
 await page.locator('[data-testid="vertex"]').nth(2).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 // now drag vertex 1 and save
 const v2=page.locator('[data-testid="vertex"]').nth(1);const vb2=await v2.boundingBox();
 await page.mouse.move(vb2.x+vb2.width/2,vb2.y+vb2.height/2);await page.mouse.down();await page.mouse.move(vb2.x+vb2.width/2+50,vb2.y+vb2.height/2+30,{steps:6});await page.mouse.up();
 await page.getByTestId('form-name').fill('Test Stage 1 (edited)');
 await page.getByTestId('save').click();await page.waitForSelector('[data-testid="area-row"]');
 saved=await apiAreas(PE);
 check('desktop save edit: same id, revision 2, geometry changed, name updated',saved[0].id===id1&&saved[0].revision===2&&JSON.stringify(saved[0].ring)!==ring1&&saved[0].name==='Test Stage 1 (edited)');
 // invalid shape in the editor
 await page.getByTestId('draw-start').click();c=await canvas(page);
 for(const [dx,dy] of [[-150,-100],[150,100],[150,-100],[-150,100]])await page.mouse.click(c.cx+dx,c.cy+dy);
 await page.getByTestId('draw-finish').click();await page.getByTestId('form-name').fill('Bow tie');
 check('desktop invalid: self-crossing shape is flagged and Save stays disabled',/crosses itself/.test(await page.getByTestId('shape-status').innerText())&&await page.getByTestId('save').isDisabled());
 await page.screenshot({path:`${OUT}/04-desktop-invalid.png`});
 await page.getByTestId('cancel').click();
 check('desktop cancel new shape: nothing created',(await apiAreas(PE)).length===1);
 // second area so there are two, then stale edit
 await page.getByTestId('draw-start').click();c=await canvas(page);
 for(const [dx,dy] of [[-240,-120],[-150,-120],[-150,-40],[-240,-40]])await page.mouse.click(c.cx+dx,c.cy+dy);
 await page.getByTestId('draw-finish').click();await page.getByTestId('form-name').fill('Traffic control A');await page.getByTestId('form-discipline').selectOption('traffic_management');await page.getByTestId('form-delivery').selectOption('subcontracted');await page.getByTestId('form-contractor').fill('Example TC Pty Ltd');
 await page.getByTestId('save').click();await page.waitForSelector('[data-testid="area-row"] >> nth=1');
 saved=await apiAreas(PE);const tcArea=saved.find(x=>x.name==='Traffic control A');
 check('desktop: subcontracted traffic-control area saved with contractor',tcArea?.delivery==='subcontracted'&&tcArea.contractorLabel==='Example TC Pty Ltd'&&tcArea.discipline==='traffic_management');
 await selectRow(page,'Traffic control A');await page.getByTestId('area-edit').click();
 await a('/api/projects/work-areas','PATCH',{id:tcArea.id,revision:tcArea.revision,notes:'changed elsewhere'});
 await page.getByTestId('form-name').fill('Traffic control A2');await page.getByTestId('save').click();
 await page.waitForSelector('[data-testid="save-error"]');
 check('desktop stale edit: conflict message and reload action, edit not applied',/changed by someone else/.test(await page.getByTestId('save-error').innerText())&&(await apiAreas(PE)).find(x=>x.id===tcArea.id).name==='Traffic control A');
 await page.screenshot({path:`${OUT}/05-desktop-stale.png`});
 await page.getByTestId('reload-latest').click();await page.waitForSelector('[data-testid="area-row"]');
 check('desktop stale edit: reload returns to the list with the latest data',await page.getByTestId('save').count()===0&&(await page.locator('[data-testid="area-row"]').count())===2);
 // archive
 await selectRow(page,'Traffic control A');await page.getByTestId('area-archive').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-testid="area-row"]').length===1);
 check('desktop archive: area leaves the active list; row kept as archived',(await apiAreas(PE)).length===1&&(await apiAreas(PE,1)).some(x=>x.id===tcArea.id&&x.status==='archived'));
 await page.getByLabel('Show archived').check();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="area-row"]').length===2);
 await selectRow(page,'Traffic control A');
 check('desktop archived: no Edit/Archive actions on an archived area',await page.getByTestId('area-edit').count()===0);
 await page.screenshot({path:`${OUT}/06-desktop-archived.png`});
 await page.getByLabel('Show archived').uncheck();
 // unavailable maps: config says Google browser mode, the Maps script is blocked
 await page.route('**/api/platform/locations?op=config',rt=>rt.fulfill({json:{provider:'google',mode:'browser',browserKey:'unavailable-test-key',mapId:null,region:'au'}}));
 let googleCalls=0;await page.route('**/maps.googleapis.com/**',rt=>{googleCalls++;return rt.abort();});
 await page.reload();await page.waitForSelector('[data-testid="area-row"]');
 check('unavailable maps: work map still loads, edits and shows areas (no provider needed)',await page.getByTestId('area-shape').count()===1&&await page.getByTestId('draw-start').isEnabled());
 check('unavailable maps: the work map made no request to Google',googleCalls===0,String(googleCalls));
 await page.unroute('**/maps.googleapis.com/**');
 // closed project and read-only role in the UI
 await db.execute("UPDATE jobs SET stage='closed',status='Closed' WHERE id=?",[PE]);await page.reload();await page.waitForSelector('[data-testid="workmap-closed"]');
 check('desktop closed project: banner shown, no Draw/Edit actions',await page.getByTestId('draw-start').count()===0&&await page.getByText('The work map is read-only.').isVisible());
 await page.getByTestId('area-row').first().click();check('desktop closed project: no Edit/Archive on selected area',await page.getByTestId('area-edit').count()===0);
 await page.screenshot({path:`${OUT}/07-desktop-closed.png`});
 await db.execute("UPDATE jobs SET stage='setup',status='Planning' WHERE id=?",[PE]);
 const rctx=await mkCtx(ro,{viewport:{width:1280,height:800}});const rpage=await rctx.newPage();await open(rpage,PE);await rpage.waitForSelector('[data-testid="area-row"]');
 check('read-only role: sees the map, no Draw button',await rpage.getByTestId('area-shape').count()===1&&await rpage.getByTestId('draw-start').count()===0&&await rpage.getByText(/You can view the work map/).isVisible());
 await rctx.close();
 const fctx=await mkCtx(field,{viewport:{width:1280,height:800}});const fpage=await fctx.newPage();await fpage.goto(base+`/#Projects//${PE}/workmap`);await fpage.waitForTimeout(3000);
 check('field worker: no Work map content is reachable',await fpage.getByTestId('work-map').count()===0);
 await fctx.close();
 await dctx.close();

 // ---- mobile touch (390x844, touch events through CDP)
 const mctx=await mkCtx(A,{viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});const m=await mctx.newPage();m.on('pageerror',e=>errors.push('mobile: '+e.message));m.on('dialog',d=>void d.accept());
 const cdp=await mctx.newCDPSession(m);
 const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
 const drag=async(from,to)=>{await touch('touchStart',[from]);for(let i=1;i<=8;i++)await touch('touchMove',[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8}]);await touch('touchEnd',[]);};
 const tap=async p=>{await touch('touchStart',[p]);await touch('touchEnd',[]);};
 // Sticky headers cover the top ~150px on mobile; bring the canvas fully below them before touching it.
 const align=async()=>{await m.getByTestId('map-canvas').scrollIntoViewIfNeeded();await m.evaluate(()=>{const r=document.querySelector('[data-testid="map-canvas"] svg[role="application"]').getBoundingClientRect();window.scrollBy(0,r.top-170);});await m.waitForTimeout(150);};
 await open(m,PE);await m.getByTestId('area-row').first().waitFor();
 check('mobile: no horizontal page overflow',await m.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await m.getByTestId('map-canvas').scrollIntoViewIfNeeded();await m.screenshot({path:`${OUT}/08-mobile-view.png`});
 await m.getByTestId('draw-start').scrollIntoViewIfNeeded();await m.getByTestId('draw-start').tap();
 await m.getByTestId('map-canvas').scrollIntoViewIfNeeded();
 await align();let mc=await canvas(m);
 for(const [dx,dy] of [[-90,-80],[90,-80],[90,80],[-90,80]])await tap({x:mc.cx+dx,y:mc.cy+dy});
 check('mobile draw: four touch taps add four points',(await m.getByTestId('point-count').innerText()).startsWith('4'));
 await m.getByTestId('draw-finish').scrollIntoViewIfNeeded();await m.getByTestId('draw-finish').tap();
 check('mobile draw: shape OK',/Shape OK/.test(await m.getByTestId('shape-status').innerText()));
 const vs=await m.locator('[data-testid="vertex"] circle').first().boundingBox();
 check('mobile: vertex touch target is at least 44 px',vs.width>=44&&vs.height>=44,`${Math.round(vs.width)}x${Math.round(vs.height)}`);
 await m.getByTestId('form-name').scrollIntoViewIfNeeded();await m.getByTestId('form-name').fill('Mobile stage');
 await align();mc=await canvas(m);
 // drag vertex 2 by touch
 const mv=await m.locator('g[data-vertex="1"] circle').first().boundingBox();
 const before=await m.evaluate(()=>[...document.querySelectorAll('[data-testid="vertex"] circle:nth-child(2)')].map(c=>c.getAttribute('cx')+','+c.getAttribute('cy')));
 await drag({x:mv.x+mv.width/2,y:mv.y+mv.height/2},{x:mv.x+mv.width/2+30,y:mv.y+mv.height/2+25});
 const afterV=await m.evaluate(()=>[...document.querySelectorAll('[data-testid="vertex"] circle:nth-child(2)')].map(c=>c.getAttribute('cx')+','+c.getAttribute('cy')));
 check('mobile edit: touch-dragging a vertex moves only that vertex',before.length===4&&afterV.filter((x,i)=>x!==before[i]).length===1&&afterV[1]!==before[1],`${before[1]} → ${afterV[1]}`);
 // pinch zoom (two touches apart) changes the scale
 const scale0=await m.getByTestId('basemap-status').innerText();
 await touch('touchStart',[{x:mc.cx-100,y:mc.cy},{x:mc.cx+100,y:mc.cy}]);for(let i=1;i<=8;i++)await touch('touchMove',[{x:mc.cx-100+i*9,y:mc.cy},{x:mc.cx+100-i*9,y:mc.cy}]);await touch('touchEnd',[]);
 const scale1=await m.getByTestId('basemap-status').innerText();
 check('mobile: pinch-in gesture zooms the map out (grid scale changed)',scale0!==scale1,`${scale0.match(/Grid squares ([^.]+)/)?.[1]} → ${scale1.match(/Grid squares ([^.]+)/)?.[1]}`);
 await m.screenshot({path:`${OUT}/09-mobile-editing.png`});
 await m.getByTestId('save').scrollIntoViewIfNeeded();await m.getByTestId('save').tap();await m.getByTestId('area-row').first().waitFor();
 saved=await apiAreas(PE);
 check('mobile save: persisted, 2 active areas',saved.length===2&&saved.some(x=>x.name==='Mobile stage'&&x.ring.length===4));
 await m.reload();await m.getByTestId('area-row').first().waitFor();
 check('mobile reload: both areas reopen',await m.getByTestId('area-shape').count()===2);
 check('mobile: still no horizontal overflow after editing',await m.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await m.getByTestId('map-canvas').scrollIntoViewIfNeeded();await m.screenshot({path:`${OUT}/10-mobile-saved.png`});
 await mctx.close();await browser.close();
 check('no uncaught page errors',errors.length===0,errors.join(' | ').slice(0,200));
}finally{
 server.kill();await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
