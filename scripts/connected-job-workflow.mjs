// Connected-job acceptance run: drives the EXISTING UI through one synthetic job and checks the boundaries around it.
//   Estimate -> approval -> award -> project -> programme activity with saved costing assumptions -> uploaded, reviewed
//   dockets -> actual cost -> separately agreed client charge -> claim approval and client-review PDF.
// It supplements, and does not replace, `npm test`, `test:mysql` and `test:v1`. Synthetic data only; the app runs with email
// disabled and every user is created in the disposable *_test database named by MYSQL_DATABASE (which must be empty).
//
//   npm run build && npm run db:migrate   (against the disposable database)
//   MYSQL_DATABASE=rc_test node scripts/connected-job-workflow.mjs [outputDir]
//
// Optional environment: PLAYWRIGHT_MODULE (path to the playwright package), CHROMIUM_PATH, PORT (default 3187),
//   PDFJS_DIR (an unpacked pdfjs-dist@6.3.289 `package` directory) so PDF upload and PDF text checks can run offline,
//   TESSERACT_ROOT (directory holding tesseract.js-7.0.0, tesseract.js-core-7.0.0 and tesseract.js-data-eng-1.0.0 unpacked npm packages)
//   for the scanned-image check. Steps whose inputs are missing are reported "not run", never silently passed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {connect} from './mysql-config.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
const PORT=Number(process.env.PORT||3187),base=`http://localhost:${PORT}`,OUT=process.argv[2]||'/tmp/connected-job-workflow';
mkdirSync(OUT,{recursive:true});
const loadPlaywright=()=>{for(const p of [process.env.PLAYWRIGHT_MODULE,'playwright','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){try{return require(p);}catch{/* try next */}}throw new Error('Playwright is not available: set PLAYWRIGHT_MODULE');};
const {chromium}=loadPlaywright();
const CHROMIUM=process.env.CHROMIUM_PATH||['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const {PDFDocument,StandardFonts}=require('pdf-lib');
const PDFJS_DIR=process.env.PDFJS_DIR&&existsSync(process.env.PDFJS_DIR+'/legacy/build/pdf.mjs')?process.env.PDFJS_DIR:null;
const TESS=process.env.TESSERACT_ROOT&&existsSync(process.env.TESSERACT_ROOT+'/tesseract.js-7.0.0/package/dist/tesseract.min.js')?process.env.TESSERACT_ROOT:null;

const results=[];
const record=(step,status,detail='')=>{results.push({step,status,detail});console.log(`${status.toUpperCase().padEnd(7)} ${step}${detail?' — '+detail:''}`);};
const check=(step,condition,detail='')=>{record(step,condition?'pass':'fail',detail);return Boolean(condition);};
const notRun=(step,why)=>record(step,'not-run',why);

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
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'connected-job-secret-with-32-characters!!',BETTER_AUTH_URL:base,R2_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET_NAME:'test-bucket'};
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
if(migrated.status!==0)throw new Error('migrations failed: '+migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}

const stamp=Date.now(),password='Very-strong-test-password-42';
const signup=async(name,org)=>{const email=`${name}-${stamp}@example.invalid`;let r;for(let attempt=0;attempt<6;attempt++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,(Number(r.headers.get('retry-after'))||10)*1000));}
 const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]);const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);
 if(!u)throw new Error(`sign-up for ${name} failed: ${r.status} ${(await r.text()).slice(0,300)}`);
 return {id:u.id,email,cookies,cookie:cookies.join('; '),org:u.organisation_id};};
const api=cookie=>async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json};};
const must=(r,codes,label)=>{if(!codes.includes(r.status))throw new Error(`${label} -> ${r.status} ${JSON.stringify(r.body).slice(0,300)}`);return r.body;};
const today=new Date().toISOString().slice(0,10);

let browser;
try{
 // ================= Setup (API): people, client, opportunity, tender, bid decision, estimate items =================
 const admin=await signup('rc-admin'),a=api(admin.cookie);
 must(await a('/api/platform/onboarding','PUT',{legal_name:'RC Civil Pty Ltd',trading_name:'RC Civil',abn:'51 824 753 556',business_activities:['Civil construction'],operating_regions:['NSW'],workforce_size:'21–50',onboarding_step:4,complete:true}),[200],'onboarding');
 const members={};
 for(const [name,role] of [['rc-site','site_engineer'],['rc-field','field'],['rc-scheduler','scheduler'],['rc-readonly','read_only']]){const m=await signup(name);await db.query('UPDATE users SET organisation_id=?,role=? WHERE id=?',[admin.org,role,m.id]);members[role]=m;}
 const other=await signup('rc-other-org');const b=api(other.cookie);
 must(await b('/api/platform/onboarding','PUT',{legal_name:'Other Civil Pty Ltd',trading_name:'Other Civil',abn:'51 824 753 556',business_activities:['Civil construction'],operating_regions:['NSW'],workforce_size:'21–50',onboarding_step:4,complete:true}),[200],'other onboarding');
 const client=must(await a('/api/platform/clients','POST',{action:'create',client:{name:'Example Builder Group',contactName:'Pat Lee',site:{name:'Sample Road',address:'1 Sample Rd, Testville NSW 2000'}}}),[201],'client').client;
 const opp=must(await a('/api/registers/opportunities','POST',{values:{name:'RC Sample Road Upgrade',client_id:client.id,site_id:client.sites[0].id,estimated_value:90000,probability:70,closing_date:'2099-01-15'}}),[201],'opportunity').record;
 must(await a('/api/registers/opportunities','PATCH',{id:opp.id,transition:'qualified'}),[200],'qualify');
 const {tenderId}=must(await a('/api/tenders/register','POST',{opportunityId:opp.id}),[201],'tender');
 must(await a('/api/tenders/workspace','POST',{action:'bid-review',id:tenderId,values:{strategic_fit:'Core client',capacity:'Crew available',recommendation:'bid',recommendation_reason:'Fit'}}),[200],'bid review');
 must(await a('/api/tenders/workspace','POST',{action:'bid-decision',id:tenderId,decision:'bid',reason:'Fit'}),[200],'bid decision');
 const {estimateId}=must(await a('/api/tenders/workspace','POST',{action:'create-estimate',id:tenderId,mode:'general'}),[200],'create estimate');
 const est=must(await a('/api/estimates?id='+estimateId),[200],'get estimate').estimate;
 const items=[{id:'i1',section:'Drainage',costCode:'100',category:'labour',description:'Pipe laying crew',quantity:120,unit:'m',productivity:10,rateBasis:'hour',rate:95},{id:'i2',section:'Drainage',costCode:'300',category:'material',description:'375mm RCP',quantity:120,unit:'m',productivity:0,rateBasis:'unit',rate:180},{id:'i3',section:'Drainage',costCode:'200',category:'plant',description:'Excavator hire',quantity:12,unit:'h',productivity:0,rateBasis:'unit',rate:210}];
 must(await a('/api/estimates','PUT',{id:estimateId,data:{...est.data,clientName:'Example Builder Group',projectName:'RC Sample Road Upgrade',workType:'Drainage',items,marginValue:15,overheadsPct:8,contingencyPct:3}}),[200],'save estimate');
 record('Setup (API scaffolding): users in two organisations, client, opportunity, tender, bid decision, priced estimate','pass','email disabled; synthetic users exist only in the *_test database');

 browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1100}});ctx.setDefaultTimeout(20000);
 await ctx.addCookies(admin.cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));
 if(PDFDJS()||TESS)await ctx.route(/cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com/,route=>{const f=localAsset(route.request().url());if(f&&existsSync(f)){const type=f.endsWith('.wasm')?'application/wasm':f.endsWith('.gz')?'application/gzip':'text/javascript';return route.fulfill({status:200,body:readFileSync(f),headers:{'content-type':type,'access-control-allow-origin':'*'}});}return route.abort();});
 const page=await ctx.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
 const shot=(name)=>page.screenshot({path:`${OUT}/${name}.png`});
 const nav=async(section,sub)=>{await page.locator('aside').getByText(section,{exact:true}).first().click();await page.waitForTimeout(1200);if(sub){await page.locator('aside').getByText(sub,{exact:true}).first().click({timeout:5000}).catch(()=>page.locator('main button:visible',{hasText:sub}).first().click());await page.waitForTimeout(1500);}};
 await page.goto(base+'/');await page.waitForTimeout(3000);

 // ================= 1. Estimate -> approval (UI) =================
 await nav('Pipeline','Tenders');await page.getByText('RC Sample Road Upgrade').first().click();await page.waitForTimeout(2000);
 await page.getByRole('button',{name:'Submit for review'}).click();await page.waitForTimeout(1500);
 await page.getByRole('button',{name:'Approve revision'}).first().click();await page.waitForTimeout(800);
 const dlg=page.getByRole('dialog');await dlg.locator('textarea').fill('Checked rates and quantities').catch(()=>{});await dlg.getByRole('button',{name:'Approve revision'}).click();await page.waitForTimeout(2000);
 let approval=must(await a('/api/estimates/approval?estimateId='+estimateId),[200],'approval');
 const baseline={directCost:approval.revisions[0].directCost,sellPrice:approval.revisions[0].sellPrice,revisionId:approval.revisions[0].id};
 check('Estimate submitted and approved through the UI',approval.state==='approved'&&baseline.directCost===25260,`direct cost ${baseline.directCost}, sell ${baseline.sellPrice}`);
 await shot('01-estimate-approved');

 // ================= 2. Tender approval/submission (API; UI exists) -> award (UI) -> project =================
 must(await a('/api/tenders/workspace','POST',{action:'request-approval',id:tenderId}),[200],'request approval');
 must(await a('/api/tenders/workspace','POST',{action:'approval-decision',id:tenderId,approve:true,notes:'Approved to submit'}),[200],'tender approval');
 must(await a('/api/tenders/workspace','POST',{action:'submit',id:tenderId,method:'Client portal',version:'Rev A',notes:'Sent'}),[200],'submit');
 record('Tender approval and submission (API-driven here; the Approval and Submission tabs exist in the UI)','pass');
 await page.reload();await page.waitForTimeout(2500);await nav('Pipeline','Tenders');await page.getByText('RC Sample Road Upgrade').first().click();await page.waitForTimeout(2000);
 await page.getByRole('button',{name:/Award/}).first().click();await page.waitForTimeout(1200);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Record award and create project'}).click();await page.waitForTimeout(3500);
 const tender=must(await a('/api/tenders/workspace?id='+tenderId),[200],'tender').tender;const projectId=tender.projectId;
 check('Award through the UI created the project from the approved estimate',tender.stage==='awarded'&&Boolean(projectId));
 const [[job]]=await db.query('SELECT contract_value,original_budget,source_estimate_revision_id FROM jobs WHERE id=?',[projectId]);
 check('Project baseline equals the approved estimate revision',Number(job.contract_value)===baseline.sellPrice&&job.source_estimate_revision_id===baseline.revisionId,`contract ${job.contract_value}`);
 await shot('02-awarded');

 // ================= 3. Programme activity and saved costing assumptions (UI) =================
 await nav('Projects');await page.getByText('RC Sample Road Upgrade').first().click();await page.waitForTimeout(2200);
 await page.getByRole('tab',{name:/Programme/}).click().catch(()=>page.getByText('Programme',{exact:true}).last().click());await page.waitForTimeout(2000);
 const form=page.getByRole('form',{name:'Add activity'});
 await form.getByLabel('New activity').fill('Pipe laying');await form.getByLabel('Start').fill('2026-10-05');await form.getByLabel('Days').fill('3');await form.getByRole('button',{name:/Add/}).click();await page.waitForTimeout(1800);
 await form.getByLabel('New activity').fill('Backfill');await form.getByLabel('Start').fill('2026-10-08');await form.getByLabel('Days').fill('2');await form.getByRole('button',{name:/Add/}).click();await page.waitForTimeout(1800);
 await page.getByRole('button',{name:'List'}).click().catch(()=>{});await page.waitForTimeout(800);
 const programme=async()=>must(await a('/api/projects/program?projectId='+projectId),[200],'programme').activities;
 await page.getByRole('button',{name:/Details/}).first().click();await page.waitForTimeout(1200);
 const dr=page.getByRole('dialog',{name:/Activity details/}),status=()=>dr.getByRole('status').first().innerText().then(t=>t.replace(/\n/g,' '));
 await dr.getByLabel('Planned quantity').fill('120');await dr.getByLabel('Quantity unit',{exact:true}).first().fill('m');await dr.getByLabel('Production per working day').fill('40');
 await dr.getByLabel('Productive hours per working day').fill('8');await dr.getByLabel('Direct cost rate (AUD)').fill('95');
 await dr.getByLabel('Approved estimate item reference').selectOption({label:'Pipe laying crew (m)'});
 const p120=await status();await dr.getByLabel('Planned quantity').fill('200');const p200=await status();await dr.getByLabel('Planned quantity').fill('120');
 check('Cost preview follows the proposed inputs',/Planned direct cost: \$2,280\.00/.test(p120)&&/\$3,800\.00/.test(p200),`${p120.match(/Planned direct cost: \S+/)?.[0]} -> ${p200.match(/Planned direct cost: \S+/)?.[0]} at 200 m`);
 await shot('03-programme-drawer');
 await dr.getByRole('button',{name:'Save details'}).click();await page.waitForTimeout(1800);
 let acts=await programme();const pl=acts.find(x=>x.name==='Pipe laying');
 check('Costing assumptions saved with the activity',Number(pl.planned_quantity)===120&&Number(pl.productive_hours_per_day)===8&&Number(pl.direct_cost_rate)===95&&Boolean(pl.source_estimate_item_id),`revision ${pl.revision}`);
 // cancel discards; reload reopens the saved values
 if(!(await page.getByRole('dialog',{name:/Activity details/}).count()))await page.getByRole('button',{name:/Details/}).first().click();await page.waitForTimeout(800);
 const dr2=page.getByRole('dialog',{name:/Activity details/});await dr2.getByLabel('Planned quantity').fill('999');await dr2.getByLabel('Direct cost rate (AUD)').fill('1');await page.keyboard.press('Escape');await page.waitForTimeout(700);
 if(await page.getByRole('dialog',{name:/Activity details/}).count())await page.mouse.click(10,10);
 acts=await programme();const afterCancel=acts.find(x=>x.name==='Pipe laying');
 check('Cancelling the drawer leaves the saved activity unchanged',Number(afterCancel.planned_quantity)===120&&Number(afterCancel.direct_cost_rate)===95&&afterCancel.revision===pl.revision);
 await page.reload();await page.waitForTimeout(3000);await nav('Projects');await page.getByText('RC Sample Road Upgrade').first().click();await page.waitForTimeout(2200);
 await page.getByRole('tab',{name:/Programme/}).click().catch(()=>page.getByText('Programme',{exact:true}).last().click());await page.waitForTimeout(1800);
 await page.getByRole('button',{name:'List'}).click().catch(()=>{});await page.getByRole('button',{name:/Details/}).first().click();await page.waitForTimeout(1200);
 const reopened=await page.getByRole('dialog',{name:/Activity details/}).getByLabel('Planned quantity').inputValue();
 check('Saved activity reopens after a full page reload',reopened==='120');await page.keyboard.press('Escape');
 const staleActivity=await a('/api/projects/program','POST',{projectId,id:pl.id,revision:pl.revision-1,name:'Pipe laying',startDate:'2026-10-05',durationDays:3,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',plannedQuantity:1,quantityUnit:'m',productionPerDay:1,status:'planned'});
 check('A stale programme edit is refused',staleActivity.status===409,`-> ${staleActivity.status}`);
 const backfill=(await programme()).find(x=>x.name==='Backfill');
 check('An activity without costing assumptions keeps cost rate and hours unknown (null), not zero',backfill.direct_cost_rate===null&&backfill.productive_hours_per_day===null&&Number(backfill.planned_quantity)===0,JSON.stringify({rate:backfill.direct_cost_rate,hours:backfill.productive_hours_per_day,qty:backfill.planned_quantity}));
 approval=must(await a('/api/estimates/approval?estimateId='+estimateId),[200],'approval');
 check('Approved estimate baseline is unchanged by programme work',approval.revisions[0].directCost===baseline.directCost&&approval.revisions[0].sellPrice===baseline.sellPrice);
 const estLocked=await a('/api/estimates','PUT',{id:estimateId,data:{...est.data,items:[{...items[0],rate:1}]}});
 // Editing an approved estimate is allowed only as a NEW working revision; the approved revision itself is immutable.
 const afterEdit=must(await a('/api/estimates/approval?estimateId='+estimateId),[200],'approval after edit');
 const approvedRev=afterEdit.revisions.find(r=>r.id===baseline.revisionId);
 check('Approved estimate revision is protected from edits',estLocked.status!==200||(approvedRev&&approvedRev.directCost===baseline.directCost&&approvedRev.sellPrice===baseline.sellPrice),`PUT -> ${estLocked.status}; approved revision still direct ${approvedRev?.directCost}, sell ${approvedRev?.sellPrice}; estimate state now ${afterEdit.state}`);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 await page.getByRole('button',{name:/Details/}).first().click().catch(()=>{});await page.waitForTimeout(800);await shot('04-programme-drawer-mobile');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);check('Programme drawer has no horizontal overflow at 390px',overflow<=2,`${overflow}px`);
 await page.keyboard.press('Escape');await page.waitForTimeout(400);if(await page.getByRole('dialog',{name:/Activity details/}).count())await page.getByRole('dialog',{name:/Activity details/}).getByRole('button',{name:/Cancel|Close/}).first().click();await page.setViewportSize({width:1440,height:1100});await page.reload();await page.waitForTimeout(2500);

 // ================= 4. Dockets: upload (UI) -> review -> allocate -> approve -> actual cost =================
 const makePdf=async text=>{const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);const pg=pdf.addPage([595,842]);let y=800;for(const line of text.split('\n')){let x=40;for(const cell of line.split(/ {2,}/)){pg.drawText(cell,{x,y,size:10,font});x+=Math.max(60,cell.length*5.2+14);}y-=16;}return Buffer.from(await pdf.save());};
 const supplierText=`DELIVERY DOCKET\nExample Quarry Pty Ltd\nABN  22 222 222 222\nDocket No: Q-7781\nDate: 06/10/2026\nClient: Example Builder Group\nJob Location: RC Sample Road Upgrade\nOrder No: PO-5521\nItem Description: 20mm road base\nQuantity: 2 tonnes\nTotal ex GST: $600.00`;
 const worksText=readFileSync(new URL('./fixtures/dockets/works-docket-1p.txt',import.meta.url),'utf8').trim();
 const dir=`${OUT}/files`;mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/supplier-docket-Q-7781.pdf`,await makePdf(supplierText));writeFileSync(`${dir}/works-docket-9042.pdf`,await makePdf(worksText));
 await nav('Commercial','Work Records');
 let uploaded=false;
 if(PDFJS_DIR){
  await page.getByRole('button',{name:/Upload dockets/}).first().click();await page.waitForTimeout(500);
  await page.locator('input[type=file]').setInputFiles([`${dir}/supplier-docket-Q-7781.pdf`,`${dir}/works-docket-9042.pdf`]);await page.waitForTimeout(500);
  await page.getByRole('button',{name:/Read & add dockets/}).click();await page.getByTestId('review-uploaded').waitFor({timeout:90000});
  const rows=await page.getByTestId('uploaded-docket').allInnerTexts();uploaded=rows.length===2;
  check('Two PDFs uploaded through the UI and listed for review from the created records',uploaded,rows.map(r=>r.replace(/\n/g,' / ')).join(' || ').slice(0,260));
  await shot('05-dockets-uploaded');
 }else{
  notRun('Docket PDF upload through the UI','PDFJS_DIR not set (PDF.js is loaded from a CDN); dockets created through the same records API instead');
  for(const [no,text] of [['Q-7781',supplierText],['9042',worksText]]){const f=new FormData();f.set('records',JSON.stringify([no==='Q-7781'?{docketNo:'Q-7781',workDate:'2026-10-06',client:'Example Builder Group',project:'RC Sample Road Upgrade',poNumber:'PO-5521',quantity:2,quantityUnit:'t',amount:600,lineItems:[{description:'20mm road base',quantity:2,unit:'t',rate:300,amount:600,valueSource:'document'}],status:'ready',sourceName:'supplier-docket-Q-7781.pdf'}:{docketNo:'9042',workDate:'2026-09-23',client:'Example Builder Group',project:'Sample Road Upgrade Stage 2',labourHours:30,amount:0,lineItems:[{kind:'labour',description:'TC',quantity:10,unit:'hr',rate:null,amount:null,valueSource:'unpriced'}],status:'review',sourceName:'works-docket-9042.pdf'}]));const r=await fetch(base+'/api/dockets',{method:'POST',headers:{origin:base,cookie:admin.cookie},body:f});assert.equal(r.status,200);}
  await page.reload();await page.waitForTimeout(3000);await nav('Commercial','Work Records');
 }
 const docketRows=async()=>(await db.query("SELECT id,docket_no,status,amount,links,updated_at FROM dockets WHERE organisation_id=? ORDER BY docket_no",[admin.org]))[0];
 const openDocket=async(no)=>{await page.locator('tbody tr',{hasText:no}).first().getByRole('button',{name:/Edit entry/}).click();await page.waitForTimeout(1500);return page.getByRole('dialog').first();};
 // supplier docket: allocate + approve
 let drows=await docketRows();const supplier=drows.find(d=>d.docket_no==='Q-7781'),works=drows.find(d=>d.docket_no==='9042');
 if(uploaded)await page.reload().then(()=>page.waitForTimeout(3000)).then(()=>nav('Commercial','Work Records'));
 // cancel first: editing and closing without saving leaves the record untouched
 {const e=await openDocket('Q-7781');await e.getByLabel('Amount ex GST').fill('1');await page.keyboard.press('Escape');await page.waitForTimeout(600);
  const after=(await docketRows()).find(d=>d.docket_no==='Q-7781');check('Closing the docket editor without saving changes nothing',Number(after.amount)===600&&after.updated_at===supplier.updated_at);}
 {const e=await openDocket('Q-7781');await e.getByLabel('Allocate to project').selectOption({label:'PRJ-0001 · RC Sample Road Upgrade'});await e.locator('#edit-status').selectOption({label:'Approved (posts the cost to the project)'});await shot('06-docket-approve');await e.getByRole('button',{name:/Save docket/}).click();await page.waitForTimeout(2500);}
 const control=async()=>must(await a('/api/projects/control?id='+projectId),[200],'control');
 let c=await control();check('Approved supplier docket posted its actual cost to the project',c.financials.forecast.actual===600,`actual ${c.financials.forecast.actual}`);
 // internal cost correction 600 -> 725 before any claim
 {const e=await openDocket('Q-7781');check('Reopened approved docket keeps its project allocation and amount',(await e.getByLabel('Allocate to project').inputValue()).length>0&&(await e.getByLabel('Amount ex GST').inputValue())==='600');
  await e.getByLabel('Amount ex GST').fill('725');await e.getByRole('button',{name:/Save docket/}).click();await page.waitForTimeout(2500);}
 c=await control();check('Internal cost correction re-posts in place (600 -> 725), not as a second posting',c.financials.forecast.actual===725);
 const [costRows]=await db.query("SELECT source_line,amount,status FROM cost_transactions WHERE organisation_id=? AND source_type='docket' AND source_id=?",[admin.org,supplier.id]);
 check('Exactly one active cost row exists for the docket',costRows.filter(r=>r.status==='actual').length===1&&costRows.length===1,JSON.stringify(costRows.map(r=>[r.source_line,Number(r.amount),r.status])));
 // unpriced works docket: allocate + approve; unknown stays unknown, nothing posts
 {const e=await openDocket('9042');await e.getByLabel('Allocate to project').selectOption({label:'PRJ-0001 · RC Sample Road Upgrade'});await e.locator('#edit-status').selectOption({label:'Approved (posts the cost to the project)'});await e.getByRole('button',{name:/Save docket/}).click();await page.waitForTimeout(2500);}
 c=await control();const [[wd]]=await db.query('SELECT line_items,status FROM dockets WHERE id=?',[works.id]);
 check('Unpriced works docket approved: no cost posted and its rates stay unknown',c.financials.forecast.actual===725&&JSON.parse(wd.line_items).every(i=>i.rate===null&&i.amount===null),`actual still ${c.financials.forecast.actual}`);
 const dup=await a('/api/dockets?month='+today.slice(0,7));
 const approvedAgain=await a('/api/dockets','PUT',{...(dup.body.dockets||[]).find(d=>d.docketNo==='Q-7781'),status:'approved'});
 const [[n725]]=await db.query("SELECT COUNT(*) AS n,SUM(amount) AS total FROM cost_transactions WHERE organisation_id=? AND source_id=? AND status='actual'",[admin.org,supplier.id]);
 check('Re-approving the same docket never duplicates cost',approvedAgain.status===200&&Number(n725.n)===1&&Number(n725.total)===725);
 await page.setViewportSize({width:390,height:844});const e390=await openDocket('Q-7781').catch(()=>null);await page.waitForTimeout(500);await shot('07-docket-editor-mobile');
 const ov2=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);check('Docket review has no horizontal overflow at 390px',ov2<=2,`${ov2}px`);await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1100});

 // ================= 5. Separately agreed client charge -> claim -> approval -> client-review PDF (UI) =================
 await nav('Projects');await page.getByText('RC Sample Road Upgrade').first().click();await page.waitForTimeout(2000);
 await page.locator('main button:visible',{hasText:/^Commercial$/}).first().click();await page.waitForTimeout(2500);
 const claimsBefore=Number((await db.query('SELECT COUNT(*) AS n FROM progress_claims WHERE organisation_id=?',[admin.org]))[0][0].n);
 await page.getByRole('button',{name:'New claim'}).click();await page.waitForTimeout(1500);
 let sheet=page.getByRole('dialog').first();
 const lineText=(await sheet.locator('li').allInnerTexts()).join(' || ');
 check('Docket lines require a separately entered client charge (no supplier cost offered as revenue)',/Q-7781[\s\S]*client charge required/i.test(lineText));
 await page.keyboard.press('Escape');await page.waitForTimeout(800);
 check('Cancelling the claim form creates no claim',Number((await db.query('SELECT COUNT(*) AS n FROM progress_claims WHERE organisation_id=?',[admin.org]))[0][0].n)===claimsBefore);
 await page.getByRole('button',{name:'New claim'}).click();await page.waitForTimeout(1200);sheet=page.getByRole('dialog').first();
 const line=sheet.locator('li',{hasText:/Q-7781/}).first();
 await line.getByLabel('Agreed client charge (ex GST)').fill('1000');await line.getByLabel('Client agreement or contract rate reference').fill('Agreement RC-2026-14 rate schedule');await line.getByRole('checkbox').check();await shot('08-claim-form');
 await sheet.getByRole('button',{name:'Submit for internal approval'}).click();await page.waitForTimeout(3000);
 const [[claim]]=await db.query('SELECT id,status,gross_amount,net_amount,revision FROM progress_claims WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1',[admin.org]);
 check('Claim created from the UI with the agreed charge',Number(claim.gross_amount)===1000&&claim.status==='internal_approval',`gross ${claim.gross_amount}, actual cost ${725}`);
 await page.getByRole('button',{name:'Approve and submit'}).click();await page.waitForTimeout(2500);
 const [[approved]]=await db.query('SELECT status,revision FROM progress_claims WHERE id=?',[claim.id]);
 check('Claim approved and submitted through the UI',approved.status==='submitted');
 await page.reload();await page.waitForTimeout(3000);await nav('Projects');await page.getByText('RC Sample Road Upgrade').first().click();await page.waitForTimeout(2000);await page.locator('main button:visible',{hasText:/^Commercial$/}).first().click();await page.waitForTimeout(2500);
 const pdfLink=page.getByRole('link',{name:/Client review PDF/});check('Submitted claim shows the client-review PDF link after reload',await pdfLink.count()===1);await shot('09-claim-submitted');
 const pdfResponse=await fetch(base+(await pdfLink.getAttribute('href')),{headers:{cookie:admin.cookie}});const pdf=Buffer.from(await pdfResponse.arrayBuffer());
 check('Client-review PDF export succeeds',pdfResponse.status===200&&pdf.subarray(0,5).toString()==='%PDF-',`${pdf.length} bytes`);
 if(PDFJS_DIR){const pdfjs=await import(`${PDFJS_DIR}/legacy/build/pdf.mjs`);const doc=await pdfjs.getDocument({data:new Uint8Array(pdf),isEvalSupported:false}).promise;let text='';for(let i=1;i<=doc.numPages;i++)text+=(await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ')+' ';
  check('PDF states the agreed charge ex GST, is labelled a review copy, and carries no supplier cost',/Progress claim - client review/.test(text)&&/1,?000\.00/.test(text)&&/excluding GST/i.test(text)&&!/725/.test(text),'');}
 else notRun('Client-review PDF text check','PDFJS_DIR not set');
 // internal cost can no longer be changed once claimed; the agreed charge is independent of cost
 const claimedEdit=await a('/api/dockets','PUT',{...(dup.body.dockets||[]).find(d=>d.docketNo==='Q-7781'),amount:5000,lineItems:[{description:'x',quantity:1,unit:'t',rate:5000,amount:5000}],status:'approved'});
 const [[afterClaim]]=await db.query('SELECT gross_amount FROM progress_claims WHERE id=?',[claim.id]);c=await control();
 check('A claimed docket is locked; internal cost stays 725 and the agreed charge stays 1000',claimedEdit.status===409&&Number(afterClaim.gross_amount)===1000&&c.financials.forecast.actual===725,`edit -> ${claimedEdit.status}`);

 // ================= 6. Boundaries =================
 // tenant isolation
 for(const [label,path] of [['programme','/api/projects/program?projectId='+projectId],['project control','/api/projects/control?id='+projectId],['claims',`/api/commercial/claims?projectId=${projectId}`],['claim PDF',`/api/commercial/claims?claimId=${claim.id}&projectId=${projectId}&revision=${approved.revision}`],['docket by id','/api/dockets?id='+supplier.id],['estimate','/api/estimates?id='+estimateId]]){const r=await b(path);check(`Another organisation cannot read the ${label}`,[403,404].includes(r.status),`-> ${r.status}`);}
 const foreignWrite=await b('/api/projects/program','POST',{projectId,name:'Intruder',startDate:'2026-10-05',durationDays:1,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',status:'planned'});
 check('Another organisation cannot write to the programme',[403,404].includes(foreignWrite.status),`-> ${foreignWrite.status}`);
 // roles
 const site=members.site_engineer,siteApi=api(site.cookie);
 await db.query("INSERT INTO project_members (id,organisation_id,project_id,user_id,project_role,active,revision,created_by,created_at,updated_at) VALUES (UUID(),?,?,?,?,1,1,?,?,?)",[admin.org,projectId,site.id,'site_engineer',admin.id,new Date().toISOString(),new Date().toISOString()]);
 const siteRead=await siteApi('/api/projects/program?projectId='+projectId);
 check('A site engineer on the project sees the programme without financial fields',siteRead.status===200&&siteRead.body.canViewCosts===false&&siteRead.body.activities.every(x=>!('direct_cost_rate' in x)||x.direct_cost_rate==null),`canViewCosts ${siteRead.body.canViewCosts}`);
 const siteFinancial=await siteApi('/api/projects/program','POST',{projectId,id:pl.id,revision:(await programme()).find(x=>x.name==='Pipe laying').revision,name:'Pipe laying',startDate:'2026-10-05',durationDays:3,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',status:'planned',directCostRate:1});
 check('A role without financial access cannot write costing rates',siteFinancial.status===403,`-> ${siteFinancial.status}`);
 const fieldApi=api(members.field.cookie),schedApi=api(members.scheduler.cookie),roApi=api(members.read_only.cookie);
 const fieldProgramme=await fieldApi('/api/projects/program','POST',{projectId,name:'x',startDate:'2026-10-05',durationDays:1,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',status:'planned'});
 check('A field user cannot edit the programme',[403,404].includes(fieldProgramme.status),`-> ${fieldProgramme.status}`);
 const fieldApprove=await fieldApi('/api/dockets','PUT',{...(dup.body.dockets||[]).find(d=>d.docketNo==='9042'),status:'approved'});
 check('A field user cannot approve dockets',[403,404].includes(fieldApprove.status),`-> ${fieldApprove.status}`);
 const schedClaim=await schedApi('/api/commercial/claims','POST',{action:'create',projectId,period:today.slice(0,7),lines:[{lineType:'contract',sourceId:'x',thisClaim:1}]});
 check('A scheduler cannot create claims',[403,404].includes(schedClaim.status),`-> ${schedClaim.status}`);
 const roEstimate=await roApi('/api/estimates','PUT',{id:estimateId,data:{...est.data}});
 check('A read-only user cannot edit estimates',[403,404,409].includes(roEstimate.status),`-> ${roEstimate.status}`);
 // OCR safeguard in the browser: a scanned image can never become Ready on its own
 if(TESS){
  const png=await page.evaluate(async lines=>{const c=document.createElement('canvas');c.width=1400;c.height=900;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#000';x.font='34px Arial';lines.forEach((t,i)=>x.fillText(t,40,70+i*60));return c.toDataURL('image/png').split(',')[1];},['DELIVERY DOCKET','Docket No: S-4410','Client: Example Builder Group','Quantity: 3 tonnes']);
  writeFileSync(`${dir}/scanned-docket.png`,Buffer.from(png,'base64'));
  await nav('Commercial','Work Records');await page.getByRole('button',{name:/Upload dockets/}).first().click();await page.waitForTimeout(500);await page.locator('input[type=file]').setInputFiles(`${dir}/scanned-docket.png`);await page.getByRole('button',{name:/Read & add dockets/}).click();
  await page.getByTestId('review-uploaded').waitFor({timeout:420000});const [[scan]]=await db.query("SELECT status,confidence FROM dockets WHERE source_name='scanned-docket.png' ORDER BY created_at DESC LIMIT 1");
  check('A scanned image with missing fields requires human review (never Ready or Approved)',['review','duplicate'].includes(scan.status),`status ${scan.status}, confidence ${scan.confidence}`);
 }else notRun('Scanned-image OCR review check','TESSERACT_ROOT not set (OCR assets are loaded from a CDN); covered by scripts/test-docket-accuracy.mjs');
 check('No page errors during the whole run',pageErrors.filter(e=>!/favicon|ResizeObserver/.test(e)).length===0,pageErrors.slice(0,2).join(' | '));
 // the migration under test
 const [cols]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='program_activities' AND COLUMN_NAME IN ('productive_hours_per_day','direct_cost_rate','cost_rate_basis','source_estimate_revision_id','source_estimate_item_id')");
 check('Migration 0025 columns exist on the migrated database',cols.length===5);
}catch(error){record('Workflow aborted',"fail",String(error?.stack||error).slice(0,600));}
finally{
 await browser?.close().catch(()=>{});server.kill();s3.close();await db.end();
 const failed=results.filter(r=>r.status==='fail').length,skipped=results.filter(r=>r.status==='not-run').length;
 writeFileSync(`${OUT}/report.json`,JSON.stringify({results,failed,skipped},null,1));
 console.log(`\n${results.filter(r=>r.status==='pass').length} passed, ${failed} failed, ${skipped} not run. Report and screenshots: ${OUT}`);
 process.exit(failed?1:0);
}
function PDFDJS(){return PDFJS_DIR;}
function localAsset(url){
 let m=PDFJS_DIR&&url.match(/pdfjs-dist@6\.3\.289\/(.*)$/);if(m)return `${PDFJS_DIR}/${m[1].split('?')[0]}`;
 if(TESS){m=url.match(/tesseract\.js@7\/dist\/(.*)$/)||url.match(/tesseract\.js@v7[^/]*\/dist\/(.*)$/);if(m)return `${TESS}/tesseract.js-7.0.0/package/dist/${m[1].split('?')[0]}`;
  m=url.match(/tesseract\.js-core@v?7[^/]*\/(.*)$/);if(m)return `${TESS}/tesseract.js-core-7.0.0/package/${m[1].split('?')[0]}`;
  if(/eng\.traineddata/.test(url))return `${TESS}/tesseract.js-data-eng-1.0.0/package/4.0.0/eng.traineddata.gz`;}
 return null;
}
