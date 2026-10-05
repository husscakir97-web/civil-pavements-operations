// Planning resource picker acceptance run: link a requirement to an existing worker or plant item (select, replace, clear), with
// server and browser checks. Synthetic data only; email disabled; the disposable *_test database named by MYSQL_DATABASE must be empty.
//   npm run build   then   MYSQL_DATABASE=picker_test node scripts/planning-picker-journey.mjs [outputDir]
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_PATH, PORT (default 3189). Results are pass/fail; nothing is silently skipped.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {connect} from './mysql-config.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
const PORT=Number(process.env.PORT||3189),base=`http://localhost:${PORT}`,OUT=process.argv[2]||'/tmp/planning-picker';
mkdirSync(OUT,{recursive:true});
const loadPlaywright=()=>{for(const p of [process.env.PLAYWRIGHT_MODULE,'playwright','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){try{return require(p);}catch{/* try next */}}throw new Error('Playwright is not available: set PLAYWRIGHT_MODULE');};
const {chromium}=loadPlaywright();
const CHROMIUM=process.env.CHROMIUM_PATH||['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const results=[];
const record=(step,status,detail='')=>{results.push({step,status,detail});console.log(`${status.toUpperCase().padEnd(7)} ${step}${detail?' — '+detail:''}`);};
const check=(step,condition,detail='')=>{record(step,condition?'pass':'fail',detail);return Boolean(condition);};

const db=await connect();
const [[existing]]=await db.query('SELECT COUNT(*) AS n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(existing.n)!==0)throw new Error('Refusing to run: the disposable database already has users. Use an empty, freshly migrated database.');

// ---- S3-compatible fixture and the production server
const objects=new Map();
const s3=createServer(async(req,res)=>{const key=decodeURIComponent(new URL(req.url,'http://x').pathname.replace(/^\/test-bucket\//,''));
 if(req.method==='PUT'){const c=[];for await(const x of req)c.push(x);objects.set(key,Buffer.concat(c));res.end();}
 else if(req.method==='GET'){if(!objects.has(key)){res.writeHead(404);res.end('<Error><Code>NoSuchKey</Code></Error>');return;}res.end(objects.get(key));}
 else if(req.method==='DELETE'){objects.delete(key);res.end();}else res.end();});
await new Promise(r=>s3.listen(0,'127.0.0.1',r));
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'picker-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:base,R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET_NAME:'test-bucket'};
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
if(migrated.status!==0)throw new Error('migrations failed: '+migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}

const stamp=Date.now(),password='Very-strong-test-password-42';
const signup=async name=>{const email=`${name}-${stamp}@example.invalid`;let r;for(let attempt=0;attempt<6;attempt++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,(Number(r.headers.get('retry-after'))||10)*1000));}
 const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]);const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);
 if(!u)throw new Error(`sign-up for ${name} failed: ${r.status} ${(await r.text()).slice(0,300)}`);
 return {id:u.id,email,cookies,cookie:cookies.join('; '),org:u.organisation_id};};
const api=cookie=>async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json};};
const must=(r,codes,label)=>{if(!codes.includes(r.status))throw new Error(`${label} -> ${r.status} ${JSON.stringify(r.body).slice(0,300)}`);return r.body;};
const planning=cookie=>{const a=api(cookie);return {get:id=>a(`/api/planning?scenarioId=${id}`),post:body=>a('/api/planning','POST',body),lookup:(type,q='',extra='')=>a(`/api/planning?lookup=${type}&q=${encodeURIComponent(q)}${extra}`)};};
const rowsById=async table=>Object.fromEntries((await db.query(`SELECT * FROM ${table} ORDER BY id`))[0].map(r=>[r.id,r]));
const diffRows=(a,b)=>Object.keys(a).flatMap(id=>Object.keys(a[id]).filter(k=>JSON.stringify(a[id][k])!==JSON.stringify(b[id]?.[k])).map(k=>`${id.slice(0,8)}.${k}`));
const req=(id,kind,name,quantity,rate,resourceRef=null)=>({id,kind,name,quantity,rate,rateBasis:'hour',resourceRef});
const act=(id,name,over={})=>({id,kind:'activity',name,notes:'',quantity:null,unit:null,productivity:null,productivityUnit:null,durationMode:'entered',durationDays:2,hoursPerDay:8,plannedStart:null,requirements:[],costItems:[],sharedCostIds:[],...over});
const docOf=(...activities)=>({activities,dependencies:[],sharedCosts:[]});
let browser;
try{
 // ================= Setup =================
 const admin=await signup('pk-admin');
 const members={};
 for(const [name,role] of [['pk-estimator','estimator'],['pk-readonly','read_only'],['pk-pm','project_manager']]){const m=await signup(name);await db.query('UPDATE users SET organisation_id=?,role=? WHERE id=?',[admin.org,role,m.id]);members[role]=m;}
 const other=await signup('pk-other-org');
 const E=planning(members.estimator.cookie),RO=planning(members.read_only.cookie),PM=planning(members.project_manager.cookie),B=planning(other.cookie);
 const ea=api(admin.cookie),ob=api(other.cookie);
 const worker=async(call,first,last,no,role,extra={})=>must(await call('/api/operations/resources','POST',{action:'saveWorker',worker:{firstName:first,lastName:last,employeeNumber:no,email:`${first}.${last}@example.invalid`.toLowerCase(),phone:'0400 111 222',roleTitle:role,employmentType:'employee',hourlyRate:61.37,location:'Exampleton depot',status:'Active',...extra}}),[200,201],`worker ${first}`).id;
 const plant=async(call,no,name,category,description)=>must(await call('/api/operations/resources','POST',{action:'savePlant',plant:{name,plantNumber:no,registration:'REG'+no.replace(/\W/g,''),category,description,make:'Make',model:'Model',ownership:'owned',hourlyRate:212.5,dayRate:1701.55,complianceExpiry:'2027-06-01',location:'Exampleton depot',status:'Available'}}),[200,201],`plant ${no}`).id;
 const W1=await worker(ea,'Dan','Hollis','E-100','Paving Foreman'),W2=await worker(ea,'Priya','Nair','E-101','Roller Operator'),W3=await worker(ea,'Karl','Jensen','E-102','Profiler Operator'),W4=await worker(ea,'Archie','Archived','E-199','Retired Foreman');
 const P1=await plant(ea,'P-101','Wirtgen W 100 Profiler','Profiler','Cold planer'),P2=await plant(ea,'P-102','Vogele Super 1800 Paver','Paver','Asphalt paver'),P3=await plant(ea,'P-103','Retired roller','Roller','Sold');
 await db.query("UPDATE workers SET status='Archived' WHERE id=?",[W4]);await db.query("UPDATE plant SET status='Archived' WHERE id=?",[P3]);
 const workersBefore=await rowsById('workers'),plantBefore=await rowsById('plant');
 const BW=await worker(ob,'Bianca','Otherorg','B-1','Foreign Foreman'),BP=await plant(ob,'Q-900','Foreign Grader','Grader','Other organisation');
 record('Setup: administrator, estimator, project manager, read-only user, second organisation; 4 workers (1 archived) and 3 plant items (1 archived) with pay and hire rates; another organisation with its own worker and plant','pass','synthetic data in the *_test database only');

 // ================= Lookup (server) =================
 const names=r=>r.body.results.map(x=>x.label);
 let r=await E.lookup('worker');
 check('Worker lookup returns the organisation\'s active workers, with clear labels, and never an archived or another organisation\'s record',r.status===200&&names(r).length===3&&names(r).includes('Dan Hollis')&&!names(r).includes('Archie Archived')&&!names(r).includes('Bianca Otherorg'),names(r).join(', '));
 const detail=r.body.results.find(x=>x.label==='Dan Hollis');
 check('A worker choice shows the name and "employment type · role · employee number" and carries no other fields',detail&&detail.detail==='Employee (type unspecified) · Paving Foreman · E-100'&&Object.keys(detail).sort().join()==='detail,id,label,type',JSON.stringify(detail));
 check('Lookup never exposes pay or hire rates, contact details or registrations',!/hourly|day_?rate|"rate"|0400|@example|REG[A-Z0-9]|email|phone|registration|61\.37|212\.5|1701\.55/i.test(JSON.stringify((await E.lookup('worker')).body)+JSON.stringify((await E.lookup('plant')).body)));
 check('Search narrows by role, employee number and plant number (spaces and dashes ignored), best matches first',names(await E.lookup('worker','foreman')).join()==='Dan Hollis'&&names(await E.lookup('worker','e101')).join()==='Priya Nair'&&names(await E.lookup('plant','p101')).join()==='P-101 · Wirtgen W 100 Profiler'&&names(await E.lookup('plant','paver')).join()==='P-102 · Vogele Super 1800 Paver');
 check('Plant lookup excludes archived plant and other organisations\' plant; the limit is honoured',names(await E.lookup('plant')).length===2&&!names(await E.lookup('plant')).some(n=>/Grader|Retired/.test(n))&&(await E.lookup('worker','','&limit=1')).body.results.length===1);
 check('Lookup refuses an unknown kind (400), a role that cannot edit plans (403), and an unauthenticated caller (401)',(await E.lookup('crane')).status===400&&(await RO.lookup('worker')).status===403&&(await PM.lookup('plant')).status===403&&(await fetch(`${base}/api/planning?lookup=worker`)).status===401);
 check('Another organisation sees only its own records through the same endpoint',names(await B.lookup('worker')).join()==='Bianca Otherorg'&&names(await B.lookup('plant')).join()==='Q-900 · Foreign Grader');

 // ================= Select → save → reopen, replace, clear (server) =================
 const planned=must(await E.post({action:'create-plan',name:'Picker plan'}),[200],'create plan');
 const sid=planned.scenario.id;let rev=planned.scenario.revision;
 const baseline=docOf(act('pave-a0001','Paving',{requirements:[req('pave-r0001','labour','Paving crew',3,66),req('pave-r0002','plant','Paver',1,230),req('pave-r0003','labour','Casual labour',2,null)]}));
 const saved0=must(await E.post({action:'save',scenarioId:sid,expectedRevision:rev,document:baseline}),[200],'baseline save');rev=saved0.scenario.revision;
 const costOf=p=>JSON.stringify(p.result.cost);
 const withRefs=(w,p)=>docOf(act('pave-a0001','Paving',{requirements:[req('pave-r0001','labour','Paving crew',3,66,w?{type:'worker',id:w}:null),req('pave-r0002','plant','Paver',1,230,p?{type:'plant',id:p}:null),req('pave-r0003','labour','Casual labour',2,null)]}));
 const saveRefs=async(w,p,as=E)=>{rev=(await E.get(sid)).body.scenario.revision;const res=await as.post({action:'save',scenarioId:sid,expectedRevision:rev,document:withRefs(w,p)});if(res.status===200)rev=res.body.scenario.revision;return res;};
 let s=await saveRefs(W1,P1);
 check('Selecting a worker and a plant item saves',s.status===200,`-> ${s.status}`);
 let again=(await E.get(sid)).body;
 const rq=again.document.activities[0].requirements;
 check('Reopen: both links come back, with their labels',rq[0].resourceRef?.id===W1&&rq[1].resourceRef?.id===P1&&again.resources['worker:'+W1].label==='Dan Hollis'&&again.resources['plant:'+P1].label==='P-101 · Wirtgen W 100 Profiler'&&again.resourcesAvailable===true);
 check('Linking changed nothing else: names, counts, rates and the whole costing result are identical to the unlinked plan',rq[0].name==='Paving crew'&&rq[0].quantity===3&&rq[0].rate===66&&rq[1].name==='Paver'&&rq[1].rate===230&&rq[2].resourceRef===null&&rq[2].rate===null&&costOf(again)===costOf(saved0)&&JSON.stringify(again.result.activities)===JSON.stringify(saved0.result.activities));
 s=await saveRefs(W2,P2);again=(await E.get(sid)).body;
 check('Replacing both links saves and reopens with the new records; costing is still identical',s.status===200&&again.document.activities[0].requirements[0].resourceRef.id===W2&&again.document.activities[0].requirements[1].resourceRef.id===P2&&again.resources['worker:'+W2].label==='Priya Nair'&&!again.resources['worker:'+W1]&&costOf(again)===costOf(saved0));
 s=await saveRefs(null,P2);again=(await E.get(sid)).body;
 const [dbRows]=await db.query('SELECT name,resource_ref_type,resource_ref_id FROM planning_requirements WHERE organisation_id=? AND scenario_id=? ORDER BY sort',[admin.org,sid]);
 check('Clearing a link stores NULL for it and keeps the other link and the manually entered lines',s.status===200&&dbRows[0].resource_ref_type===null&&dbRows[0].resource_ref_id===null&&dbRows[1].resource_ref_id===P2&&dbRows[2].name==='Casual labour'&&again.document.activities[0].requirements[0].name==='Paving crew'&&Object.keys(again.resources).join()==='plant:'+P2);
 check('The labels map holds identifying fields only',!/hourly|day_?rate|"rate"|0400|@example|REG[A-Z0-9]|61\.37|212\.5|1701\.55/i.test(JSON.stringify(again.resources)));

 // ================= Rejections =================
 const revBefore=rev;
 const rejected=async(label,res,codes,pattern)=>check(label,codes.includes(res.status)&&(!pattern||pattern.test(JSON.stringify(res.body))),`-> ${res.status} ${JSON.stringify(res.body).slice(0,120)}`);
 await rejected('Another organisation\'s worker cannot be linked (400, "not found in this organisation")',await saveRefs(BW,P2),[400],/not found in this organisation/);
 await rejected('Another organisation\'s plant item cannot be linked',await saveRefs(W2,BP),[400],/not found in this organisation/);
 await rejected('A record of the wrong kind cannot be linked (a plant id on a labour line)',await saveRefs(P1,P2),[400],/not found in this organisation/);
 await rejected('An archived worker and an archived plant item cannot be newly linked',await saveRefs(W4,P2),[400],/not found/);
 await rejected('…nor an archived plant item',await saveRefs(W2,P3),[400],/not found/);
 {const bad=await E.post({action:'save',scenarioId:sid,expectedRevision:rev,document:docOf(act('pave-a0001','Paving',{requirements:[req('pave-r0001','labour','Paving crew',3,66,{type:'plant',id:P1})]}))});
  await rejected('A labour line cannot link a plant item (the shared contract refuses it)',bad,[400],/labour line can only be linked to a worker/);}
 check('Every rejected save changed nothing',(await E.get(sid)).body.scenario.revision===revBefore);
 check('A role that cannot edit plans cannot link (403)',(await RO.post({action:'save',scenarioId:sid,expectedRevision:rev,document:withRefs(W2,P2)})).status===403&&(await PM.post({action:'save',scenarioId:sid,expectedRevision:rev,document:withRefs(W2,P2)})).status===403);

 // ================= Existing links survive later changes; Operations availability =================
 s=await saveRefs(W3,P2);rev=s.body.scenario.revision;
 await db.query("UPDATE workers SET status='Archived' WHERE id=?",[W3]);
 s=await saveRefs(W3,P2);again=(await E.get(sid)).body;
 check('A link to a worker archived LATER is carried forward unchanged and shown as archived',s.status===200&&again.resources['worker:'+W3].archived===true&&again.document.activities[0].requirements[0].resourceRef.id===W3);
 await db.query("UPDATE workers SET status='Active' WHERE id=?",[W3]);
 s=await saveRefs(W3,P2);
 await db.query("UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND module='operations'",[admin.org]);
 const off=(await E.get(sid)).body;
 check('Operations disabled: no labels or lookup for anyone, the plan still opens and its costing is intact',off.resourcesAvailable===false&&Object.keys(off.resources).length===0&&costOf(off)===costOf(saved0)&&(await E.lookup('worker')).status===403);
 check('Operations disabled: an unchanged saved link is carried forward, a NEW link is refused (403), and clearing is allowed',(await saveRefs(W3,P2)).status===200&&(await saveRefs(W2,P2)).status===403&&(await saveRefs(null,P2)).status===200);
 await db.query("UPDATE organisation_entitlements SET status='active' WHERE organisation_id=? AND module='operations'",[admin.org]);
 s=await saveRefs(W1,P1);

 // ================= Roles and financial redaction =================
 const ro=await RO.get(sid),pmv=await PM.get(sid),est=await E.get(sid);
 for(const [who,res] of [['Read-only',ro],['Project manager',pmv]]){
  const j=JSON.stringify(res.body);
  check(`${who}: sees the linked asset's label but no rate, amount or cost`,res.status===200&&res.body.resources['worker:'+W1]?.label==='Dan Hollis'&&res.body.resources['plant:'+P1]&&res.body.ratesVisible===false&&res.body.result.cost===undefined&&!/"rate":\d/.test(j)&&!/61\.37|212\.5|1701\.55/.test(j)&&res.body.document.activities[0].requirements.every(x=>x.rate===null)&&res.body.document.activities[0].requirements[0].resourceRef.id===W1);
 }
 check('The estimator sees rates and labels together',est.body.ratesVisible===true&&est.body.document.activities[0].requirements[0].rate===66&&est.body.resources['worker:'+W1]);

 // ================= An existing link stays; a NEW association to the same asset is validated normally =================
 {
  const plan2=must(await E.post({action:'create-plan',name:'Association plan'}),[200],'create plan 2');
  const sA=plan2.scenario.id;
  const docA=(extra=[],ref1={type:'worker',id:W1},ref2={type:'plant',id:P1})=>docOf(act('assoc-a0001','Paving',{requirements:[req('assoc-r0001','labour','Paving crew',3,66,ref1),req('assoc-r0002','plant','Paver',1,230,ref2),...extra]}));
  const saveIn=async(sc,doc)=>{const cur=(await E.get(sc)).body.scenario.revision;return E.post({action:'save',scenarioId:sc,expectedRevision:cur,document:doc});};
  check('Association setup: a labour line linked to a worker and a plant line linked to a plant item save',(await saveIn(sA,docA())).status===200);
  await db.query("UPDATE workers SET status='Archived' WHERE id=?",[W1]);
  check('An existing association to a worker archived LATER stays: an unchanged save is accepted',(await saveIn(sA,docA())).status===200);
  const second=req('assoc-r0003','labour','Second crew',2,66,{type:'worker',id:W1});
  {const res=await saveIn(sA,docA([second]));check('A NEW association to the SAME archived worker (on another requirement) is refused: the plan-wide exemption is gone',res.status===400&&/not found/.test(JSON.stringify(res.body)),`-> ${res.status}`);}
  await db.query("UPDATE workers SET status='Active' WHERE id=?",[W1]);
  await db.query("UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND module='operations'",[admin.org]);
  const copy=await E.post({action:'create-scenario',planId:plan2.plan.id,name:'Copy while Operations is off',basedOnScenarioId:sA});
  const sB=copy.status===200?copy.body.scenario.id:null;
  check('Scenario copy keeps its links even with Operations off (a trusted copy of stored associations, with fresh requirement ids)',copy.status===200&&copy.body.document.activities[0].requirements[0].resourceRef?.id===W1&&copy.body.document.activities[0].requirements[0].id!=='assoc-r0001'&&copy.body.document.activities[0].requirements[1].resourceRef?.id===P1,`-> ${copy.status}`);
  check('Operations off: the unchanged persisted associations are still accepted in the original scenario and in its copy',(await saveIn(sA,docA())).status===200&&Boolean(sB)&&(await saveIn(sB,copy.body.document)).status===200);
  {const res=await saveIn(sA,docA([req('assoc-r0004','plant','Second paver',1,230,{type:'plant',id:P1})]));check('Operations off: a NEW association to a plant item the same scenario already references is refused (403)',res.status===403,`-> ${res.status}`);}
  if(sB){const doc=copy.body.document;const added={...doc,activities:[{...doc.activities[0],requirements:[...doc.activities[0].requirements,req('assoc-r0005','labour','Extra crew',1,66,{type:'worker',id:W1})]}]};
   const res=await saveIn(sB,added);check('Operations off: a NEW association in the copied scenario to a worker already referenced elsewhere in the plan is refused (403)',res.status===403,`-> ${res.status}`);}
  check('Operations off: clearing an existing association still works',(await saveIn(sA,docA([],null,{type:'plant',id:P1}))).status===200&&(await E.get(sA)).body.document.activities[0].requirements[0].resourceRef===null);
  await db.query("UPDATE organisation_entitlements SET status='active' WHERE organisation_id=? AND module='operations'",[admin.org]);
 }

 // ================= Browser =================
 await db.query("UPDATE workers SET status='Active' WHERE id=?",[W3]);
 {const changed=[...diffRows(workersBefore,await rowsById('workers')),...diffRows(plantBefore,await rowsById('plant'))];check('Linking, replacing and clearing never wrote to workers or plant (every resource row is identical to before)',changed.length===0,changed.join(', '));}
 s=await saveRefs(null,null);
 browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
 const cookies=who=>who.cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};});
 const session=async(who,viewport)=>{const ctx=await browser.newContext({viewport});ctx.setDefaultTimeout(20000);await ctx.addCookies(cookies(who));const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));return {ctx,page,errors};};
 const goPlan=async(page,viewport)=>{await page.setViewportSize({width:1440,height:1100});await page.goto(base+'/');await page.waitForTimeout(2500);const nav=page.locator('aside');if(await nav.count()&&await nav.first().isVisible().catch(()=>false)){await nav.getByText('Pipeline',{exact:true}).first().click();await page.waitForTimeout(600);await page.getByRole('navigation',{name:/ sections$/}).getByText('Planning',{exact:true}).first().click();}else{await page.getByRole('button',{name:/menu/i}).first().click().catch(()=>{});await page.getByText('Pipeline',{exact:true}).first().click();await page.waitForTimeout(600);await page.getByText('Planning',{exact:true}).first().click();}await page.waitForTimeout(1200);
  await page.locator('li',{hasText:'Picker plan'}).getByRole('button',{name:'Open'}).click();await page.getByRole('heading',{name:'Picker plan'}).waitFor();if(viewport)await page.setViewportSize(viewport);await page.waitForTimeout(400);};
 const dlg=page=>page.getByRole('dialog');
 const openPaving=async page=>{await page.getByRole('group',{name:/^Paving,/}).getByRole('button',{name:/^(Edit|View)$/}).click();await dlg(page).waitFor();};
 const rowOf=(page,i)=>dlg(page).getByTestId('requirement').nth(i);
 const saveAll=async page=>{await dlg(page).getByRole('button',{name:'Close'}).click();await dlg(page).waitFor({state:'detached'});await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();};
 const values=async(page,i)=>({name:await rowOf(page,i).getByLabel('Resource name').inputValue(),count:await rowOf(page,i).getByLabel('Resource count').inputValue(),rate:await rowOf(page,i).getByLabel('Resource rate').inputValue()});

 for(const [label,viewport,prefix] of [['desktop',{width:1440,height:1100},'desktop'],['mobile',{width:390,height:844},'mobile']]){
  s=await saveRefs(null,null);
  const {ctx,page,errors}=await session(members.estimator,viewport);
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  await goPlan(page,viewport);await openPaving(page);
  await page.screenshot({path:`${OUT}/${prefix}-0-drawer.png`});
  const before=await values(page,0),costBefore=await dlg(page).getByTestId('activity-cost').innerText();
  check(`${label}: an unlinked line offers "Link a worker"; a plant line offers "Link a plant item"`,await rowOf(page,0).getByRole('button',{name:'Link a worker'}).isVisible()&&await rowOf(page,1).getByRole('button',{name:'Link a plant item'}).isVisible());
  await rowOf(page,0).getByRole('button',{name:'Link a worker'}).click();
  await rowOf(page,0).getByLabel('Search workers').fill('foreman');
  await rowOf(page,0).getByTestId('resource-option').first().waitFor();
  const opts=await rowOf(page,0).getByTestId('resource-option').allInnerTexts();
  check(`${label}: the search shows matching workers with clear labels (name, role, employee number) and no archived or foreign records`,opts.length===1&&/Dan Hollis/.test(opts[0])&&/Paving Foreman · E-100/.test(opts[0])&&!/Archie|Bianca/.test(opts.join()),opts.join(' | '));
  await rowOf(page,0).getByLabel('Search workers').fill('');await rowOf(page,0).getByTestId('resource-option').nth(2).waitFor();
  check(`${label}: an empty search lists the organisation's three active workers`,await rowOf(page,0).getByTestId('resource-option').count()===3);
  await rowOf(page,0).getByLabel('Search workers').fill('dan');await rowOf(page,0).getByTestId('resource-option').first().waitFor();
  await page.screenshot({path:`${OUT}/${prefix}-1-picker-open.png`});
  check(`${label}: option rows are at least 44px tall (touch-friendly)`,(await rowOf(page,0).getByTestId('resource-option').first().boundingBox()).height>=44);
  await rowOf(page,0).getByTestId('resource-option').first().click();
  check(`${label}: choosing a worker shows the link`,/Linked worker:\s*Dan Hollis/.test(await rowOf(page,0).getByTestId('resource-link-label').innerText()));
  check(`${label}: choosing did not change the line's name, count, rate or the activity cost`,JSON.stringify(await values(page,0))===JSON.stringify(before)&&await dlg(page).getByTestId('activity-cost').innerText()===costBefore,JSON.stringify(await values(page,0)));
  check(`${label}: the line's type cannot be changed while it is linked`,await rowOf(page,0).getByLabel('Resource type').isDisabled());
  await rowOf(page,1).getByRole('button',{name:'Link a plant item'}).click();
  await rowOf(page,1).getByLabel('Search plant').fill('p101');await rowOf(page,1).getByTestId('resource-option').first().click();
  check(`${label}: a plant line links a plant item, labelled by number and name`,/Linked plant:\s*P-101 · Wirtgen W 100 Profiler/.test(await rowOf(page,1).getByTestId('resource-link-label').innerText()));
  await page.screenshot({path:`${OUT}/${prefix}-2-linked.png`});
  check(`${label}: no horizontal overflow while linking`,(await overflow())<=0,`overflow ${await overflow()}`);
  await saveAll(page);
  await goPlan(page,viewport);await openPaving(page);
  check(`${label}: save → reload → reopen keeps both links with their labels`,/Dan Hollis/.test(await rowOf(page,0).getByTestId('resource-link-label').innerText())&&/P-101/.test(await rowOf(page,1).getByTestId('resource-link-label').innerText())&&JSON.stringify(await values(page,0))===JSON.stringify(before));
  await rowOf(page,0).getByRole('button',{name:'Replace linked worker'}).click();
  await rowOf(page,0).getByLabel('Search workers').fill('priya');await rowOf(page,0).getByTestId('resource-option').first().click();
  check(`${label}: replacing selects another worker`,/Priya Nair/.test(await rowOf(page,0).getByTestId('resource-link-label').innerText()));
  await saveAll(page);await goPlan(page,viewport);await openPaving(page);
  check(`${label}: the replacement survives reload`,/Priya Nair/.test(await rowOf(page,0).getByTestId('resource-link-label').innerText()));
  await rowOf(page,0).getByRole('button',{name:'Clear linked worker'}).click();
  check(`${label}: clearing returns the line to manual entry with its values intact`,await rowOf(page,0).getByRole('button',{name:'Link a worker'}).isVisible()&&JSON.stringify(await values(page,0))===JSON.stringify(before)&&await rowOf(page,0).getByLabel('Resource type').isEnabled());
  await saveAll(page);await goPlan(page,viewport);await openPaving(page);
  const [cleared]=await db.query('SELECT resource_ref_type,resource_ref_id FROM planning_requirements WHERE organisation_id=? AND scenario_id=? ORDER BY sort LIMIT 1',[admin.org,sid]);
  check(`${label}: a cleared link stays cleared after reload and is NULL in the database; the plant link is still there`,cleared[0].resource_ref_id===null&&await rowOf(page,0).getByRole('button',{name:'Link a worker'}).isVisible()&&/P-101/.test(await rowOf(page,1).getByTestId('resource-link-label').innerText()));
  await page.screenshot({path:`${OUT}/${prefix}-3-reopened.png`});
  check(`${label}: no page errors`,errors.length===0,errors.join(' | ').slice(0,200));
  await ctx.close();
 }

 // Switching the resource type while a search is loaded or pending must never leave the other kind's results clickable.
 {
  s=await saveRefs(null,null);
  const {ctx,page,errors}=await session(members.estimator,{width:1440,height:1100});
  const gates={worker:null,plant:null};
  await page.route(/\/api\/planning\?lookup=(worker|plant)/,async route=>{const kind=/lookup=(worker|plant)/.exec(route.request().url())[1];if(gates[kind])await gates[kind].promise;await route.continue();});
  const hold=kind=>{let release;const promise=new Promise(r=>{release=r;});gates[kind]={promise,release};return()=>{gates[kind]=null;release();};};
  await goPlan(page);await openPaving(page);
  const row=rowOf(page,2),box=()=>row.getByRole('textbox',{name:/^Search /}),options=()=>row.getByTestId('resource-option');
  const workerNames=/Dan Hollis|Karl Jensen|Priya Nair/;
  await row.getByRole('button',{name:'Link a worker'}).click();
  await box().fill('10');await options().nth(2).waitFor();
  check('Type switch (loaded results): worker results for "10" are showing on a labour line',await options().count()===3&&workerNames.test((await options().allInnerTexts()).join()));
  const releasePlant=hold('plant');
  await row.getByLabel('Resource type').selectOption('plant');
  check('Type switch (loaded results): while the plant search is pending, no worker result remains visible or clickable',await options().filter({hasText:workerNames}).count()===0&&await options().count()===0&&/Searching/.test(await row.innerText()));
  check('Type switch: the search box now says plant',await row.getByLabel('Search plant').isVisible());
  releasePlant();await options().first().waitFor();
  check('Type switch (loaded results): when the plant response arrives only plant items are listed',await options().count()===2&&(await options().allInnerTexts()).every(t=>/P-10[12]/.test(t)));
  // a worker response that is still in flight when the kind changes must not appear afterwards
  await row.getByLabel('Resource type').selectOption('labour');
  await options().nth(2).waitFor();
  const releaseWorker=hold('worker');
  await row.getByLabel('Search workers').fill('101');
  await row.getByLabel('Resource type').selectOption('plant');
  await row.getByLabel('Search plant').fill('102');await options().first().waitFor();
  releaseWorker();await page.waitForTimeout(700);
  check('Type switch (pending response): a worker response that arrives after the switch never replaces the plant results',await options().count()===1&&/P-102/.test(await options().first().innerText())&&await options().filter({hasText:workerNames}).count()===0,(await options().allInnerTexts()).join(' | '));
  await options().first().click();
  check('Type switch: choosing then links a plant item to the plant line (never a worker)',/Linked plant:\s*P-102/.test(await row.getByTestId('resource-link-label').innerText()));
  check('Type switch: no page errors',errors.length===0,errors.join(' | ').slice(0,200));
  await ctx.close();
 }

 // unsaved-change protection (desktop): edits show the pending state, leaving asks first, discard returns to the saved values
 {const {ctx,page,errors}=await session(members.estimator,{width:1440,height:1100});
  await goPlan(page,{width:1440,height:1100});await openPaving(page);
  const saved=await rowOf(page,1).getByLabel('Resource name').inputValue();
  await rowOf(page,1).getByLabel('Resource name').fill(saved+' edited');await dlg(page).getByRole('button',{name:'Close'}).click();await dlg(page).waitFor({state:'detached'});
  check('Unsaved changes: the pending-edit state and the Save button are visible after editing',await page.getByText('Unsaved changes').isVisible()&&await page.getByText('Edits not saved yet').first().isVisible()&&await page.getByRole('button',{name:'Save',exact:true}).isEnabled());
  let asked='';page.once('dialog',d=>{asked=d.message();void d.dismiss();});
  await page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('button',{name:'Planning'}).click();await page.waitForTimeout(400);
  check('Unsaved changes: leaving to the plan list asks first, and cancelling keeps the editor and the edit',/unsaved changes/i.test(asked)&&await page.getByRole('heading',{name:'Picker plan'}).isVisible()&&await page.getByText('Unsaved changes').isVisible(),asked);
  await page.getByRole('button',{name:'Discard changes'}).click();await page.getByText('Unsaved changes').waitFor({state:'detached'});
  await openPaving(page);
  check('Unsaved changes: discarding restores the saved values',await rowOf(page,1).getByLabel('Resource name').inputValue()===saved);
  await page.screenshot({path:`${OUT}/desktop-4-after-discard.png`});check('Unsaved changes: no page errors',errors.length===0);await ctx.close();}

 // read-only viewer and Operations off (desktop)
 s=await saveRefs(W1,P1);
 {const {ctx,page,errors}=await session(members.read_only,{width:1440,height:1100});
  await goPlan(page);await openPaving(page);
  check('Read-only viewer: sees the linked worker and plant item but has no link, replace or clear controls and no rates',/Dan Hollis/.test(await rowOf(page,0).getByTestId('resource-link-label').innerText())&&await dlg(page).getByRole('button',{name:/Link a|Replace linked|Clear linked/}).count()===0&&/Restricted/.test(await dlg(page).innerText()));
  await page.screenshot({path:`${OUT}/readonly-linked.png`});check('Read-only viewer: no page errors',errors.length===0);await ctx.close();}
 await db.query("UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND module='operations'",[admin.org]);
 {const {ctx,page,errors}=await session(members.estimator,{width:1440,height:1100});
  await goPlan(page);await openPaving(page);
  check('Operations off: an existing link is kept but shown as unavailable, it can be cleared, and nothing offers a new link',/not available to you/.test(await rowOf(page,0).getByTestId('resource-link-label').innerText())&&await rowOf(page,0).getByRole('button',{name:'Clear linked worker'}).isVisible()&&await dlg(page).getByRole('button',{name:/^Replace linked/}).count()===0);
  await rowOf(page,2).scrollIntoViewIfNeeded();
  check('Operations off: an unlinked line explains why it cannot be linked and keeps manual entry',/needs Operations/.test(await rowOf(page,2).innerText())&&await rowOf(page,2).getByLabel('Resource name').isEnabled());
  await page.screenshot({path:`${OUT}/operations-off.png`});check('Operations off: no page errors',errors.length===0);await ctx.close();}
 await db.query("UPDATE organisation_entitlements SET status='active' WHERE organisation_id=? AND module='operations'",[admin.org]);
}catch(e){console.error(e.stack||e);record('Harness ran to completion','fail',String(e.message).slice(0,300));}
finally{await browser?.close();server.kill();s3.close();await db.end();const failed=results.filter(x=>x.status==='fail').length;console.log(`\n${results.length-failed} passed, ${failed} failed`);process.exit(failed?1:0);}
