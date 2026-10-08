// EXISTING_TENANT_LOAD=app-check: a read-only proof that the importer's private app accepts TCP connections, plus the /proc listener inventory it relies on.
// The "hijacked" fixture reproduces the hosted symptom: the app prints Next's Ready banner and a 127.0.0.1 URL while its listen() was redirected to a unix socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {listenerInventory,formatInventory,describeProcess} from './demo/import-app.mjs';

const PASSWORD='Sup3r-Secret-Db-Pass!';
const source={PATH:process.env.PATH,MYSQL_DATABASE:'fixture_test',MYSQL_PASSWORD:PASSWORD};
const fast={attempts:6,intervalMs:100,probeTimeoutMs:500};

async function fixture(serverSource){
 const root=mkdtempSync(join(tmpdir(),'app-check-'));
 mkdirSync(join(root,'scripts','demo'),{recursive:true});
 for(const f of ['import-app.mjs','app-supervisor.mjs','app-check.mjs'])copyFileSync('scripts/demo/'+f,join(root,'scripts','demo',f));
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));writeFileSync(join(root,'server.js'),serverSource);
 const {appCheck}=await import(pathToFileURL(join(root,'scripts/demo/app-check.mjs')).href+'?'+Math.random());
 return {root,appCheck,done:()=>rmSync(root,{recursive:true,force:true})};
}
const NORMAL=`import {createServer} from 'node:http';
console.log('▲ Next.js (fixture) Local: http://127.0.0.1:'+process.env.PORT+' ✓ Ready in 0ms');
createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT),process.env.HOSTNAME);`;
// a hosting loader stand-in: any numeric-port listen goes to a unix socket instead, and the app still prints the URL it was asked for
const HIJACKED=`import http from 'node:http';import os from 'node:os';import path from 'node:path';
const orig=http.Server.prototype.listen;
http.Server.prototype.listen=function(...a){if(typeof a[0]==='number')return orig.call(this,path.join(os.tmpdir(),'ac-hijack-'+process.pid+'.sock'));return orig.apply(this,a);};
console.log('▲ Next.js (fixture) Local: http://127.0.0.1:'+process.env.PORT+' ✓ Ready in 0ms password '+process.env.MYSQL_PASSWORD);
http.createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT),process.env.HOSTNAME);`;
const run=async(f,opts)=>{const logs=[];const code=await f.appCheck({env:source,log:(...a)=>logs.push(a.join(' ')),appOptions:opts});return {code,log:logs.join('\n')};};
const leftovers=root=>execSync(`ps -eo pid,args | grep -F '${root}' | grep -E 'app-supervisor|server.js' | grep -v grep | awk '{print $1}' || true`).toString().trim().split('\n').filter(Boolean).map(Number);

test('normal host: the bare child and the private app both accept TCP, result PASS, exit 0, nothing left running',async()=>{
 const f=await fixture(NORMAL);
 try{
  const {code,log}=await run(f,fast);
  assert.equal(code,0,log);
  assert.match(log,/bare node child on 127\.0\.0\.1:\d+: child reports address \{"address":"127\.0\.0\.1".*"port":\d+\}; TCP connected; GET \/ HTTP 200/);
  assert.match(log,/tcp LISTEN 127\.0\.0\.1:\d+/);
  assert.match(log,/private app over http:\/\/127\.0\.0\.1:\d+: TCP connected; GET \/ HTTP 200/);
  assert.match(log,/transports a child process can be reached on from this process: loopback TCP: works; unix socket: works/);
  assert.match(log,/RESULT: PASS .* An apply attempt can proceed\./);
  assert.match(log,/node v\d+\.\d+\.\d+ \(node\)/);
  await new Promise(r=>setTimeout(r,800));assert.deepEqual(leftovers(f.root),[],'private app must be stopped');
 }finally{f.done();}
});

test('a private app that accepts TCP and answers HTTP 500 elsewhere still passes: the check proves the socket, not the pages',async()=>{
 const f=await fixture(`import {createServer} from 'node:http';
 createServer((q,r)=>{r.statusCode=q.url==='/login'?200:500;r.end('x');}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
 try{const {code,log}=await run(f,fast);assert.equal(code,0,log);assert.match(log,/private app over .*TCP connected; GET \/ HTTP 500/);assert.match(log,/RESULT: PASS/);}finally{f.done();}
});

test('hosted symptom reproduced: Ready banner and a 127.0.0.1 URL, but a unix socket - the check FAILS and says exactly that',async()=>{
 const f=await fixture(HIJACKED);
 try{
  const {code,log}=await run(f,fast);
  assert.equal(code,1,log);
  assert.match(log,/Ready in 0ms/,'the app really printed the banner');
  assert.match(log,/last readiness probe: connection error ECONNREFUSED/);
  assert.match(log,/unix LISTEN ac-hijack-\d+\.sock/,'the /proc inventory shows the real listener');
  assert.ok(!/tcp LISTEN 127\.0\.0\.1:\d+.*\n.*\[isolated-app\]/.test(log.split('sockets owned')[1]||''),'no TCP listener for the private app');
  assert.match(log,/bare node child .*TCP connected/);
  assert.match(log,/RESULT: FAIL .*the private app does NOT accept connections although a bare child does, so the cause is in the private app's own launch/);
  assert.ok(!log.includes(PASSWORD),'credential leaked');
 }finally{for(const pid of leftovers(f.root))try{process.kill(pid,'SIGKILL');}catch{/* gone */}f.done();}
});

test('a server that exits at once is reported with its exit and an empty inventory, not as a listener',async()=>{
 const f=await fixture(`console.error('boom');process.exit(3);`);
 try{const {code,log}=await run(f,fast);assert.equal(code,1);assert.match(log,/exited before it was ready/);assert.match(log,/RESULT: FAIL/);}finally{f.done();}
});

test('listenerInventory reads the sockets a real process tree owns, with names and ports only',async()=>{
 const child=spawn(process.execPath,['-e',"require('http').createServer().listen(0,'127.0.0.1',()=>console.log(require('net').isIP('127.0.0.1')));setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
 await new Promise(r=>child.stdout.once('data',r));
 try{
  const inv=listenerInventory(child.pid),mine=inv.find(e=>e.pid===child.pid);
  assert.ok(mine,'the child is in the tree');assert.equal(mine.listeners.length,1);assert.equal(mine.listeners[0].kind,'tcp');assert.equal(mine.listeners[0].addr,'127.0.0.1');assert.ok(mine.listeners[0].port>0);
  const text=formatInventory(inv).join('\n');assert.match(text,/listening: tcp LISTEN 127\.0\.0\.1:\d+/);assert.ok(!text.includes(process.cwd()),'no full paths');
  assert.deepEqual(listenerInventory(2**22+7),[],'an unknown pid gives an empty inventory');
  assert.deepEqual(listenerInventory(child.pid,'/nonexistent-proc'),[],'no /proc gives an empty inventory');
 }finally{child.kill('SIGKILL');}
});

test('describeProcess reports argv basenames and hosting-related env NAMES only, never values',()=>{
 const d=describeProcess(process.pid);
 assert.ok(d.argv.length>0&&d.argv.every(a=>!a.includes('/')));
 const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{PATH:process.env.PATH,NODE_OPTIONS:'--no-warnings',LSNODE_SECRET_VALUE:'do-not-print',UNRELATED:'x'},stdio:'ignore'});
 return new Promise(res=>setTimeout(()=>{const x=describeProcess(c.pid);c.kill('SIGKILL');
  assert.deepEqual(x.envNames,['LSNODE_SECRET_VALUE','NODE_OPTIONS']);assert.ok(!JSON.stringify(x).includes('do-not-print'));res();},300));
});

test('the loader accepts the app-check mode (it reaches the allow-list check instead of rejecting the mode)',async()=>{
 const {existingTenantLoad}=await import('./existing-tenant-load.mjs');
 const lines=[];const orig=console.log;console.log=(...a)=>lines.push(a.join(' '));let code;
 try{code=await existingTenantLoad({EXISTING_TENANT_LOAD:'app-check'});}finally{console.log=orig;}
 assert.equal(code,2);assert.match(lines.join('\n'),/EXISTING_TENANT_ALLOWLIST_JSON is not set; nothing was done/);assert.ok(!/must be fingerprint/.test(lines.join('\n')));
});
