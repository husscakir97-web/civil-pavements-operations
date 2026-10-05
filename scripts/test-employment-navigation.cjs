// Focused real-component navigation fixture; all API data is disposable and intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.EMPLOYMENT_UI_URL||'http://127.0.0.1:3212';
assert.equal(new URL(base).hostname,'127.0.0.1');
function load(file){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const calc=load('lib/estimate-calculations.ts');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 let failures=0;
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  let accept=false,failLoad=false,dialogs=0,reads=0;const errors=[];
  page.on('dialog',async d=>{dialogs++;await (accept?d.accept():d.dismiss());});page.on('pageerror',e=>errors.push(e.message));
  const workers=['Jordan Taylor','Casey Review'].map((name,i)=>({id:'worker0'+i,name,first_name:name.split(' ')[0],last_name:name.split(' ')[1],status:'Active',employment_type:'full_time',revision:1,active:true,competencies:[]}));
  const estimates=['First estimate','Second estimate'].map((name,i)=>({id:'estimate0'+i,name,status:'Draft',revisionNumber:1,data:{...calc.makeDefaultEstimate(),name,clientName:'Fixture',projectName:name,site:'Fixture'}}));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
   const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.pathname==='/api/workspace')return respond({brand:{productName:'Fixture',accentColor:'#2d2f31'},role:'admin',userId:'fixture',canEdit:true,capabilities:[],entitlements:{core:'active',estimating:'active',operations:'active'},onboarding:{completed:true,step:0}});
   if(u.pathname==='/api/operations/resources')return respond(u.searchParams.get('kind')==='issues'?{issues:[]}:{workers});
   if(u.pathname==='/api/estimates/approval')return respond({state:'draft',revisions:[]});
   if(u.pathname==='/api/estimates'){
    if(u.searchParams.has('id')){reads++;if(failLoad)return respond({error:'Fixture load failed'},500);return respond({estimate:estimates.find(e=>e.id===u.searchParams.get('id')),revisions:[]});}
    return respond({estimates,rateLibraries:[calc.DEFAULT_RATE_LIBRARY],opportunities:[],jobs:[]});
   }
   return respond({records:[],people:[],users:[],units:[],items:[],results:[]});
  });
  const check=(name,fn)=>{try{fn();console.log('PASS '+width+' '+name);}catch(e){failures++;console.error('FAIL '+width+' '+name+': '+e.message);}};
  const nav=name=>page.getByRole('navigation').getByRole('button',{name,exact:true});
  const type=()=>page.getByLabel('Employment type',{exact:true});
  await page.goto(base+'/employment-fixture',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Edit Jordan Taylor',exact:true}).click();await type().selectOption('casual');
  accept=true;let before=dialogs;await page.getByRole('button',{name:'Edit Jordan Taylor',exact:true}).click();
  check('same worker does not consume guard',()=>assert.equal(dialogs,before));assert.equal(await type().inputValue(),'casual');
  accept=false;before=dialogs;await page.getByRole('button',{name:'Edit Casey Review',exact:true}).click();
  check('cancel worker replacement keeps guard',()=>assert.equal(dialogs,before+1));
  const keptWorker=await page.getByRole('form',{name:'Edit Jordan Taylor'}).count();check('cancel worker replacement keeps form',()=>assert.equal(keptWorker,1));
  if(await page.getByRole('form',{name:'Edit Jordan Taylor'}).count())assert.equal(await type().inputValue(),'casual');
  accept=true;await page.getByRole('button',{name:'Edit Casey Review',exact:true}).click();await page.getByRole('form',{name:'Edit Casey Review'}).waitFor();assert.equal(await type().inputValue(),'full_time');
  accept=false;before=dialogs;await nav('Estimate').click();assert.equal(dialogs,before);
  await page.getByRole('button',{name:'Production & Resources',exact:true}).click();const assumption=page.getByLabel(/^Employee classification assumption for/).first();await assumption.selectOption('casual');
  const second=page.getByRole('button',{name:/^Second estimate/});
  before=dialogs;const readBefore=reads;await second.click();assert.equal(dialogs,before+1);assert.equal(reads,readBefore);assert.equal(await assumption.inputValue(),'casual');
  console.log('PASS '+width+' cancel estimate replacement keeps draft and avoids request');
  failLoad=true;accept=true;await Promise.all([page.waitForResponse(r=>r.url().includes('id=estimate01')),second.click()]);await page.waitForTimeout(50);
  accept=false;before=dialogs;await nav('People').click();
  check('failed estimate load retains navigation guard',()=>assert.equal(dialogs,before+1));
  if(await assumption.count())assert.equal(await assumption.inputValue(),'casual');else failures++;
  // Reset the fixture after a reproduced failure, so successful replacement is independently exercised.
  accept=true;await page.reload({waitUntil:'networkidle'});failLoad=false;await nav('Estimate').click();await page.getByRole('button',{name:'Production & Resources',exact:true}).click();await assumption.selectOption('part_time');
  await Promise.all([page.waitForResponse(r=>r.url().includes('id=estimate01')),second.click()]);await page.waitForTimeout(50);
  assert.equal(await assumption.inputValue(),'');before=dialogs;accept=false;await nav('People').click();assert.equal(dialogs,before);await page.getByRole('button',{name:'Edit Jordan Taylor',exact:true}).waitFor();
  check('successful replacement clears guard; failures handled',()=>assert.deepEqual(errors,[]));
  await context.close();
 }}finally{await browser.close();}
 assert.equal(failures,0,'navigation regressions');
})().catch(e=>{console.error(e);process.exitCode=1;});
