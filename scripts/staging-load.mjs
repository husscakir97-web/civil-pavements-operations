// One-shot demo loading for Hostinger's MANAGED Node.js hosting, where npm/node cannot be assumed to be available in a shell: the load runs
// from the application's own start command (scripts/start.mjs) as a background child, controlled ONLY by environment variables, and is inert
// unless STAGING_DEMO_MODE=true AND STAGING_DEMO_LOAD is set. It never replaces a guard: it builds the importer's own allow-list file from
// STAGING_DEMO_ALLOWLIST_JSON and runs scripts/import-demo-tenant.mjs / staging-verify.mjs exactly as an operator would.
//   STAGING_DEMO_LOAD=plan    dry run: prints the plan and its hash to the runtime log (read-only)
//   STAGING_DEMO_LOAD=apply   needs STAGING_DEMO_PLAN_HASH (the reviewed hash) and DEMO_SEED_PASSWORD (the administrator's, set only for this run)
//   STAGING_DEMO_LOAD=verify  read-only verification
// Resume: the baseline is kept in STAGING_DEMO_STATE_DIR (default ~/.staging-demo-state). If the host discards it, an interrupted import is
// not resumable: recreate the empty staging database and start again (it is disposable by design).
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,readFileSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {stagingActive} from '../lib/platform/staging-policy.mjs';
import {connect} from './mysql-config.mjs';

const log=(...a)=>console.log('[staging-load]',...a);
export async function stagingLoad(env=process.env){
 const mode=String(env.STAGING_DEMO_LOAD||'').trim().toLowerCase();
 if(!stagingActive(env)||!mode)return 0;
 if(!['plan','apply','verify'].includes(mode)){log('STAGING_DEMO_LOAD must be plan, apply or verify; nothing was done.');return 2;}
 if(!env.STAGING_DEMO_ALLOWLIST_JSON){log('STAGING_DEMO_ALLOWLIST_JSON is not set; nothing was done.');return 2;}
 let org;
 try{
  const db=await connect();try{const [rows]=await db.query('SELECT id FROM organisations');if(rows.length!==1){log(`expected exactly one organisation (found ${rows.length}); register the administrator first. Nothing was done.`);return 2;}org=rows[0].id;}finally{await db.end();}
 }catch(e){log('could not read the staging database; nothing was done:',String(e.message).split('\n')[0]);return 2;}
 const dir=mkdtempSync(join(tmpdir(),'staging-load-'));chmodSync(dir,0o700);
 const allow=join(dir,'allow.json');writeFileSync(allow,env.STAGING_DEMO_ALLOWLIST_JSON,{mode:0o600});
 const base=['--organisation-id',org,'--staging-allowlist',allow];
 const childEnv={...env,DEMO_SEED_EMAIL:env.STAGING_DEMO_ADMIN_EMAIL,STAGING_DEMO_CONFIRM_SHA256:env.STAGING_DEMO_CONFIRM_SHA256};
 let script,args;
 if(mode==='plan'){
  script='scripts/import-demo-tenant.mjs';args=base;
  // after an interruption the plan must see the saved baseline, otherwise it cannot tell the import's own records from anyone else's
  const baseline=join(env.STAGING_DEMO_STATE_DIR||join(homedir(),'.staging-demo-state'),'baseline.json');
  if(existsSync(baseline))args=[...base,'--baseline',baseline,'--baseline-sha256',createHash('sha256').update(readFileSync(baseline)).digest('hex')];
 }
 else if(mode==='verify'){script='scripts/staging-verify.mjs';args=base;}
 else{
  if(!/^[0-9a-f]{64}$/.test(env.STAGING_DEMO_PLAN_HASH||'')){log('apply needs STAGING_DEMO_PLAN_HASH (the hash printed by the plan run); nothing was done.');return 2;}
  if(!env.DEMO_SEED_PASSWORD){log('apply needs DEMO_SEED_PASSWORD (set it only for this run, then remove it); nothing was done.');return 2;}
  const state=env.STAGING_DEMO_STATE_DIR||join(homedir(),'.staging-demo-state');mkdirSync(state,{recursive:true,mode:0o700});
  const baseline=join(state,'baseline.json');
  script='scripts/import-demo-tenant.mjs';args=[...base,'--apply','--plan-hash',env.STAGING_DEMO_PLAN_HASH,'--baseline',baseline];
  if(existsSync(baseline))args.push('--baseline-sha256',createHash('sha256').update(readFileSync(baseline)).digest('hex'));
 }
 log(`mode=${mode} organisation=${org}`);
 const code=await new Promise(res=>{const c=spawn(process.execPath,[script,...args],{env:childEnv,stdio:'inherit'});c.on('exit',x=>res(x??1));c.on('error',()=>res(1));});
 rmSync(dir,{recursive:true,force:true});
 log(`${mode} finished with exit code ${code}. Set STAGING_DEMO_LOAD back to empty (and remove DEMO_SEED_PASSWORD) after an apply.`);
 return code;
}
if(import.meta.url===`file://${process.argv[1]}`)process.exitCode=await stagingLoad();
