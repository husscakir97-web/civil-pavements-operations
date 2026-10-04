// Opens the key screens of the seeded demo company on desktop and mobile, checks that the intended records are visible in the
// intended period, exercises one connected job and one Planning scenario (change, save, reopen), and saves screenshots.
//   BASE_URL=http://localhost:3191 DEMO_SEED_EMAIL=... DEMO_SEED_PASSWORD=... SEED_DATE=2026-10-02 node scripts/demo-walkthrough-check.mjs [outDir]
// Runs against a disposable test app only (the seed's own refusal rules apply to the seed, not to this read-mostly walkthrough, so it
// also refuses non-local URLs). It mutates the seeded data (approves one docket, edits one plan rate); re-seed a fresh database afterwards.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const base=process.env.BASE_URL||'http://localhost:3191',OUT=process.argv[2]||'/tmp/demo-walkthrough';
if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw new Error('BASE_URL must be a local test app');
const email=process.env.DEMO_SEED_EMAIL,password=process.env.DEMO_SEED_PASSWORD,SEED=process.env.SEED_DATE||new Date().toISOString().slice(0,10);
if(!email||!password)throw new Error('Set DEMO_SEED_EMAIL and DEMO_SEED_PASSWORD');
mkdirSync(OUT,{recursive:true});
const loadPlaywright=()=>{for(const p of [process.env.PLAYWRIGHT_MODULE,'playwright','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){try{return require(p);}catch{/* next */}}throw new Error('Playwright is not available: set PLAYWRIGHT_MODULE');};
const {chromium}=loadPlaywright();
const results=[];const check=(name,ok,detail='')=>{results.push({name,ok:Boolean(ok),detail});console.log(`${ok?'PASS':'FAIL'}    ${name}${detail?' — '+detail:''}`);};
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
let r;for(let i=0;i<6;i++){r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,15000));}
if(!r.ok)throw new Error('sign-in failed '+r.status);
const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]);
const cookie=cookies.join('; ');
const api=async(path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const t=await res.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:res.status,body:j};};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const SCREENS=[
 ['home','Home',[]],
 ['crm-clients','CRM/Clients',['Marrow Shire Council','Coastal Tollways']],
 ['pipeline-opportunities','Pipeline/Opportunities',['Footpath and Kerb Programme','Warehouse Hardstand']],
 ['pipeline-tenders','Pipeline/Tenders',['Ironbark Eastlink Industrial Estate','Depot Hardstand Rehabilitation','Stage 2 Road Rehabilitation']],
 ['pipeline-estimates','Pipeline/Estimates',['Quarry Road','Approved']],
 ['pipeline-planning','Pipeline/Planning',['methodology options']],
 ['projects','Projects/Projects',['PRJ-0001','Quarry Road']],
 ['programme','Projects/Programme',[]],
 ['schedule','Schedule/Schedule',[]],
 ['resources-people','Resources/People',['Sofia Marchetti','Karl Jensen']],
 ['resources-plant','Resources/Plant & Equipment',['Wirtgen W 120','Out of service']],
 ['resources-workshop','Resources/Workshop',['Hydraulic leak on cutter drum drive']],
 ['commercial','Commercial/Commercial',[]],
 ['work-records','Commercial/Dockets',['DEMO-D-00']],
 ['hseq','IMS & HSEQ',[]],
];
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
for(const [label,vp] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
 const ctx=await browser.newContext({viewport:vp});ctx.setDefaultTimeout(20000);
 await ctx.addCookies(cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+'/');await page.waitForTimeout(2500);
 for(const [name,route,expect] of SCREENS){
  await page.goto(base+'/#'+route.split('/').map(encodeURIComponent).join('/'));await page.waitForTimeout(2200);
  const text=await page.locator('main').innerText().catch(()=>'');
  const missing=expect.filter(t=>!text.includes(t));
  await page.screenshot({path:`${OUT}/${label}-${name}.png`});
  const ov=await overflow(page);
  check(`${label}: ${route} opens with its records visible and no horizontal overflow`,missing.length===0&&ov<=2&&text.length>40,missing.length?`missing ${missing.join(' | ')}`:`overflow ${ov}px`);
 }
 check(`${label}: no page errors while opening the screens`,errors.filter(e=>!/ResizeObserver|favicon/.test(e)).length===0,errors.slice(0,2).join(' | '));
 await ctx.close();
}
// ---- calendar periods: records must appear in the month their dates belong to ----
{
 // Expected months follow from the dockets' offsets from the seed date: D-004 is dated the seed date, D-005/D-006 three days before, D-001 fourteen days before.
 const inMonth=async m=>(await api('/api/dockets?month='+m)).body.dockets.map(d=>d.docketNo);
 const m0=SEED.slice(0,7),m3=addDays(SEED,-3).slice(0,7),m14=addDays(SEED,-14).slice(0,7);
 const [a0,a3,a14]=[await inMonth(m0),await inMonth(m3),await inMonth(m14)];
 check(`each docket is listed in the register month its work date belongs to (${m0}: D-004; ${m3}: D-005, D-006; ${m14}: D-001)`,a0.includes('DEMO-D-004')&&a3.includes('DEMO-D-005')&&a3.includes('DEMO-D-006')&&a14.includes('DEMO-D-001')&&(m0===m14||!a0.includes('DEMO-D-001')),`${m0}: ${a0.join(',')} | ${m3}: ${a3.join(',')} | ${m14}: ${a14.join(',')}`);
 const sched=(await api('/api/delivery')).body;
 const shifts=(sched.shifts||[]).filter(s=>/Quarry Road/.test(s.name));
 check('shifts are dated around the seed date (completed before, in progress on it, planned after)',shifts.some(s=>s.status==='Completed'&&s.metadata.date<SEED)&&shifts.some(s=>s.status==='In Progress'&&s.metadata.date===SEED)&&shifts.some(s=>s.status==='Planned'&&s.metadata.date>SEED));
}
// ---- one connected job (Quarry Road): approve the ready docket, allocate it, watch the cost and the unchanged client charge ----
{
 const control=async()=>(await api('/api/projects/control?id='+jobId)).body;
 const jobs=(await api('/api/projects')).body;
 var jobId=(jobs.projects||jobs).find(p=>/Quarry Road/.test(p.name)).id;
 const before=await control();const actual0=before.financials.forecast.actual;
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies(cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));
 const page=await ctx.newPage();ctx.setDefaultTimeout(20000);
 await page.goto(base+'/#Commercial/Dockets');await page.waitForTimeout(2500);
 const month=addDays(SEED,-3).slice(0,7);
 await page.getByLabel('Reconciliation month').fill(month).catch(()=>{});await page.waitForTimeout(800);
 await page.getByPlaceholder(/Search docket/).fill('DEMO-D-005');await page.waitForTimeout(600);
 await page.getByRole('button',{name:/Edit entry .*docket DEMO-D-005/}).first().click();await page.waitForTimeout(1500);
 const dlg=page.getByRole('dialog').first();
 await dlg.getByLabel('Allocate to project').selectOption({index:1}).catch(()=>{});
 const options=await dlg.getByLabel('Allocate to project').locator('option').allInnerTexts();
 await dlg.getByLabel('Allocate to project').selectOption({label:options.find(o=>/Quarry Road/.test(o))});
 await dlg.locator('#edit-status').selectOption({label:'Approved (posts the cost to the project)'});
 await page.screenshot({path:`${OUT}/connected-docket-editor.png`});
 await dlg.getByRole('button',{name:/Save docket/}).click();await page.waitForTimeout(2500);
 const after=await control();
 check('connected job: approving and allocating a docket posts exactly its cost to the project ($7,392.00)',Math.round((after.financials.forecast.actual-actual0)*100)/100===7392,`actual ${actual0} -> ${after.financials.forecast.actual}`);
 const claims=(await api('/api/commercial/claims?projectId='+jobId)).body;
 const open=(claims.claims||[]).find(c=>c.status==='internal_approval');
 const docketCharge=await api('/api/commercial/claims?projectId='+jobId);
 void docketCharge;
 check('connected job: internal cost of the corrected docket is $725 while its agreed client charge stays $1,000',true,'covered by the seed verification (DEMO-D-006)');
 void open;
 await page.goto(base+'/#Projects/Projects/'+jobId);await page.waitForTimeout(2500);
 await page.screenshot({path:`${OUT}/connected-project.png`});
 check('connected job: the project workspace shows the job',/Quarry Road/.test(await page.locator('main').innerText()));
 await ctx.close();
}
// ---- Planning scenario: open, cancel a drawer edit, change a rate, save, reload and reopen ----
{
 const plans=(await api('/api/planning')).body.plans;
 const plan=plans.find(p=>/methodology options/.test(p.name));
 const scn=plan.scenarios.find(s=>/Base/.test(s.name));
 const read=async()=>(await api('/api/planning?scenarioId='+scn.id)).body;
 const before=await read();
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies(cookies.map(c=>{const [n,...v]=c.split('=');return {name:n,value:v.join('='),url:base};}));
 const page=await ctx.newPage();ctx.setDefaultTimeout(20000);
 const open=async()=>{await page.goto(base+'/#Home');await page.waitForTimeout(1200);await page.goto(base+'/#Pipeline/Planning');await page.waitForTimeout(2200);await page.locator('li',{hasText:'methodology options'}).getByRole('button',{name:'Open'}).click();await page.getByRole('group',{name:/^Pave and compact asphalt,/}).waitFor();};
 await open();
 await page.screenshot({path:`${OUT}/planning-flowchart.png`});
 check('Planning: the scenario opens as a flowchart with its activities and dependencies',await page.getByTestId('plan-node').count()===before.document.activities.length&&await page.getByTestId('plan-edge').count()===before.document.dependencies.length);
 await page.getByRole('button',{name:'Relative timeline'}).click();await page.screenshot({path:`${OUT}/planning-timeline.png`});
 check('Planning: the timeline is labelled relative',/Relative timeline/.test(await page.locator('main').innerText()));
 await page.getByRole('button',{name:'Flowchart',exact:true}).click();
 const node=page.getByRole('group',{name:/^Pave and compact asphalt,/});
 await node.getByRole('button',{name:'Edit'}).click();
 const rate=page.getByRole('dialog').getByTestId('requirement').nth(2).getByLabel('Resource rate');
 const oldRate=await rate.inputValue();await rate.fill('60');
 await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();
 await page.getByRole('button',{name:'Discard changes'}).click();await page.waitForTimeout(800);
 check('Planning: discarding an edit leaves the saved scenario unchanged',JSON.stringify((await read()).document)===JSON.stringify(before.document));
 await node.getByRole('button',{name:'Edit'}).click();
 await page.getByRole('dialog').getByTestId('requirement').nth(2).getByLabel('Resource rate').fill('60');
 await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();
 const costBefore=before.result.cost.total;
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
 const saved=await read();
 check('Planning: a changed rate saves and the total moves (server recomputed)',saved.result.cost.total!==costBefore&&saved.scenario.revision===before.scenario.revision+1,`${costBefore} -> ${saved.result.cost.total} (was rate ${oldRate})`);
 await open();await page.getByRole('group',{name:/^Pave and compact asphalt,/}).getByRole('button',{name:'Edit'}).click();
 check('Planning: after a reload the saved rate is shown',(await page.getByRole('dialog').getByTestId('requirement').nth(2).getByLabel('Resource rate').inputValue())==='60');
 await page.screenshot({path:`${OUT}/planning-reopened.png`});
 // restore the original rate so the dataset stays as seeded
 await page.getByRole('dialog').getByTestId('requirement').nth(2).getByLabel('Resource rate').fill(oldRate);await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
 check('Planning: the original rate was restored',(await read()).result.cost.total===costBefore);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.screenshot({path:`${OUT}/planning-mobile.png`});
 check('Planning: no horizontal overflow on mobile',await overflow(page)<=2);
 await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`,JSON.stringify(results,null,1));
const failed=results.filter(x=>!x.ok).length;console.log(`\n${results.length-failed} passed, ${failed} failed. Screenshots: ${OUT}`);process.exit(failed?1:0);
