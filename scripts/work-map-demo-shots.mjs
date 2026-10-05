// Screenshots of the DEMO work map (desktop + mobile). Run the demo fixture first.
//   MYSQL_DATABASE=<x>_test BETTER_AUTH_URL=http://localhost:3190 node scripts/work-map-demo-shots.mjs <outDir>
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {seedWorkMapDemo} from './seed-work-map-demo.mjs';
const require=createRequire(import.meta.url);
const {chromium}=(()=>{for(const p of ['playwright','playwright-core'])try{return require(p);}catch{/* next */}throw new Error('Playwright is not available');})();
const OUT=process.argv[2]||'/tmp/work-map-demo',base=process.env.BETTER_AUTH_URL;mkdirSync(OUT,{recursive:true});
const demo=await seedWorkMapDemo({log:()=>{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']});
// Sign in once and reuse the session (the auth endpoint rate-limits repeated sign-ins).
const auth=await browser.newContext();{const page=await auth.newPage();await page.goto(base+'/login');
 const status=await page.evaluate(async d=>(await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:d.email,password:d.password})})).status,demo);
 if(status!==200)throw new Error('demo sign-in failed: '+status);}
const state=await auth.storageState();await auth.close();
const shoot=async(name,opts,fn)=>{const ctx=await browser.newContext({...opts,storageState:state});const page=await ctx.newPage();
 await page.goto(base+`/#Projects//${demo.projectId}/workmap`);await page.reload();await page.getByTestId('area-row').first().waitFor();await page.waitForTimeout(500);await fn(page);await page.screenshot({path:`${OUT}/${name}.png`,fullPage:name.includes('full')});await ctx.close();};
await shoot('demo-desktop-overview',{viewport:{width:1360,height:860}},async()=>{});
await shoot('demo-desktop-selected',{viewport:{width:1360,height:860}},async p=>{await p.getByTestId('area-row').filter({hasText:'Traffic control east'}).click();});
await shoot('demo-desktop-editing',{viewport:{width:1360,height:860}},async p=>{await p.getByTestId('area-row').filter({hasText:'Intersection asphalt patch'}).click();await p.getByTestId('area-edit').click();});
await shoot('demo-mobile-overview',{viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2},async p=>{await p.getByTestId('map-canvas').scrollIntoViewIfNeeded();});
await shoot('demo-mobile-list-full',{viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2},async p=>{await p.getByTestId('area-row').filter({hasText:'Stage 2'}).tap();});
await browser.close();console.log('screenshots in',OUT);
