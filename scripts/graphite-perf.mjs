// Before/after interaction timing for the Graphite Studio redesign, under the SAME conditions: one machine, one browser, the same demo database,
// both production builds running side by side, runs interleaved (before, after, before, after…) after one warm-up each, headless Chromium, 1440x900.
//   BEFORE_URL=http://localhost:3302 AFTER_URL=http://localhost:3301 DEMO_SEED_EMAIL=… DEMO_SEED_PASSWORD=… MYSQL_* node scripts/graphite-perf.mjs [runs] [out.json]
// Each interaction is timed from the action to the moment its result is visible (wall clock in the test process; identical overhead on both sides).
import {createRequire} from 'node:module';
import {existsSync,writeFileSync} from 'node:fs';
import {connect} from './mysql-config.mjs';
const require=createRequire(import.meta.url);
const URLS={before:process.env.BEFORE_URL,after:process.env.AFTER_URL},email=process.env.DEMO_SEED_EMAIL,password=process.env.DEMO_SEED_PASSWORD,RUNS=Number(process.argv[2]||9),OUT=process.argv[3];
for(const u of Object.values(URLS))if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u||''))throw new Error('local test apps only');
const {chromium}=(()=>{for(const p of ['playwright','playwright-core','/opt/node22/lib/node_modules/playwright']){try{return require(p);}catch{/* next */}}throw new Error('Playwright not found');})();
const CHROMIUM=['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const db=await connect();const [[o]]=await db.query('SELECT organisation_id o FROM users WHERE email=?',[email]);
const B1=(await db.query("SELECT id FROM jobs WHERE organisation_id=? AND name LIKE '%Quarry Road%' ORDER BY created_at LIMIT 1",[o.o]))[0][0].id;await db.end();
const browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
const ms=()=>performance.now();
async function session(base){const ctx=await browser.newContext({viewport:{width:1440,height:900}});const r=await ctx.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}});if(!r.ok())throw new Error('sign-in '+r.status());return ctx;}
const T={
 'Open Work map (navigate → all areas drawn)':async(page,base)=>{const t=ms();await page.goto(`${base}/#Projects//${B1}/workmap`);await page.reload();await page.locator('[data-testid="area-shape"]').nth(10).waitFor();return ms()-t;},
 'Select an area (click → detail shown)':async(page,base)=>{await page.goto(`${base}/#Projects//${B1}/workmap`);await page.reload();await page.getByTestId('area-row').first().waitFor();const row=page.getByTestId('area-row').nth(2);const t=ms();await row.click();await page.getByTestId('area-id').waitFor();return ms()-t;},
 'Draw a 4-point area (start → shape OK)':async(page,base)=>{await page.goto(`${base}/#Projects//${B1}/workmap`);await page.reload();await page.getByTestId('draw-start').waitFor();const t=ms();await page.getByTestId('draw-start').click();const b=await page.locator('[data-testid="map-canvas"] svg[role="application"]').boundingBox();for(const [dx,dy] of [[-300,120],[-200,120],[-200,180],[-300,180]])await page.mouse.click(b.x+b.width/2+dx,b.y+b.height/2+dy);await page.getByTestId('draw-finish').click();await page.getByTestId('shape-status').waitFor();const d=ms()-t;await page.getByTestId('cancel').click();return d;},
 'Open Planning list (navigate → plans listed)':async(page,base)=>{const t=ms();await page.goto(`${base}/#Pipeline/Planning`);await page.reload();await page.getByRole('button',{name:/^Open/}).first().waitFor();return ms()-t;},
 'Open a plan (click → canvas drawn)':async(page,base)=>{await page.goto(`${base}/#Pipeline/Planning`);await page.reload();const open=page.getByRole('button',{name:/^Open/}).first();await open.waitFor();const t=ms();await open.click();await page.getByTestId('plan-canvas').getByText('Pave and compact asphalt').first().waitFor();return ms()-t;},
 'Select a plan activity (click → inspector)':async(page,base)=>{await page.goto(`${base}/#Pipeline/Planning`);await page.reload();await page.getByRole('button',{name:/^Open/}).first().click();const n=page.getByTestId('plan-canvas').getByText('Pave and compact asphalt').first();await n.waitFor();const t=ms();await n.click();await page.getByTestId('plan-inspector').waitFor();return ms()-t;},
 'Open Schedule list (navigate → cards)':async(page,base)=>{const t=ms();await page.goto(`${base}/#Schedule`);await page.reload();await page.getByRole('button',{name:'List',exact:true}).click();await page.locator('article').first().waitFor();return ms()-t;},
};
const samples={};for(const k of Object.keys(T))samples[k]={before:[],after:[]};
const ctxs={before:await session(URLS.before),after:await session(URLS.after)};
const pages={before:await ctxs.before.newPage(),after:await ctxs.after.newPage()};
for(const p of Object.values(pages))p.setDefaultTimeout(30000);
for(const [name,fn] of Object.entries(T)){
 if(process.env.ONLY&&!new RegExp(process.env.ONLY).test(name))continue;
 for(const side of ['before','after'])await fn(pages[side],URLS[side]).catch(()=>0);   // warm-up (not recorded)
 for(let i=0;i<RUNS;i++)for(const side of (i%2?['after','before']:['before','after'])){try{samples[name][side].push(await fn(pages[side],URLS[side]));}catch(e){samples[name][side].push(NaN);}}
}
const med=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);return s.length?s[Math.floor((s.length-1)/2)]:NaN;},p90=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.ceil(s.length*0.9)-1)]:NaN;};
const rows=Object.entries(samples).map(([k,v])=>({interaction:k,beforeMedianMs:Math.round(med(v.before)),afterMedianMs:Math.round(med(v.after)),beforeP90Ms:Math.round(p90(v.before)),afterP90Ms:Math.round(p90(v.after)),changePct:Math.round((med(v.after)-med(v.before))/med(v.before)*100),runs:v.before.filter(Number.isFinite).length}));
// page weight: the document and stylesheet a first load transfers
const weight={};for(const side of ['before','after']){const r=await ctxs[side].request.get(URLS[side]+'/login');weight[side]={html:(await r.body()).length};}
console.log('interaction'.padEnd(48),'before'.padStart(8),'after'.padStart(8),'change'.padStart(8),'  (median ms, p90 in brackets)');
for(const r of rows)console.log(r.interaction.padEnd(48),String(r.beforeMedianMs).padStart(8),String(r.afterMedianMs).padStart(8),`${r.changePct>0?'+':''}${r.changePct}%`.padStart(8),`  (${r.beforeP90Ms} / ${r.afterP90Ms})${r.changePct>10?'  ← REGRESSION >10%':''}`);
if(OUT)writeFileSync(OUT,JSON.stringify({runs:RUNS,rows,weight},null,1));
await browser.close();
