import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Never import loader/database code into the Next runtime or a build worker.
export const RUNTIME_ENV_KEYS=['PATH','HOME','TZ','NODE_ENV','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL_CA',
 'EXISTING_TENANT_LOAD','EXISTING_TENANT_ALLOWLIST_JSON','EXISTING_TENANT_CONFIRM_SHA256','EXISTING_TENANT_PLAN_HASH',
 'EXISTING_TENANT_BACKUP_EVIDENCE_JSON','EXISTING_TENANT_STATE_DIR','DEMO_SEED_PASSWORD','MAINTENANCE_UNTIL','STAGING_DEMO_MODE'];
export const runtimeLoaderEnv=env=>Object.fromEntries(RUNTIME_ENV_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
let started=false;
export function startRuntimeLoader(env=process.env,argv=process.argv,root=process.cwd(),launch=spawn){
 if(started||env.NODE_ENV!=='production'||env.EXISTING_TENANT_RUNTIME_ENABLE!=='true'||!env.EXISTING_TENANT_LOAD||
    !env.__NEXT_PRIVATE_STANDALONE_CONFIG||resolve(argv[1]||'')!==join(root,'server.js'))return false;
 if(!existsSync(join(root,'.next','BUILD_ID'))||!existsSync(join(root,'scripts','existing-tenant-load.mjs')))
  throw new Error('Standalone loader assets are missing; refusing to start the loader.');
 started=true;
 const childEnv={...runtimeLoaderEnv(env),EXISTING_TENANT_RUNTIME_PARENT_PID:String(process.pid)};
 const child=launch(process.execPath,[join(root,'scripts','existing-tenant-load.mjs')],{cwd:root,env:childEnv,stdio:'inherit'});
 child.on('error',()=>console.error('[existing-tenant-load] runtime child could not start'));
 child.on('exit',code=>console.log('[existing-tenant-load] runtime child exit:',code));
 return true;
}
