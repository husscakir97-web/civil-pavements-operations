// Run AFTER a real production build. Copies the standalone artifact to an
// unrelated temporary directory; no NODE_PATH or source node_modules fallback.
// No database settings are inherited and no database operations are performed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer,connect} from 'node:net';
import {cpSync,existsSync,mkdtempSync,readdirSync,rmSync,lstatSync,renameSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const source=resolve(process.argv[2]||'.next/standalone');
assert.ok(existsSync(join(source,'server.js')),'Build the production standalone artifact first');
const temp=mkdtempSync(join(tmpdir(),'standalone-acceptance-'));
const checkout=process.cwd(),hidden=checkout+'-standalone-hidden-'+process.pid;let sourceHidden=false;
const root=join(temp,'app');const processes=new Set();
const port=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const stop=async c=>{if(c.exitCode!==null||c.signalCode)return;c.kill('SIGTERM');await once(c,'exit');};
const waitFor=async(fn,timeout=60_000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out');};
try{
 // Reject links before copying: a junction back into the source would invalidate
 // this test. Native Next tracing output contains regular copied files.
 const walk=p=>{assert.ok(!lstatSync(p).isSymbolicLink(),'Artifact link: '+p);if(lstatSync(p).isDirectory())for(const n of readdirSync(p))walk(join(p,n));};walk(source);
 cpSync(source,root,{recursive:true});
 if(process.argv.includes('--hide-source')){
  assert.equal(process.env.CI,'true','Source hiding is restricted to an ephemeral CI checkout');
  assert.equal(resolve(process.env.GITHUB_WORKSPACE||''),checkout);
  assert.ok(!existsSync(hidden));renameSync(checkout,hidden);sourceHidden=true;
  assert.ok(!existsSync(checkout),'Source checkout must be unavailable during all artifact probes');
 }
 for(const f of ['scripts/existing-tenant-load.mjs','scripts/import-demo-tenant.mjs','scripts/existing-tenant-verify.mjs',
  'scripts/demo/app-supervisor.mjs','docs/DEMO-COMPANY-MANIFEST.json','docs/DEMO-IMPORT-FOOTPRINT.json'])assert.ok(existsSync(join(root,f)),f);
 const current=join(temp,'current');symlinkSync(root,current,process.platform==='win32'?'junction':'dir');
 // A host process manager is the process entry point (argv[1] is its loader, NOT server.js) and starts from another working directory.
 const hostLoader=join(temp,'host-loader.cjs');writeFileSync(hostLoader,"import(require('node:url').pathToFileURL(process.argv[2]).href).catch(e=>{console.error(e);process.exit(1);});\n");
 for(const [enabled,entry,via,extra] of [[false,root],[true,root],[true,current],[true,root,'host'],[true,current,'host'],[true,root,'host',{EXISTING_TENANT_RUNTIME_PARENT_PID:'1'}],[true,root,'host',{NEXT_PHASE:'phase-production-build'}]]){
  const p=await port();let output='';
  const env={PATH:process.env.PATH||'',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',HOSTNAME:'127.0.0.1',PORT:String(p),EMAIL_ENABLED:'false',AI_ENABLED:'false',
   LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'standalone-test-only-secret-at-least-32-chars',BETTER_AUTH_URL:`http://127.0.0.1:${p}`,
   EXISTING_TENANT_LOAD:'invalid-artifact-probe',...(enabled?{EXISTING_TENANT_RUNTIME_ENABLE:'true'}:{}),...(extra||{})};
  const c=spawn(process.execPath,via?[hostLoader,join(entry,'server.js')]:[join(entry,'server.js')],{cwd:via?temp:entry,env,stdio:['ignore','pipe','pipe']});processes.add(c);
  c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>output+=b);
  await waitFor(async()=>{if(c.exitCode!==null)throw new Error(output);try{return (await fetch(`http://127.0.0.1:${p}/api/health`)).ok;}catch{return false;}});
  assert.equal((await fetch(`http://127.0.0.1:${p}/login`)).status,200);
  if(enabled&&extra?.EXISTING_TENANT_RUNTIME_PARENT_PID){await waitFor(()=>output.includes('runtime hook skipped: reason=loader-child-process launcher=host-loader.cjs'));
   await new Promise(r=>setTimeout(r,1500));assert.ok(!output.includes('EXISTING_TENANT_LOAD must be'),'a loader child must never launch the loader again');}
  else if(enabled&&extra?.NEXT_PHASE){await new Promise(r=>setTimeout(r,2500));assert.ok(!output.includes('[existing-tenant-load]'),'a build phase must never run the hook');}
  else if(enabled)await waitFor(()=>output.includes('EXISTING_TENANT_LOAD must be fingerprint, plan, apply or verify'));
  else assert.ok(!output.includes('[existing-tenant-load]'),'Default startup must not launch loader');
  await stop(c);processes.delete(c);console.log('PASS detached artifact startup, runtime enabled='+enabled+', current symlink='+(entry===current)+(via?', host launcher'+(extra?' ('+Object.keys(extra)[0]+')':''):''));
 }
 // Import the PACKAGED supervisor helper, which launches PACKAGED server.js with
 // a fresh loopback port. No source module or build tree participates.
 const {startIsolatedApp}=await import(pathToFileURL(join(root,'scripts/demo/import-app.mjs')).href);
 const app=await startIsolatedApp({PATH:process.env.PATH,EXISTING_TENANT_RUNTIME_ENABLE:'true',EXISTING_TENANT_LOAD:'apply',NODE_OPTIONS:'invalid'});
 try{assert.equal(new URL(app.base).hostname,'127.0.0.1');assert.equal((await fetch(app.base+'/login')).status,200);}
 // 'stopped' means a NEW TCP connection is refused. (A pooled keep-alive fetch can still be answered by a server that is mid graceful shutdown, which made this check timing-dependent.)
 finally{app.stop();await waitFor(()=>new Promise(res=>{const sock=connect({host:'127.0.0.1',port:Number(new URL(app.base).port)});sock.once('connect',()=>{sock.destroy();res(false);});sock.once('error',()=>res(true));}));}
 console.log('PASS detached artifact isolated standalone child startup and shutdown');
}finally{
 for(const c of processes)await stop(c);
 if(sourceHidden)renameSync(hidden,checkout);
 rmSync(temp,{recursive:true,force:true});
}
