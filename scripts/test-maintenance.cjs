// Bounded maintenance mode (lib/platform/maintenance.ts + its scripts twin + proxy.ts): pure rules, twin equivalence, and static proof that the gate
// and every outbound integration choke point are wired. The end-to-end proof (a running app refusing real requests while an import runs, with
// capture servers seeing no email/storage traffic) is in test-existing-tenant-path.mjs.
const ts=require('typescript'),fs=require('node:fs'),assert=require('node:assert/strict');
const loadTs=f=>{const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,require,m);return m.exports;};
const T={...loadTs('lib/platform/maintenance.ts'),...loadTs('lib/platform/maintenance-fence.ts')};
let n=0;const t=(name,fn)=>Promise.resolve(fn()).then(()=>{n++;console.log('PASS',name);});
(async()=>{
 const J=await import('../lib/platform/maintenance-policy.mjs');
 const now=Date.parse('2026-10-05T10:00:00.000Z'),iso=ms=>new Date(now+ms).toISOString();
 await t('inactive when unset, empty, invalid or already past (so a stale value can never leave the site locked)',()=>{
  for(const v of [undefined,'','  ','not a date','2026-10-05T09:59:59.000Z',iso(0)])assert.equal(T.maintenanceState({MAINTENANCE_UNTIL:v},now).active,false,String(v));
  assert.match(T.maintenanceState({MAINTENANCE_UNTIL:'nope'},now).problem,/valid/);assert.match(T.maintenanceState({MAINTENANCE_UNTIL:iso(-1000)},now).problem,/ended/);});
 await t('active until the stated time, then ends by itself',()=>{const e={MAINTENANCE_UNTIL:iso(60_000)};assert.equal(T.maintenanceState(e,now).active,true);assert.equal(T.maintenanceState(e,now+59_999).active,true);assert.equal(T.maintenanceState(e,now+60_000).active,false);});
 await t('every outbound integration refuses while active and works again after it ends',()=>{const e={MAINTENANCE_UNTIL:iso(60_000)};assert.throws(()=>T.assertNotMaintenance('email',e,now),/Maintenance mode: email/);assert.doesNotThrow(()=>T.assertNotMaintenance('email',e,now+120_000));assert.doesNotThrow(()=>T.assertNotMaintenance('email',{},now));});
 await t('the scripts twin agrees with the app copy on a matrix of values and times',()=>{let c=0;for(const v of [undefined,'','x',iso(-5000),iso(1),iso(299_999),iso(300_000),iso(3600_000),iso(13*3600_000)])for(const d of [0,1,60_000,3600_000]){const e={MAINTENANCE_UNTIL:v};assert.deepEqual(J.maintenanceState(e,now+d),T.maintenanceState(e,now+d));c++;}assert.equal(c,36);assert.equal(J.MAX_WINDOW_HOURS,T.MAX_WINDOW_HOURS);});
 await t('the loader window rule: needs an active window of at least 5 minutes and at most 12 hours',()=>{
  assert.match(J.maintenanceWindowProblems({},now).join(),/not set/);assert.match(J.maintenanceWindowProblems({MAINTENANCE_UNTIL:'zzz'},now).join(),/valid/);assert.match(J.maintenanceWindowProblems({MAINTENANCE_UNTIL:iso(-1)},now).join(),/ended/);
  assert.match(J.maintenanceWindowProblems({MAINTENANCE_UNTIL:iso(4*60_000)},now).join(),/less than 5 minutes/);assert.match(J.maintenanceWindowProblems({MAINTENANCE_UNTIL:iso(13*3600_000)},now).join(),/more than 12 hours/);
  assert.deepEqual(J.maintenanceWindowProblems({MAINTENANCE_UNTIL:iso(2*3600_000)},now),[]);});

 const mod=await import('../lib/platform/maintenance-policy.mjs');
 await t('import lock name: the app, the scripts twin and the importer compute the same name',()=>{
  const crypto=require('node:crypto');const want='demo_import_'+crypto.createHash('sha256').update('dbx|org1').digest('hex').slice(0,40);
  assert.equal(T.importLockName('dbx','org1'),want);assert.equal(mod.importLockName('dbx','org1'),want);
  assert.ok(fs.readFileSync('scripts/import-demo-tenant.mjs','utf8').includes("'demo_import_'+createHash('sha256').update(String(process.env.MYSQL_DATABASE)+'|'+org).digest('hex').slice(0,40)"));});
 await t('import fence: only an APPLY configuration engages it; an unreadable allow-list fails closed',()=>{
  const allow=JSON.stringify({organisationId:'org1'});
  for(const mode of [undefined,'','plan','fingerprint','verify'])assert.equal(T.importFence({EXISTING_TENANT_LOAD:mode,MYSQL_DATABASE:'dbx',EXISTING_TENANT_ALLOWLIST_JSON:allow}).configured,false);
  const f=T.importFence({EXISTING_TENANT_LOAD:'apply',MYSQL_DATABASE:'dbx',EXISTING_TENANT_ALLOWLIST_JSON:allow});assert.equal(f.configured,true);assert.equal(f.lockName,T.importLockName('dbx','org1'));
  for(const bad of ['','{nope','{}',JSON.stringify({organisationId:''})]){const g=T.importFence({EXISTING_TENANT_LOAD:'apply',MYSQL_DATABASE:'dbx',EXISTING_TENANT_ALLOWLIST_JSON:bad});assert.deepEqual([g.configured,g.lockName],[true,null],bad);}});
 await t('import fence: closed while the importer lock is held, open when it is free, FAILS CLOSED on any error, and reacts within its 1 s cache',async()=>{
  T.resetImportFenceCache();let held=true,boom=false,calls=0;const q=async()=>{calls++;if(boom)throw new Error('db down');return [[{u:held?4242:null}]];};
  const now=1_000_000;
  assert.equal(await T.importInFlight('L',q,now),true);held=false;
  assert.equal(await T.importInFlight('L',q,now+500),true,'cached for under a second (no query storm)');assert.equal(calls,1);
  assert.equal(await T.importInFlight('L',q,now+1001),false,'free: reopens within a second of the importer session ending');
  held=true;assert.equal(await T.importInFlight('L',q,now+3000),true,'a new importer closes it again');
  boom=true;assert.equal(await T.importInFlight('L',q,now+5000),true,'database error: stay closed');
  assert.equal(await T.importInFlight(null,q,now+9000),true,'unnamed lock: stay closed');T.resetImportFenceCache();});
 await t('apply needs a longer window than plan, and the importer stops 90 s before the window ends',()=>{
  const e={MAINTENANCE_UNTIL:iso(10*60_000)};assert.deepEqual(mod.maintenanceWindowProblems(e,now),[]);assert.match(mod.maintenanceWindowProblems(e,now,mod.MIN_REMAINING_APPLY_MINUTES).join(),/less than 15 minutes/);
  assert.deepEqual(mod.maintenanceWindowProblems({MAINTENANCE_UNTIL:iso(20*60_000)},now,mod.MIN_REMAINING_APPLY_MINUTES),[]);
  assert.equal(mod.importDeadlineMs(now+20*60_000),now+20*60_000-90_000);assert.deepEqual(mod.KILL_GRACE_SECONDS,[20,30]);});
 const G=await import('./demo/import-guards.mjs');
 await t('importer deadline (deterministic): once passed, every API write and every SQL write is refused; reads stay allowed; before it, writes pass',async()=>{
  const calls=[];const call=async(path,method)=>{calls.push(method+' '+path);return {status:200,body:{}};};
  const sqlCalls=[];const fakeDb={query:async(sql)=>{sqlCalls.push(String(sql).slice(0,20));return [[],[]];},end(){}};
  const gc=G.guardedCall(call,null),gd=G.guardedDb(fakeDb,'org',null);
  try{G.mutationGate.deadline=Date.now()+60_000;await gc('/api/projects/work-areas','POST',{projectId:'x'});assert.equal(calls.length,1,'before the deadline a permitted write passes');
   G.mutationGate.deadline=Date.now()-1;
   await assert.rejects(()=>gc('/api/projects/work-areas','POST',{projectId:'x'}),e=>e.code==='DEADLINE');
   await assert.rejects(()=>gc('/api/business-units','POST',{name:'n',code:'TC'}),e=>e.code==='DEADLINE');
   await assert.doesNotReject(()=>gc('/api/projects/workspace?id=x','GET'));
   await assert.rejects(()=>gd.query("UPDATE shifts SET status='In Progress' WHERE organisation_id=? AND name=?",['org','x']),e=>e.code==='DEADLINE');
   await assert.doesNotReject(()=>gd.query('SELECT 1',[]));
   assert.equal(calls.length,2,'no write reached the application after the deadline');assert.ok(!sqlCalls.some(x=>/UPDATE/.test(x)));
   assert.throws(()=>G.assertBeforeDeadline(Date.now()),e=>e.code==='DEADLINE');G.mutationGate.deadline=0;assert.doesNotThrow(()=>G.assertBeforeDeadline(Date.now()));
  }finally{G.mutationGate.deadline=0;}});
 const proxy=fs.readFileSync('proxy.ts','utf8');
 await t('proxy: gates every path, exempts only GET /api/health, answers 503 with Retry-After and a recovery instruction',()=>{assert.match(proxy,/matcher:'\/:path\*'/);assert.equal((proxy.match(/pathname===/g)||[]).length,1);assert.match(proxy,/'\/api\/health'/);assert.match(proxy,/status:503/);assert.match(proxy,/Retry-After/);assert.match(proxy,/remove <code>MAINTENANCE_UNTIL<\/code>/);});
 await t('health route exists, runs no query of its own (only the import-fence lock probe when an apply is configured) and reports the maintenance state',()=>{const h=fs.readFileSync('app/api/health/route.ts','utf8');assert.match(h,/maintenanceState/);assert.match(h,/importInFlight/);assert.ok(!/SELECT|INSERT|UPDATE|session/i.test(h.replace(/\/\/.*$/gm,'')));});
 await t('every outbound integration choke point calls assertNotMaintenance (email, object storage, address provider, AI, ABN lookup)',()=>{for(const [f,w] of [['email.ts','email'],['storage.ts','object storage'],['location-provider.ts','the address provider'],['ai.ts','the AI provider'],['abn.ts','the ABN lookup']])assert.ok(fs.readFileSync('lib/platform/'+f,'utf8').includes(`assertNotMaintenance('${w}')`),f);});
 await t('maintenance.ts stays free of Node-only imports (it is reachable from browser bundles)',()=>{assert.ok(!/from 'node:/.test(fs.readFileSync('lib/platform/maintenance.ts','utf8')));});
 await t('the application has no background writer: no timers other than per-request timeouts, no scheduler, no instrumentation hook',()=>{
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'?[]:walk(d+'/'+e.name)):/\.(ts|tsx|mjs|js)$/.test(e.name)?[d+'/'+e.name]:[]);
  const files=[...walk('app'),...walk('lib')].filter(f=>!/^\s*['"]use client['"]/m.test(fs.readFileSync(f,'utf8')));   // server code; browser code (e.g. the offline queue) can only reach the app through requests, which the gate refuses
  const bad=files.filter(f=>/setInterval\(|node-cron|\bcron\b|schedule\(|queueMicrotask\(/.test(fs.readFileSync(f,'utf8').replace(/\/\/.*$/gm,'')));
  assert.deepEqual(bad,[],bad.join());
  assert.ok(!fs.existsSync('instrumentation.ts')&&!fs.existsSync('src/instrumentation.ts'));
  const timeouts=files.filter(f=>/setTimeout\(/.test(fs.readFileSync(f,'utf8')));
  for(const f of timeouts)assert.ok(/AbortController|AbortSignal|timed out|requestAnimationFrame|useEffect|window\./.test(fs.readFileSync(f,'utf8')),'unexpected timer in '+f);});
 console.log(`\n${n} passed, 0 failed`);
})().catch(e=>{console.error(e);process.exit(1);});
