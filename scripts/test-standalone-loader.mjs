// No database connections: executable boundary tests, fake lock sessions, and
// packaging closure checks. Real standalone acceptance is a separate command.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import {startRuntimeLoader,runtimeLoaderEnv} from './demo/runtime-loader.mjs';
import {acquireLoaderLock,loaderLockName} from './demo/loader-lock.mjs';
import {isolatedAppEnv} from './demo/import-app.mjs';
import {existingTenantLoad} from './existing-tenant-load.mjs';

test('instrumentation never imports loader in build/default/dev/edge/isolated environments',async()=>{
 const code=ts.transpileModule(readFileSync('instrumentation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const enabled={NEXT_RUNTIME:'nodejs',NODE_ENV:'production',EXISTING_TENANT_RUNTIME_ENABLE:'true',EXISTING_TENANT_LOAD:'plan',__NEXT_PRIVATE_STANDALONE_CONFIG:'{}'};
 for(const env of [{},{...enabled,__NEXT_PRIVATE_STANDALONE_CONFIG:undefined},{...enabled,NEXT_RUNTIME:'edge'},
  {...enabled,NODE_ENV:'development'},{...enabled,EXISTING_TENANT_RUNTIME_ENABLE:undefined},
  {...enabled,EXISTING_TENANT_LOAD:''},isolatedAppEnv(enabled,'http://127.0.0.1:3333')]){
  const exports={};vm.runInNewContext(code,{exports,process:{env},require(){assert.fail('unexpected loader import');}});
  await exports.register();
 }
 let called=0;const exports={};vm.runInNewContext(code,{exports,process:{env:enabled},require(){return {startRuntimeLoader(){called++;}};}});
 await exports.register();assert.equal(called,1);
});

test('standalone runtime rejects build/CLI argv even with all enable flags; launches once with a restricted environment',()=>{
 const root=mkdtempSync(join(tmpdir(),'loader-runtime-'));
 const env={NODE_ENV:'production',EXISTING_TENANT_RUNTIME_ENABLE:'true',EXISTING_TENANT_LOAD:'plan',__NEXT_PRIVATE_STANDALONE_CONFIG:'{}',
  NODE_OPTIONS:'--require malicious',NODE_PATH:'/untrusted',PORT:'443',HOSTNAME:'0.0.0.0',OPENAI_API_KEY:'test-only',MYSQL_HOST:'127.0.0.1'};
 let count=0;const launch=(exe,args,opts)=>{count++;assert.equal(exe,process.execPath);assert.deepEqual(args,[join(root,'scripts','existing-tenant-load.mjs')]);assert.equal(opts.cwd,root);
  for(const key of ['NODE_OPTIONS','NODE_PATH','PORT','HOSTNAME','OPENAI_API_KEY','EXISTING_TENANT_RUNTIME_ENABLE','__NEXT_PRIVATE_STANDALONE_CONFIG'])assert.equal(opts.env[key],undefined,key);
  return {on(){}};};
 try{
  for(const argv of [[process.execPath,'next','build'],[process.execPath,'scripts/start.mjs'],[process.execPath]])assert.equal(startRuntimeLoader(env,argv,root,launch),false);
  assert.throws(()=>startRuntimeLoader(env,[process.execPath,join(root,'server.js')],root,launch),/assets are missing/);
  mkdirSync(join(root,'.next'));mkdirSync(join(root,'scripts'));writeFileSync(join(root,'.next','BUILD_ID'),'test');writeFileSync(join(root,'scripts','existing-tenant-load.mjs'),'');
  assert.equal(startRuntimeLoader(env,[process.execPath,join(root,'server.js')],root,launch),true);
  assert.equal(startRuntimeLoader(env,[process.execPath,join(root,'server.js')],root,launch),false);assert.equal(count,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('database-wide nonblocking mutex excludes concurrent runtime instances before quiescence; releases for resume',async()=>{
 const owners=new Map();let next=0;
 const session=()=>{const id=++next;return {async query(sql,[key]){
  if(sql.includes('GET_LOCK')){const free=!owners.has(key);if(free)owners.set(key,id);return [[{acquired:free?1:0}]];}
  return [[{owner:null}]];
 },async end(){for(const [key,value] of owners)if(value===id)owners.delete(key);}};};
 const a=session(),b=session();let quiesced=0;
 const run=async(db,org)=>{if(!await acquireLoaderLock(db,'fixture_test',org))return false;quiesced++;return true;};
 assert.deepEqual(await Promise.all([run(a,'org-a'),run(b,'org-b')]),[true,false]);assert.equal(quiesced,1);
 await a.end();assert.equal(await run(b,'org-b'),true);assert.equal(quiesced,2);await b.end();
 assert.notEqual(loaderLockName('fixture_test'),loaderLockName('other_test'));
 const orphan={query:async sql=>[[sql.includes('GET_LOCK')?{acquired:1}:{owner:42}]]};
 assert.equal(await acquireLoaderLock(orphan,'fixture_test','org-a'),false,'live importer survives a loader restart');
 for(const acquired of [null,0])assert.equal(await acquireLoaderLock({query:async()=>[[{acquired}]]},'fixture_test','org-a'),false);
 await assert.rejects(()=>acquireLoaderLock({query:async()=>{throw new Error('offline');}},'fixture_test','org-a'),/offline/);
 const source=readFileSync('scripts/existing-tenant-load.mjs','utf8');
 assert.ok(source.indexOf('await acquireLoaderLock')<source.indexOf('await quiesce'));
 assert.ok(source.indexOf('await lease.end()')>source.lastIndexOf('await quiesce'));
});

test('disabled/invalid loader refuses without database settings; child environment cannot enable recursion or outbound integrations',async()=>{
 assert.equal(await existingTenantLoad({}),0);
 assert.equal(await existingTenantLoad({EXISTING_TENANT_LOAD:'invalid'}),2);
 assert.equal(await existingTenantLoad({EXISTING_TENANT_LOAD:'apply'}),2);
 const source={MYSQL_HOST:'127.0.0.1',MYSQL_DATABASE:'fixture_test',EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_RUNTIME_ENABLE:'true',
  MAINTENANCE_UNTIL:'future',NODE_OPTIONS:'bad',NODE_PATH:'bad',SMTP_HOST:'external',OPENAI_API_KEY:'test',STRIPE_SECRET_KEY:'test',R2_ENDPOINT:'external',BETTER_AUTH_SECRET:'old'};
 const env=isolatedAppEnv(source,'http://127.0.0.1:4444');
 assert.equal(env.MYSQL_DATABASE,'fixture_test');assert.equal(env.NODE_ENV,'production');assert.equal(env.EMAIL_ENABLED,'false');assert.equal(env.R2_ENDPOINT,'http://127.0.0.1:9');
 assert.notEqual(env.BETTER_AUTH_SECRET,source.BETTER_AUTH_SECRET);
 for(const key of ['EXISTING_TENANT_LOAD','EXISTING_TENANT_RUNTIME_ENABLE','MAINTENANCE_UNTIL','NODE_OPTIONS','NODE_PATH','SMTP_HOST','OPENAI_API_KEY','STRIPE_SECRET_KEY'])assert.equal(env[key],undefined,key);
 assert.equal(runtimeLoaderEnv(source).EXISTING_TENANT_LOAD,'apply');
});

test('loader orchestration refuses expired windows before connect, keeps lease through cleanup, and preserves evidence/resume arguments',async()=>{
 const policy=await import('../lib/platform/maintenance-policy.mjs');
 const events=[],launches=[];const state=mkdtempSync(join(tmpdir(),'loader-state-'));let acquired=1;
 const require=createRequire(import.meta.url),exports={};
 const db={query:async sql=>[[sql.includes('GET_LOCK')?{acquired}:{owner:null}]],on(){},ping:async()=>{},end:async()=>events.push('release')};
 // The real coordinator runs with fake database/child boundaries. Allow-list
 // validity and import data semantics remain the existing integration suites' job.
 const mocks={
  './mysql-config.mjs':{connect:async()=>{events.push('connect');return db;}},
  './demo/existing-tenant.mjs':{evaluateExistingTenantAllowlist:()=>({problems:[]}),databaseFingerprint:async()=> 'f'.repeat(64)},
  './demo/quiesce.mjs':{quiesce:async()=>{events.push('quiesce');return {killed:0,remaining:0,ms:0};}},
  './demo/loader-lock.mjs':{acquireLoaderLock},'../lib/platform/maintenance-policy.mjs':policy,
  'node:child_process':{spawn:(exe,args,opts)=>{launches.push({args,opts});events.push('spawn');const c=new EventEmitter();queueMicrotask(()=>c.emit('exit',0));return c;}},
 };
 const source=readFileSync('scripts/existing-tenant-load.mjs','utf8').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(resolve('scripts/existing-tenant-load.mjs')).href));
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 await vm.runInNewContext('(async()=>{'+code+'})()',{exports,URL,require:name=>mocks[name]||require(name),console:{log(){}},
  process:{env:{},argv:[],execPath:process.execPath,exit(){assert.fail('unexpected watchdog exit');}},setInterval,clearInterval,setTimeout,clearTimeout});
 const env={MYSQL_DATABASE:'fixture_test',EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_ALLOWLIST_JSON:JSON.stringify({organisationId:'fixture-org',adminEmail:'test@example.invalid'}),
  MAINTENANCE_UNTIL:new Date(Date.now()+30*60_000).toISOString(),EXISTING_TENANT_STATE_DIR:state,
  EXISTING_TENANT_PLAN_HASH:'a'.repeat(64),DEMO_SEED_PASSWORD:'test-only',EXISTING_TENANT_BACKUP_EVIDENCE_JSON:'{}'};
 try{
  assert.equal(await exports.existingTenantLoad({...env,MAINTENANCE_UNTIL:new Date(Date.now()-1).toISOString()}),2);assert.deepEqual(events,[]);
  acquired=0;assert.equal(await exports.existingTenantLoad(env),3);assert.deepEqual(events,['connect','release']);events.length=0;acquired=1;
  assert.equal(await exports.existingTenantLoad({...env,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:undefined}),2);assert.equal(launches.length,0);events.length=0;
  assert.equal(await exports.existingTenantLoad(env),0);assert.deepEqual(events,['connect','quiesce','spawn','quiesce','release']);
  assert.ok(launches[0].args.includes('--backup-evidence'));assert.ok(launches[0].args.includes('--deadline-ms'));
  writeFileSync(join(state,'baseline.json'),'original baseline fixture');events.length=0;
  assert.equal(await exports.existingTenantLoad({...env,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:undefined}),0);
  assert.ok(launches[1].args.includes('--baseline-sha256'));assert.ok(!launches[1].args.includes('--backup-evidence'));
  assert.equal(readFileSync(join(state,'baseline.json'),'utf8'),'original baseline fixture');
 }finally{rmSync(state,{recursive:true,force:true});}
});

test('installed Next env loader cannot repopulate isolated credentials or trigger settings from deployment .env files',()=>{
 const root=mkdtempSync(join(tmpdir(),'isolated-dotenv-'));
 try{
  writeFileSync(join(root,'.env.production'),'MYSQL_DATABASE=wrong_database\nSMTP_HOST=external.invalid\nEXISTING_TENANT_LOAD=apply\nEXISTING_TENANT_RUNTIME_ENABLE=true\n');
  const require=createRequire(import.meta.url);
  const code=`const {loadEnvConfig}=require(${JSON.stringify(require.resolve('@next/env'))});loadEnvConfig(process.cwd());console.log(JSON.stringify(process.env));`;
  const child=spawnSync(process.execPath,['-e',code],{cwd:root,env:isolatedAppEnv({MYSQL_DATABASE:'fixture_test'},'http://127.0.0.1:4444'),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const env=JSON.parse(child.stdout);
  assert.equal(env.MYSQL_DATABASE,'fixture_test');for(const key of ['SMTP_HOST','EXISTING_TENANT_LOAD','EXISTING_TENANT_RUNTIME_ENABLE'])assert.equal(env[key],undefined,key);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('interruption fixture driver rejects hosted targets and production mode before any database connection',()=>{
 for(const extra of [{MYSQL_HOST:'hosted.example.invalid'},{MYSQL_HOST:'127.0.0.1',NODE_ENV:'production'}]){
  const child=spawnSync(process.execPath,['scripts/test-existing-tenant-path.mjs'],{env:{PATH:process.env.PATH,MYSQL_DATABASE:'fixture_test',...extra},encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/Fixture tests require a disposable loopback MySQL service and a non-production test driver/);
 }
});

test('explicit trace list covers mysql2 lockfile dependency closure and loader relative module/assets graph',()=>{
 const config=ts.transpileModule(readFileSync('next.config.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};vm.runInNewContext(config,{exports,process:{env:{}}});
 assert.equal(exports.default.output,'standalone');
 const includes=exports.default.outputFileTracingIncludes['/*'];
 const lock=JSON.parse(readFileSync('package-lock.json','utf8'));const packages=new Set();
 function visit(name){if(packages.has(name))return;packages.add(name);assert.ok(includes.includes(`./node_modules/${name}/**/*`),name);
  for(const dep of Object.keys(lock.packages['node_modules/'+name].dependencies||{}))visit(dep);}
 visit('mysql2');
 const seen=new Set();const require=createRequire(import.meta.url);
 function file(path){path=resolve(path);if(seen.has(path))return;seen.add(path);const relative='./'+path.slice(process.cwd().length+1).replaceAll('\\','/');
  assert.ok(includes.includes(relative)||(relative.startsWith('./scripts/demo/')&&includes.includes('./scripts/demo/**/*.mjs')),relative);
  const source=readFileSync(path,'utf8');if(!path.endsWith('.mjs'))return;
  for(const m of source.matchAll(/(?:from\s+|import\s+|new URL\()['"]([^'"]+)['"]/g)){
   const spec=m[1];if(spec.startsWith('.')){if(spec.endsWith('.mjs')||spec.endsWith('.json'))file(new URL(spec,'file:///'+path.replaceAll('\\','/')).pathname.replace(/^\/([A-Z]:)/,'$1'));}
   else if(!spec.startsWith('node:')){assert.equal(spec,'mysql2/promise');assert.ok(require.resolve(spec));}
  }
 }
 for(const path of ['scripts/existing-tenant-load.mjs','scripts/existing-tenant-verify.mjs','scripts/import-demo-tenant.mjs','scripts/demo/app-supervisor.mjs'])file(path);
 assert.ok(seen.size>20);
});

test('isolated supervisor starts and stops a standalone-shaped fixture without a source checkout or inherited loader settings',async()=>{
 const root=mkdtempSync(join(tmpdir(),'supervisor-fixture-'));
 mkdirSync(join(root,'scripts','demo'),{recursive:true});
 for(const f of ['import-app.mjs','app-supervisor.mjs'])copyFileSync('scripts/demo/'+f,join(root,'scripts','demo',f));
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 // This is a process/lifecycle fixture, NOT a substitute for the Next artifact test.
 writeFileSync(join(root,'server.js'),`import {createServer} from 'node:http';
 createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(process.env));}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
 let app;
 try{
  const {startIsolatedApp}=await import(pathToFileURL(join(root,'scripts/demo/import-app.mjs')));
  app=await startIsolatedApp({PATH:process.env.PATH,MYSQL_DATABASE:'fixture_test',NODE_OPTIONS:'--require nonexistent',PORT:'1',HOSTNAME:'0.0.0.0',EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_RUNTIME_ENABLE:'true',MAINTENANCE_UNTIL:'future'});
  const env=await (await fetch(app.base+'/login')).json();
  assert.equal(env.HOSTNAME,'127.0.0.1');assert.equal(env.PORT,new URL(app.base).port);assert.equal(env.MYSQL_DATABASE,'fixture_test');
  for(const key of ['NODE_OPTIONS','EXISTING_TENANT_LOAD','EXISTING_TENANT_RUNTIME_ENABLE','MAINTENANCE_UNTIL'])assert.equal(env[key],undefined,key);
 }finally{
  if(app){app.stop();let stopped=false;for(let i=0;i<60;i++){try{await fetch(app.base+'/login');}catch{stopped=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(stopped,'isolated server must stop with its supervisor');}
  rmSync(root,{recursive:true,force:true});
 }
});
