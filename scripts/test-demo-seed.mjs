// Proves the demo-company seed on a disposable database: safety refusals, idempotence, tenant isolation and totals.
//   npm run build   then   MYSQL_DATABASE=demo_check_test node scripts/test-demo-seed.mjs     (database must be empty)
// Starts its own app (email disabled, no integrations) and signs up synthetic administrators. Nothing leaves the machine.
import {spawn,spawnSync} from 'node:child_process';
import {connect} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const PORT=Number(process.env.PORT||3192),base=`http://localhost:${PORT}`;
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'demo-seed-test-secret-with-at-least-32-characters',BETTER_AUTH_URL:base,R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x'};
const db=await connect();
const [[users]]=await db.query('SELECT COUNT(*) AS n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(users.n))throw new Error('Refusing to run: the database already has users. Use an empty disposable database.');
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});if(migrated.status!==0)throw new Error(migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
const results=[];const check=(name,ok,detail='')=>{results.push(Boolean(ok));console.log(`${ok?'PASS':'FAIL'}    ${name}${detail?' — '+detail:''}`);};
const password='Demo-Seed-Test-Password-42!',stamp=Date.now();
const signup=async(name,role)=>{const email=`${name}-${stamp}@kestrel-demo.example.invalid`;let r;for(let i=0;i<8;i++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,10000));}
 if(!r.ok)throw new Error('sign-up '+name+' '+r.status);const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);if(role)await db.query('UPDATE users SET role=? WHERE id=?',[role,u.id]);return {email,org:u.organisation_id,id:u.id};};
const seed=(who,extra=[],overrides={})=>{const r=spawnSync(process.execPath,['scripts/seed-demo-company.mjs','--base-url',overrides.base||base,...extra],{env:{...env,...(overrides.env||{}),DEMO_SEED_EMAIL:who.email,DEMO_SEED_PASSWORD:password},encoding:'utf8',timeout:900000});return {status:r.status,out:(r.stdout||'')+(r.stderr||'')};};
// every table that carries organisation_id, counted for one organisation
const tables=(await db.query("SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='organisation_id' AND TABLE_NAME NOT LIKE 'auth_%'"))[0].map(r=>r.TABLE_NAME);
const snapshot=async org=>{const out={};for(const t of tables){const [[r]]=await db.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE organisation_id=?`,[org]);if(Number(r.n))out[t]=Number(r.n);}return out;};
const diff=(a,b)=>Object.keys({...a,...b}).filter(k=>k!=='users'&&a[k]!==b[k]).map(k=>`${k}:${a[k]||0}->${b[k]||0}`);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}
 const A=await signup('demo-a'),B=await signup('demo-b'),C=await signup('bystander'),NONADMIN=await signup('not-admin');
 await db.query("UPDATE users SET organisation_id=?,role='estimator' WHERE id=?",[A.org,NONADMIN.id]);
 const Csnapshot=await snapshot(C.org),Bsnapshot0=await snapshot(B.org);

 // ---- safety refusals (nothing may change) ----
 const before=await snapshot(A.org);
 const refusals=[
  ['a database whose name does not end in _test',seed(A,[],{env:{MYSQL_DATABASE:'demo_prod'}})],
  ['a remote database host',seed(A,[],{env:{MYSQL_HOST:'db.example.com'}})],
  ['a non-local app URL',seed(A,[],{base:'https://app.example.com'})],
  ['EMAIL_ENABLED=true',seed(A,[],{env:{EMAIL_ENABLED:'true'}})],
  ['a configured SMTP host',seed(A,[],{env:{SMTP_HOST:'smtp.example.com'}})],
  ['a configured billing provider',seed(A,[],{env:{BILLING_PROVIDER:'stripe'}})],
  ['an enabled AI integration',seed(A,[],{env:{AI_ENABLED:'true'}})],
  ['NODE_ENV=production',seed(A,[],{env:{NODE_ENV:'production'}})],
  ['a non-administrator account',seed(NONADMIN)],
  ['an account that is not in this database',seed({email:'nobody@kestrel-demo.example.invalid'})],
 ];
 for(const [what,r] of refusals)check(`the seed refuses ${what}`,r.status===2&&/Refusing/.test(r.out),r.out.split('\n').find(l=>/Refusing|^ - /.test(l))||r.out.slice(0,80));
 check('refusals changed nothing',diff(before,await snapshot(A.org)).length===0);

 // ---- tenant A: seed twice ----
 const first=seed(A,['--manifest','/tmp/demo-a-manifest.json']);
 check('first run completes and every verification check passes',first.status===0&&!/FAIL/.test(first.out),first.status===0?'':first.out.slice(-400));
 const afterOne=await snapshot(A.org);
 const second=seed(A,['--manifest','/tmp/demo-a-manifest2.json']);
 check('second run completes and creates nothing (idempotent)',second.status===0&&/Created in this run: \{\}/.test(second.out),second.status===0?'':second.out.slice(-400));
 check('second run leaves every table of the organisation unchanged',diff(afterOne,await snapshot(A.org)).length===0,diff(afterOne,await snapshot(A.org)).join(', '));
 check('an unrelated tenant (never seeded) is untouched by seeding tenant A',diff(Csnapshot,await snapshot(C.org)).length===0);

 // ---- tenant B: independent copy; nothing crosses ----
 const afterA=await snapshot(A.org);
 const sb=seed(B);
 check('a second tenant can be seeded independently',sb.status===0&&!/FAIL/.test(sb.out),sb.status===0?'':sb.out.slice(-300));
 const afterB=await snapshot(B.org);
 check('tenant A is unchanged by seeding tenant B',diff(afterA,await snapshot(A.org)).length===0);
 check('tenant B received the same dataset (same table counts as A, ignoring audit rows)',diff(Object.fromEntries(Object.entries(afterOne).filter(([k])=>!/audit|domain_events/.test(k))),Object.fromEntries(Object.entries(afterB).filter(([k])=>!/audit|domain_events/.test(k)))).length===0,diff(afterOne,afterB).filter(x=>!/audit|domain_events/.test(x)).join(', '));
 check('the bystander tenant is still untouched',diff(Csnapshot,await snapshot(C.org)).length===0);
 check('no deterministic id is shared between tenants',(await db.query("SELECT COUNT(*) AS n FROM (SELECT id FROM users GROUP BY id HAVING COUNT(DISTINCT organisation_id)>1) x"))[0][0].n==0);
 check('every seeded plan, scenario and activity row belongs to exactly one organisation',(await db.query("SELECT COUNT(*) AS n FROM planning_activities a JOIN planning_scenarios s ON s.id=a.scenario_id WHERE a.organisation_id<>s.organisation_id"))[0][0].n==0);
 void Bsnapshot0;
}catch(e){console.log('FAIL    aborted — '+String(e.stack||e).slice(0,600));results.push(false);}
finally{server.kill();await db.end();const failed=results.filter(x=>!x).length;console.log(`\n${results.length-failed} passed, ${failed} failed`);process.exit(failed?1:0);}
