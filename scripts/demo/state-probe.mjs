import {existsSync,realpathSync,lstatSync,mkdirSync,openSync,writeSync,closeSync,linkSync,unlinkSync,readFileSync,constants} from 'node:fs';
import {resolve,join,sep,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {standaloneRuntimeProblem,skipNote} from './standalone-runtime.mjs';

// Filesystem-only persistence diagnostic. Imports no database code, opens no
// endpoint, reads no secrets. Off unless EXISTING_TENANT_STATE_PROBE is set to
// "create" or "verify". It proves *observed* persistence of one harmless marker
// across a restart/redeploy, not a permanent hosting guarantee.
export const MARKER_NAME='infrastruct-state-probe.json';
const KIND='infrastruct-state-probe',VERSION=1;
const DENIED_SEGMENTS=new Set(['public_html','hbuilds','node_modules','.next','.git']);
const inside=(child,parent)=>child===parent||child.startsWith(parent.endsWith(sep)?parent:parent+sep);
const fail=m=>{throw new Error(m);};

export function checkProbeDir(dir,root){
 if(typeof dir!=='string'||!dir||dir!==resolve(dir))fail('probe dir must be a normalised absolute path');
 const rootReal=realpathSync(root),rootLex=resolve(root);
 const guard=p=>{
  if(p.split(sep).some(s=>DENIED_SEGMENTS.has(s)))fail('probe dir is in a public/deployment location');
  for(const r of [rootReal,rootLex])if(inside(p,r)||inside(r,p))fail('probe dir overlaps the deployment');
 };
 guard(dir);
 let real;
 if(existsSync(dir)||lstatSafe(dir)){
  if(lstatSync(dir).isSymbolicLink())fail('probe dir must not be a symlink');
  if(!lstatSync(dir).isDirectory())fail('probe dir is not a directory');
  real=realpathSync(dir);
 }else{
  const parent=dirname(dir);
  if(!existsSync(parent))fail('probe dir parent does not exist');
  real=join(realpathSync(parent),dir.slice(parent.length).replace(/^[\\/]+/,''));
 }
 guard(real);
 return real;
}
function lstatSafe(p){try{return lstatSync(p);}catch{return null;}}

function readMarker(file){
 const st=lstatSafe(file);
 if(!st)fail('marker is missing');
 if(!st.isFile()||st.isSymbolicLink())fail('marker is not a regular file');
 const text=readFileSync(file,'utf8');let doc;
 try{doc=JSON.parse(text);}catch{fail('marker is not valid JSON');}
 if(doc?.kind!==KIND||doc.version!==VERSION||typeof doc.id!=='string'||!doc.id)fail('marker content is not recognised');
 return {id:doc.id,createdAt:doc.createdAt,sha256:createHash('sha256').update(text).digest('hex')};
}

// mode "create": make the dir (if absent) and the marker if absent; an existing
// marker is validated and reported, never overwritten. mode "verify": read only.
export function runStateProbe(env=process.env,root=process.cwd()){
 const mode=env.EXISTING_TENANT_STATE_PROBE;
 if(mode!=='create'&&mode!=='verify')fail('EXISTING_TENANT_STATE_PROBE must be create or verify');
 const dir=env.EXISTING_TENANT_STATE_PROBE_DIR;
 const real=checkProbeDir(dir,root);
 if(mode==='create'&&!existsSync(dir)){
  try{mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  checkProbeDir(dir,root);
 }
 const file=join(dir,MARKER_NAME);let created=false;
 if(mode==='create'&&!lstatSafe(file)){
  // Complete content is written to a private temp file, then hard-linked into
  // place: link() fails with EEXIST for the loser of a concurrent start, and no
  // reader can ever see a half-written marker.
  const tmp=join(dir,`.${MARKER_NAME}.${process.pid}.${randomUUID()}.tmp`);
  const body=JSON.stringify({kind:KIND,version:VERSION,id:randomUUID(),createdAt:new Date().toISOString(),note:'Harmless persistence marker. Safe to delete.'})+'\n';
  const fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
  try{writeSync(fd,body);}finally{closeSync(fd);}
  try{linkSync(tmp,file);created=true;}catch(e){if(e.code!=='EEXIST')throw e;}finally{try{unlinkSync(tmp);}catch{}}
 }
 const m=readMarker(file);
 if(env.EXISTING_TENANT_STATE_PROBE_EXPECT_ID&&env.EXISTING_TENANT_STATE_PROBE_EXPECT_ID!==m.id)fail('marker id differs from the expected id');
 if(env.EXISTING_TENANT_STATE_PROBE_EXPECT_SHA256&&env.EXISTING_TENANT_STATE_PROBE_EXPECT_SHA256!==m.sha256)fail('marker content differs from the expected sha256');
 return {mode,created,dir:real,...m};
}

let started=false;
// Explicit opt-in (EXISTING_TENANT_STATE_PROBE) plus the launcher-independent standalone-server proof (standalone-runtime.mjs). Silent when not opted in;
// when opted in but declined, logs one concise private skip line (reason code, launcher file name). Never throws into app start.
export function startStateProbe(env=process.env,argv=process.argv,root=process.cwd(),log=console){
 if(started||!env.EXISTING_TENANT_STATE_PROBE)return null;
 const problem=standaloneRuntimeProblem(env,root);
 if(problem){log.warn(skipNote('[state-probe]',problem,argv));return null;}
 started=true;
 try{
  const r=runStateProbe(env,root);
  log.log(`[state-probe] OK mode=${r.mode} created=${r.created} id=${r.id} sha256=${r.sha256} createdAt=${r.createdAt} dir=${r.dir} pid=${process.pid} at=${new Date().toISOString()}`);
  return r;
 }catch(e){
  log.error(`[state-probe] FAIL mode=${env.EXISTING_TENANT_STATE_PROBE} reason=${e.message} pid=${process.pid} at=${new Date().toISOString()}`);
  return false;
 }
}
export const _resetStateProbeForTests=()=>{started=false;};
