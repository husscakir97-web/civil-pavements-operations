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
// Hosts such as Hostinger capture the app's own console but not file descriptors a child inherits, so the child's output (fingerprint, plan, refusals) never reached
// the Runtime logs. The child therefore writes to pipes and the parent relays it line by line through its own console: stdout -> console.log, stderr -> console.error.
// Exit codes are untouched (this only changes where text goes). Values of password/secret/token variables are redacted from relayed text, and a line is capped so a
// child without newlines cannot make the parent buffer without bound.
export const MAX_RELAY_LINE=16384;
export function redactor(env){
 const secrets=[...new Set(Object.entries(env).filter(([k,v])=>RUNTIME_ENV_KEYS.includes(k)&&/PASSWORD|SECRET|TOKEN/i.test(k)&&typeof v==='string'&&v.length>=4).map(([,v])=>v))].sort((a,b)=>b.length-a.length);
 return text=>{let t=text;for(const secret of secrets)t=t.split(secret).join('[redacted]');return t;};
}
export function relayLines(stream,write,redact){
 let buf='';
 // every emitted piece is at most MAX_RELAY_LINE characters, whether or not the child ever sent a newline
 const emit=text=>{do{write(redact(text.slice(0,MAX_RELAY_LINE)));text=text.slice(MAX_RELAY_LINE);}while(text.length);};
 stream.setEncoding?.('utf8');
 stream.on('data',chunk=>{
  buf+=chunk;let i;
  while((i=buf.indexOf('\n'))>=0){emit(buf.slice(0,i).replace(/\r$/,''));buf=buf.slice(i+1);}
  while(buf.length>MAX_RELAY_LINE){emit(buf.slice(0,MAX_RELAY_LINE));buf=buf.slice(MAX_RELAY_LINE);}
 });
 stream.on('end',()=>{if(buf){emit(buf);buf='';}});
}
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
 const child=launch(process.execPath,[join(root,'scripts','existing-tenant-load.mjs')],{cwd:root,env:childEnv,stdio:['ignore','pipe','pipe']});
 const redact=redactor(env);
 if(child.stdout)relayLines(child.stdout,line=>console.log(line),redact);
 if(child.stderr)relayLines(child.stderr,line=>console.error(line),redact);
 child.on('error',()=>console.error('[existing-tenant-load] runtime child could not start'));
 // 'close' fires after the child's pipes are drained, so every relayed line precedes the exit line; the timer only covers a grandchild that keeps a pipe open.
 let reported=false;const report=code=>{if(!reported){reported=true;console.log('[existing-tenant-load] runtime child exit:',code);}};
 child.on('exit',code=>{setTimeout(()=>report(code),2000).unref?.();});
 child.on('close',code=>report(code));
 return true;
}
