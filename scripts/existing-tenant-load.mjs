// Hosted loader for adding the demonstration dataset to an EXISTING tenant (docs/EXISTING-TENANT-DEMO-IMPORT.md). Runs from the app's own
// start command (scripts/start.mjs) because Hostinger's managed Node.js hosting cannot be assumed to give a shell or npm. Inert unless
// EXISTING_TENANT_LOAD is set. It does not weaken or replace any guard: it writes the reviewed allow-list (and backup evidence) from
// environment variables to private temp files and runs the same importer/verifier an operator would. The child process receives ONLY
// the database settings and the values below: no email, SMS, billing, AI, ABR, map or storage settings, so nothing external can be reached
// (the importer's own temporary app is additionally built from a fixed whitelist). Modes:
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

const log=(...a)=>console.log('[existing-tenant-load]',...a);
export const CHILD_ENV_KEYS=['PATH','HOME','TZ','NODE_ENV','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL_CA','DEMO_SEED_PASSWORD','EXISTING_TENANT_CONFIRM_SHA256'];
export async function existingTenantLoad(env=process.env){
 const mode=String(env.EXISTING_TENANT_LOAD||'').trim().toLowerCase();
 if(!mode)return 0;
 if(!['fingerprint','plan','apply','verify'].includes(mode)){log('EXISTING_TENANT_LOAD must be fingerprint, plan, apply or verify; nothing was done.');return 2;}
 if(!env.EXISTING_TENANT_ALLOWLIST_JSON){log('EXISTING_TENANT_ALLOWLIST_JSON is not set; nothing was done.');return 2;}
 const dir=mkdtempSync(join(tmpdir(),'existing-tenant-'));chmodSync(dir,0o700);
 const cleanup=()=>rmSync(dir,{recursive:true,force:true});
 try{
  const allow=join(dir,'allow.json');writeFileSync(allow,env.EXISTING_TENANT_ALLOWLIST_JSON,{mode:0o600});
  let entry;try{entry=JSON.parse(env.EXISTING_TENANT_ALLOWLIST_JSON);}catch{log('the allow-list is not valid JSON; nothing was done.');return 2;}
  const childEnv=Object.fromEntries(CHILD_ENV_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
  childEnv.DEMO_SEED_EMAIL=entry.adminEmail;
  // exact target first, before any connection (the importer repeats it)
  const pre=evaluateExistingTenantAllowlist(allow,{...childEnv,STAGING_DEMO_MODE:env.STAGING_DEMO_MODE});
  if(pre.problems.length){log('refused (nothing was connected or changed):\n - '+pre.problems.join('\n - '));return 2;}
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
  const code=await new Promise(res=>{const c=spawn(process.execPath,[script,...args],{env:childEnv,stdio:'inherit'});c.on('exit',x=>res(x??1));c.on('error',()=>res(1));});
  log(`${mode} finished with exit code ${code}.${mode==='apply'?' Now empty EXISTING_TENANT_LOAD and delete DEMO_SEED_PASSWORD, EXISTING_TENANT_PLAN_HASH and EXISTING_TENANT_BACKUP_EVIDENCE_JSON.':''}`);
  return code;
 }catch(e){log('failed:',String(e.message).split('\n')[0]);return 1;}
 finally{cleanup();}
}
if(import.meta.url===`file://${process.argv[1]}`)process.exitCode=await existingTenantLoad();
