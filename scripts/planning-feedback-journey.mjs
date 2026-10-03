// Planning save-feedback, mobile summary and layout-compatibility acceptance run (390px and desktop), with real failures
// forced in the browser. Synthetic data only; email disabled; the disposable *_test database named by MYSQL_DATABASE must be empty.
//   npm run build   then   MYSQL_DATABASE=feedback_test node scripts/planning-feedback-journey.mjs [outputDir]
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_PATH, PORT (default 3189). Results are pass/fail; nothing is silently skipped.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {connect} from './mysql-config.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
const PORT=Number(process.env.PORT||3189),base=`http://localhost:${PORT}`,OUT=process.argv[2]||'/tmp/planning-feedback';
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
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'feedback-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:base,R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET_NAME:'test-bucket'};
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
const req=(id,kind,name,quantity,rate,resourceRef=null)=>({id,kind,name,quantity,rate,rateBasis:'hour',resourceRef});
const act=(id,name,over={})=>({id,kind:'activity',name,notes:'',quantity:null,unit:null,productivity:null,productivityUnit:null,durationMode:'entered',durationDays:2,hoursPerDay:8,plannedStart:null,requirements:[],costItems:[],sharedCostIds:[],...over});
const docOf=(...activities)=>({activities,dependencies:[],sharedCosts:[]});
let browser;
try{

 // ================= Setup =================
 const admin=await signup('fb-admin');
 const est=await signup('fb-estimator');await db.query('UPDATE users SET organisation_id=?,role=? WHERE id=?',[admin.org,'estimator',est.id]);
 const E=planning(est.cookie);
 const LONG='Remove existing wearing course and profile the full carriageway width including the intersection approaches and the kerb returns on both sides';
 const planned=must(await E.post({action:'create-plan',name:'Feedback plan'}),[200],'create plan');
 const sid=planned.scenario.id;
 const many=[req('fb-r0001','labour','Paving crew',3,66),req('fb-r0002','plant','Paver',1,230),req('fb-r0003','labour','Casual labour',2,45),req('fb-r0004','plant','Roller',1,120),req('fb-r0005','labour','Traffic controller',2,52),req('fb-r0006','plant','Water cart',1,80)];
 const baseline=docOf(act('fb-a0001','Paving',{requirements:many}),act('fb-a0002',LONG,{requirements:[req('fb-r0007','labour','Profiler crew',4,70)]}));
 must(await E.post({action:'save',scenarioId:sid,expectedRevision:planned.scenario.revision,document:baseline}),[200],'baseline');
 const dbRev=async()=>Number((await db.query('SELECT revision FROM planning_scenarios WHERE id=?',[sid]))[0][0].revision);
 const dbName=async()=>(await db.query('SELECT name FROM planning_activities WHERE id=?',['fb-a0001']))[0][0]?.name;
 record('Setup: estimator, plan with an activity of six resources and an activity with a 140-character name','pass','synthetic data in the *_test database');

 browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
 const cookies=who=>who.cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};});
 const session=async(viewport)=>{const ctx=await browser.newContext({viewport});ctx.setDefaultTimeout(20000);await ctx.addCookies(cookies(est));const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));return {ctx,page,errors};};
 const goPlan=async(page,viewport)=>{await page.setViewportSize({width:1440,height:1100});await page.goto(base+'/');await page.waitForTimeout(2500);const nav=page.locator('aside');if(await nav.count()&&await nav.first().isVisible().catch(()=>false)){await nav.getByText('Pipeline',{exact:true}).first().click();await page.waitForTimeout(800);await page.getByRole('button',{name:'Planning',exact:true}).first().click().catch(()=>{});}
  await page.getByText('Planning',{exact:true}).first().click().catch(()=>{});
  await page.locator('li',{hasText:'Feedback plan'}).getByRole('button',{name:'Open'}).click();await page.getByRole('heading',{name:'Feedback plan'}).waitFor();if(viewport)await page.setViewportSize(viewport);await page.waitForTimeout(400);};
 const dlg=page=>page.getByRole('dialog');
 const alerts=page=>page.locator('[role=alert]:not(#__next-route-announcer__)');
 const txt=async l=>(await l.count())?l.first().innerText():'';
 const inView=async(page,loc)=>{if(!(await loc.count()))return false;const b=await loc.boundingBox(),v=page.viewportSize();return Boolean(b)&&b.x>=-1&&b.y>=-1&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1;};
 const guard=page=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
 const M={width:390,height:844};
 const openPavingMobile=async page=>{await page.getByRole('group',{name:/^Paving,/}).getByRole('button',{name:/^(Edit|View)$/}).click();await dlg(page).waitFor();};
 const bodies=[];
 const track=page=>page.route('**/api/planning',async route=>{const r=route.request();if(r.method()==='POST'){try{bodies.push(JSON.parse(r.postData()||'{}'));}catch{bodies.push({});}}await route.fallback();});

 // ================= A. Forced save failure (390px) =================
 {const {ctx,page,errors}=await session(M);await goPlan(page,M);await track(page);
  await openPavingMobile(page);const name=dlg(page).getByLabel('Activity name');await name.fill('Paving edited');
  check('A: editing shows the pending state inside the open panel',await dlg(page).getByText('Edits not saved yet').isVisible());
  await page.route('**/api/planning',r=>r.request().method()==='POST'&&/"action":"save"/.test(r.request().postData()||'')?r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Forced save failure'})}):r.fallback());
  const revBefore=await dbRev();
  await dlg(page).getByRole('button',{name:'Save changes'}).click();
  const alert=dlg(page).getByRole('alert');await alert.waitFor({timeout:4000}).catch(()=>{});
  await page.screenshot({path:`${OUT}/A-forced-failure-mobile.png`});
  check('A: the failure is visible inside the open panel and within the 390px viewport',/Forced save failure/.test(await txt(alert))&&await inView(page,alert),await txt(alert));
  check('A: the message says nothing was saved and the edits are retained',/Nothing was saved/.test(await dlg(page).innerText())&&await name.inputValue()==='Paving edited'&&await dbRev()===revBefore&&await dbName()==='Paving');
  check('A: no duplicate message: exactly one alert on the page and the page itself shows none',await alerts(page).count()===1);
  check('A: Save changes is still available to retry',await dlg(page).getByRole('button',{name:'Save changes'}).isEnabled());
  check('A: the unsaved-changes guard is active',await guard(page)===true);
  await page.unroute('**/api/planning');await track(page);
  await dlg(page).getByRole('button',{name:'Save changes'}).click();await dlg(page).getByRole('status').filter({hasText:'Saved.'}).waitFor({timeout:6000}).catch(()=>{});
  check('A: retrying succeeds, the error clears, the value is saved and the guard clears',await dlg(page).getByRole('alert').count()===0&&await dbName()==='Paving edited'&&await guard(page)===false);
  check('A: no page errors',errors.length===0);await ctx.close();}
 await E.post({action:'save',scenarioId:sid,expectedRevision:await dbRev(),document:baseline});

 // ================= B. Stale revision (390px) =================
 {const {ctx,page,errors}=await session(M);await goPlan(page,M);
  await openPavingMobile(page);await dlg(page).getByLabel('Activity name').fill('Mine');
  const other=docOf(act('fb-a0001','Changed by someone else',{requirements:many}),baseline.activities[1]);
  must(await E.post({action:'save',scenarioId:sid,expectedRevision:await dbRev(),document:other}),[200],'concurrent save');
  await dlg(page).getByRole('button',{name:'Save changes'}).click();
  const alert=dlg(page).getByRole('alert');await alert.waitFor({timeout:4000}).catch(()=>{});await page.screenshot({path:`${OUT}/B-stale-mobile.png`});
  const recover=dlg(page).getByRole('button',{name:'Discard mine and reload'});
  check('B: the stale-conflict message and its recovery action are visible inside the open panel at 390px',/changed elsewhere/.test(await txt(alert))&&await recover.isVisible()&&await inView(page,recover));
  check('B: the other change was not overwritten and my edit is still in the form',await dbName()==='Changed by someone else'&&await dlg(page).getByLabel('Activity name').inputValue()==='Mine');
  check('B: a single alert only (no duplicate generic error)',await alerts(page).count()===1);
  if(await recover.count()){await recover.click();await page.waitForFunction(()=>document.querySelector('[role=dialog] [aria-label="Activity name"]')?.value==='Changed by someone else',null,{timeout:6000}).catch(()=>{});}
  check('B: recovering reloads the latest saved scenario, drops my edit, clears the alert and the guard',await dlg(page).getByRole('alert').count()===0&&await guard(page)===false);
  check('B: no page errors',errors.length===0);await ctx.close();}
 await E.post({action:'save',scenarioId:sid,expectedRevision:await dbRev(),document:baseline});

 // ================= C. Business saved, layout failed (390px) =================
 {const {ctx,page,errors}=await session(M);await goPlan(page,M);await track(page);
  await page.getByRole('button',{name:'Canvas',exact:true}).click();
  const node=page.getByRole('group',{name:/^Paving,/});const b=await node.boundingBox();
  await page.mouse.move(b.x+60,b.y+20);await page.mouse.down();await page.mouse.move(b.x+90,b.y+60,{steps:5});await page.mouse.up();
  await node.getByRole('button',{name:/^(Edit|View)$/}).click();await dlg(page).waitFor();await dlg(page).getByLabel('Activity name').fill('Paving moved');
  const positionsBefore=JSON.stringify((await db.query('SELECT * FROM planning_canvas_positions WHERE scenario_id=?',[sid]).catch(()=>[[]]))[0]);
  bodies.length=0;let failLayout=true;
  await page.route('**/api/planning',r=>{const d=r.request().postData()||'';return failLayout&&r.request().method()==='POST'&&/"action":"positions"/.test(d)?r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Forced layout failure'})}):r.fallback();});
  const revStart=await dbRev();
  await dlg(page).getByRole('button',{name:'Save changes'}).click();
  const alert=dlg(page).getByRole('alert');await alert.waitFor({timeout:4000}).catch(()=>{});await page.screenshot({path:`${OUT}/C-partial-mobile.png`});
  const text=await txt(alert);
  check('C: the panel says the changes were saved but the layout was not, and the layout is the only thing pending',/Your changes were saved, but the layout could not be saved/.test(text)&&/Forced layout failure/.test(text)&&/only the node positions are pending/.test(text)&&await inView(page,alert),text);
  check('C: it is not reported as a complete failure: no "Nothing was saved", one alert only',!/Nothing was saved/.test(await dlg(page).innerText())&&await alerts(page).count()===1);
  check('C: the business data really is saved and the revision advanced once',await dbName()==='Paving moved'&&await dbRev()===revStart+1,`rev ${revStart}→${await dbRev()}`);
  const retry=dlg(page).getByRole('button',{name:'Retry layout save'});
  check('C: a layout retry action is visible and the guard stays on while the layout is pending',await retry.isVisible()&&await inView(page,retry)&&await guard(page)===true);
  failLayout=false;bodies.length=0;if(await retry.count())await retry.click();await dlg(page).getByRole('status').filter({hasText:'Saved.'}).waitFor({timeout:6000}).catch(()=>{});
  check('C: the retry sends only the layout (no second business save) against the revision it returned, with no stale-version error',bodies.length===1&&bodies[0].action==='positions'&&!('document' in bodies[0])&&await dbRev()===revStart+1,JSON.stringify(bodies.map(x=>x.action)));
  check('C: afterwards the alert is gone, the layout is stored and the guard is clear',await dlg(page).getByRole('alert').count()===0&&await guard(page)===false&&JSON.stringify((await db.query('SELECT * FROM planning_canvas_positions WHERE scenario_id=?',[sid]).catch(()=>[[]]))[0])!==positionsBefore);
  check('C: no page errors',errors.length===0);await ctx.close();}
 await E.post({action:'save',scenarioId:sid,expectedRevision:await dbRev(),document:baseline});

 // ================= D. Mobile summary sheet (390px) =================
 {const {ctx,page,errors}=await session(M);await goPlan(page,M);
  await page.getByRole('button',{name:'Select Paving'}).click();const sheet=page.getByTestId('plan-inspector');await sheet.waitFor();
  const openBtn=sheet.getByRole('button',{name:'Open details'});await openBtn.scrollIntoViewIfNeeded();
  check('D: with six resources the summary scrolls inside itself and Open details is reachable, tappable and inside the viewport',await inView(page,openBtn)&&(await sheet.boundingBox()).height<=844*0.6,JSON.stringify(await sheet.boundingBox()));
  await page.screenshot({path:`${OUT}/D-sheet-open-details-mobile.png`});
  await openBtn.click();await dlg(page).waitFor();check('D: Open details opens the detail panel',await dlg(page).getByLabel('Activity name').isVisible()&&await page.getByTestId('plan-inspector').count()===0);
  await dlg(page).getByRole('button',{name:'Close'}).click();await dlg(page).waitFor({state:'detached'});
  check('D: closing returns to the page with the summary available again',await page.getByTestId('plan-inspector').isVisible());
  await page.getByRole('button',{name:'Collapse summary'}).click();await page.waitForTimeout(250);
  const compact=await page.getByTestId('plan-inspector').boundingBox();
  check('D: collapsing leaves a compact bar (under 130px) and expanding restores the summary',compact.height<150&&(await page.getByRole('button',{name:'Expand summary'}).isVisible()));
  await page.screenshot({path:`${OUT}/D-sheet-collapsed-mobile.png`});
  await page.getByRole('button',{name:'Relative timeline'}).click();await page.getByTestId('plan-timeline').waitFor();
  check('D: with the summary collapsed the underlying controls (view tabs) work',true);
  await page.getByRole('button',{name:'Flowchart',exact:true}).click();
  await page.getByRole('button',{name:'Expand summary'}).click();await page.waitForTimeout(250);
  check('D: expanding again shows the full summary',await page.getByRole('button',{name:'Collapse summary'}).isVisible()&&await sheet.getByRole('button',{name:'Open details'}).count()===1);
  await page.getByRole('button',{name:'Deselect activity'}).click();await page.getByTestId('plan-inspector').waitFor({state:'detached'});
  check('D: deselecting removes the sheet and the page controls are fully usable',await page.getByRole('button',{name:'Add activity'}).isVisible()&&await inView(page,page.getByRole('button',{name:'Relative timeline'})));
  // long name
  await page.getByRole('button',{name:/^Select Remove existing wearing course/}).click();await page.getByTestId('plan-inspector').waitFor();
  const long=page.getByTestId('plan-inspector');const lb=await long.boundingBox();const ov=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  await long.getByRole('button',{name:'Open details'}).scrollIntoViewIfNeeded();
  check('D: a 140-character name wraps inside the sheet (no horizontal overflow) and Open details is still reachable',ov<=2&&await inView(page,long.getByRole('button',{name:'Open details'}))&&lb.width<=390,`overflow ${ov}`);
  await page.screenshot({path:`${OUT}/D-sheet-long-name-mobile.png`});
  check('D: no page errors',errors.length===0);await ctx.close();}

 // ================= E. Dirty guard clears after discard =================
 {const {ctx,page,errors}=await session({width:1440,height:1100});await goPlan(page);
  await page.getByRole('group',{name:/^Paving,/}).getByRole('button',{name:'Edit'}).click();await dlg(page).waitFor();await dlg(page).getByLabel('Activity name').fill('Temp');
  check('E: the guard is active while edits are pending',await guard(page)===true);
  await dlg(page).getByRole('button',{name:'Close'}).click();await page.getByRole('button',{name:'Discard changes'}).click();await page.getByText('Unsaved changes').waitFor({state:'detached'});
  check('E: discarding clears the guard',await guard(page)===false);check('E: no page errors',errors.length===0);await ctx.close();}

 // ================= F. Earlier 124px row spacing against the 140px cards =================
 {const old=must(await E.post({action:'create-plan',name:'Old layout plan'}),[200],'old plan');const osid=old.scenario.id;
  const d3=docOf(act('ol-a0001','Milling'),act('ol-a0002','Preparation'),act('ol-a0003','Paving'));
  must(await E.post({action:'save',scenarioId:osid,expectedRevision:old.scenario.revision,document:d3}),[200],'old save');
  const stored={'ol-a0001':{x:24,y:24},'ol-a0002':{x:24,y:148},'ol-a0003':{x:24,y:272},};
  must(await E.post({action:'positions',scenarioId:osid,positions:stored}),[200],'old positions');
  const {ctx,page,errors}=await session({width:1440,height:1100});await goPlan(page);await page.getByRole('button',{name:'Back to plans'}).click().catch(()=>{});
  await page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('button',{name:'Planning'}).click();
  await page.locator('li',{hasText:'Old layout plan'}).getByRole('button',{name:'Open'}).click();await page.getByRole('heading',{name:'Old layout plan'}).waitFor();
  const rects=async()=>page.getByTestId('plan-node').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.activityId,x:n.dataset.x,y:n.dataset.y,top:r.top,bottom:r.bottom,left:r.left,right:r.right};}));
  const overlap=rs=>rs.some((a,i)=>rs.some((b,j)=>j>i&&a.left<b.right&&b.left<a.right&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5));
  let rs=await rects();await page.screenshot({path:`${OUT}/F-old-layout-desktop.png`});
  check('F: cards in a layout saved with 124px row spacing do not overlap',!overlap(rs),JSON.stringify(rs.map(r=>[r.y,Math.round(r.bottom-r.top)])));
  check('F: stored positions are unchanged (x and y read back exactly)',rs.every(r=>r.x==='24'&&r.y===String(stored[r.id].y)));
  const after=(await E.get(osid)).body;check('F: nothing was rewritten in storage: the saved positions are still exactly the stored ones',Object.entries(stored).every(([id,p])=>after.positions[id]?.x===p.x&&after.positions[id]?.y===p.y)&&Object.keys(after.positions).length===3,JSON.stringify(after.positions));
  check('F: the page is not marked as having unsaved changes just from displaying it',await page.getByText('Unsaved changes').count()===0);
  // drag still works and only moves the dragged node
  const n2=page.getByRole('group',{name:/^Preparation,/});const b2=await n2.boundingBox();
  await page.mouse.move(b2.x+40,b2.y+15);await page.mouse.down();await page.mouse.move(b2.x+340,b2.y+15,{steps:6});await page.mouse.up();
  rs=await rects();const prep=rs.find(r=>r.id==='ol-a0002'),mill=rs.find(r=>r.id==='ol-a0001');
  check('F: dragging still moves a card and leaves the others at their stored positions',Number(prep.x)>=300&&mill.x==='24'&&mill.y==='24'&&await page.getByText('Unsaved changes').isVisible(),JSON.stringify([prep.x,prep.y,mill.x,mill.y]));
  await page.getByRole('button',{name:'Discard changes'}).click();await page.getByText('Unsaved changes').waitFor({state:'detached'});
  // roomy layout keeps full-size cards
  const roomy={'ol-a0001':{x:24,y:24},'ol-a0002':{x:24,y:192},'ol-a0003':{x:24,y:360}};
  must(await E.post({action:'positions',scenarioId:osid,positions:roomy}),[200],'roomy');await page.reload();await page.waitForTimeout(2500);
  await page.getByRole('heading',{name:'Planning'}).first().waitFor().catch(()=>{});
  check('F: no page errors',errors.length===0);await ctx.close();}
}catch(e){console.error(e.stack||e);record('Harness ran to completion','fail',String(e.message).slice(0,300));}
finally{await browser?.close();server.kill();s3.close();await db.end();const failed=results.filter(x=>x.status==='fail').length;console.log(`\n${results.length-failed} passed, ${failed} failed`);process.exit(failed?1:0);}
