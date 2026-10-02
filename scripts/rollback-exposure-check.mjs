// Rehearsal of the rollback hazard and its containment (docs/CONNECTED-JOB-RELEASE-CANDIDATE.md). Not part of CI: it needs a BUILT copy of the
// previous main (b8a75ae). Synthetic data, disposable *_test database, email off, no deployment.
//   git worktree add /tmp/old-main b8a75ae && ln -s "$PWD/node_modules" /tmp/old-main/node_modules && (cd /tmp/old-main && npm run build)
//   MYSQL_DATABASE=rollback_test OLD_BUILD_DIR=/tmp/old-main node scripts/rollback-exposure-check.mjs
// Shows: (1) the OLD build returns direct_cost_rate to a site engineer once 0025 data exists, (2) after `contain` the same request is
// refused and no rate remains, (3) after `release` the old build serves the programme again with the rates gone.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const OLD=process.env.OLD_BUILD_DIR;if(!OLD||!existsSync(OLD+'/.next'))throw new Error('Set OLD_BUILD_DIR to a built checkout of the previous main');
const PORT=Number(process.env.PORT||3189),base=`http://localhost:${PORT}`;
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'rollback-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:base,R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET_NAME:'test-bucket'};
const results=[];const check=(step,ok,detail='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}    ${step}${detail?' — '+detail:''}`);};
const db=await connect();
const [[existing]]=await db.query('SELECT COUNT(*) AS n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(existing.n)!==0)throw new Error('Refusing to run: the disposable database already has users.');
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});if(migrated.status!==0)throw new Error(migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,cwd:OLD,stdio:'ignore'});
const dir=mkdtempSync(join(tmpdir(),'rollback-'));let failed=true;
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}
 const stamp=Date.now(),password='Very-strong-test-password-42';
 const signup=async(name)=>{const email=`${name}-${stamp}@example.invalid`;let r;for(let a=0;a<6;a++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,10000));}
  const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);return {id:u.id,org:u.organisation_id,cookie};};
 const call=async(who,path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{origin:base,cookie:who.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j};};
 const admin=await signup('rb-admin'),site=await signup('rb-site');
 await db.query("UPDATE users SET organisation_id=?,role='site_engineer' WHERE id=?",[admin.org,site.id]);
 const made=await call(admin,'/api/projects','POST',{name:'Rollback rehearsal project'});if(made.status!==201)throw new Error('project: '+made.status+' '+JSON.stringify(made.body).slice(0,200));
 const [[job]]=await db.query('SELECT id FROM jobs WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1',[admin.org]);const projectId=job.id;
 await call(admin,'/api/projects/team','POST',{projectId,userId:site.id,projectRole:'site_engineer'});
 const created=await call(admin,'/api/projects/program','POST',{projectId,name:'Pipe laying',startDate:'2026-10-05',durationDays:3,predecessorId:null,responsible:'',workPackage:'',resourceRequirement:'',plannedQuantity:1,quantityUnit:'m',productionPerDay:1,status:'planned'});
 if(created.status!==200)throw new Error('could not create an activity on the old build: '+JSON.stringify(created.body).slice(0,200));
 // the state after the NEW build has saved costing assumptions (migration 0025 columns populated)
 await db.query("UPDATE program_activities SET direct_cost_rate=95,productive_hours_per_day=8,source_estimate_revision_id='rev',source_estimate_item_id='item' WHERE organisation_id=?",[admin.org]);
 const seen=async()=>{const r=await call(site,'/api/projects/program?projectId='+projectId);return {status:r.status,rate:r.body?.activities?.[0]?.direct_cost_rate};};
 const before=await seen();
 check('HAZARD REPRODUCED: the previous build returns direct_cost_rate to a site engineer once 0025 data exists',before.status===200&&Number(before.rate)===95,JSON.stringify(before));
 const tool=(...a)=>spawnSync(process.execPath,['scripts/programme-costing-containment.mjs',...a],{env,encoding:'utf8'});
 const state=join(dir,'state.json'),backup=join(dir,'backup.sql');writeFileSync(backup,'-- synthetic rehearsal backup (disposable database)');
 const contained=tool('contain','--state',state,'--backup-file',backup,'--approved-by','Rehearsal operator, test',  '--confirm');
 check('Containment runs and verifies',contained.status===0&&/Remaining exposed rows: 0; organisations still able to open Projects: 0/.test(contained.stdout),contained.stdout.trim().split('\n').pop());
 const during=await seen();
 check('While contained, the previous build refuses the programme to the site engineer (404) and no rate is returned',during.status===404&&during.rate===undefined,JSON.stringify(during));
 const [[leak]]=await db.query('SELECT COUNT(*) AS n FROM program_activities WHERE direct_cost_rate IS NOT NULL OR source_estimate_revision_id IS NOT NULL OR source_estimate_item_id IS NOT NULL');
 check('No financial value remains in the database',Number(leak.n)===0);
 const released=tool('release','--state',state,'--confirm');
 const after=await seen();
 check('After release the previous build serves the programme again, with no rate exposed',released.status===0&&after.status===200&&(after.rate===null||after.rate===undefined),JSON.stringify(after));
 failed=results.includes(false);
}catch(e){console.log('FAIL    '+String(e.stack||e).slice(0,500));}
finally{server.kill();await db.end();rmSync(dir,{recursive:true,force:true});console.log(`\n${results.filter(Boolean).length} passed, ${results.filter(x=>!x).length+(failed&&!results.includes(false)?1:0)} failed`);process.exit(failed?1:0);}
