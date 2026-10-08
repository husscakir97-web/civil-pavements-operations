// The importer starts its OWN application instance, so the writer is bound to the database that was verified and to a safe
// configuration by construction: the app gets exactly the importer's (already verified) MYSQL_* settings, a random auth secret,
// and every external integration switched off or pointed at nothing. It listens on a free local port only. An already-running app
// can never be used, because nothing outside this process can prove what database or integrations it is configured with.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve,basename,join} from 'node:path';
import {readdirSync,readFileSync,readlinkSync,mkdtempSync,chmodSync,rmSync} from 'node:fs';

export const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});s.on('error',reject);});

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

// ---- what is actually listening (Linux /proc; read-only, names and ports only) ----
// A printed "Local: http://127.0.0.1:<port>" is the requested address, not proof of a socket: Next only takes the port from server.address() when that is an object.
// This reads the sockets the isolated app's process tree really owns, so a log can say "TCP LISTEN 127.0.0.1:<port>" or "unix LISTEN <name>" or "none".
const readText=p=>{try{return readFileSync(p,'utf8');}catch{return '';}};
const ipv4=h=>[6,4,2,0].map(i=>parseInt(h.slice(i,i+2),16)).join('.');
function tcpAddress(hex){
 if(hex.length===8)return ipv4(hex);
 if(/^0+$/.test(hex))return '::';
 if(/^0{24}01000000$/i.test(hex))return '::1';
 const m=/^0{16}ffff0000([0-9a-f]{8})$/i.exec(hex);return m?'::ffff:'+ipv4(m[1]):'ipv6';
}
function tcpTable(file){
 const out=new Map();
 for(const line of readText(file).split('\n').slice(1)){const f=line.trim().split(/\s+/);if(f.length<10)continue;const [a,port]=f[1].split(':');out.set(f[9],{kind:'tcp',listen:f[3]==='0A',addr:tcpAddress(a),port:parseInt(port,16)});}
 return out;
}
function unixTable(file){
 const out=new Map();
 for(const line of readText(file).split('\n').slice(1)){const f=line.trim().split(/\s+/);if(f.length<7)continue;
  const path=f[7]||'';out.set(f[6],{kind:'unix',listen:(parseInt(f[3],16)&0x10000)!==0,name:path?(path.startsWith('@')?'@abstract':basename(path)):'(unnamed)'});}
 return out;
}
const HOST_ENV_NAMES=/^(NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|PASSENGER\w*|IS_PASSENGER|LSNODE\w*|LSAPI\w*|LS_\w+|PHUSION\w*)$/;
/** argv basenames (first 4) and the NAMES (never values) of hosting-related environment variables of one process. */
export function describeProcess(pid,proc='/proc'){
 const argv=readText(`${proc}/${pid}/cmdline`).split('\0').filter(Boolean).slice(0,4).map(a=>basename(a).slice(0,40));
 const envNames=readText(`${proc}/${pid}/environ`).split('\0').map(e=>e.split('=')[0]).filter(n=>HOST_ENV_NAMES.test(n)).sort();
 return {pid:Number(pid),argv,envNames};
}
/** The process tree rooted at rootPid and the sockets each process owns. Returns [] when /proc is unavailable. */
export function listenerInventory(rootPid,proc='/proc'){
 let pids;try{pids=readdirSync(proc).filter(n=>/^\d+$/.test(n));}catch{return [];}
 const parent=new Map();
 for(const n of pids){const st=readText(`${proc}/${n}/stat`);if(!st)continue;const rest=st.slice(st.lastIndexOf(')')+2).split(' ');parent.set(Number(n),Number(rest[1]));}
 const tree=[Number(rootPid)];for(let i=0;i<tree.length&&tree.length<20;i++)for(const [pid,pp] of parent)if(pp===tree[i]&&!tree.includes(pid))tree.push(pid);
 const sockets=new Map([...tcpTable(`${proc}/net/tcp`),...tcpTable(`${proc}/net/tcp6`),...unixTable(`${proc}/net/unix`)]);
 return tree.filter(pid=>parent.has(pid)).map(pid=>{
  const owned=[];
  try{for(const fd of readdirSync(`${proc}/${pid}/fd`)){let l='';try{l=readlinkSync(`${proc}/${pid}/fd/${fd}`);}catch{continue;}const m=/^socket:\[(\d+)\]$/.exec(l);const s=m&&sockets.get(m[1]);if(s&&s.listen)owned.push(s);}}catch{/* not readable */}
  return {...describeProcess(pid,proc),listeners:owned};
 });
}
const formatListener=l=>l.kind==='tcp'?`tcp LISTEN ${l.addr}:${l.port}`:`unix LISTEN ${l.name}`;
export function formatInventory(entries){
 if(!entries.length)return ['(process table not readable here)'];
 return entries.map(e=>`pid ${e.pid} [${e.argv.join(' ')||'?'}] listening: ${e.listeners.length?e.listeners.map(formatListener).join(', '):'none'}${e.envNames.length?` | hosting-related env names: ${e.envNames.join(',')}`:''}`);
}

// ---- how the importer reaches its private app ----
// Default: loopback TCP, exactly as before. Some hosts accept a listening socket on 127.0.0.1 yet refuse every connection to it (Hostinger: the child reports a real
// TCP address and /proc shows `tcp LISTEN`, but connect() gets ECONNREFUSED). Before starting anything the importer therefore proves, with a bare node child and
// a 3 s budget, which transport actually works here: TCP if it does, otherwise a unix domain socket in a private (0700) directory, which is also not reachable by
// other local users. If neither works it stops at once with the reason instead of waiting 90 s. PRIVATE_APP_TRANSPORT=tcp|unix|auto (default auto) forces a choice
// and exists for tests and recovery; the private app stays unreachable from anywhere but this machine either way.
export const TRANSPORT_PROBE_MS=3000;
export const SOCKET_PATH_MAX=100;   // sun_path is 108 bytes on Linux (104 on macOS)
const PROBE_SERVER=`const http=require('http'),net=require('net');
const mk=()=>http.createServer((q,r)=>r.end('ok'));
const t=mk(),u=mk();let up=0;const ready=()=>{if(++up===2){console.log('READY');self()}};
t.on('error',e=>console.log('TCPERR '+(e.code||'error')));u.on('error',e=>console.log('UDSERR '+(e.code||'error')));
t.listen(Number(process.env.PROBE_PORT),'127.0.0.1',ready);u.listen(process.env.PROBE_SOCKET,ready);
const one=(o)=>new Promise(res=>{const s=net.connect(o);s.setTimeout(1500,()=>{s.destroy();res('timeout')});s.once('connect',()=>{s.destroy();res('connected')});s.once('error',e=>res(String(e.code||'error')))});
async function self(){const r={tcp:await one({port:Number(process.env.PROBE_PORT),host:'127.0.0.1'}),unix:await one({path:process.env.PROBE_SOCKET})};console.log('SELF '+JSON.stringify(r))}
setInterval(()=>{},1000);`;
const codeOf=e=>String(e?.code||e?.cause?.code||e?.name||'error').replace(/[^\w.-]/g,'').slice(0,30)||'error';
/** One request over TCP or a unix socket with a hard time limit; never keeps a connection alive. Resolves {ok,code}. */
function probeRequest(opts,ms){
 return new Promise(res=>{
  let done=false;const fin=r=>{if(!done){done=true;res(r);}};
  const req=httpRequest({...opts,method:'GET',path:'/',agent:false,headers:{connection:'close'},timeout:ms},r=>{r.resume();r.on('end',()=>fin({ok:r.statusCode===200,code:'HTTP '+r.statusCode}));});
  req.on('timeout',()=>{req.destroy();fin({ok:false,code:'timeout'});});req.on('error',e=>fin({ok:false,code:codeOf(e)}));req.end();
 });
}
/** Does a bare node child on this host accept loopback TCP and unix-socket connections from this process? Also what the child itself gets connecting to its own listeners. */
export async function probeTransports({ms=TRANSPORT_PROBE_MS,retried=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'transport-probe-'));
 const out={tcp:{ok:false,code:'not-tested'},unix:{ok:false,code:'not-tested'},self:null,errors:[],dir};
 let child;
 try{
  chmodSync(dir,0o700);
  const sock=join(dir,'p.sock'),port=await freePort();
  if(sock.length>SOCKET_PATH_MAX){out.unix={ok:false,code:'path-too-long'};}
  child=spawn(process.execPath,['-e',PROBE_SERVER],{env:{PATH:process.env.PATH||'',PROBE_PORT:String(port),PROBE_SOCKET:sock},stdio:['ignore','pipe','ignore']});
  let text='';child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{text+=c;});
  const t0=Date.now();while(!/READY/.test(text)&&!/(TCPERR|UDSERR) /.test(text)&&Date.now()-t0<ms*0.5)await new Promise(r=>setTimeout(r,25));
  for(const m of text.matchAll(/(TCP|UDS)ERR (\S+)/g))out.errors.push(`${m[1]==='TCP'?'tcp':'unix'} listen ${m[2]}`);
  const left=Math.max(500,ms-(Date.now()-t0));
  const [tcp,unix]=await Promise.all([
   /TCPERR /.test(text)?{ok:false,code:'listen-failed'}:probeRequest({host:'127.0.0.1',port},left),
   out.unix.code==='path-too-long'?out.unix:(/UDSERR /.test(text)?{ok:false,code:'listen-failed'}:probeRequest({socketPath:sock},left))]);
  out.tcp=tcp;out.unix=unix;
  const m=/SELF (\{.*\})/.exec(text);if(m){try{out.self=JSON.parse(m[1]);}catch{/* ignore */}}
 }catch(e){out.errors.push('probe '+codeOf(e));}
 finally{try{child?.kill('SIGKILL');}catch{/* gone */}rmSync(dir,{recursive:true,force:true});}
 if(!retried&&out.errors.some(e=>/listen EADDRINUSE/.test(e)))return probeTransports({ms,retried:true});   // another process took the free port we had just picked
 return out;
}
/** auto: tcp if it works, else unix, else null. Forced values are returned as asked. */
export function chooseTransport(mode,probe){
 if(mode==='tcp'||mode==='unix')return mode;
 if(probe.tcp.ok)return 'tcp';
 if(probe.unix.ok)return 'unix';
 return null;
}
export const describeProbe=p=>`loopback TCP: ${p.tcp.ok?'works':'refused ('+p.tcp.code+')'}; unix socket: ${p.unix.ok?'works':'refused ('+p.unix.code+')'}${p.self?`; the probe child connecting to its own listeners: tcp ${p.self.tcp}, unix ${p.self.unix}`:''}${p.errors.length?`; ${p.errors.join(', ')}`:''}`;

/** A fetch-like request to the private app over its unix socket: status, ok, headers (a real Headers, so getSetCookie works), text(), json(). */
export function unixFetcher(socketPath,host){
 return async function unixFetch(path,init={}){
  let body=init.body,headers={...(init.headers||{})};
  if(body!==undefined&&body!==null&&typeof body!=='string'&&!Buffer.isBuffer(body)){   // FormData and friends: let Response serialise it (multipart boundary included)
   const r=new Response(body);body=Buffer.from(await r.arrayBuffer());const ct=r.headers.get('content-type');if(ct)headers['content-type']=ct;
  }
  headers={host,connection:'close',...headers};if(body!==undefined&&body!==null)headers['content-length']=String(Buffer.byteLength(body));
  return new Promise((resolve,reject)=>{
   const req=httpRequest({socketPath,path,method:init.method||'GET',headers,agent:false,signal:init.signal},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));
    res.on('end',()=>{
     const buf=Buffer.concat(chunks),h=new Headers();
     for(let i=0;i<res.rawHeaders.length;i+=2)h.append(res.rawHeaders[i],res.rawHeaders[i+1]);
     const status=res.statusCode;
     resolve({status,ok:status>=200&&status<300,headers:h,text:async()=>buf.toString('utf8'),json:async()=>JSON.parse(buf.toString('utf8')),arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)});
    });
    res.on('error',reject);
   });
   req.on('error',reject);
   if(body!==undefined&&body!==null)req.write(body);
   req.end();
  });
 };
}

export const READINESS_PROBE_TIMEOUT_MS=5000,MIN_PROBE_MS=50;
const SIGNAL_EXIT={SIGTERM:143,SIGHUP:129};

/**
 * Starts the private app and waits until GET /login answers 2xx.
 * The budget is a WALL-CLOCK deadline (attempts x intervalMs = 90 s by default). Every probe is cancellable and bounded (READINESS_PROBE_TIMEOUT_MS, never past the
 * deadline), so one request the server accepts but never answers cannot stretch the budget, and a supervisor that exits while a probe is outstanding ends the wait
 * at once. One marker line is logged at the start, so a log that stops after it shows where the process was. While waiting, SIGTERM/SIGHUP (a host stop) log the same
 * bounded, redacted report and exit 143/129; SIGKILL cannot be caught or logged. `opts` exist for tests only; the defaults are the production values.
 */
export async function startIsolatedApp(source=process.env,{attempts=180,intervalMs=500,probeTimeoutMs=READINESS_PROBE_TIMEOUT_MS,log=(...a)=>console.error(...a),transport=source.PRIVATE_APP_TRANSPORT||'auto',probe=probeTransports}={}){
 const port=await freePort(),base=`http://127.0.0.1:${port}`;   // in unix mode this is only the origin the app is configured with; nothing listens on the port
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const env=isolatedAppEnv(source,base),secrets=diagnosticSecrets(source,env);
 // which transport reaches the private app on this host (proven with a bare node child first; see above)
 const mode=['tcp','unix','auto'].includes(transport)?transport:'auto';
 let probed=null,chosen=mode==='auto'?null:mode;
 if(mode==='auto'){probed=await probe();chosen=chooseTransport('auto',probed);}
 if(!chosen){
  log(`[isolated-app] no usable transport to a private app on this host: ${describeProbe(probed)}\n[isolated-app] nothing was started.`);
  throw Object.assign(new Error('The private app cannot be reached on this host: neither loopback TCP nor a unix socket accepts connections from this process. Nothing was started.'),{probe:probed});
 }
 let socketDir=null,socketPath=null;
 if(chosen==='unix'){
  socketDir=mkdtempSync(join(tmpdir(),'private-app-'));chmodSync(socketDir,0o700);socketPath=join(socketDir,'app.sock');
  if(socketPath.length>SOCKET_PATH_MAX){rmSync(socketDir,{recursive:true,force:true});throw new Error(`The private app's unix socket path would be ${socketPath.length} characters (limit ${SOCKET_PATH_MAX}). Nothing was started.`);}
  if(probed)log(`[isolated-app] transport: unix socket in a private directory (${describeProbe(probed)})`);
 }
 const reqFn=chosen==='unix'?unixFetcher(socketPath,`127.0.0.1:${port}`):(path,init)=>fetch(base+path,init);
  const stdout=outputTail(secrets),stderr=outputTail(secrets),t0=Date.now(),budgetMs=attempts*intervalMs,deadline=t0+budgetMs;
 const child=spawn(process.execPath,[resolve(root,'scripts/demo/app-supervisor.mjs'),String(port),...(socketPath?[socketPath]:[])],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>stdout.push(c));child.stderr.on('data',c=>stderr.push(c));
 let dead=false,exit=null,onExit;const exited=new Promise(r=>{onExit=r;}),closed=new Promise(r=>child.on('close',r));
 child.on('exit',(code,signal)=>{dead=true;exit={code,signal};onExit('exited');});child.on('error',e=>{dead=true;exit={error:describeProbeError(e)};onExit('exited');});
 const stop=()=>{try{child.kill('SIGTERM');}catch{/* already gone */}if(socketDir)try{rmSync(socketDir,{recursive:true,force:true});}catch{/* best effort */}};
 process.on('exit',stop);
 let probes=0,last='none yet';
 const report=reason=>{
  const out=stdout.text(),err=stderr.text(),indent=(label,t)=>t?t.split('\n').map(l=>`[isolated-app ${label}] ${l}`).join('\n'):`[isolated-app ${label}] (nothing)`;
  log([`[isolated-app] ${reason}`,
   `[isolated-app] elapsed=${Date.now()-t0}ms probes=${probes} supervisor=${dead?'exited'+(exit?(exit.error?` (spawn error ${exit.error})`:` code=${exit.code} signal=${exit.signal}`):''):'running'} probe=GET /login ${chosen==='unix'?'over a unix socket':'on 127.0.0.1 (port '+port+')'}`,
   `[isolated-app] last readiness probe: ${last}`,
   `[isolated-app] supervisor and app output, last ${DIAG_TAIL_CHARS} chars at most, credentials redacted:`,
   indent('stdout',out),indent('stderr',err),
   '[isolated-app] sockets owned by the supervisor and its children (read from /proc, not from what the app printed):',...(dead?['(the supervisor had already exited)']:formatInventory(child.pid?listenerInventory(child.pid):[])).map(l=>`[isolated-app]   ${l}`)].join('\n'));
 };
 const onSignal=signal=>{report(`the importer received ${signal} while waiting for the isolated app; stopping (this is best effort: SIGKILL cannot be logged)`);stop();process.exit(SIGNAL_EXIT[signal]);};
 const handlers=Object.keys(SIGNAL_EXIT).map(sig=>[sig,()=>onSignal(sig)]);
 for(const [sig,h] of handlers)process.on(sig,h);
 const release=()=>{for(const [sig,h] of handlers)process.off(sig,h);};
 log(`[isolated-app] starting: GET /login ${chosen==='unix'?'over a unix socket':'on 127.0.0.1:'+port}, wall-clock budget ${Math.round(budgetMs/1000)}s, importer pid ${process.pid}`);
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  while(Date.now()<deadline){
   if(dead){await Promise.race([closed,sleep(1000)]);report('the isolated app exited before it was ready');throw new Error('The isolated app exited before it was ready (is the production build present? run npm run build).');}
   if(deadline-Date.now()<MIN_PROBE_MS)break;   // a probe that could only run for a few ms says nothing and would overwrite the last real result in the report
   const limit=Math.min(probeTimeoutMs,deadline-Date.now()),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),limit);
   probes++;
   const probeReq=reqFn('/login',{signal:ctl.signal}).then(r=>({ok:r.ok,text:`HTTP ${r.status}`}),
    e=>({ok:false,text:ctl.signal.aborted?`no response within ${limit} ms (probe cancelled)`:`connection error ${describeProbeError(e)}`}));
   const outcome=await Promise.race([probeReq,exited]);
   clearTimeout(timer);
   if(outcome==='exited'){ctl.abort();last=`probe ${probes} was still outstanding when the supervisor exited`;await Promise.race([closed,sleep(1000)]);report('the isolated app exited before it was ready');throw new Error('The isolated app exited before it was ready (is the production build present? run npm run build).');}
   last=outcome.text;if(outcome.ok)return {base,stop,fetch:reqFn,transport:chosen,socketPath,probe:probed};
   await Promise.race([sleep(Math.max(0,Math.min(intervalMs,deadline-Date.now()))),exited]);
  }
  report('the isolated app did not become ready in time');
  stop();throw new Error('The isolated app did not become ready in time.');
 }finally{release();}
}
