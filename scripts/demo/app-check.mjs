// Read-only proof that the importer's PRIVATE app really accepts connections on this host, run before any import attempt (EXISTING_TENANT_LOAD=app-check).
// It writes nothing and signs nobody in: it starts the same isolated app the importer uses, connects to it over TCP and asks GET /login, and reports what is
// actually listening (read from /proc, not from what the app printed). It also starts a bare `node` child with a one-line HTTP server, so a failure can be
// attributed: if the bare child works and the private app does not, the cause is in the app's own launch; if both fail, it is the host or its node.
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {basename} from 'node:path';
import {startIsolatedApp,freePort,listenerInventory,describeProcess,formatInventory,diagnosticSecrets,redactDiagnostic,probeTransports,describeProbe,chooseTransport} from './import-app.mjs';

const tcp=(port,ms=2000)=>new Promise(res=>{const s=connect({port,host:'127.0.0.1'});const done=r=>{s.destroy();res(r);};s.setTimeout(ms,()=>done('timeout'));s.once('connect',()=>done('connected'));s.once('error',e=>done(String(e.code||'error')));});
async function reach(port,tries=20,gap=250){let last='';for(let i=0;i<tries;i++){last=await tcp(port);if(last==='connected')break;await new Promise(r=>setTimeout(r,gap));}
 let http='no response';try{const r=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(4000)});http=`HTTP ${r.status}`;}catch(e){http=`failed (${String(e?.cause?.code||e?.name||'error').slice(0,30)})`;}
 return {tcp:last,http};}

const PLAIN="const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('LISTENING '+JSON.stringify(s.address())));setInterval(()=>{},1000);";

/** `startApp` and the budget are parameters for tests only; production uses startIsolatedApp with its 90 s budget. */
export async function appCheck({env=process.env,log=(...a)=>console.log('[app-check]',...a),startApp=startIsolatedApp,appOptions={}}={}){
 const secrets=diagnosticSecrets(env),say=(...a)=>log(redactDiagnostic(a.join(' '),secrets));
 let ok=true;
 // 1. launch facts (names only: no values, no full paths)
 const parent=describeProcess(process.ppid);
 say(`node ${process.version} (${basename(process.execPath)}); this loader's parent: [${parent.argv.join(' ')||'?'}]${parent.envNames.length?` hosting-related env names: ${parent.envNames.join(',')}`:''}`);
 // 2. a bare node child with a one-line HTTP server
 const port=await freePort();
 const bare=spawn(process.execPath,['-e',PLAIN],{env:{PATH:env.PATH||'',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let out='';bare.stdout.setEncoding('utf8');bare.stdout.on('data',c=>{out+=c;});bare.stderr.resume();
 const r1=await reach(port);const reported=/LISTENING (.*)/.exec(out)?.[1]||'(nothing reported)';
 const inv1=listenerInventory(bare.pid);
 say(`bare node child on 127.0.0.1:${port}: child reports address ${reported}; TCP ${r1.tcp}; GET / ${r1.http}`);
 for(const l of formatInventory(inv1))say(`  ${l}`);
 try{bare.kill('SIGKILL');}catch{/* gone */}
 const bareOk=r1.tcp==='connected'&&r1.http==='HTTP 200';
 const probed=await probeTransports();
 say(`transports a child process can be reached on from this process: ${describeProbe(probed)}`);
 // 3. the private app, the same code as apply (it logs its own diagnostic block on failure), on the transport the importer will use
 let app=null,failedProbe=null;
 try{app=await startApp(env,{log:(...a)=>say(...a),probe:async()=>probed,...appOptions});}catch(e){failedProbe=e.probe||null;say(`private app: FAIL to become ready (${String(e.message).slice(0,160)})`);}
 let appOk=false,transport=chooseTransport('auto',probed);
 if(app){
  transport=app.transport||'tcp';
  let r2;
  if(transport==='unix'){
   const c=await new Promise(res=>{const sk=connect({path:app.socketPath});sk.setTimeout(2000,()=>{sk.destroy();res('timeout');});sk.once('connect',()=>{sk.destroy();res('connected');});sk.once('error',e=>res(String(e.code||'error')));});
   let h;try{h=`HTTP ${(await app.fetch('/',{signal:AbortSignal.timeout(4000)})).status}`;}catch(e){h=`failed (${String(e?.code||e?.name||'error').slice(0,30)})`;}
   r2={tcp:c,http:h};
  }else r2=await reach(Number(new URL(app.base).port));
  say(`private app over ${transport==='unix'?'its unix socket':app.base}: ${transport==='unix'?'connect':'TCP'} ${r2.tcp}; GET / ${r2.http}`);
  appOk=r2.tcp==='connected'&&/^HTTP \d{3}$/.test(r2.http);   // any HTTP status line proves the socket accepts and speaks HTTP; readiness already required GET /login 2xx
  app.stop();
 }
 ok=appOk;
 const used=app?.probe||failedProbe||probed;   // the probe result the private app's transport was actually chosen from
 const refusedTcp=!used.tcp.ok;
 say(`RESULT: ${ok?'PASS':'FAIL'} - `+(ok
  ?(transport==='unix'
    ?`loopback TCP is refused on this host (${used.tcp.code}), but the private app accepts connections over a unix socket, which the importer now uses. An apply attempt can proceed.`
    :'the private app accepts TCP connections. An apply attempt can proceed.')
  :(refusedTcp&&!used.unix.ok
    ?`neither loopback TCP (${used.tcp.code}) nor a unix socket (${used.unix.code}) reaches a child process on this host, so the cause is in the host or its node, not the app.`
    :bareOk?'the private app does NOT accept connections although a bare child does, so the cause is in the private app\'s own launch (see its block above).'
    :'the private app does NOT accept connections and the bare child fails too, so the cause is in the host or its node, not the app.')));
 return ok?0:1;
}
