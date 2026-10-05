// Planning v0.1 acceptance run (docs/PLANNING-V0-1-DECISION.md): drives the real UI and API against the production build.
// Synthetic data only; email disabled; every user lives in the disposable *_test database named by MYSQL_DATABASE (must be empty).
//   npm run build   then   MYSQL_DATABASE=planning_test node scripts/planning-journey.mjs [outputDir]
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_PATH, PORT (default 3188). Results are pass/fail; nothing is silently skipped.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
const PORT=Number(process.env.PORT||3188),base=`http://localhost:${PORT}`,OUT=process.argv[2]||'/tmp/planning-journey';
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
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'planning-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:base,R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET_NAME:'test-bucket'};
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

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const planning=(cookie)=>{const a=api(cookie);return {get:id=>a(`/api/planning?scenarioId=${id}`),list:()=>a('/api/planning'),post:body=>a('/api/planning','POST',body),csv:id=>a(`/api/planning?scenarioId=${id}&export=csv`)};};
const act=(id,name,over={})=>({id,kind:'activity',name,notes:'',quantity:null,unit:null,productivity:null,productivityUnit:null,durationMode:'entered',durationDays:null,hoursPerDay:null,plannedStart:null,requirements:[],costItems:[],sharedCostIds:[],...over});
const docOf=(...activities)=>({activities,dependencies:[],sharedCosts:[]});
let browser;
try{
 // ================= Setup: one organisation with ONLY Estimating (plus core), people in several roles, a second organisation =================
 const admin=await signup('pl-admin');
 await db.query("UPDATE organisation_entitlements SET status='disabled' WHERE organisation_id=? AND module NOT IN ('estimating','core')",[admin.org]);
 const members={};
 for(const [name,role] of [['pl-estimator','estimator'],['pl-pm','project_manager'],['pl-readonly','read_only']]){const m=await signup(name);await db.query('UPDATE users SET organisation_id=?,role=? WHERE id=?',[admin.org,role,m.id]);members[role]=m;}
 const other=await signup('pl-other-org');
 const A=planning(admin.cookie),E=planning(members.estimator.cookie),PM=planning(members.project_manager.cookie),RO=planning(members.read_only.cookie),B=planning(other.cookie);
 const ea=api(admin.cookie);
 // an APPROVED estimate that Planning must never touch
 const created=must(await ea('/api/estimates','POST',{data:{name:'Approved reference estimate',clientName:'Example Client',projectName:'Reference',workType:'Drainage',items:[{id:'i1',section:'Drainage',costCode:'100',category:'labour',description:'Crew',quantity:100,unit:'m',productivity:10,rateBasis:'hour',rate:95}],marginValue:15,overheadsPct:8,contingencyPct:3}}),[200,201],'create estimate');
 const estimateId=created.estimate?.id||created.id;
 must(await ea('/api/estimates/approval','POST',{estimateId,action:'submit'}),[200],'submit estimate');
 must(await ea('/api/estimates/approval','POST',{estimateId,action:'approve',notes:'Approved for the planning isolation check'}),[200],'approve estimate');
 const estimateSnapshot=async()=>{const [e]=await db.query('SELECT * FROM estimates WHERE organisation_id=? AND id=?',[admin.org,estimateId]);const [r]=await db.query('SELECT * FROM estimate_revisions WHERE organisation_id=? AND estimate_id=? ORDER BY id',[admin.org,estimateId]);const [counts]=await db.query("SELECT (SELECT COUNT(*) FROM jobs WHERE organisation_id=?) AS jobs,(SELECT COUNT(*) FROM shifts WHERE organisation_id=?) AS shifts,(SELECT COUNT(*) FROM shift_assignments WHERE organisation_id=?) AS bookings,(SELECT COUNT(*) FROM program_activities WHERE organisation_id=?) AS programme",[admin.org,admin.org,admin.org,admin.org]);return sha({e,r,counts});};
 const estimateBefore=await estimateSnapshot();
 record('Setup: organisation with only Estimating enabled; estimator, project manager, read-only and administrator users; second organisation; approved estimate','pass','email disabled; synthetic users exist only in the *_test database');
 check('Unrelated modules are really off for this organisation',(await api(members.estimator.cookie)('/api/projects/program')).status===404&&(await api(members.estimator.cookie)('/api/commercial')).status===404);

 // ================= Server contract (API) =================
 const plan1=must(await E.post({action:'create-plan',name:'Contract plan',estimateId}),[200],'create plan');
 const s1=plan1.scenario.id;let rev=plan1.scenario.revision;
 const bad=async(label,doc,pattern)=>{const r=await E.post({action:'save',scenarioId:s1,expectedRevision:rev,document:doc});check(label,r.status===400&&(!pattern||pattern.test(JSON.stringify(r.body))),`-> ${r.status} ${JSON.stringify(r.body).slice(0,140)}`);};
 await bad('Server rejects a dependency cycle',{...docOf(act('cyc-a0001','A',{durationDays:1}),act('cyc-b0001','B',{durationDays:1}),act('cyc-c0001','C',{durationDays:1})),dependencies:[{from:'cyc-a0001',to:'cyc-b0001'},{from:'cyc-b0001',to:'cyc-c0001'},{from:'cyc-c0001',to:'cyc-a0001'}]},/loop/);
 await bad('Server rejects incompatible units',docOf(act('unit-a001','Unit clash',{durationMode:'derived',quantity:10,unit:'m2',productivity:5,productivityUnit:'t',hoursPerDay:8})),/incompatible/);
 await bad('Server rejects a dependency on an unknown activity',{...docOf(act('dep-a0001','A',{durationDays:1})),dependencies:[{from:'dep-a0001',to:'missing-0001'}]});
 await bad('Server rejects duplicate identifiers',docOf(act('dup-a0001','A',{durationDays:1}),act('dup-a0001','B',{durationDays:1})));
 await bad('Server rejects a negative quantity',docOf(act('neg-a0001','A',{quantity:-1})));
 await bad('Server rejects a resource reference outside the organisation',docOf(act('ref-a0001','A',{durationDays:1,requirements:[{id:'ref-r0001',kind:'plant',name:'Roller',quantity:1,rate:10,rateBasis:'day',resourceRef:{type:'plant',id:'not-in-this-org'}}]})));
 check('Rejected saves changed nothing',(await E.get(s1)).body.scenario.revision===rev&&(await E.get(s1)).body.document.activities.length===0);

 // missing vs zero round-trips through the database
 const mixed={activities:[act('mix-a0001','Known zero rate',{durationDays:2,hoursPerDay:8,requirements:[{id:'mix-r0001',kind:'plant',name:'Loan roller',quantity:1,rate:0,rateBasis:'day',resourceRef:null},{id:'mix-r0002',kind:'labour',name:'Unpriced crew',quantity:2,rate:null,rateBasis:'hour',resourceRef:null}]})],dependencies:[],sharedCosts:[]};
 const savedMixed=must(await E.post({action:'save',scenarioId:s1,expectedRevision:rev,document:mixed}),[200],'save mixed');rev=savedMixed.scenario.revision;
 const [reqRows]=await db.query('SELECT name,rate FROM planning_requirements WHERE organisation_id=? AND scenario_id=? ORDER BY name',[admin.org,s1]);
 check('A known zero rate is stored as 0 and a missing rate stays NULL (unknown)',reqRows.find(r=>r.name==='Loan roller')?.rate!==null&&Number(reqRows.find(r=>r.name==='Loan roller').rate)===0&&reqRows.find(r=>r.name==='Unpriced crew')?.rate===null,JSON.stringify(reqRows));
 check('Server result: plan total unknown (not zero) while one rate is missing, known subtotal reported',savedMixed.result.cost.total===null&&savedMixed.result.cost.knownTotal===0&&savedMixed.result.cost.unknownCount===1,JSON.stringify(savedMixed.result.cost).slice(0,160));

 // stale save refused; layout does not bump the revision
 const fresh=must(await E.get(s1),[200],'get').scenario.revision;
 const staleSave=await A.post({action:'save',scenarioId:s1,expectedRevision:fresh-1,document:docOf(act('stale-a001','Should not exist',{durationDays:1}))});
 check('A stale save is refused (409) and writes nothing',staleSave.status===409&&(await E.get(s1)).body.document.activities.length===1,`-> ${staleSave.status}`);
 const posRes=await E.post({action:'positions',scenarioId:s1,positions:{'mix-a0001':{x:120,y:80}}});
 check('Saving canvas positions is separate business-neutral layout (no revision change)',posRes.status===200&&(await E.get(s1)).body.scenario.revision===fresh&&(await E.get(s1)).body.positions['mix-a0001'].x===120);
 check('Positions for an activity outside the scenario are refused',(await E.post({action:'positions',scenarioId:s1,positions:{'nope-0000001':{x:1,y:1}}})).status===400);

 // ================= Roles, redaction, ownership =================
 const full=await E.get(s1),roBody=await RO.get(s1),pmBody=await PM.get(s1);
 check('Estimator sees rates and costs',full.body.ratesVisible===true&&full.body.result.cost!==undefined);
 for(const [who,res] of [['Read-only',roBody],['Project manager',pmBody]]){
  const j=JSON.stringify(res.body);
  check(`${who}: server redacts every rate, amount and cost from the response`,res.status===200&&res.body.ratesVisible===false&&res.body.result.cost===undefined&&res.body.result.activities['mix-a0001'].cost===undefined&&!res.body.document.activities[0].requirements.some(r=>r.rate!==null)&&!/"rate":[1-9]/.test(j),`ratesVisible ${res.body.ratesVisible}`);
  check(`${who}: structure and relative timeline remain available`,res.body.result.activities['mix-a0001'].finish===2&&res.body.document.activities[0].name==='Known zero rate');
 }
 const csvFull=await E.csv(s1),csvRo=await RO.csv(s1),csvPm=await PM.csv(s1);
 check('CSV export includes costs for the estimator',csvFull.status===200&&/Cost \(ex GST\)/.test(csvFull.body));
 check('CSV export is redacted for read-only and project manager (no cost columns or amounts)',csvRo.status===200&&csvPm.status===200&&!/Cost|\$|Unknown \(/.test(csvRo.body+csvPm.body)&&/Relative finish/.test(csvRo.body),csvRo.body.slice(0,120));
 check('A role without estimate.edit cannot write',(await PM.post({action:'create-plan',name:'No'})).status===403&&(await RO.post({action:'save',scenarioId:s1,expectedRevision:fresh,document:docOf()})).status===403);
 const priv=must(await A.post({action:'create-plan',name:'Private plan',accessScope:'owner'}),[200],'private plan');
 check('An owner-only plan is hidden from other users (404 and absent from the list) but visible to its owner',(await E.get(priv.scenario.id)).status===404&&!(await E.list()).body.plans.some(p=>p.name==='Private plan')&&(await A.get(priv.scenario.id)).status===200);

 // ================= Tenant isolation =================
 const foreign=[['read',await B.get(s1)],['export',await B.csv(s1)],['save',await B.post({action:'save',scenarioId:s1,expectedRevision:fresh,document:docOf()})],['positions',await B.post({action:'positions',scenarioId:s1,positions:{}})],['new scenario',await B.post({action:'create-scenario',planId:plan1.plan.id,name:'x'})],['update plan',await B.post({action:'update-plan',planId:plan1.plan.id,revision:1,name:'x'})]];
 for(const [what,res] of foreign)check(`Another organisation cannot ${what} a plan (404, no existence leak)`,res.status===404,`-> ${res.status}`);
 check('Another organisation sees none of these plans',!(await B.list()).body.plans.length);
 check('Another organisation cannot link its plan to this organisation’s estimate',(await B.post({action:'create-plan',name:'Cross link',estimateId})).status===400);

 // ================= Browser: the estimator journey with Estimating as the only module =================
 browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1100}});ctx.setDefaultTimeout(20000);
 await ctx.addCookies(members.estimator.cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));
 const page=await ctx.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
 const shot=name=>page.screenshot({path:`${OUT}/${name}.png`});
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
 const goPlanning=async()=>{await page.goto(base+'/');await page.waitForTimeout(2500);await page.locator('aside').getByText('Pipeline',{exact:true}).first().click();await page.waitForTimeout(800);await page.getByRole('navigation',{name:/ sections$/}).getByText('Planning',{exact:true}).first().click();await page.waitForTimeout(1500);};
 await goPlanning();
 const side=await page.locator('aside').innerText();
 check('Standalone: the estimator reaches Planning with only Estimating enabled (no Projects, Commercial, Schedule or Resources in the menu)',!/Commercial|Schedule|Resources|IMS/.test(side)&&await page.getByRole('heading',{name:'Planning'}).isVisible(),side.replace(/\n+/g,' | ').slice(0,200));
 await shot('01-plan-list-desktop');
 await page.getByLabel('Plan name').fill('Main Street resurfacing');await page.getByRole('button',{name:'Create plan'}).click();
 await page.getByRole('heading',{name:'Main Street resurfacing'}).waitFor();
 check('Plan created and the canvas is undated and labelled relative',/relative/i.test(await page.locator('header.workspace-page-header').first().innerText()));
 const dlg=()=>page.getByRole('dialog');
 const addActivity=async()=>{await page.getByRole('button',{name:'Add activity'}).click();await dlg().waitFor();};
 const closeDrawer=async()=>{await dlg().getByRole('button',{name:'Close'}).click();await dlg().waitFor({state:'detached'});};
 for(let i=0;i<3;i++){await addActivity();await closeDrawer();}
 const names=await page.locator('[data-testid=plan-node] p').allInnerTexts();
 check('Milling, Preparation and Paving blocks added',['Milling','Preparation','Paving'].every(n=>names.some(t=>t.includes(n))),names.join(', '));
 const openNode=async name=>{await page.getByRole('group',{name:new RegExp('^'+name+',')}).getByRole('button',{name:/^(Edit|View)$/}).click();await dlg().waitFor();};
 const num=async(label,v)=>{const el=dlg().getByLabel(label,{exact:true}).first();await el.fill(String(v));};
 const costText=()=>dlg().getByTestId('activity-cost').innerText();

 // Milling: derived duration from quantity and productivity, labour + plant
 await openNode('Milling');
 await dlg().getByLabel('Derive it from quantity and productivity').check();
 await num('Quantity',1200);await dlg().getByLabel('Quantity unit',{exact:true}).fill('m2');await num('Productivity',100);await dlg().getByLabel('Productivity unit',{exact:true}).fill('m2');await num('Productive hours per day',8);
 check('Derived duration = quantity ÷ productivity ÷ hours per day (1200 m2 at 100 m2/h, 8 h/day = 1.5 d)',/1\.5 d/.test(await dlg().getByTestId('derived-duration').innerText()));
 await dlg().getByRole('button',{name:'Add labour'}).click();
 const req=i=>dlg().getByTestId('requirement').nth(i);
 await req(0).getByLabel('Resource name').fill('Milling crew');await req(0).getByLabel('Resource count').fill('4');await req(0).getByLabel('Resource rate').fill('60');
 await dlg().getByRole('button',{name:'Add plant'}).click();
 await req(1).getByLabel('Resource name').fill('Milling machine');await req(1).getByLabel('Resource count').fill('1');await req(1).getByLabel('Resource rate').fill('900');await req(1).getByLabel('Rate basis').selectOption('day');
 const c1=await costText();
 check('Live activity cost: 4 × $60 × 8 h × 1.5 d + 1 × $900 × 1.5 d = $4,230.00',/\$4,230\.00/.test(c1),c1);
 await req(0).getByLabel('Resource rate').fill('70');
 const c2=await costText();
 check('Changing a rate updates the cost immediately ($4,710.00)',/\$4,710\.00/.test(c2),c2);
 await num('Quantity',2400);
 check('Changing the quantity updates duration and cost immediately (3 d, $9,420.00)',/3 d/.test(await dlg().getByTestId('derived-duration').innerText())&&/\$9,420\.00/.test(await costText()),await costText());
 await num('Quantity',1200);
 await dlg().getByLabel('Productivity unit',{exact:true}).fill('t');
 check('Incompatible productivity unit is flagged in the UI and blocks saving',await page.getByRole('alert').filter({hasText:/incompatible/}).count()>0&&await page.getByRole('button',{name:'Save',exact:true}).isDisabled());
 await dlg().getByLabel('Productivity unit',{exact:true}).fill('m2');
 await shot('02-drawer-desktop');
 const dm=await overflow();
 await closeDrawer();

 // Preparation: entered duration, crew, activity setup
 await openNode('Preparation');
 await num('Duration days',2);await num('Productive hours per day',8);
 await dlg().getByRole('button',{name:'Add labour'}).click();
 await req(0).getByLabel('Resource name').fill('Prep crew');await req(0).getByLabel('Resource count').fill('2');await req(0).getByLabel('Resource rate').fill('50');
 await dlg().getByRole('button',{name:'Add setup cost'}).click();await dlg().getByLabel('Setup cost name').fill('Traffic setup');await dlg().getByLabel('Setup cost amount').fill('500');
 check('Setup cost is explicit and part of the activity ($1,600.00 resources + $500.00 setup = $2,100.00)',/\$2,100\.00/.test(await costText()),await costText());
 await closeDrawer();

 // Paving: unknown rate vs zero rate
 await openNode('Paving');
 await num('Duration days',1);await num('Productive hours per day',8);
 await dlg().getByRole('button',{name:'Add plant'}).click();
 await req(0).getByLabel('Resource name').fill('Paver');await req(0).getByLabel('Resource count').fill('1');await req(0).getByLabel('Rate basis').selectOption('day');
 const unknownText=await costText();
 check('A missing rate shows the activity cost as Unknown (never $0.00)',/Activity cost: Unknown/.test(unknownText),unknownText);
 await req(0).getByLabel('Resource rate').fill('0');
 check('An entered zero rate is a known $0.00',/\$0\.00/.test(await costText())&&!/Unknown/.test(await costText()),await costText());
 await req(0).getByLabel('Resource rate').fill('1200');
 check('Paving cost with a $1,200 day rate',/\$1,200\.00/.test(await costText()),await costText());
 await closeDrawer();

 // Shared cost counted once
 await page.getByRole('tab',{name:'Costs'}).or(page.getByRole('button',{name:'Costs',exact:true})).first().click();
 await page.getByRole('button',{name:'Add shared cost'}).click();
 await page.getByLabel('Amount for Shared cost').fill('1000');
 await page.getByRole('button',{name:'Flowchart',exact:true}).click();
 for(const n of ['Milling','Preparation']){await openNode(n);await dlg().getByLabel('Shared cost').check();await closeDrawer();}
 await page.getByRole('button',{name:'Costs',exact:true}).click();
 const totals=async()=>({run:await page.getByTestId('cost-run').innerText(),setup:await page.getByTestId('cost-setup').innerText(),shared:await page.getByTestId('cost-shared').innerText(),total:await page.getByTestId('cost-total').innerText()});
 const t1=await totals();
 check('Shared setup cost is counted once even though two activities rely on it (resources $7,510 + setup $500 + shared $1,000 = $9,010)',t1.run==='$7,510.00'&&t1.setup==='$500.00'&&t1.shared==='$1,000.00'&&t1.total==='$9,010.00',JSON.stringify(t1));
 const rows=await page.getByTestId('activity-total').allInnerTexts();
 check('Per-activity totals exclude the shared cost',rows.join('|')==='$4,710.00|$2,100.00|$1,200.00',rows.join('|'));
 await shot('03-costs-desktop');
 await page.getByRole('button',{name:'Flowchart',exact:true}).click();

 // Dependencies: connect, parallel join, cycle rejection
 const connectPair=async(from,to)=>{await page.getByRole('button',{name:`Connect from ${from}`}).click();await page.getByRole('button',{name:`Connect to ${to}`}).click();};
 await connectPair('Milling','Paving');await connectPair('Preparation','Paving');
 check('Two predecessors connect into Paving',await page.getByTestId('plan-edge').count()===2);
 await connectPair('Paving','Milling');
 check('A connection that would create a loop is refused with an explanation',await page.getByTestId('plan-edge').count()===2&&/loop/.test(await page.getByRole('status').filter({hasText:/loop/}).innerText().catch(()=>'')));
 await page.getByRole('button',{name:'Relative timeline'}).click();
 const bars=await page.locator('[data-testid=plan-timeline] li').evaluateAll(els=>els.map(e=>({id:e.querySelector('button')?.textContent,start:e.querySelector('[data-start]')?.getAttribute('data-start'),finish:e.querySelector('[data-finish]')?.getAttribute('data-finish')})));
 const paving=bars.find(b=>b.id==='Paving');
 check('Parallel paths join at the LATEST predecessor finish: Paving starts at day 2 and finishes at day 3 (not 1.5+2)',paving&&paving.start==='2'&&paving.finish==='3',JSON.stringify(bars));
 check('Timeline is labelled relative and makes no availability claim',/Relative timeline/.test(await page.getByTestId('plan-timeline').locator('xpath=ancestor::section').innerText())&&/No calendar dates/.test(await page.locator('main').innerText()));
 await shot('04-timeline-desktop');
 await page.getByRole('button',{name:'Flowchart',exact:true}).click();

 // Drag, save, reload
 const node=page.getByRole('group',{name:/^Milling,/});
 const before=await node.evaluate(e=>({x:Number(e.dataset.x),y:Number(e.dataset.y)}));
 const box=await node.boundingBox();
 await page.mouse.move(box.x+30,box.y+14);await page.mouse.down();await page.mouse.move(box.x+130,box.y+60,{steps:8});await page.mouse.move(box.x+190,box.y+90,{steps:8});await page.mouse.up();
 const after=await node.evaluate(e=>({x:Number(e.dataset.x),y:Number(e.dataset.y)}));
 check('A block can be dragged on the canvas',Math.abs(after.x-before.x)>100&&Math.abs(after.y-before.y)>40,JSON.stringify({before,after}));
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
 await shot('05-flowchart-saved-desktop');
 const planRow=await db.query('SELECT s.id,s.revision FROM planning_scenarios s JOIN planning_plans p ON p.id=s.plan_id WHERE p.organisation_id=? AND p.name=?',[admin.org,'Main Street resurfacing']);
 const mainScenario=planRow[0][0].id;
 await goPlanning();await page.getByRole('button',{name:'Open'}).first().click().catch(async()=>{await page.locator('li',{hasText:'Main Street resurfacing'}).getByRole('button',{name:'Open'}).click();});
 await page.getByRole('heading',{name:'Main Street resurfacing'}).waitFor();
 await page.getByRole('group',{name:/^Milling,/}).waitFor();
 const reloaded=await page.getByRole('group',{name:/^Milling,/}).evaluate(e=>({x:Number(e.dataset.x),y:Number(e.dataset.y)}));
 check('After a full page reload the flowchart shows the saved layout, blocks and links',reloaded.x===after.x&&reloaded.y===after.y&&await page.getByTestId('plan-edge').count()===2&&await page.getByTestId('plan-node').count()===3,JSON.stringify(reloaded));
 await openNode('Milling');
 check('After reload the drawer shows the saved quantities, rate and derived duration',(await dlg().getByLabel('Quantity',{exact:true}).first().inputValue())==='1200'&&/1\.5 d/.test(await dlg().getByTestId('derived-duration').innerText())&&/\$4,710\.00/.test(await costText()));
 await closeDrawer();
 await page.getByRole('button',{name:'Relative timeline'}).click();
 const bars2=await page.locator('[data-testid=plan-timeline] li').evaluateAll(els=>els.map(e=>[e.querySelector('button')?.textContent,e.querySelector('[data-start]')?.getAttribute('data-start'),e.querySelector('[data-finish]')?.getAttribute('data-finish')].join(':')));
 check('After reload the relative timeline matches',bars2.join('|')===bars.map(b=>[b.id,b.start,b.finish].join(':')).join('|'),bars2.join('|'));
 await page.getByRole('button',{name:'Flowchart',exact:true}).click();
 const server1=(await E.get(mainScenario)).body;
 check('The server recomputes the same totals as the browser preview',server1.result.cost.total===9010&&server1.result.duration.days===3,`server total ${server1.result.cost.total}, duration ${server1.result.duration.days}`);

 // Scenarios
 await page.getByLabel('Save a copy as a new scenario').fill('Night shift option');await page.getByRole('button',{name:'New scenario'}).click();
 await page.getByText('Scenario: Night shift option').waitFor();
 await openNode('Paving');await dlg().getByTestId('requirement').nth(0).getByLabel('Resource rate').fill('2000');await closeDrawer();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
 const scenarios=(await E.get(mainScenario)).body.plan.scenarios;
 const night=scenarios.find(s=>s.name==='Night shift option');
 const baseNow=(await E.get(mainScenario)).body,nightNow=(await E.get(night.id)).body;
 check('A saved scenario is an independent copy (fresh ids): editing it leaves the base scenario untouched',baseNow.result.cost.total===9010&&nightNow.result.cost.total===9810&&!baseNow.document.activities.some(a=>nightNow.document.activities.some(b=>b.id===a.id)),`${baseNow.result.cost.total} vs ${nightNow.result.cost.total}`);
 check('Copied scenario keeps dependencies and the shared cost (counted once)',nightNow.document.dependencies.length===2&&nightNow.result.cost.sharedTotal===1000);

 // Stale save in the UI
 await page.getByLabel('Scenario',{exact:true}).selectOption({label:'Base scenario'});
 await page.getByText('Scenario: Base scenario').waitFor();
 const live=(await E.get(mainScenario)).body;
 must(await A.post({action:'save',scenarioId:mainScenario,expectedRevision:live.scenario.revision,document:{...live.document,activities:live.document.activities.map(a=>a.name==='Paving'?{...a,notes:'Changed by someone else'}:a)}}),[200],'concurrent save');
 await openNode('Preparation');await dlg().getByLabel('Activity name').fill('Preparation (my edit)');await closeDrawer();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('alert').filter({hasText:/changed elsewhere/}).first().waitFor();
 check('A stale save from the UI is refused with a clear message and the other edit survives',(await E.get(mainScenario)).body.document.activities.every(a=>a.name!=='Preparation (my edit)')&&(await E.get(mainScenario)).body.document.activities.some(a=>a.notes==='Changed by someone else'));
 await shot('06-stale-save-desktop');
 await page.getByRole('button',{name:'Discard mine and reload'}).click();await page.getByRole('group',{name:/^Preparation,/}).waitFor();

 // Approved records untouched
 must(await E.post({action:'update-plan',planId:plan1.plan.id,revision:plan1.plan.revision,name:'Contract plan (linked)'}),[200],'update plan');
 const estimateAfter=await estimateSnapshot();
 check('Scenarios and the estimate link leave the approved estimate, its revisions, projects, schedule bookings and programme untouched',estimateBefore===estimateAfter);

 // ================= Save robustness: removed activities and a failed layout save =================
 const savedOk=async()=>{await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();return !(await page.locator('main').innerText()).match(/could not be saved|changed elsewhere/);};
 const saveBtn=()=>page.getByRole('button',{name:'Save',exact:true});
 const scenarioRow=async()=>(await db.query('SELECT revision FROM planning_scenarios WHERE id=?',[mainScenario]))[0][0];
 const orphanPositions=async()=>(await db.query('SELECT COUNT(*) AS n FROM planning_canvas_positions p LEFT JOIN planning_activities a ON a.id=p.activity_id AND a.scenario_id=p.scenario_id WHERE p.scenario_id=? AND a.id IS NULL',[mainScenario]))[0][0].n;
 const nodesBefore=await page.getByTestId('plan-node').count();
 const revA=(await scenarioRow()).revision;
 await page.getByRole('button',{name:'Add activity'}).click();await dlg().waitFor();
 await dlg().getByRole('button',{name:'Remove activity'}).click();await dlg().waitFor({state:'detached'});
 await saveBtn().click();
 check('Add then remove then save succeeds (no stale position sent for the removed activity)',await savedOk()&&await page.getByTestId('plan-node').count()===nodesBefore&&Number((await scenarioRow()).revision)===Number(revA)+1&&Number(await orphanPositions())===0);
 // drag a new activity, remove it, save
 await page.getByRole('button',{name:'Add activity'}).click();await dlg().waitFor();await closeDrawer();
 const fresh2=page.getByTestId('plan-node').last();const fb=await fresh2.boundingBox();
 await page.mouse.move(fb.x+30,fb.y+14);await page.mouse.down();await page.mouse.move(fb.x+120,fb.y+80,{steps:6});await page.mouse.up();
 const freshId=await fresh2.getAttribute('data-activity-id');
 await fresh2.getByRole('button',{name:'Edit'}).click();await dlg().waitFor();await dlg().getByRole('button',{name:'Remove activity'}).click();await dlg().waitFor({state:'detached'});
 await saveBtn().click();
 check('Drag then remove then save succeeds and leaves no orphan canvas position',await savedOk()&&await page.getByTestId('plan-node').count()===nodesBefore&&Number(await orphanPositions())===0&&(await db.query('SELECT COUNT(*) AS n FROM planning_canvas_positions WHERE activity_id=?',[freshId]))[0][0].n===0);
 // business save succeeds, layout save fails once: revision is retained and a retry saves only the layout
 let failLayout=true;
 await page.route('**/api/planning',async route=>{const r=route.request();if(failLayout&&r.method()==='POST'&&/"action":"positions"/.test(r.postData()||''))return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Layout service unavailable.'})});return route.continue();});
 const revB=Number((await scenarioRow()).revision);
 await openNode('Preparation');await dlg().getByLabel('Activity name').fill('Preparation (renamed)');await closeDrawer();
 const mover=page.getByRole('group',{name:/^Paving,/});const mb=await mover.boundingBox();const mx0=Number(await mover.getAttribute('data-x'));
 await page.mouse.move(mb.x+30,mb.y+14);await page.mouse.down();await page.mouse.move(mb.x+90,mb.y+60,{steps:6});await page.mouse.up();
 const mx1=Number(await mover.getAttribute('data-x'));
 await saveBtn().click();await page.getByText(/Your changes were saved, but the layout could not be saved/).waitFor();
 const revC=Number((await scenarioRow()).revision);
 check('When the business save succeeds but the layout save fails the user is told, the business change is stored, and Save stays available for the layout',revC===revB+1&&(await db.query('SELECT name FROM planning_activities WHERE scenario_id=? AND name=?',[mainScenario,'Preparation (renamed)']))[0].length===1&&await saveBtn().isEnabled()&&await page.getByText('Unsaved changes').isVisible());
 failLayout=false;await saveBtn().click();
 check('Retrying after the layout failure succeeds with no stale-version error, saves only the layout, and does not bump the business revision',await savedOk()&&Number((await scenarioRow()).revision)===revC&&mx1!==mx0&&Number((await db.query('SELECT x FROM planning_canvas_positions p JOIN planning_activities a ON a.id=p.activity_id WHERE a.scenario_id=? AND a.name=?',[mainScenario,'Paving']))[0][0].x)===mx1);
 await page.unroute('**/api/planning');

 // ================= Precision: preview, validation and storage agree =================
 await openNode('Paving');
 const rateBox=dlg().getByTestId('requirement').nth(0).getByLabel('Resource rate');
 await rateBox.fill('95.12345');
 check('A rate with more decimal places than are stored is rejected in the UI: message shown, cost previews as Unknown, Save disabled',await dlg().getByTestId('num-problem').isVisible()&&/Activity cost: Unknown/.test(await costText())&&await saveBtn().isDisabled(),await costText());
 await rateBox.fill('95.125');
 check('A rate of 95.125 is storable and previews exactly (day basis: $95.13 once the line is rounded to cents)',!(await dlg().getByTestId('num-problem').count())&&/\$95\.13/.test(await costText()),await costText());
 await closeDrawer();await saveBtn().click();
 check('95.125 saves',await savedOk());
 await goPlanning();await page.locator('li',{hasText:'Main Street resurfacing'}).getByRole('button',{name:'Open'}).click();await page.getByRole('group',{name:/^Paving,/}).waitFor();
 await openNode('Paving');
 check('After reload the rate is still 95.125 (not changed by persistence) and the cost matches the preview',(await dlg().getByTestId('requirement').nth(0).getByLabel('Resource rate').inputValue())==='95.125'&&/\$95\.13/.test(await costText()));
 await closeDrawer();
 // server contract: exact round trips and rejections
 const prec=must(await E.post({action:'create-plan',name:'Precision plan'}),[200],'precision plan');let pr=prec.scenario.revision;const psid=prec.scenario.id;
 const pdoc=(over)=>docOf(act('prc-a00001','Precision',{durationMode:'derived',quantity:1,unit:'m',productivity:0.0004,productivityUnit:'m',hoursPerDay:8,requirements:[{id:'prc-r00001',kind:'labour',name:'Crew',quantity:1,rate:95.125,rateBasis:'hour',resourceRef:null}],costItems:[],...over}));
 const savedP=await E.post({action:'save',scenarioId:psid,expectedRevision:pr,document:pdoc({})});
 const readP=(await E.get(psid)).body;pr=readP.scenario.revision;
 check('Very small productivity (0.0004) and a $95.125 hourly rate round-trip exactly through save and reload',savedP.status===200&&readP.document.activities[0].productivity===0.0004&&readP.document.activities[0].requirements[0].rate===95.125,JSON.stringify([readP.document.activities[0].productivity,readP.document.activities[0].requirements[0].rate]));
 check('The server result equals the preview arithmetic: 1 m at 0.0004 m/h = 2,500 h = 312.5 days; 95.125 × 8 h × 312.5 d = $237,812.50',readP.result.activities['prc-a00001'].durationDays===312.5&&readP.result.cost.total===237812.5,JSON.stringify(readP.result.cost.total));
 const [[stored]]=await db.query('SELECT productivity,duration_days FROM planning_activities WHERE id=?',['prc-a00001']);
 check('The database holds the same values (no rounding in storage)',Number(stored.productivity)===0.0004);
 for(const [label,over,pattern] of [['productivity below the stored precision (0.0000004) is rejected, not stored as zero',{productivity:0.0000004},/at most 6 decimal places/],['a dollar amount with more than cents (setup 95.125) is rejected',{costItems:[{id:'prc-c00001',label:'Setup',amount:95.125}]},/at most 2 decimal places/],['a rate beyond 4 decimal places is rejected',{requirements:[{id:'prc-r00002',kind:'labour',name:'Crew',quantity:1,rate:95.12345,rateBasis:'hour',resourceRef:null}]},/at most 4 decimal places/],['a duration beyond the stored range is rejected',{durationMode:'entered',durationDays:200000},/between 0 and/]]){
  const r=await E.post({action:'save',scenarioId:psid,expectedRevision:pr,document:pdoc(over)});
  check(`Server: ${label}`,r.status===400&&pattern.test(JSON.stringify(r.body)),`-> ${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
 }
 check('Rejected precision saves left the stored plan unchanged',(await E.get(psid)).body.scenario.revision===pr);

 // Mobile
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 const mobile={};
 mobile.flow=await overflow();await shot('07-flowchart-mobile');
 await page.getByRole('button',{name:'Relative timeline'}).click();mobile.timeline=await overflow();await shot('08-timeline-mobile');
 await page.getByRole('button',{name:'Costs',exact:true}).click();mobile.costs=await overflow();await shot('09-costs-mobile');
 await page.getByRole('button',{name:'Flowchart',exact:true}).click();
 await page.getByRole('group',{name:/^Milling,/}).getByRole('button',{name:'Edit'}).click();await dlg().waitFor();mobile.drawer=await overflow();await shot('10-drawer-mobile');
 await dlg().getByRole('button',{name:'Close'}).click();
 check('Desktop and mobile (390px): no horizontal page overflow in the drawer, flowchart, timeline or costs',dm<=2&&Object.values(mobile).every(v=>v<=2),JSON.stringify({desktopDrawer:dm,...mobile}));
 check('Flowchart is reachable on mobile (the canvas scrolls inside its own frame)',await page.getByTestId('plan-canvas').evaluate(e=>e.parentElement.scrollWidth>=e.parentElement.clientWidth));
 check('No page errors during the whole run',pageErrors.filter(e=>!/favicon|ResizeObserver/.test(e)).length===0,pageErrors.slice(0,2).join(' | '));
 const [cols]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'planning\\\\_%'");
 const [noOrg]=await db.query("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'planning\\\\_%' AND COLUMN_NAME='organisation_id'");
 check('Migration 0026: all eight planning tables exist and each carries organisation_id',cols.length===8&&noOrg.length===8,`${cols.length} tables, ${noOrg.length} with organisation_id`);
}catch(error){record('Journey aborted','fail',String(error?.stack||error).slice(0,700));}
finally{
 await browser?.close().catch(()=>{});server.kill();s3.close();await db.end();
 const failed=results.filter(r=>r.status==='fail').length;
 writeFileSync(`${OUT}/report.json`,JSON.stringify({results,failed},null,1));
 console.log(`\n${results.filter(r=>r.status==='pass').length} passed, ${failed} failed. Report and screenshots: ${OUT}`);
 process.exit(failed?1:0);
}
