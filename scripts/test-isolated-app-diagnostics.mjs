// The isolated app's startup diagnostic: when it does not become ready, the importer logs what the supervisor and the server printed and what the
// last readiness probe got, bounded and with credentials redacted (also across chunks). Success stays silent; timeout, guards and behaviour unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {outputTail,diagnosticSecrets,redactDiagnostic,DIAG_TAIL_CHARS} from './demo/import-app.mjs';

const PASSWORD='Sup3r-Secret-Db-Pass!',SEED='seed-admin-password-123';

/** A packaged-shaped root (server.js at its root) whose server behaviour is the test's. */
async function fixture(serverSource){
 const root=mkdtempSync(join(tmpdir(),'isolated-diag-'));
 mkdirSync(join(root,'scripts','demo'),{recursive:true});
 for(const f of ['import-app.mjs','app-supervisor.mjs'])copyFileSync('scripts/demo/'+f,join(root,'scripts','demo',f));
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(join(root,'server.js'),serverSource);
 const {startIsolatedApp}=await import(pathToFileURL(join(root,'scripts/demo/import-app.mjs')).href+'?'+Math.random());
 return {root,startIsolatedApp,done:()=>rmSync(root,{recursive:true,force:true})};
}
const source={PATH:process.env.PATH,MYSQL_DATABASE:'fixture_test',MYSQL_USER:'u',MYSQL_PASSWORD:PASSWORD,DEMO_SEED_PASSWORD:SEED};
const quick={attempts:8,intervalMs:100};
const portOf=text=>Number(/port (\d+)/.exec(text)[1]);
const closed=async port=>{for(let i=0;i<80;i++){try{await fetch(`http://127.0.0.1:${port}/login`);}catch{return true;}await new Promise(r=>setTimeout(r,100));}return false;};
const SERVER=body=>`import {createServer} from 'node:http';\n${body}`;
const LISTEN="listen(Number(process.env.PORT),process.env.HOSTNAME)";

test('successful startup returns the app and logs nothing',async()=>{
 const f=await fixture(SERVER(`createServer((q,r)=>r.end('ok')).${LISTEN};console.log('server up');`));
 const logs=[];let app;
 try{app=await f.startIsolatedApp(source,{...quick,log:(...a)=>logs.push(a.join(' '))});
  assert.equal(new URL(app.base).hostname,'127.0.0.1');assert.equal((await fetch(app.base+'/login')).status,200);assert.deepEqual(logs,[]);}
 finally{app?.stop();if(app)assert.ok(await closed(Number(new URL(app.base).port)),'server must stop with its supervisor');f.done();}
});

test('timeout: same error message, last probe status, supervisor and server output, credentials redacted even when split across writes',async()=>{
 // the generated auth secret (64 hex) and both passwords are printed, each split in two writes with a pause between them
 const f=await fixture(SERVER(`
 const s=process.env.BETTER_AUTH_SECRET,p=process.env.MYSQL_PASSWORD;
 const half=x=>[x.slice(0,Math.floor(x.length/2)),x.slice(Math.floor(x.length/2))];
 process.stdout.write('booting db password=');for(const c of half(p)){process.stdout.write(c);await new Promise(r=>setTimeout(r,60));}process.stdout.write('\\n');
 process.stderr.write('auth secret=');for(const c of half(s)){process.stderr.write(c);await new Promise(r=>setTimeout(r,60));}process.stderr.write('\\n');
 process.stderr.write('startup problem: cannot reach upstream\\n');
 createServer((q,r)=>{r.statusCode=500;r.end('boom');}).${LISTEN};`));
 const logs=[];let msg='';
 try{await f.startIsolatedApp(source,{...quick,log:(...a)=>logs.push(a.join(' '))});}catch(e){msg=e.message;}
 const log=logs.join('\n');
 try{
  assert.equal(msg,'The isolated app did not become ready in time.');
  assert.equal(logs.length,1,'one diagnostic block');
  assert.match(log,/did not become ready in time/);assert.match(log,/probes=\d+/);assert.match(log,/last readiness probe: HTTP 500/);assert.match(log,/supervisor=running/);
  assert.match(log,/\[isolated-app stdout\] booting db password=\[redacted\]/);
  assert.match(log,/\[isolated-app stderr\] \[supervisor\] starting .*server\.js on 127\.0\.0\.1:\d+/);
  assert.match(log,/auth secret=\[redacted\]/);assert.match(log,/startup problem: cannot reach upstream/);
  for(const secret of [PASSWORD,SEED])assert.ok(!log.includes(secret),'credential leaked');
  assert.ok(!/[0-9a-f]{64}/i.test(log),'generated 64-hex secret leaked');
  for(const half of [PASSWORD.slice(0,10),PASSWORD.slice(10)])assert.ok(!log.includes(half),'half of a split credential leaked');
  assert.ok(await closed(portOf(log)),'the isolated app must be stopped after the timeout');
 }finally{f.done();}
});

test('timeout with nothing listening reports the connection error code',async()=>{
 const f=await fixture(SERVER(`setInterval(()=>{},1000);`));
 const logs=[];let msg='';
 try{await f.startIsolatedApp(source,{attempts:4,intervalMs:100,log:(...a)=>logs.push(a.join(' '))});}catch(e){msg=e.message;}
 try{assert.equal(msg,'The isolated app did not become ready in time.');assert.match(logs.join('\n'),/last readiness probe: connection error ECONNREFUSED/);assert.match(logs.join('\n'),/\[isolated-app stdout\] \(nothing\)/);}
 finally{f.done();}
});

test('early exit: same error message, exit code, the server\'s stderr and the supervisor note',async()=>{
 const f=await fixture(SERVER(`console.error('fatal: cannot bind, password '+process.env.MYSQL_PASSWORD);process.exit(3);`));
 const logs=[];let msg='';
 try{await f.startIsolatedApp(source,{...quick,log:(...a)=>logs.push(a.join(' '))});}catch(e){msg=e.message;}
 const log=logs.join('\n');
 try{
  assert.match(msg,/^The isolated app exited before it was ready/);
  assert.match(log,/the isolated app exited before it was ready/);assert.match(log,/supervisor=exited code=0/);
  assert.match(log,/\[supervisor\] server exited code=3 signal=null/);assert.match(log,/fatal: cannot bind, password \[redacted\]/);
  assert.ok(!log.includes(PASSWORD));
 }finally{f.done();}
});

test('a missing server is reported through the supervisor (nothing is thrown away)',async()=>{
 const f=await fixture(SERVER(`process.exit(0);`));
 rmSync(join(f.root,'server.js'));
 const logs=[];let msg='';
 try{await f.startIsolatedApp(source,{...quick,log:(...a)=>logs.push(a.join(' '))});}catch(e){msg=e.message;}
 try{assert.ok(msg.length>0);assert.match(logs.join('\n'),/\[supervisor\] starting next start on 127\.0\.0\.1:\d+/);}finally{f.done();}
});

test('output is bounded: a flood and an unterminated line keep only a redacted, capped tail',async()=>{
 const f=await fixture(SERVER(`
 for(let i=0;i<4000;i++)process.stdout.write('line '+i+' '+'x'.repeat(60)+'\\n');
 process.stdout.write('LAST-LINE-MARKER '+process.env.MYSQL_PASSWORD+' '+'y'.repeat(30000));
 createServer((q,r)=>{r.statusCode=503;r.end('no');}).${LISTEN};`));
 const logs=[];
 try{await f.startIsolatedApp(source,{attempts:15,intervalMs:100,log:(...a)=>logs.push(a.join(' '))}).catch(()=>{});
  const log=logs.join('\n');
  assert.ok(log.length<2*DIAG_TAIL_CHARS+2000,`log is ${log.length} chars`);
  assert.ok(!log.includes('line 0 '),'the oldest output must be dropped');assert.ok(!log.includes(PASSWORD));assert.match(log,/last readiness probe: HTTP 503/);
 }finally{f.done();}
});

test('outputTail: a credential split across chunks, and one cut by the buffer cap, is never partially shown',()=>{
 const secrets=diagnosticSecrets({MYSQL_PASSWORD:PASSWORD,SHORT_TOKEN:'abc',NOT_A_CREDENTIAL:'visible-value-1234'});
 assert.deepEqual(secrets,[PASSWORD],'short and non-credential values are not treated as secrets');
 const t=outputTail(secrets);t.push('pass=Sup3r-Sec');t.push('ret-Db-');t.push('Pass! done\n');
 assert.equal(t.text(),'pass=[redacted] done');
 // cut by the cap: the first (possibly partial) line is dropped before redaction, so no fragment can survive
 const c=outputTail(secrets,40);c.push('prefix '+PASSWORD+' tail-one\nsecond line is here\n');
 const shown=c.text();assert.ok(!shown.includes('Sup3r')&&!shown.includes('Pass!')&&!shown.includes('Db-'),shown);assert.match(shown,/second line is here/);
 // cap on the tail length
 const big=outputTail(secrets);big.push('z'.repeat(50000));assert.ok(big.text().length<=DIAG_TAIL_CHARS+3);
 // redaction helper
 assert.equal(redactDiagnostic(`x ${'a'.repeat(64)} y ${PASSWORD}`,secrets),'x [redacted] y [redacted]');
});
