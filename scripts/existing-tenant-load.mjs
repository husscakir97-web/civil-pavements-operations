// Hosted loader for adding the demonstration dataset to an EXISTING tenant (docs/EXISTING-TENANT-DEMO-IMPORT.md). Runs from the app's own
// start command (scripts/start.mjs), or the opt-in standalone runtime hook, because managed hosting cannot assume a shell or npm. Inert unless
// EXISTING_TENANT_LOAD is set. It does not weaken or replace any guard: it writes the reviewed allow-list (and backup evidence) from
// environment variables to private temp files and runs the same importer/verifier an operator would. The child process receives ONLY
// the database settings and the values below: no email, SMS, billing, AI, ABR, map or storage settings, so nothing external can be reached
// (the importer's own temporary app is additionally built from a fixed whitelist). Modes:
//   (fingerprint, plan and apply refuse unless MAINTENANCE_UNTIL puts this app into bounded maintenance: every request is refused with a 503)
//   fingerprint   read-only: prints the database fingerprint to put in the backup evidence (take it right after the backup, with writes frozen)
//   plan          read-only: prints the plan, its conflicts and its hash
//   apply         the reviewed import; needs EXISTING_TENANT_PLAN_HASH, EXISTING_TENANT_BACKUP_EVIDENCE_JSON (first apply), DEMO_SEED_PASSWORD
//   verify        read-only verification of the demonstration records
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,readFileSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';
import {evaluateExistingTenantAllowlist,databaseFingerprint} from './demo/existing-tenant.mjs';
import {maintenanceWindowProblems,importDeadlineMs,MIN_REMAINING_APPLY_MINUTES,KILL_GRACE_SECONDS} from '../lib/platform/maintenance-policy.mjs';
import {quiesce} from './demo/quiesce.mjs';
import {acquireLoaderLock} from './demo/loader-lock.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

const log=(...a)=>console.log('[existing-tenant-load]',...a);
export const CHILD_ENV_KEYS=['PATH','HOME','TZ','NODE_ENV','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL_CA','DEMO_SEED_PASSWORD','EXISTING_TENANT_CONFIRM_SHA256'];
export async function existingTenantLoad(env=process.env){
 const mode=String(env.EXISTING_TENANT_LOAD||'').trim().toLowerCase();
 if(!mode)return 0;
 if(!['fingerprint','plan','apply','verify'].includes(mode)){log('EXISTING_TENANT_LOAD must be fingerprint, plan, apply or verify; nothing was done.');return 2;}
 if(!env.EXISTING_TENANT_ALLOWLIST_JSON){log('EXISTING_TENANT_ALLOWLIST_JSON is not set; nothing was done.');return 2;}
 const dir=mkdtempSync(join(tmpdir(),'existing-tenant-'));chmodSync(dir,0o700);
 const cleanup=()=>rmSync(dir,{recursive:true,force:true});
 let lease,heartbeat;
 try{
  const allow=join(dir,'allow.json');writeFileSync(allow,env.EXISTING_TENANT_ALLOWLIST_JSON,{mode:0o600});
  let entry;try{entry=JSON.parse(env.EXISTING_TENANT_ALLOWLIST_JSON);}catch{log('the allow-list is not valid JSON; nothing was done.');return 2;}
  const childEnv=Object.fromEntries(CHILD_ENV_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
  childEnv.DEMO_SEED_EMAIL=entry.adminEmail;
  // exact target first, before any connection (the importer repeats it)
  const pre=evaluateExistingTenantAllowlist(allow,{...childEnv,STAGING_DEMO_MODE:env.STAGING_DEMO_MODE});
  if(pre.problems.length){log('refused (nothing was connected or changed):\n - '+pre.problems.join('\n - '));return 2;}
  // THE FREEZE: fingerprint, plan and apply only run while this very app (same environment) is refusing every request, so no user, webhook or
  // device can write between the backup and the import. Without it the fingerprint would only detect a change after the fact.
  if(['fingerprint','plan','apply'].includes(mode)){const mp=maintenanceWindowProblems(env,Date.now(),mode==='apply'?MIN_REMAINING_APPLY_MINUTES:undefined);if(mp.length){log('refused (nothing was connected or changed): the write freeze is not in force:\n - '+mp.join('\n - '));return 2;}}
  lease=await connect();
  if(!await acquireLoaderLock(lease,env.MYSQL_DATABASE,entry.organisationId)){log('another loader/import is running; no quiescence or import was attempted.');return 3;}
  // A lost mutex session must never leave its child running without ownership.
  // The importer already detects a dead loader and exits before further writes.
  const lost=()=>{log('loader lock connection lost; stopping (resumable).');process.exit(76);};
  lease.on('error',lost);
  heartbeat=setInterval(()=>lease.ping().catch(lost),15_000);heartbeat.unref();
  // Before anything runs: clear any database session left over from an earlier, killed run (an in-flight statement of a dead importer can keep running
  // on the server). Safe because the app is in maintenance, so the only active sessions can be an importer's.
  if(['fingerprint','plan','apply'].includes(mode)){
   try{const q=await quiesce(lease);log(`database quiescence before ${mode}: killed ${q.killed} leftover session(s), ${q.remaining} still active`);if(q.remaining){log('refused: sessions are still active in the database; nothing was changed. Wait and restart.');return 3;}}
   catch(e){log('could not check the database for leftover sessions; nothing was done:',String(e.message).split('\n')[0]);return 2;}
  }
  const base=['--organisation-id',entry.organisationId,'--existing-tenant-allowlist',allow];
  let script,args;
  if(mode==='fingerprint'){
   const db=await connect();try{log('fingerprint: '+await databaseFingerprint(db));}finally{await db.end();}
   log('Put this value in the backup evidence as "fingerprint" (taken right after the backup, with no writes since). It changes if anything is written.');
   return 0;
  }
  if(mode==='plan'){script='scripts/import-demo-tenant.mjs';args=base;}
  else if(mode==='verify'){script='scripts/existing-tenant-verify.mjs';args=base;}
  else{
   if(!/^[0-9a-f]{64}$/.test(env.EXISTING_TENANT_PLAN_HASH||'')){log('apply needs EXISTING_TENANT_PLAN_HASH (the hash printed by the plan run); nothing was done.');return 2;}
   if(!env.DEMO_SEED_PASSWORD){log('apply needs DEMO_SEED_PASSWORD (the administrator password, set only for this run); nothing was done.');return 2;}
   const state=env.EXISTING_TENANT_STATE_DIR||join(homedir(),'.existing-tenant-state');mkdirSync(state,{recursive:true,mode:0o700});
   const baseline=join(state,'baseline.json');
   script='scripts/import-demo-tenant.mjs';args=[...base,'--apply','--plan-hash',env.EXISTING_TENANT_PLAN_HASH,'--baseline',baseline];
   if(existsSync(baseline))args.push('--baseline-sha256',createHash('sha256').update(readFileSync(baseline)).digest('hex'));
   else{
    if(!env.EXISTING_TENANT_BACKUP_EVIDENCE_JSON){log('the first apply needs EXISTING_TENANT_BACKUP_EVIDENCE_JSON; nothing was done.');return 2;}
    const ev=join(dir,'evidence.json');writeFileSync(ev,env.EXISTING_TENANT_BACKUP_EVIDENCE_JSON,{mode:0o600});args.push('--backup-evidence',ev);
   }
  }
  // the state directory holds the resume baseline; plan/verify read it too so the plan can tell the import's own records from the owner's
  if(mode==='plan'||mode==='verify'){const baseline=join(env.EXISTING_TENANT_STATE_DIR||join(homedir(),'.existing-tenant-state'),'baseline.json');if(mode==='plan'&&existsSync(baseline))args.push('--baseline',baseline,'--baseline-sha256',createHash('sha256').update(readFileSync(baseline)).digest('hex'));}
  log(`mode=${mode} organisation=${entry.organisationId}`);
  // APPLY has a deadline: the importer stops issuing ANY mutation DEADLINE_MARGIN_SECONDS before the freeze ends (it refuses further writes itself and exits 75),
  // is terminated (whole process group) if it is still alive shortly after, and the database is then checked to be quiet before the freeze is allowed to lapse.
  let deadline=0;
  if(mode==='apply'){deadline=importDeadlineMs(Date.parse(env.MAINTENANCE_UNTIL));args.push('--deadline-ms',String(deadline));log('import deadline: '+new Date(deadline).toISOString()+' (the importer makes no change after this; maintenance ends '+new Date(Date.parse(env.MAINTENANCE_UNTIL)).toISOString()+')');}
  const timers=[];
  const code=await new Promise(res=>{
   const c=spawn(process.execPath,[join(root,script),...args],{cwd:root,env:childEnv,stdio:'inherit',detached:mode==='apply'});
   if(deadline){const killGroup=sig=>{try{process.kill(-c.pid,sig);}catch{/* gone */}};
    timers.push(setTimeout(()=>{log('the importer is still running after its deadline: stopping it');killGroup('SIGTERM');},Math.max(0,deadline-Date.now())+KILL_GRACE_SECONDS[0]*1000),setTimeout(()=>killGroup('SIGKILL'),Math.max(0,deadline-Date.now())+KILL_GRACE_SECONDS[1]*1000));}
   c.on('exit',x=>res(x??1));c.on('error',()=>res(1));
  });
  timers.forEach(clearTimeout);
  let quiet=true;
  if(mode==='apply'){
   try{const q=await quiesce(lease);quiet=q.remaining===0;log(`database quiescence after the importer stopped: killed ${q.killed} active session(s), ${q.remaining} still active (${q.ms} ms)`);if(!quiet)log('NOT QUIET: do not lift maintenance; wait, then restart and check again');}catch(e){quiet=false;log('could not confirm database quiescence:',String(e.message).split('\n')[0]);}
   if(code===75)log('stopped at the deadline: nothing was changed after it. Extend MAINTENANCE_UNTIL, restart with EXISTING_TENANT_LOAD=plan, then apply with the new hash to resume.');
  }
  const finalCode=quiet?code:(code||3);
  log(`${mode} finished with exit code ${finalCode}.${mode==='apply'?' Now empty EXISTING_TENANT_LOAD and delete DEMO_SEED_PASSWORD, EXISTING_TENANT_PLAN_HASH and EXISTING_TENANT_BACKUP_EVIDENCE_JSON.':''}`);
  return finalCode;
 }catch(e){log('failed:',String(e.message).split('\n')[0]);return 1;}
 finally{clearInterval(heartbeat);try{if(lease)await lease.end();}finally{cleanup();}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const parent=Number(process.env.EXISTING_TENANT_RUNTIME_PARENT_PID);
 // Linux re-parents immediately, even when the old parent is an unreaped zombie.
 const watchdog=parent?setInterval(()=>{if(process.ppid!==parent)process.exit(76);},300):null;
 watchdog?.unref();
 try{process.exitCode=await existingTenantLoad();}finally{clearInterval(watchdog);}
}
