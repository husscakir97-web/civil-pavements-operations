// How the importer reaches its private app: loopback TCP when it works, otherwise a unix socket in a private directory (hosts that accept a listener on 127.0.0.1 but
// refuse every connection to it, e.g. Hostinger: `tcp LISTEN` in /proc, ECONNREFUSED on connect). Covers the unix transport end to end (headers, cookies, multipart bodies,
// owner-only permissions, cleanup), the selection logic, fast failure when nothing works, the supervisor's socket-path validation, the preload's narrowness, and - when
// run as root with network namespaces available - the real situation with loopback TCP actually rejected by the kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync,execSync} from 'node:child_process';
import {connect} from 'node:net';
import {pathToFileURL} from 'node:url';
import {probeTransports,chooseTransport,describeProbe} from './demo/import-app.mjs';

const PASSWORD='Sup3r-Secret-Db-Pass!';
const source={PATH:process.env.PATH,MYSQL_DATABASE:'fixture_test',MYSQL_PASSWORD:PASSWORD};
const fast={attempts:8,intervalMs:100,probeTimeoutMs:1000};
const FILES=['import-app.mjs','app-supervisor.mjs','app-check.mjs','private-socket-preload.mjs'];

async function fixture(serverSource){
 const root=mkdtempSync(join(tmpdir(),'transport-fixture-'));
 mkdirSync(join(root,'scripts','demo'),{recursive:true});
 for(const f of FILES)copyFileSync('scripts/demo/'+f,join(root,'scripts','demo',f));
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));writeFileSync(join(root,'server.js'),serverSource);
 const mod=f=>import(pathToFileURL(join(root,'scripts/demo',f)).href+'?'+Math.random());
 return {root,mod,done:()=>rmSync(root,{recursive:true,force:true})};
}
// listens exactly the way the standalone Next server does: server.listen(PORT, HOSTNAME)
const ECHO=`import {createServer} from 'node:http';
createServer((q,r)=>{
 const chunks=[];q.on('data',c=>chunks.push(c));
 q.on('end',()=>{const body=Buffer.concat(chunks);
  if(q.url==='/login'){r.statusCode=200;return r.end('login');}
  if(q.url==='/cookies'){r.setHeader('Set-Cookie',['a=1; Path=/; HttpOnly','b=2; Path=/']);r.setHeader('Retry-After','7');return r.end('{"ok":true}');}
  r.setHeader('content-type','application/json');
  r.end(JSON.stringify({method:q.method,url:q.url,host:q.headers.host,origin:q.headers.origin,cookie:q.headers.cookie,contentType:q.headers['content-type'],length:body.length,text:body.toString('utf8')}));
 });
}).listen(Number(process.env.PORT),process.env.HOSTNAME);`;
const pids=root=>execSync(`ps -eo pid,args | grep -F '${root}' | grep -E 'app-supervisor|server.js' | grep -v grep | awk '{print $1}' || true`).toString().trim().split('\n').filter(Boolean).map(Number);
const gone=async(root,ms=5000)=>{const t0=Date.now();while(pids(root).length&&Date.now()-t0<ms)await new Promise(r=>setTimeout(r,100));return pids(root).length===0;};
const tcpTry=port=>new Promise(res=>{const s=connect({port,host:'127.0.0.1'});s.setTimeout(1500,()=>{s.destroy();res('timeout');});s.once('connect',()=>{s.destroy();res('connected');});s.once('error',e=>res(e.code));});
const BLOCKED={tcp:{ok:false,code:'ECONNREFUSED'},unix:{ok:true,code:'HTTP 200'},self:{tcp:'ECONNREFUSED',unix:'connected'},errors:[]};
const OPEN={tcp:{ok:true,code:'HTTP 200'},unix:{ok:true,code:'HTTP 200'},self:{tcp:'connected',unix:'connected'},errors:[]};
const NONE={tcp:{ok:false,code:'ECONNREFUSED'},unix:{ok:false,code:'EACCES'},self:null,errors:[]};

test('unix transport end to end: readiness, JSON with headers and cookies, multipart, TCP not listening, owner-only socket, cleaned up',async()=>{
 const f=await fixture(ECHO);const {startIsolatedApp}=await f.mod('import-app.mjs');const logs=[];let app;
 try{
  app=await startIsolatedApp(source,{...fast,transport:'unix',log:(...a)=>logs.push(a.join(' '))});
  assert.equal(app.transport,'unix');assert.match(app.base,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(logs.join('\n'),/starting: GET \/login over a unix socket, wall-clock budget \d+s/);
  assert.equal((await app.fetch('/login')).status,200);
  // nothing listens on TCP: the nominal port in `base` is only the configured origin
  assert.equal(await tcpTry(Number(new URL(app.base).port)),'ECONNREFUSED');
  // JSON writer: method, origin, cookie and host are what the importer sets
  const j=await (await app.fetch('/api/x?y=1',{method:'POST',headers:{origin:app.base,cookie:'s=1; t=2','Content-Type':'application/json'},body:JSON.stringify({a:'é'})})).json();
  assert.deepEqual([j.method,j.url,j.origin,j.cookie,j.contentType,j.text],['POST','/api/x?y=1',app.base,'s=1; t=2','application/json','{"a":"é"}']);
  assert.equal(j.host,new URL(app.base).host,'Host matches the configured origin');
  // cookies and retry-after come back as real headers
  const c=await app.fetch('/cookies');assert.equal(c.ok,true);assert.deepEqual(c.headers.getSetCookie().map(x=>x.split(';')[0]),['a=1','b=2']);assert.equal(c.headers.get('retry-after'),'7');
  // multipart form (the docket upload shape)
  const form=new FormData();form.set('file','line one\nline two');form.set('meta',JSON.stringify({k:1}));
  const m=await (await app.fetch('/api/dockets',{method:'POST',headers:{origin:app.base,cookie:'s=1'},body:form})).json();
  assert.match(m.contentType,/^multipart\/form-data; boundary=/);assert.ok(m.text.includes('line one\r\nline two')&&m.text.includes('{"k":1}'));
  // owner-only: private directory 0700, socket 0600, no TCP
  const sock=app.socketPath,dir=dirname(sock);
  assert.match(dir.split('/').pop(),/^private-app-/);assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(sock).mode&0o077,0,`socket mode ${(statSync(sock).mode&0o777).toString(8)}`);
  app.stop();assert.equal(existsSync(dir),false,'the private directory is removed on stop');
  assert.ok(await gone(f.root),'supervisor and server stopped');
 }finally{app?.stop();f.done();}
});

test('the failure report names the unix listener the app really owns',async()=>{
 const f=await fixture(`import {createServer} from 'node:http';createServer((q,r)=>{r.statusCode=503;r.end('no');}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
 const {startIsolatedApp}=await f.mod('import-app.mjs');const logs=[];
 try{
  await assert.rejects(startIsolatedApp(source,{attempts:5,intervalMs:100,probeTimeoutMs:500,transport:'unix',log:(...a)=>logs.push(a.join(' '))}),/did not become ready in time/);
  const log=logs.join('\n');assert.match(log,/last readiness probe: HTTP 503/);assert.match(log,/probe=GET \/login over a unix socket/);assert.match(log,/listening: unix LISTEN app\.sock/);assert.ok(!/tcp LISTEN/.test(log.split('sockets owned')[1]||''));
  assert.ok(await gone(f.root));
 }finally{f.done();}
});

test('auto selection: TCP when it works (silent, as before), the unix socket when TCP is refused, nothing started when neither works',async()=>{
 const f=await fixture(ECHO);const {startIsolatedApp}=await f.mod('import-app.mjs');
 try{
  let logs=[];let app=await startIsolatedApp(source,{...fast,probe:async()=>OPEN,log:(...a)=>logs.push(a.join(' '))});
  assert.equal(app.transport,'tcp');assert.equal(logs.length,1,'only the startup marker');assert.match(logs[0],/starting: GET \/login on 127\.0\.0\.1:\d+,/);assert.equal((await app.fetch('/login')).status,200);app.stop();assert.ok(await gone(f.root));
  logs=[];app=await startIsolatedApp(source,{...fast,probe:async()=>BLOCKED,log:(...a)=>logs.push(a.join(' '))});
  assert.equal(app.transport,'unix');assert.match(logs.join('\n'),/transport: unix socket in a private directory \(loopback TCP: refused \(ECONNREFUSED\); unix socket: works; the probe child connecting to its own listeners: tcp ECONNREFUSED, unix connected\)/);
  assert.equal((await app.fetch('/login')).status,200);app.stop();assert.ok(await gone(f.root));
  logs=[];const t0=Date.now();
  await assert.rejects(startIsolatedApp(source,{...fast,probe:async()=>NONE,log:(...a)=>logs.push(a.join(' '))}),/neither loopback TCP nor a unix socket accepts connections from this process\. Nothing was started\./);
  assert.ok(Date.now()-t0<1500,'fails at once, not after the 90 s budget');assert.match(logs.join('\n'),/loopback TCP: refused \(ECONNREFUSED\); unix socket: refused \(EACCES\)/);assert.deepEqual(pids(f.root),[]);
  // forced values are honoured without probing
  app=await startIsolatedApp(source,{...fast,transport:'tcp',probe:async()=>{throw new Error('must not probe');},log:()=>{}});assert.equal(app.transport,'tcp');app.stop();
  assert.equal(chooseTransport('tcp',NONE),'tcp');assert.equal(chooseTransport('unix',OPEN),'unix');assert.equal(chooseTransport('auto',OPEN),'tcp');assert.equal(chooseTransport('auto',BLOCKED),'unix');assert.equal(chooseTransport('auto',NONE),null);
 }finally{f.done();}
});

test('probeTransports on a normal host: both transports work, quickly, and the probe child can connect to its own listeners',async()=>{
 const t0=Date.now();const p=await probeTransports();
 assert.equal(p.tcp.ok,true,JSON.stringify(p));assert.equal(p.unix.ok,true,JSON.stringify(p));assert.deepEqual(p.self,{tcp:'connected',unix:'connected'});assert.ok(Date.now()-t0<3500,`${Date.now()-t0} ms`);
 assert.match(describeProbe(p),/^loopback TCP: works; unix socket: works; the probe child connecting to its own listeners: tcp connected, unix connected$/);
 assert.ok(p.dir&&!existsSync(p.dir),'the probe\'s own directory is removed');
});

test('the supervisor refuses any socket path that is not the importer\'s own private directory',()=>{
 const run=socket=>spawnSync(process.execPath,['scripts/demo/app-supervisor.mjs','45999',socket],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
 for(const bad of ['relative/private-app-x/app.sock','/tmp/other-dir/app.sock','/tmp/private-app-x/not-app.sock','/tmp/private-app-'+'x'.repeat(100)+'/app.sock','/etc/app.sock']){
  const r=run(bad);assert.notEqual(r.status,0,bad);assert.match(r.stderr,/Invalid isolated app socket path/,bad);
 }
});

test('the preload redirects only the server\'s single listen(PORT) call, only when asked',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'private-app-'));const sock=join(dir,'app.sock');
 const script=`const http=require('http');const a=http.createServer(),b=http.createServer();let n=0;const out={};
  const done=()=>{if(++n===2){console.log(JSON.stringify(out));process.exit(0)}};
  a.listen(Number(process.env.PORT),'127.0.0.1',()=>{out.first=a.address();b.listen(0,'127.0.0.1',()=>{out.second=b.address();done()});done()});`;
 const run=env=>spawnSync(process.execPath,['--import',pathToFileURL(join(process.cwd(),'scripts/demo/private-socket-preload.mjs')).href,'-e',script],{env:{PATH:process.env.PATH,PORT:'45123',...env},encoding:'utf8',timeout:15000});
 try{
  const on=JSON.parse(run({PRIVATE_APP_SOCKET:sock}).stdout.trim().split('\n').pop());
  assert.equal(on.first,sock,'the first listen(PORT) went to the socket');assert.equal(typeof on.second,'object','a later listen is untouched');assert.equal(on.second.address,'127.0.0.1');
  const off=JSON.parse(run({}).stdout.trim().split('\n').pop());
  assert.equal(typeof off.first,'object');assert.equal(off.first.port,45123,'without PRIVATE_APP_SOCKET nothing changes');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('app-check passes over the unix socket when loopback TCP is refused, and says so',async()=>{
 const f=await fixture(ECHO);const {appCheck}=await f.mod('app-check.mjs');const logs=[];
 try{
  const code=await appCheck({env:source,log:(...a)=>logs.push(a.join(' ')),appOptions:fast});   // real probe: both work -> tcp
  assert.equal(code,0,logs.join('\n'));assert.match(logs.join('\n'),/RESULT: PASS - the private app accepts TCP connections/);
  logs.length=0;
  const { startIsolatedApp }=await f.mod('import-app.mjs');
  const code2=await appCheck({env:source,log:(...a)=>logs.push(a.join(' ')),startApp:(e,o)=>startIsolatedApp(e,{...o,probe:async()=>BLOCKED}),appOptions:fast});
  const log=logs.join('\n');assert.equal(code2,0,log);
  assert.match(log,/private app over its unix socket: connect connected; GET \/ HTTP 200/);
  assert.match(log,/RESULT: PASS - loopback TCP is refused on this host \(ECONNREFUSED\), but the private app accepts connections over a unix socket, which the importer now uses\. An apply attempt can proceed\./);
  assert.ok(await gone(f.root));
  logs.length=0;
  const code3=await appCheck({env:source,log:(...a)=>logs.push(a.join(' ')),startApp:(e,o)=>startIsolatedApp(e,{...o,probe:async()=>NONE}),appOptions:fast});
  assert.equal(code3,1);assert.match(logs.join('\n'),/RESULT: FAIL - neither loopback TCP \(ECONNREFUSED\) nor a unix socket \(EACCES\) reaches a child process on this host, so the cause is in the host or its node, not the app\./);
 }finally{f.done();}
});

// ---- the real thing: the kernel rejects loopback TCP (iptables), as on Hostinger. Needs root and network namespaces; skipped otherwise. ----
const canNetns=(()=>{try{if(process.getuid?.()!==0)return false;return spawnSync('unshare',['-n','sh','-c','ip link set lo up && iptables -A OUTPUT -o lo -p tcp --dport 1024:65535 -j REJECT'],{timeout:10000}).status===0;}catch{return false;}})();
test('loopback TCP really rejected by the kernel: auto picks the unix socket and the private app works; app-check passes',{skip:canNetns?false:'needs root + unshare + iptables (not available here)'},async()=>{
 const f=await fixture(ECHO);
 const script=join(f.root,'netns-run.mjs');
 writeFileSync(script,`import {pathToFileURL} from 'node:url';import {join} from 'node:path';
  const {startIsolatedApp,probeTransports,describeProbe}=await import(pathToFileURL(join(${JSON.stringify(f.root)},'scripts/demo/import-app.mjs')).href);
  const {appCheck}=await import(pathToFileURL(join(${JSON.stringify(f.root)},'scripts/demo/app-check.mjs')).href);
  const p=await probeTransports();console.log('PROBE '+describeProbe(p));
  const app=await startIsolatedApp({PATH:process.env.PATH},{attempts:20,intervalMs:250,log:()=>{}});
  console.log('TRANSPORT '+app.transport+' LOGIN '+(await app.fetch('/login')).status);app.stop();
  const logs=[];const code=await appCheck({env:{PATH:process.env.PATH},log:(...a)=>logs.push(a.join(' ')),appOptions:{attempts:20,intervalMs:250}});
  console.log('APPCHECK '+code+' '+logs.filter(l=>/RESULT|private app over/.test(l)).join(' | '));process.exit(0);`);
 try{
  const r=spawnSync('unshare',['-n','sh','-c',`ip link set lo up && iptables -A OUTPUT -o lo -p tcp --dport 1024:65535 -j REJECT && ${process.execPath} ${script}`],{encoding:'utf8',timeout:120000,env:{PATH:process.env.PATH}});
  const out=r.stdout;assert.equal(r.status,0,r.stderr+out);
  assert.match(out,/PROBE loopback TCP: refused \(ECONNREFUSED\); unix socket: works/);
  assert.match(out,/TRANSPORT unix LOGIN 200/);
  assert.match(out,/APPCHECK 0 .*private app over its unix socket: connect connected; GET \/ HTTP 200 \| .*RESULT: PASS - loopback TCP is refused on this host \(ECONNREFUSED\), but the private app accepts connections over a unix socket/);
 }finally{f.done();}
});
