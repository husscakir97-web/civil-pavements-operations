// Run AFTER a production build, against a disposable loopback MySQL service (MYSQL_DATABASE must end in _test; it is only fingerprinted, nothing is written).
//   node scripts/test-standalone-child-output.mjs .next/standalone
// Reproduces the Hostinger symptom: the host captures the app's OWN console but not file descriptors a child process inherits, so the runtime loader's output
// (fingerprint, refusals) was missing from the Runtime logs and only "runtime child exit: <code>" appeared. The host stand-in below patches process.stdout/stderr.write
// into a capture file and runs with ignored stdio: only text the app itself writes through its console can be captured.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const source=resolve(process.argv[2]||'.next/standalone');
assert.ok(existsSync(join(source,'server.js')),'Build the production standalone artifact first');
assert.ok(String(process.env.MYSQL_DATABASE||'').endsWith('_test'),'MYSQL_DATABASE must name a disposable database ending in _test');
assert.ok(['127.0.0.1','localhost'].includes(process.env.MYSQL_HOST),'a loopback MySQL service is required');
for(const k of ['MYSQL_USER','MYSQL_PASSWORD'])assert.ok(process.env[k],k+' is required');
const sha=x=>createHash('sha256').update(x).digest('hex');
const temp=mkdtempSync(join(tmpdir(),'child-output-'));
const app=join(temp,'app');cpSync(source,app,{recursive:true});
writeFileSync(join(temp,'host-capture.cjs'),`const fs=require('node:fs');const f=process.env.HOST_CAPTURE_FILE;
for(const s of [process.stdout,process.stderr])s.write=(c,...r)=>{fs.appendFileSync(f,typeof c==='string'?c:Buffer.from(c).toString());const cb=r.find(x=>typeof x==='function');if(cb)cb();return true;};
import(require('node:url').pathToFileURL(process.argv[2]).href).catch(e=>{fs.appendFileSync(f,'LOADFAIL '+e+'\\n');process.exit(1);});
`);
const allow=JSON.stringify({environment:'existing-tenant-additive',host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,
 appUrl:'https://child-output.example.invalid',organisationId:'org-child-output',adminEmail:'owner@child-output.example.invalid'});
let n=0;
async function host(loadEnv){
 const capture=join(temp,`capture-${++n}.log`);writeFileSync(capture,'');
 const port=String(3900+n);
 const env={PATH:process.env.PATH||'',HOME:temp,HOSTNAME:'127.0.0.1',PORT:port,EMAIL_ENABLED:'false',AI_ENABLED:'false',LOCATION_PROVIDER:'fake',
  BETTER_AUTH_SECRET:'child-output-test-only-secret-at-least-32-chars',BETTER_AUTH_URL:`http://127.0.0.1:${port}`,
  MYSQL_HOST:process.env.MYSQL_HOST,MYSQL_PORT:String(process.env.MYSQL_PORT||3306),MYSQL_DATABASE:process.env.MYSQL_DATABASE,MYSQL_USER:process.env.MYSQL_USER,MYSQL_PASSWORD:process.env.MYSQL_PASSWORD,
  EXISTING_TENANT_RUNTIME_ENABLE:'true',HOST_CAPTURE_FILE:capture,...loadEnv};
 const c=spawn(process.execPath,[join(temp,'host-capture.cjs'),join(app,'server.js')],{cwd:temp,env,stdio:'ignore'});   // ignored stdio: raw descriptor output is lost, as on the host
 const end=Date.now()+90_000;
 while(Date.now()<end&&!/runtime child exit/.test(readFileSync(capture,'utf8'))){if(c.exitCode!==null)break;await new Promise(r=>setTimeout(r,200));}
 c.kill('SIGTERM');await Promise.race([once(c,'exit'),new Promise(r=>setTimeout(r,5000))]);if(c.exitCode===null)c.kill('SIGKILL');
 return readFileSync(capture,'utf8');
}
try{
 // 1. invalid mode: rejected by the child before it touches the database; its message and its exit code must reach the host log
 let log=await host({EXISTING_TENANT_LOAD:'nonsense-probe'});
 assert.match(log,/\[existing-tenant-load\] EXISTING_TENANT_LOAD must be fingerprint, plan, apply or verify/,'the child message must be captured: '+log.slice(0,600));
 assert.match(log,/runtime child exit: 2/);
 assert.ok(log.indexOf('must be fingerprint')<log.indexOf('runtime child exit'),'the exit line comes after the child output');
 console.log('PASS invalid mode: child message and exit code 2 reach a console-only host log');
 // 2. fingerprint: real child, real MySQL connection, lock and quiescence; its output must reach the host log and no secret may
 const until=new Date(Date.now()+2*3600e3).toISOString();
 log=await host({EXISTING_TENANT_LOAD:'fingerprint',EXISTING_TENANT_ALLOWLIST_JSON:allow,EXISTING_TENANT_CONFIRM_SHA256:sha(allow),EXISTING_TENANT_STATE_DIR:join(temp,'state'),MAINTENANCE_UNTIL:until});
 assert.match(log,/\[existing-tenant-load\] fingerprint: [0-9a-f]{64}/,'fingerprint must be captured: '+log.slice(0,900));
 // fingerprint mode returns before the generic "<mode> finished with exit code" line (only plan/apply/verify/reset print it): its evidence hint and the parent's exit line are the markers
 assert.match(log,/Put this value in the backup evidence as "fingerprint"/);
 assert.match(log,/runtime child exit: 0/);
 assert.ok(!log.includes(process.env.MYSQL_PASSWORD),'the database password must never appear in the relayed output');
 console.log('PASS fingerprint: child output and exit code 0 reach a console-only host log; no secret in it');
}finally{rmSync(temp,{recursive:true,force:true});}
