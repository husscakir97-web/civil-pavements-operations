// Filesystem only; no database. Run: node --test scripts/test-state-probe.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,symlinkSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runStateProbe,startStateProbe,_resetStateProbeForTests,MARKER_NAME} from './demo/state-probe.mjs';

const sandbox=()=>{const base=realpathSync(mkdtempSync(join(tmpdir(),'probe-')));const root=join(base,'hbuilds','current','nodejs');
 mkdirSync(root,{recursive:true});writeFileSync(join(root,'server.js'),'');return {base,root,dir:join(base,'.existing-tenant-state')};};
const env=(dir,mode='create',extra={})=>({EXISTING_TENANT_STATE_PROBE:mode,EXISTING_TENANT_STATE_PROBE_DIR:dir,...extra});

test('create writes one identifiable marker, never overwrites, leaves no temp files',()=>{
 const {base,root,dir}=sandbox();
 try{
  const a=runStateProbe(env(dir),root);assert.equal(a.created,true);
  const before=readFileSync(join(dir,MARKER_NAME),'utf8');assert.match(before,/infrastruct-state-probe/);
  const b=runStateProbe(env(dir),root);assert.equal(b.created,false);assert.equal(b.id,a.id);assert.equal(b.sha256,a.sha256);
  assert.equal(readFileSync(join(dir,MARKER_NAME),'utf8'),before);
  assert.deepEqual(readdirSync(dir),[MARKER_NAME]);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('verify never creates; fails when missing, different, corrupt or foreign',()=>{
 const {base,root,dir}=sandbox();
 try{
  assert.throws(()=>runStateProbe(env(dir,'verify'),root),/does not exist|missing/);assert.equal(existsSync(dir),false);
  mkdirSync(dir);assert.throws(()=>runStateProbe(env(dir,'verify'),root),/missing/);assert.equal(readdirSync(dir).length,0);
  const a=runStateProbe(env(dir),root);
  assert.equal(runStateProbe(env(dir,'verify',{EXISTING_TENANT_STATE_PROBE_EXPECT_ID:a.id,EXISTING_TENANT_STATE_PROBE_EXPECT_SHA256:a.sha256}),root).created,false);
  assert.throws(()=>runStateProbe(env(dir,'verify',{EXISTING_TENANT_STATE_PROBE_EXPECT_ID:'other'}),root),/differs/);
  assert.throws(()=>runStateProbe(env(dir,'verify',{EXISTING_TENANT_STATE_PROBE_EXPECT_SHA256:'0'.repeat(64)}),root),/differs/);
  writeFileSync(join(dir,MARKER_NAME),'not json');assert.throws(()=>runStateProbe(env(dir,'verify'),root),/valid JSON/);
  assert.throws(()=>runStateProbe(env(dir),root),/valid JSON/); // create does not repair/overwrite either
  assert.equal(readFileSync(join(dir,MARKER_NAME),'utf8'),'not json');
  writeFileSync(join(dir,MARKER_NAME),'{"kind":"x"}');assert.throws(()=>runStateProbe(env(dir,'verify'),root),/not recognised/);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('unsafe paths and symlinks are rejected before anything is written',()=>{
 const {base,root,dir}=sandbox();
 try{
  const bad=[undefined,'','relative/dir',base+'/a/../b',join(root,'state'),join(root,'..'),join(base,'hbuilds'),join(base,'public_html','x'),
   join(base,'node_modules','x'),base+'/hbuilds/current/nodejs/.next/x',join(base,'missing-parent','state')];
  for(const d of bad)assert.throws(()=>runStateProbe(env(d),root),Error,String(d));
  assert.throws(()=>runStateProbe({EXISTING_TENANT_STATE_PROBE:'plan',EXISTING_TENANT_STATE_PROBE_DIR:dir},root),/create or verify/);
  // ancestor of the deployment
  assert.throws(()=>runStateProbe(env(base),root),/overlaps/);
  // symlink dir pointing into the deployment and to a safe place
  const pub=join(base,'public_html');mkdirSync(pub);
  for(const target of [join(root),pub,join(base,'other')]){mkdirSync(target,{recursive:true});
   const link=join(base,'link-'+Math.random().toString(36).slice(2));symlinkSync(target,link);
   assert.throws(()=>runStateProbe(env(link),root),/symlink/);}
  // symlinked parent resolving into public_html
  const viaLink=join(base,'parentlink');symlinkSync(pub,viaLink);
  assert.throws(()=>runStateProbe(env(join(viaLink,'state')),root),/public|deployment/);
  assert.deepEqual(readdirSync(pub),[]);assert.equal(existsSync(join(root,MARKER_NAME)),false);
  // dangling symlink at the marker path is not followed
  mkdirSync(dir);symlinkSync(join(base,'elsewhere'),join(dir,MARKER_NAME));
  assert.throws(()=>runStateProbe(env(dir),root),/regular file/);assert.equal(existsSync(join(base,'elsewhere')),false);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('concurrent starts across processes produce exactly one intact marker',async()=>{
 const {base,root,dir}=sandbox();
 try{
  const mod=pathToFileURL(join(process.cwd(),'scripts/demo/state-probe.mjs')).href;
  const code=`import {runStateProbe} from ${JSON.stringify(mod)};const r=runStateProbe(process.env,process.argv[1]);console.log(JSON.stringify({c:r.created,id:r.id,sha:r.sha256}));`;
  const run=()=>new Promise((res,rej)=>{let out='',err='';const p=spawn(process.execPath,['--input-type=module','-e',code,root],{env:{...process.env,...env(dir)}});
   p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('exit',c=>c===0?res(JSON.parse(out)):rej(new Error(err)));});
  const rs=await Promise.all(Array.from({length:12},run));
  assert.equal(rs.filter(r=>r.c).length,1);assert.equal(new Set(rs.map(r=>r.id)).size,1);assert.equal(new Set(rs.map(r=>r.sha)).size,1);
  assert.deepEqual(readdirSync(dir),[MARKER_NAME]);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('startStateProbe is inert unless enabled in the standalone server; never throws; logs privately',()=>{
 const {base,root,dir}=sandbox();const logs=[],errs=[];const log={log:m=>logs.push(m),error:m=>errs.push(m)};
 const on={NODE_ENV:'production',__NEXT_PRIVATE_STANDALONE_CONFIG:'{}',...env(dir)};const argv=[process.execPath,join(root,'server.js')];
 try{
  for(const e of [{},{...on,EXISTING_TENANT_STATE_PROBE:''},{...on,NODE_ENV:'development'},{...on,__NEXT_PRIVATE_STANDALONE_CONFIG:undefined}]){
   _resetStateProbeForTests();assert.equal(startStateProbe(e,argv,root,log),null);}
  _resetStateProbeForTests();assert.equal(startStateProbe(on,[process.execPath,join(root,'other.js')],root,log),null);
  assert.equal(existsSync(dir),false);assert.equal(logs.length+errs.length,0);
  _resetStateProbeForTests();const r=startStateProbe(on,argv,root,log);assert.ok(r.created);
  assert.match(logs[0],/\[state-probe\] OK mode=create created=true id=\S+ sha256=[0-9a-f]{64}/);
  assert.equal(startStateProbe(on,argv,root,log),null); // once per process
  _resetStateProbeForTests();assert.equal(startStateProbe({...on,EXISTING_TENANT_STATE_PROBE:'verify',EXISTING_TENANT_STATE_PROBE_EXPECT_ID:'nope'},argv,root,log),false);
  assert.match(errs[0],/FAIL .*differs/);
  _resetStateProbeForTests();assert.equal(startStateProbe({...on,EXISTING_TENANT_STATE_PROBE_DIR:join(root,'x')},argv,root,log),false);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('source has no database/network/secret references',()=>{
 const src=readFileSync('scripts/demo/state-probe.mjs','utf8');
 assert.doesNotMatch(src,/mysql|drizzle|better-auth|from 'node:(net|http|https)'|MYSQL_|PASSWORD|fetch\(/i);
});
