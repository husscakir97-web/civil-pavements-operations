// Component journeys against a local dev server with scripts/fixtures/employment-ui-page.tsx
// copied to app/employment-fixture/page.tsx. All API traffic is intercepted; no database is used.
// Set PLAYWRIGHT_MODULE and CHROMIUM_PATH for your local installation. See employment validation notes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.EMPLOYMENT_UI_URL||'http://127.0.0.1:3212';
assert.equal(new URL(base).hostname,'127.0.0.1','fixture journeys must only use the loopback host');
const out=process.env.EMPLOYMENT_UI_OUT||'../employment-ui-evidence';fs.mkdirSync(out,{recursive:true});
function load(file){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const calc=load('lib/estimate-calculations.ts'),E=load('lib/v1/employment.ts'),P=load('lib/v1/planning.ts');
const messages=[];const pass=s=>{messages.push('PASS '+s);console.log('PASS '+s);};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
 for(const [label,width] of [['desktop',1440],['mobile',390]]){
  let role='admin',saveCount=0;const errors=[];
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const workers=[{id:'worker01',name:'Jordan Taylor',first_name:'Jordan',last_name:'Taylor',status:'Active',employment_type:'full_time',revision:1,active:true,competencies:[],hourly_rate:61},{id:'worker02',name:'Casey Review',first_name:'Casey',last_name:'Review',status:'Active',employment_type:'Seasonal?',revision:1,active:true,competencies:[]}];
  let estimate={id:'estimate01',name:'Fixture estimate',status:'Draft',revisionNumber:1,data:{...calc.makeDefaultEstimate(),name:'Fixture estimate',clientName:'Fixture client',projectName:'Fixture project',site:'Fixture site'}};
  const activity={...P.blankActivity('activity','Paving','activity01'),durationDays:1,hoursPerDay:8,requirements:[{id:'requirement01',kind:'labour',name:'Proposed crew',quantity:2,rate:42,rateBasis:'hour',resourceRef:null}]};
  let document={activities:[activity],dependencies:[],sharedCosts:[]},revision=1;
  const choice={type:'worker',id:'worker01',label:'Jordan Taylor',detail:'Full-time · Paving crew · EMP-1'};
  const plan={id:'plan0001',name:'Fixture plan',accessScope:'organisation',ownerUserId:'fixture-user',revision:1,scenarios:[{id:'scenario01',name:'Base',revision:1}]};
  const planPayload=()=>({plan,scenario:{id:'scenario01',name:'Base',revision},document,positions:{},result:P.calculatePlan(document,{rates:true}),ratesVisible:true,canEdit:true,resourcesAvailable:true,resources:{'worker:worker01':choice}});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
   if(!u.pathname.startsWith('/api/'))return route.continue();
   const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   const method=route.request().method();let body={};try{body=route.request().postDataJSON()||{};}catch{}
   if(u.pathname==='/api/workspace')return respond({brand:{productName:'Infrastruct fixture',companyName:'Disposable fixture',workspaceName:'Local',accentColor:'#2d2f31'},role,userId:'fixture-user',canEdit:true,capabilities:[],entitlements:Object.fromEntries(['core','pipeline','estimating','projects','ims','operations','field','dockets','commercial','reports','workshop'].map(k=>[k,'active'])),onboarding:{completed:true,step:0}});
   if(u.pathname==='/api/operations/resources'){
    if(method==='POST'){const w=workers.find(w=>w.id===body.id);Object.assign(w,{employment_type:E.normaliseEmploymentType(body.worker.employmentType)||w.employment_type,first_name:body.worker.firstName,last_name:body.worker.lastName,revision:w.revision+1});saveCount++;return respond({id:w.id});}
    return respond(u.searchParams.get('kind')==='issues'?{issues:[]}:{workers:workers.map(w=>role==='admin'?w:Object.fromEntries(Object.entries(w).filter(([k])=>k!=='hourly_rate')))});
   }
   if(u.pathname==='/api/delivery')return respond({availability:{worker01:[],worker02:[{severity:'block',message:'Casey Review: Leave',code:'inactive'}]},conflicts:[]});
   if(u.pathname==='/api/estimates/approval')return respond({state:'draft',revisions:[]});
   if(u.pathname==='/api/estimates'){
    if(method==='PUT'||method==='POST'){estimate={...estimate,data:body.data,revisionNumber:estimate.revisionNumber+1};saveCount++;return respond({estimate:{...estimate,totals:calc.calculateEstimate(estimate.data)}});}
    return respond(u.searchParams.has('id')?{estimate:{...estimate,totals:calc.calculateEstimate(estimate.data)},revisions:[]}:{estimates:[estimate],rateLibraries:[calc.DEFAULT_RATE_LIBRARY],opportunities:[],jobs:[]});
   }
   if(u.pathname==='/api/planning'){
    if(u.searchParams.has('lookup'))return respond({results:[choice]});
    if(method==='POST'){if(body.document){document=body.document;revision++;}return respond(planPayload());}
    return respond(u.searchParams.has('scenarioId')?planPayload():{plans:[plan],canEdit:true});
   }
   if(u.pathname.includes('business-units'))return respond({units:[],defaultId:null});
   if(u.pathname.includes('users'))return respond({users:[]});
   if(u.pathname.includes('estimate-items'))return respond({items:[]});
   return respond({records:[],people:[],users:[],units:[],items:[],results:[]});
  });
  await page.goto(base+'/employment-fixture',{waitUntil:'networkidle',timeout:120000});
  await page.getByRole('button',{name:'Edit Jordan Taylor',exact:true}).click();
  await page.getByLabel('Employment type',{exact:true}).selectOption('part_time');
  let asked='';page.once('dialog',async d=>{asked=d.message();await d.dismiss();});await page.getByRole('navigation').getByRole('button',{name:'Schedule',exact:true}).click();assert.match(asked,/unsaved worker/i);assert(await page.getByLabel('Employment type',{exact:true}).isVisible());
  await page.getByRole('button',{name:'Save worker',exact:true}).click();await page.getByRole('form',{name:'Edit Jordan Taylor',exact:true}).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Edit Jordan Taylor',exact:true}).click();assert.equal(await page.getByLabel('Employment type',{exact:true}).inputValue(),'part_time');
  await page.getByRole('button',{name:'Save worker',exact:true}).click();await page.getByRole('form',{name:'Edit Jordan Taylor',exact:true}).waitFor({state:'detached'});assert.equal(workers[0].employment_type,'part_time');
  await page.getByRole('button',{name:'Edit Casey Review',exact:true}).click();assert.equal(await page.getByLabel('Employment type',{exact:true}).inputValue(),'Seasonal?');assert.match(await page.getByLabel('Employment type',{exact:true}).innerText(),/Review employment type/);
  await page.screenshot({path:path.join(out,label+'-people.png'),fullPage:true});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  pass(label+' People: edit/repeated save/reopen, unknown retention, unsaved navigation cancellation');
  await page.getByRole('navigation').getByRole('button',{name:'Schedule',exact:true}).click();
  const available=page.getByRole('button',{name:/Jordan Taylor.*Full-time.*Available/});await available.waitFor();await available.click();
  assert(await page.getByRole('button',{name:'Remove Jordan Taylor'}).isVisible());assert(await page.getByRole('button',{name:/Casey Review.*Review employment type.*Leave/}).isDisabled());
  await page.screenshot({path:path.join(out,label+'-schedule.png'),fullPage:true});pass(label+' Schedule: choice/allocation labels, blocked worker remains blocked');
  await page.getByRole('navigation').getByRole('button',{name:'Estimate',exact:true}).click();
  await page.getByRole('button',{name:'Production & Resources',exact:true}).click();
  const assumption=page.getByLabel(/^Employee classification assumption for/).first();await assumption.waitFor();await assumption.selectOption('casual');
  asked='';page.once('dialog',async d=>{asked=d.message();await d.dismiss();});await page.getByRole('navigation').getByRole('button',{name:'People',exact:true}).click();assert.match(asked,/unsaved estimate/i);
  await page.getByRole('button',{name:'Review & Approval',exact:true}).click();
  for(let i=0;i<2;i++){await Promise.all([page.waitForResponse(r=>r.url().includes('/api/estimates?id=estimate01')),page.getByRole('button',{name:/Save draft/i}).click()]);await page.getByRole('button',{name:/Save draft/i}).waitFor();}
  await page.getByRole('button',{name:'Production & Resources',exact:true}).click();await assumption.waitFor();assert.equal(await assumption.inputValue(),'casual');await page.screenshot({path:path.join(out,label+'-estimate.png'),fullPage:true});
  assert.equal(estimate.data.labour[0].employmentTypeAssumption,'casual');assert.deepEqual(calc.calculateEstimate(estimate.data),calc.calculateEstimate({...estimate.data,labour:estimate.data.labour.map(line=>({...line,employmentTypeAssumption:undefined}))}));pass(label+' Estimate: optional assumption, repeated save, unchanged totals, unsaved navigation cancellation');
  await page.getByRole('navigation').getByRole('button',{name:'Planning',exact:true}).click();await page.getByRole('button',{name:'Open',exact:true}).click();
  // Both mobile and desktop can use the activity list when the canvas is collapsed.
  const edit=page.getByRole('button',{name:'Edit',exact:true}).first();await edit.click();
  const dialog=page.getByRole('dialog'),row=dialog.getByTestId('requirement').first();
  const before=await row.getByLabel('Resource rate',{exact:true}).inputValue();await row.getByRole('button',{name:'Link a worker',exact:true}).click();
  await row.getByTestId('resource-option').first().waitFor();assert.match(await row.getByTestId('resource-option').first().innerText(),/Full-time/);await row.getByTestId('resource-option').first().click();
  assert.match(await row.getByTestId('resource-link-label').innerText(),/Full-time/);assert.equal(await row.getByLabel('Resource rate',{exact:true}).inputValue(),before);
  await page.screenshot({path:path.join(out,label+'-planning.png'),fullPage:true});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Unsaved changes',{exact:true}).waitFor({state:'detached'});assert.equal(document.activities[0].requirements[0].rate,42);assert.equal(document.activities[0].requirements[0].resourceRef.id,'worker01');
  pass(label+' Planning: matching classification, linking keeps entered rate, save retains identity');
  role='scheduler';await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Edit Jordan Taylor',exact:true}).click();assert.equal(await page.getByLabel('Hourly rate (AUD)',{exact:true}).count(),0);pass(label+' People: scheduler sees classification without pay input');
  assert.deepEqual(errors,[]);assert(saveCount>=4);await context.close();
 }
 }finally{await browser.close();fs.writeFileSync(path.join(out,'results.txt'),messages.join('\n')+'\n');}
})().catch(e=>{console.error(e);process.exitCode=1;});
