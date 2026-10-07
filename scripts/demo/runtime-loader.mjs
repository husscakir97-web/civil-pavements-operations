import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {standaloneRuntimeProblem,skipNote} from './standalone-runtime.mjs';

// Never import loader/database code into the Next runtime or a build worker.
export const RUNTIME_ENV_KEYS=['PATH','HOME','TZ','NODE_ENV','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL_CA',
 'EXISTING_TENANT_LOAD','EXISTING_TENANT_ALLOWLIST_JSON','EXISTING_TENANT_CONFIRM_SHA256','EXISTING_TENANT_PLAN_HASH','EXISTING_TENANT_RESET_CONFIRM',
 'EXISTING_TENANT_BACKUP_EVIDENCE_JSON','EXISTING_TENANT_STATE_DIR','DEMO_SEED_PASSWORD','MAINTENANCE_UNTIL','STAGING_DEMO_MODE'];
export const runtimeLoaderEnv=env=>Object.fromEntries(RUNTIME_ENV_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
let started=false;
// Explicit opt-in (EXISTING_TENANT_RUNTIME_ENABLE=true and a load mode) plus the launcher-independent standalone-server proof (standalone-runtime.mjs):
// process.argv[1] is deliberately NOT used, because the host's process manager is the entry point. Build/CLI processes and the loader's own children
// never qualify (NEXT_PHASE, EXISTING_TENANT_RUNTIME_PARENT_PID and the stripped child environment). When opted in but declined, one concise private skip line.
export function startRuntimeLoader(env=process.env,argv=process.argv,root=process.cwd(),launch=spawn){
 if(started||env.EXISTING_TENANT_RUNTIME_ENABLE!=='true'||!env.EXISTING_TENANT_LOAD)return false;
 const problem=standaloneRuntimeProblem(env,root);
 if(problem){console.warn(skipNote('[existing-tenant-load] runtime hook',problem,argv));return false;}
 if(!existsSync(join(root,'.next','BUILD_ID'))||!existsSync(join(root,'scripts','existing-tenant-load.mjs')))
  throw new Error('Standalone loader assets are missing; refusing to start the loader.');
 started=true;
 const childEnv={...runtimeLoaderEnv(env),EXISTING_TENANT_RUNTIME_PARENT_PID:String(process.pid)};
 const child=launch(process.execPath,[join(root,'scripts','existing-tenant-load.mjs')],{cwd:root,env:childEnv,stdio:'inherit'});
 child.on('error',()=>console.error('[existing-tenant-load] runtime child could not start'));
 child.on('exit',code=>console.log('[existing-tenant-load] runtime child exit:',code));
 return true;
}
