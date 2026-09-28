// Real access and event policy, with a recording database double for transaction composition.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let rows=[],reads=0;const statements=[];
const db={prepare(sql){let args=[];const s={bind(...v){args=v;return s;},async all(){reads++;return {results:rows};},sql,get values(){return args;}};statements.push(s);return s;}};
const cache={};
function load(file){file=path.resolve(file);if(file.endsWith(path.join('platform','database.ts')))return {database:db};if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const mod=load('lib/platform/modules.ts'),perm=load('lib/platform/permissions.ts'),nav=load('lib/v1/workspaces.ts'),ctx=load('lib/platform/context.ts'),ent=load('lib/platform/entitlements.ts'),ev=load('lib/platform/domain-events.ts');
const only=(...keys)=>Object.fromEntries(mod.MODULES.map(m=>[m,m==='core'||keys.includes(m)?'active':'disabled']));
const access=(e,role='admin')=>({module:m=>mod.usable(e,m),can:c=>perm.can(role,c)});
assert.equal(mod.usable({},'operations'),false);assert.equal(mod.usable(undefined,'operations'),false);assert.equal(mod.usable(mod.FULL_ACCESS,'unknown'),false);assert.equal(mod.usable({ims:'unexpected'},'ims'),false);
assert.equal(mod.usable({ims:'read_only'},'ims'),true);assert.equal(mod.writable({ims:'read_only'},'ims'),false);
assert.deepEqual(nav.enginesFor(access(only('operations'))).map(e=>e.key),['Resource Work']);
assert.deepEqual(nav.enginesFor(access(only('ims'))).map(e=>e.key),['Prepare Work']);
assert.deepEqual(nav.enginesFor(access(only())).map(e=>e.key),[]);
assert.equal(nav.enginesFor(access(mod.FULL_ACCESS)).length,6);
assert(!nav.enginesFor(access(mod.FULL_ACCESS,'scheduler')).some(e=>e.key==='Control Money'||e.key==='Win Work'));
const before=only('operations'),after={...before,ims:'active'};
assert.equal(nav.enginesFor(access(after)).length,2);assert.equal(before.ims,'disabled');
assert(!nav.workspacesFor('Prepare Work',access(only('ims'))).some(w=>w.module==='projects'));
for(const key of mod.MODULES){const c=mod.MODULE_REGISTRY[key];assert.equal(c.key,key);assert.equal(c.entitlement,key);assert(c.workspace);for(const seam of c.optionalSeams)assert(mod.MODULE_SEAMS[seam]);}
assert(!mod.MODULES.includes('workshop'),'unbuilt products must not receive a trial grant');
for(const [key,event] of Object.entries(ev.DOMAIN_EVENTS))assert(mod.MODULE_REGISTRY[event.module].publishedEvents.includes(key));
(async()=>{
 await assert.rejects(()=>ev.domainEventStatement('project.awarded','p1','r1'),/Sign in/);
 const actor={organisationId:'org-a',userId:'admin-a',email:'a@example.invalid',role:'admin',entitlements:mod.FULL_ACCESS};
 await ctx.actorContext.run(actor,async()=>{
  const n=reads;await assert.rejects(()=>ent.getEntitlements('org-b'),/Not found/);assert.equal(reads,n,'tenant mismatch fails before database access');
  await assert.rejects(()=>ent.setEntitlement('org-b','ims','active'),/Not found/);
  assert(await ent.requireSeam('award.project'));
  const event=await ev.domainEventStatement('project.awarded','p1','revision-1');
  assert.deepEqual(event.values.slice(1,9),['org-a','project.awarded',1,'projects','project','p1','revision-1','admin-a']);
  assert(event.sql.includes('ON DUPLICATE KEY UPDATE id=id'));
 });
 for(const status of ['disabled','read_only'])await ctx.actorContext.run({...actor,entitlements:{...mod.FULL_ACCESS,projects:status}},async()=>{
  assert.equal(await ent.requireSeam('award.project'),false);
  await assert.rejects(()=>ev.domainEventStatement('project.awarded','p1','r1'));
 });
 await ctx.actorContext.run({...actor,role:'scheduler'},async()=>{
  await assert.rejects(()=>ent.requireSeam('docket.cost'),/not authorised/);
  await assert.rejects(()=>ev.domainEventStatement('docket.approved','d1','o1'),/not authorised/);
  await assert.rejects(()=>ent.setEntitlement('org-a','ims','active'),/not authorised/);
 });
 rows=[{module:'operations',status:'active',valid_until:'2000-01-01T00:00:00.000Z'}];
 await ctx.actorContext.run({...actor,entitlements:undefined},async()=>{const e=await ent.getEntitlements('org-a');assert.equal(e.operations,'read_only');assert.equal(e.ims,'disabled');assert.equal(e.core,'active');});
 console.log('PASS modular registry, standalone navigation, fail-closed access, downgrade retention policy, tenant guards, named seam permissions and atomic event statement composition');
})().catch(e=>{console.error(e);process.exitCode=1;});
