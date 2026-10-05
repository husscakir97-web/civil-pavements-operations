// Fixture browser test of the real components. No server, credentials or live data.
// Uses existing esbuild/PostCSS; PLAYWRIGHT_MODULE and CHROME_PATH can point to host tools.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const entry=`import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{Program}from'./components/v1/program';import{NavContext,parseRoute,routeHash}from'./components/v1/nav';function App(){const[route,setRoute]=useState(parseRoute(location.hash));useEffect(()=>{const f=()=>setRoute(parseRoute(location.hash));addEventListener('hashchange',f);return()=>removeEventListener('hashchange',f)},[]);return <NavContext.Provider value={{route,navigate:(area,sub,id,tab,focus)=>{location.hash=routeHash({area,sub,id,tab,focus})}}}><main style={{padding:20,maxWidth:1100,margin:'auto'}}>{route.id?<p>Project drilldown: {route.id} / {route.tab}</p>:<Program/>}</main></NavContext.Provider>;}createRoot(document.getElementById('root')).render(<App/>);`;
 const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},plugins:[{name:'explicit-files',setup(b){b.onResolve({filter:/.*/},a=>{const dir=a.resolveDir||process.cwd(),n=a.path.startsWith('@/')?path.join(process.cwd(),a.path.slice(2)):a.path;const base=n.startsWith('.')?path.resolve(dir,n):n;const candidate=[base,base+'.ts',base+'.tsx',base+'.js'].find(f=>path.isAbsolute(f)&&fs.existsSync(f)&&fs.statSync(f).isFile());return {path:candidate||require.resolve(n,{paths:[dir]}),namespace:'explicit'};});b.onLoad({filter:/.*/,namespace:'explicit'},a=>({contents:fs.readFileSync(a.path,'utf8'),loader:a.path.endsWith('.tsx')?'tsx':a.path.endsWith('.ts')?'ts':a.path.endsWith('.json')?'json':'jsx',resolveDir:path.dirname(a.path)}));}}]});
 const css=(await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?result.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],methods=[];page.on('pageerror',e=>errors.push(e.message));
  let fail=false;
  await page.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url());methods.push(req.method());
   if(!u.pathname.endsWith('/portfolio'))return route.fulfill({json:{projects:[{id:'p',name:'Harbour access road'}],activities:[],members:[],comments:[],estimateItems:[]}});
   if(fail)return route.fulfill({status:503,json:{error:'Fixture failure'}});
   const division=u.searchParams.get('divisionId'),start=u.searchParams.get('start')||'2026-10-06';
   // Delayed old request must not overwrite the latest filter result.
   if(division==='slow')await new Promise(r=>setTimeout(r,250));
   const projects=division==='empty'||division==='slow'?[]:[{id:'p',name:'Harbour access road',divisionId:'civil',divisionName:'Civil',programmeIssue:false,activities:[{id:'a',name:'Drainage and formation',start,finish:'2026-10-12',status:'ready',responsibleName:null}],overdue:[{id:'old',name:'Survey handover',finish:'2026-10-03'}],noShiftsMessage:null,shifts:[{id:'s',projectId:'p',name:'Day crew',date:start,start:'07:00',finish:'17:00',status:'Draft',assignmentCount:2,shortage:1,issues:[{code:'WORKER_DOUBLE_BOOKED',severity:'warn'}]},{id:'u',projectId:'p',name:'Unscheduled follow-up',date:null,start:null,finish:null,status:'Draft',assignmentCount:0,shortage:null,issues:[]}]}];
   await route.fulfill({json:{start,end:'2026-10-19',operations:true,coverage:'Limited to your accessible projects; conflicts outside this scope are not assessed',divisions:[{id:'civil',name:'Civil'},{id:'empty',name:'Empty division'},{id:'slow',name:'Slow division'}],projects,counts:{projects:projects.length,activities:projects.length,shifts:projects.length}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/#Projects/Programme`);
  await page.getByRole('heading',{name:'Harbour access road',exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fs.mkdirSync('outputs/programme',{recursive:true});await page.screenshot({path:'outputs/programme/mobile.png',fullPage:true});
  await page.getByText('Review queues',{exact:true}).click();await page.getByText('Undated or invalid shift dates/times (1)',{exact:true}).waitFor();
  await page.getByLabel('Division',{exact:true}).selectOption('slow');await page.getByLabel('Division',{exact:true}).selectOption('civil');
  await page.getByRole('heading',{name:'Harbour access road',exact:true}).waitFor();await page.waitForTimeout(350);assert.equal(await page.getByRole('heading',{name:'Harbour access road',exact:true}).count(),1);
  await page.getByLabel('Division',{exact:true}).selectOption('empty');await page.getByText('No accessible projects match this view.').waitFor();
  await page.goBack();await page.getByRole('heading',{name:'Harbour access road',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open project programme'}).click();await page.getByText('Project drilldown: p / programme').waitFor();await page.goBack();await page.getByRole('heading',{name:'Harbour access road',exact:true}).waitFor();
  fail=true;await page.getByRole('button',{name:'Next two weeks'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Harbour access road',exact:true}).count(),0);fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'Harbour access road',exact:true}).waitFor();
  await page.getByRole('button',{name:'Project programme',exact:true}).click();await page.getByText('Choose project',{exact:true}).waitFor({state:'attached'});await page.getByRole('button',{name:'Company programme',exact:true}).click();await page.getByRole('heading',{name:'Harbour access road',exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'outputs/programme/desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);assert(methods.length>5&&methods.every(m=>m==='GET'));console.log('PASS real component fixture: mobile fit, queues, filters, stale response race, errors/retry, drilldown/back, mode switch; all API requests GET');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
