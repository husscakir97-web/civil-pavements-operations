// Screenshots of the screens covered by the Graphite Studio redesign, on the existing FULL synthetic demo company (disposable local database only).
//   BASE_URL=http://localhost:3301 DEMO_SEED_EMAIL=... DEMO_SEED_PASSWORD=... MYSQL_* node scripts/graphite-shots.mjs <outDir> [prefix]
import {createRequire} from 'node:module';
import {mkdirSync,existsSync} from 'node:fs';
import {connect} from './mysql-config.mjs';
const require=createRequire(import.meta.url);
const base=process.env.BASE_URL,email=process.env.DEMO_SEED_EMAIL,password=process.env.DEMO_SEED_PASSWORD;
if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base||''))throw new Error('BASE_URL must be a local test app');
const OUT=process.argv[2]||'/tmp/graphite-shots',PREFIX=process.argv[3]||'';mkdirSync(OUT,{recursive:true});
const {chromium}=(()=>{for(const p of ['playwright','playwright-core','/opt/node22/lib/node_modules/playwright']){try{return require(p);}catch{/* next */}}throw new Error('Playwright not found');})();
const CHROMIUM=['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const db=await connect();const [[org]]=await db.query("SELECT organisation_id o FROM users WHERE email=?",[email]);
const proj=async frag=>(await db.query("SELECT id FROM jobs WHERE organisation_id=? AND name LIKE ? ORDER BY created_at LIMIT 1",[org.o,`%${frag}%`]))[0][0].id;
const B1=await proj('Quarry Road'),B3=await proj('Coastal Motorway');await db.end();
const browser=await chromium.launch({executablePath:CHROMIUM,args:['--no-sandbox']});
const login=async ctx=>{const r=await ctx.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}});if(!r.ok())throw new Error('sign-in '+r.status());};
async function run(label,viewport,mobile){
 const ctx=await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1});await login(ctx);const page=await ctx.newPage();page.setDefaultTimeout(30000);
 const shot=async name=>{await page.waitForTimeout(700);await page.screenshot({path:`${OUT}/${PREFIX}${label}-${name}.png`});};
 const go=async hash=>{await page.goto(base+'/'+hash);await page.reload();await page.waitForTimeout(1500);};
 await go('#Home');await shot('1-home');
 await go(`#Projects//${B1}/workmap`);await page.getByTestId('work-map').waitFor();
 await page.getByTestId('area-row').first().waitFor();
 const row=page.getByTestId('area-row').filter({hasText:'Asphalt ch 0–800'}).first();if(await row.count()){await row.scrollIntoViewIfNeeded();await row.click();}
 await page.getByTestId('map-canvas').scrollIntoViewIfNeeded();await shot('2-workmap-selected');
 await page.evaluate(()=>window.scrollTo(0,0));await shot('2b-workmap-top');
 await go(`#Projects//${B3}/workmap`);await page.getByTestId('work-map').waitFor();await shot('3-workmap-moved');
 await go('#Pipeline/Planning');await page.waitForTimeout(800);await shot('4-planning-list');
 const open=page.getByRole('button',{name:'Open',exact:true}).first();if(await open.count()){await open.click();await page.getByTestId('plan-canvas').waitFor().catch(()=>{});await page.waitForTimeout(800);await shot('5-planning-editor');
  const node=page.locator('[data-testid="plan-canvas"]').getByText('Pave and compact asphalt').first();if(await node.isVisible()){await node.click();await page.waitForTimeout(500);await shot('6-planning-selected');}}
 await go('#Schedule');await shot('7-schedule');
 await ctx.close();
}
await run('desktop',{width:1440,height:900},false);
await run('mobile',{width:390,height:844},true);
await browser.close();console.log('screenshots in',OUT);
