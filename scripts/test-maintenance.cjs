// Bounded maintenance mode (lib/platform/maintenance.ts + its scripts twin + proxy.ts): pure rules, twin equivalence, and static proof that the gate
// and every outbound integration choke point are wired. The end-to-end proof (a running app refusing real requests while an import runs, with
// capture servers seeing no email/storage traffic) is in test-existing-tenant-path.mjs.
const ts=require('typescript'),fs=require('node:fs'),assert=require('node:assert/strict');
const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync('lib/platform/maintenance.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,require,m);const T=m.exports;
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
 const proxy=fs.readFileSync('proxy.ts','utf8');
 await t('proxy: gates every path, exempts only GET /api/health, answers 503 with Retry-After and a recovery instruction',()=>{assert.match(proxy,/matcher:'\/:path\*'/);assert.equal((proxy.match(/pathname===/g)||[]).length,1);assert.match(proxy,/'\/api\/health'/);assert.match(proxy,/status:503/);assert.match(proxy,/Retry-After/);assert.match(proxy,/remove <code>MAINTENANCE_UNTIL<\/code>/);});
 await t('health route exists, touches no database and reports the maintenance state',()=>{const h=fs.readFileSync('app/api/health/route.ts','utf8');assert.match(h,/maintenanceState/);assert.ok(!/sql|database|getPool|session/i.test(h.replace(/\/\/.*$/gm,'')));});
 await t('every outbound integration choke point calls assertNotMaintenance (email, object storage, address provider, AI, ABN lookup)',()=>{for(const [f,w] of [['email.ts','email'],['storage.ts','object storage'],['location-provider.ts','the address provider'],['ai.ts','the AI provider'],['abn.ts','the ABN lookup']])assert.ok(fs.readFileSync('lib/platform/'+f,'utf8').includes(`assertNotMaintenance('${w}')`),f);});
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
