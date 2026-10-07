// The importer starts its OWN application instance, so the writer is bound to the database that was verified and to a safe
// configuration by construction: the app gets exactly the importer's (already verified) MYSQL_* settings, a random auth secret,
// and every external integration switched off or pointed at nothing. It listens on a free local port only. An already-running app
// can never be used, because nothing outside this process can prove what database or integrations it is configured with.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});s.on('error',reject);});

/** Environment for the isolated app: copied database settings, nothing else from the importer's environment. */
export function isolatedAppEnv(source,base){
 // Next otherwise reloads deployment .env files and repopulates secrets/settings
 // deliberately omitted here. Pin/test this @next/env contract on Next upgrades.
 const e={PATH:source.PATH||'',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',EMAIL_ENABLED:'false',AI_ENABLED:'false',LOCATION_PROVIDER:'fake',
  BETTER_AUTH_SECRET:randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,
  R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x'};
 for(const k of ['HOME','TZ','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL_CA'])if(source[k]!==undefined)e[k]=source[k];
 return e;
}

// ---- startup diagnostics ----
// When the isolated app does not become ready, the operator must be able to see WHY from the host's log: what the supervisor and the server printed, and
// what the last readiness probe got. Output is kept in a bounded buffer and redacted before it is logged, including a credential split across chunks
// (redaction runs over the whole buffered text, never per chunk). Nothing here changes the timeout, the guards or what the importer does.
export const DIAG_RAW_CAP=65536,DIAG_TAIL_CHARS=4096;
const SECRET_NAME=/PASSWORD|SECRET|TOKEN/i;
/** Values of credential-named variables (length >= 4), longest first so a value that contains another is replaced whole. */
export function diagnosticSecrets(...envs){
 const out=new Set();
 for(const env of envs)for(const [k,v] of Object.entries(env||{}))if(SECRET_NAME.test(k)&&typeof v==='string'&&v.length>=4)out.add(v);
 return [...out].sort((a,b)=>b.length-a.length);
}
/** Redact known credential values and any 64-hex run (the isolated app's generated auth secret is one, and is not known to the importer). */
export const redactDiagnostic=(text,secrets)=>{let t=String(text);for(const v of secrets)t=t.split(v).join('[redacted]');return t.replace(/[0-9a-f]{64}/gi,'[redacted]');};
/** Bounded tail of a stream. text() drops a first line cut by the cap, redacts the WHOLE buffer, then keeps at most `max` chars. */
export function outputTail(secrets,cap=DIAG_RAW_CAP,max=DIAG_TAIL_CHARS){
 let raw='',truncated=false;
 return {
  push(chunk){raw+=chunk;if(raw.length>cap){raw=raw.slice(raw.length-cap);truncated=true;}},
  text(){let t=raw;if(truncated){const i=t.indexOf('\n');t=i>=0?t.slice(i+1):'';}t=redactDiagnostic(t,secrets).trimEnd();return t.length>max?'...'+t.slice(t.length-max):t;}
 };
}
const describeProbeError=e=>String(e?.cause?.code||e?.code||e?.name||'error').replace(/[^\w.-]/g,'').slice(0,40)||'error';

/** `opts` exist for tests only; the defaults are the production values (180 probes, 500 ms apart = 90 s). */
export async function startIsolatedApp(source=process.env,{attempts=180,intervalMs=500,log=(...a)=>console.error(...a)}={}){
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const env=isolatedAppEnv(source,base),secrets=diagnosticSecrets(source,env);
 const stdout=outputTail(secrets),stderr=outputTail(secrets),t0=Date.now();
 const child=spawn(process.execPath,[resolve(root,'scripts/demo/app-supervisor.mjs'),String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>stdout.push(c));child.stderr.on('data',c=>stderr.push(c));
 let dead=false,exit=null;const closed=new Promise(r=>child.on('close',r));
 child.on('exit',(code,signal)=>{dead=true;exit={code,signal};});child.on('error',e=>{dead=true;exit={error:describeProbeError(e)};});
 const stop=()=>{try{child.kill('SIGTERM');}catch{/* already gone */}};
 process.on('exit',stop);
 let probes=0,last='none yet';
 const report=reason=>{
  const out=stdout.text(),err=stderr.text(),indent=(label,t)=>t?t.split('\n').map(l=>`[isolated-app ${label}] ${l}`).join('\n'):`[isolated-app ${label}] (nothing)`;
  log([`[isolated-app] ${reason}`,
   `[isolated-app] elapsed=${Date.now()-t0}ms probes=${probes} supervisor=${dead?'exited'+(exit?(exit.error?` (spawn error ${exit.error})`:` code=${exit.code} signal=${exit.signal}`):''):'running'} probe=GET /login on 127.0.0.1 (port ${port})`,
   `[isolated-app] last readiness probe: ${last}`,
   `[isolated-app] supervisor and app output, last ${DIAG_TAIL_CHARS} chars at most, credentials redacted:`,
   indent('stdout',out),indent('stderr',err)].join('\n'));
 };
 for(let i=0;i<attempts;i++){
  if(dead){await Promise.race([closed,new Promise(r=>setTimeout(r,1000))]);report('the isolated app exited before it was ready');throw new Error('The isolated app exited before it was ready (is the production build present? run npm run build).');}
  probes++;
  try{const r=await fetch(base+'/login');last=`HTTP ${r.status}`;if(r.ok)return {base,stop};}catch(e){last=`connection error ${describeProbeError(e)}`;}
  await new Promise(r=>setTimeout(r,intervalMs));
 }
 report('the isolated app did not become ready in time');
 stop();throw new Error('The isolated app did not become ready in time.');
}
