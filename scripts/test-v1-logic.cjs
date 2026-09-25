// Fast deterministic tests for V1 platform logic (no database, no network):
// lifecycle state machines, capability matrix, ABN checksum, financial
// arithmetic, risk ratings, estimate items, docket cost lines and stage mapping.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('@/')?load(n.slice(2)+'.ts'):n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const wf=load('lib/platform/workflow.ts'),perm=load('lib/platform/permissions.ts'),abn=load('lib/platform/abn.ts'),fin=load('lib/platform/finance.ts'),reg=load('lib/v1/registers.ts'),calc=load('lib/estimate-calculations.ts');

// Lifecycles: valid edges pass, skipped/critical edges fail, capability enforced.
assert.equal(wf.assertTransition('estimate','draft','review','office').to,'review');
assert.throws(()=>wf.assertTransition('estimate','draft','approved','admin'),/Cannot move/,'estimate cannot skip review');
assert.throws(()=>wf.assertTransition('estimate','review','approved','field'),/not authorised/);
assert.throws(()=>wf.assertTransition('tender','approval','submitted','admin'),/dedicated action/,'submission must use submission checks');
assert.equal(wf.assertTransition('tender','approval','submitted','admin',{system:true}).to,'submitted');
assert.throws(()=>wf.assertTransition('tender','draft','awarded','admin',{system:true}),/Cannot move/);
assert.throws(()=>wf.assertTransition('project','setup','active','admin'),/Cannot move/,'project must be ready before active');
assert.throws(()=>wf.assertTransition('claim','draft','submitted','admin'),/Cannot move/,'claim needs internal approval');
assert.throws(()=>wf.assertTransition('claim','internal_approval','submitted','field'),/not authorised/);
assert.throws(()=>wf.assertTransition('docket','review','approved','field'),/not authorised/,'field cannot approve dockets');
assert.equal(wf.assertTransition('docket','draft','review','field').to,'review','field may submit dockets');
assert.throws(()=>wf.assertTransition('swms','draft','approved','admin'),/Cannot move/);
assert.throws(()=>wf.assertTransition('swms','review','approved','field'),/not authorised/,'AI/field never approve SWMS');
assert.throws(()=>wf.assertTransition('variation','approved','draft','admin'),/Cannot move/,'approved variation is final');
assert.throws(()=>wf.assertTransition('requirement','suggested','complete','admin'),/Cannot move/,'suggested requirement must be confirmed first');
assert.deepEqual(wf.allowedTransitions('opportunity','bidding','admin').map(t=>t.to),['lost'],'conversion is not a UI transition');
for(const [k,m] of Object.entries(wf.MACHINES)){assert(m.states[m.initial],k+' initial');for(const [from,edges] of Object.entries(m.transitions)){assert(m.states[from],k+' '+from);for(const e of edges)assert(m.states[e.to],`${k} ${from}->${e.to}`);}}

// Capabilities: field users never hold commercial, rates, approval or admin capabilities.
for(const c of ['commercial.view','rates.edit','estimate.approve','tender.approve','claim.approve','docket.approve','team.admin','invoice.manage','pipeline.view'])assert.equal(perm.can('field',c),false,'field must not have '+c);
for(const c of ['rates.edit','team.admin','entitlements.manage','org.admin'])assert.equal(perm.can('office',c),false,'office must not have '+c);
assert(perm.CAPABILITIES.every(c=>perm.can('admin',c)));
assert.equal(perm.can('read_only','commercial.view'),false);assert.equal(perm.can(undefined,'project.view'),false);assert.equal(perm.can('hacker','project.view'),false);
// Role model: nine assignable roles, route gate (roleAllows) and capability matrix per role.
assert.deepEqual([...perm.ROLES].sort(),['accounts','admin','estimator','field','office','project_manager','read_only','scheduler','supervisor']);
for(const r of perm.ROLES){assert(perm.ROLE_LABELS[r]&&perm.ROLE_DESCRIPTIONS[r],'label and description for '+r);assert(perm.roleAllows(r,'field-read'));}
assert.equal(perm.roleAllows('hacker','field-read'),false);
const gate=(r,p,m)=>perm.roleAllows(r,p,m);
const matrix={
 admin:{yes:[['admin'],['approve','estimating'],['write','commercial'],['read','dockets']],no:[]},
 office:{yes:[['approve','estimating'],['write','commercial'],['write','operations']],no:[['admin']]},
 estimator:{yes:[['read','pipeline'],['write','pipeline'],['write','estimating'],['read','commercial'],['write','commercial']],no:[['approve','estimating'],['write','operations'],['write','dockets'],['admin']]},
 scheduler:{yes:[['read','operations'],['write','operations'],['read','projects']],no:[['read','commercial'],['read','dockets'],['read','pipeline'],['write','projects'],['admin']]},
 project_manager:{yes:[['write','projects'],['write','ims'],['write','operations'],['read','dockets'],['write','dockets'],['write','commercial'],['read','commercial']],no:[['approve','estimating'],['approve','commercial'],['write','pipeline'],['admin']]},
 supervisor:{yes:[['field'],['read','projects'],['read','operations'],['write','ims']],no:[['read','commercial'],['read','dockets'],['write','operations'],['read','pipeline']]},
 field:{yes:[['field'],['field-read']],no:[['read','projects'],['read','commercial'],['write','ims']]},
 accounts:{yes:[['read','commercial'],['write','commercial'],['approve','commercial'],['read','dockets'],['read','projects']],no:[['write','projects'],['read','pipeline'],['write','operations'],['admin']]},
 read_only:{yes:[['read','projects'],['read','pipeline'],['read','operations'],['read','ims'],['read','reports']],no:[['read','commercial'],['read','dockets'],['write','projects'],['field'],['write','ims'],['admin']]},
};
for(const [r,{yes,no}] of Object.entries(matrix)){for(const [p,m] of yes)assert(gate(r,p,m),`${r} should pass ${p}/${m||'core'}`);for(const [p,m] of no)assert(!gate(r,p,m),`${r} must not pass ${p}/${m||'core'}`);}
for(const r of ['scheduler','supervisor','field','read_only'])assert.equal(perm.can(r,'commercial.view'),false,r+' never sees money');
assert.equal(perm.can('estimator','estimate.approve'),false);assert.equal(perm.can('project_manager','claim.approve'),false);assert.equal(perm.can('accounts','claim.approve'),true);
// Admin navigation is capability-driven: no role sees administration it cannot use.
const navDef=load('lib/v1/navigation.ts');
assert.deepEqual(navDef.adminSubsFor('admin'),['Company','People','Plant','Rates','Company Library','Team & Permissions','Integrations','Settings']);
assert.deepEqual(navDef.adminSubsFor('estimator'),['Rates','Company Library'],'estimator: rates (read) and library, no organisation/security/entitlements');
assert.deepEqual(navDef.adminSubsFor('scheduler'),['People','Plant'],'operations: people and plant only');
assert.deepEqual(navDef.adminSubsFor('project_manager'),['People','Plant']);
assert.deepEqual(navDef.adminSubsFor('accounts'),[],'accounts: no admin area');
assert.deepEqual(navDef.adminSubsFor('read_only'),[],'read-only: no admin area');
assert.deepEqual(navDef.adminSubsFor('field'),[]);assert.deepEqual(navDef.adminSubsFor('supervisor'),[]);
assert(!navDef.adminSubsFor('office').some(k=>['Team & Permissions','Integrations','Settings','Company'].includes(k)),'office has no organisation administration');
assert.deepEqual(navDef.FIELD_SHELL_ROLES,['field','supervisor']);
for(const r of navDef.FIELD_SHELL_ROLES)assert.equal(perm.can(r,'commercial.view'),false,r+' shell never carries money');
assert.equal(perm.can('read_only','project.edit'),false);assert(perm.capabilitiesFor('read_only').every(c=>c.endsWith('.view')),'read-only holds view capabilities only');

// ABN checksum (ATO algorithm) — format only, no fake registry lookups.
assert.equal(abn.isValidAbn('51 824 753 556'),true);assert.equal(abn.isValidAbn('51824753557'),false);assert.equal(abn.isValidAbn('1234'),false);assert.equal(abn.formatAbn('51824753556'),'51 824 753 556');

// Finance: forecast, earned value, claim limits, GST.
let f=fin.forecast({originalContract:100000,approvedVariations:10000,pendingVariations:5000,originalBudget:80000,approvedVariationCost:6000,actual:30000,committed:10000,accrued:5000,claimed:40000,certified:38000,invoiced:38000,paid:20000});
assert.equal(f.currentContract,110000);assert.equal(f.currentBudget,86000);assert.equal(f.costToComplete,41000);assert.equal(f.forecastFinalCost,86000);assert.equal(f.forecastProfit,24000);assert.equal(f.forecastMarginPct,21.82);assert.equal(f.outstanding,18000);
f=fin.forecast({originalContract:100000,approvedVariations:0,pendingVariations:0,originalBudget:80000,approvedVariationCost:0,actual:90000,committed:5000,accrued:0,claimed:0,certified:0,invoiced:0,paid:0});
assert.equal(f.costToComplete,0,'overspend: no negative cost to complete');assert.equal(f.forecastFinalCost,95000);assert.equal(f.forecastProfit,5000);
f=fin.forecast({originalContract:0,approvedVariations:0,pendingVariations:0,originalBudget:0,approvedVariationCost:0,actual:0,committed:0,accrued:0,claimed:0,certified:0,invoiced:0,paid:0});
assert.equal(f.forecastMarginPct,null,'no contract → margin not available (not 0%)');
assert.deepEqual(fin.claimLine(1000,400,600),{contractValue:1000,previousClaimed:400,thisClaim:600,claimedToDate:1000,remaining:0});
assert.throws(()=>fin.claimLine(1000,400,601),/exceeds the remaining/);
// Retention (ex GST): % of gross, cumulative cap, release bounded by held, negative adjustments withhold nothing.
const T={enabled:true,pct:5,cap:null};
assert.deepEqual(fin.retention({enabled:false,pct:5,cap:null},1000,0),{gross:1000,withheld:0,released:0,net:1000,heldAfter:0});
assert.deepEqual(fin.retention(T,1000,0),{gross:1000,withheld:50,released:0,net:950,heldAfter:50});
assert.deepEqual(fin.retention({...T,cap:70},1000,40),{gross:1000,withheld:30,released:0,net:970,heldAfter:70});
assert.deepEqual(fin.retention({...T,cap:70},1000,70),{gross:1000,withheld:0,released:0,net:1000,heldAfter:70},'cap reached');
assert.deepEqual(fin.retention(T,0,50,50),{gross:0,withheld:0,released:50,net:50,heldAfter:0},'release-only');
assert.deepEqual(fin.retention(T,-200,50),{gross:-200,withheld:0,released:0,net:-200,heldAfter:50});
assert.throws(()=>fin.retention(T,100,40,40.01),/exceeds retention held/);assert.throws(()=>fin.retention(T,100,40,-1),/negative/);
assert.equal(fin.retention(T,333.33,0).withheld,16.67,'rounded to cents');
assert.deepEqual(fin.retentionHeld([{status:'certified',retentionWithheld:50,certifiedRetention:40,retentionReleased:0},{status:'submitted',retentionWithheld:30,certifiedRetention:null,retentionReleased:20}]),{withheld:70,released:20,held:50},'certified retention supersedes claimed');
assert.deepEqual(fin.retentionHeld([{status:'invoiced',retentionWithheld:50,certifiedRetention:40,retentionReleased:0},{status:'draft',retentionWithheld:30,certifiedRetention:null,retentionReleased:20},{status:'internal_approval',retentionWithheld:10,certifiedRetention:null,retentionReleased:0}]),{withheld:40,released:0,held:40},'drafts and claims awaiting internal approval hold no retention');
assert.deepEqual([...fin.RETENTION_HELD_STATES],['submitted','certified','invoiced','paid']);assert.throws(()=>fin.claimLine(1000,100,-200),/negative adjustment/);
assert.deepEqual(fin.gst(19800),{amountExGst:19800,gst:1980,total:21780});
assert.equal(fin.readinessPercent([{mandatory:true,ok:true},{mandatory:true,ok:false},{mandatory:false,ok:false}]),50);assert.equal(fin.readinessPercent([]),null);

// Risk rating (5×5, organisation thresholds).
assert.equal(reg.riskRating(4,5),'Extreme');assert.equal(reg.riskRating(2,4),'Medium');assert.equal(reg.riskRating(2,5),'High');assert.equal(reg.riskRating(1,1),'Low');assert.equal(reg.riskRating(6,1),null);assert.equal(reg.riskRating(3,3,{low:9,medium:12,high:20}),'Low');
// Every register column name is a safe identifier (they are interpolated into SQL).
for(const d of Object.values(reg.REGISTERS)){assert(/^[a-z_]+$/.test(d.table));for(const fd of d.fields)assert(/^[a-z_]+$/.test(fd.key),d.key+'.'+fd.key);}

// Estimate engine: discipline-neutral items and legacy paving compatibility.
const general={...calc.makeGeneralEstimate(),clientName:'C',projectName:'P',items:[{id:'1',section:'S',costCode:'100',category:'labour',description:'Crew',quantity:120,unit:'m',productivity:10,rateBasis:'hour',rate:95},{id:'2',section:'S',costCode:'300',category:'material',description:'Pipe',quantity:120,unit:'m',productivity:0,rateBasis:'unit',rate:180}],marginValue:0,overheadsPct:0,contingencyPct:0};
let t=calc.calculateEstimate(general);assert.equal(t.directCost,1140+21600);assert.equal(t.materialCost,0,'paving material excluded');assert.deepEqual(calc.validateEstimate(general,t).errors,[]);
const b=calc.costBreakdown(t);assert.equal(b.labour,1140);assert.equal(b.material,21600);
const bad={...general,items:[{...general.items[0],productivity:0}]};assert(calc.validateEstimate(bad,calc.calculateEstimate(bad)).errors.some(e=>/productivity/.test(e)));
const legacy=calc.normaliseEstimateData({clientName:'A',projectName:'B'});assert.equal(legacy.includePaving,true,'legacy estimates keep the paving engine');assert(calc.calculateEstimate(legacy).materialCost>0);

// Docket → cost lines: itemised lines, total fallback, adjustment to the approved amount.
const seam=load('lib/seams/docket-to-cost.ts');
let lines=seam.docketCostLines({docket_no:'D1',amount:1300,quantity:0,quantity_unit:'',line_items:JSON.stringify([{description:'Paver operator',quantity:8,rate:100},{description:'AC14 asphalt',quantity:2,rate:200,amount:400}]),notes:''});
assert.deepEqual(lines.map(l=>[l.line,l.category,l.amount]),[['L1','labour',800],['L2','material',400],['ADJ','other',100]]);
lines=seam.docketCostLines({docket_no:'D2',amount:500,quantity:3,quantity_unit:'t',line_items:'[]',notes:'Tipper hire'});assert.deepEqual(lines.map(l=>[l.line,l.category,l.amount]),[['TOTAL','plant',500]]);
assert.equal(seam.docketCostLines({docket_no:'D3',amount:0,line_items:'[]',notes:''}).length,0,'zero dockets post nothing');

// Stage mapping for legacy free-text statuses.
const rs=load('lib/v1/register-server.ts');assert.equal(rs.legacyOpportunityStage('Tendering'),'bidding');assert.equal(rs.legacyOpportunityStage('Won'),'won');assert.equal(rs.legacyOpportunityStage('Qualifying'),'qualified');
// Conflict engine (pure).
const cf=load('lib/modules/operations/conflicts.ts'),rm=load('lib/v1/resource-mapping.ts');
const res=new Map([['worker:w1',{id:'w1',type:'worker',name:'Alex',status:'Active',active:true,competencies:[{type:'White card',expiryDate:'2030-01-01',status:'current'},{type:'First aid',expiryDate:'2020-01-01',status:'current'}]}],['plant:p1',{id:'p1',type:'plant',name:'Paver',status:'Available',active:true,complianceExpiry:'2026-01-01'}]]);
const sh=(o={})=>({id:'s1',name:'Night',status:'Planned',date:'2026-03-01',start:'20:00',finish:'04:00',assignments:[{resourceType:'worker',resourceId:'w1'}],requiredCompetencies:[],...o});
const codes=c=>c.map(x=>`${x.code}:${x.severity}`).sort();
assert.deepEqual(codes(cf.evaluateShift(sh(),res,[])),['COMPETENCY_EXPIRED_OTHER:warn']);
assert.deepEqual(codes(cf.evaluateShift(sh({requiredCompetencies:['white card','Paver ticket']}),res,[])),['COMPETENCY_EXPIRED_OTHER:warn','COMPETENCY_MISSING:block']);
assert.deepEqual(codes(cf.evaluateShift(sh({requiredCompetencies:['First aid']}),res,[])),['COMPETENCY_EXPIRED:block']);
const other={id:'s2',name:'Early',status:'Planned',date:'2026-03-02',start:'03:00',finish:'06:00',assignments:[{resourceType:'worker',resourceId:'w1'}]};
assert(codes(cf.evaluateShift(sh(),res,[other])).includes('WORKER_DOUBLE_BOOKED:block'),'overnight overlap');
assert(codes(cf.evaluateShift(sh(),res,[{...other,status:'Draft'}])).includes('WORKER_DOUBLE_BOOKED:warn'),'draft bookings are tentative');
assert(!codes(cf.evaluateShift(sh(),res,[{...other,start:'04:00'}])).some(c=>c.startsWith('WORKER_DOUBLE')),'back-to-back is not an overlap');
assert(!codes(cf.evaluateShift(sh(),res,[{...other,status:'Cancelled'}])).some(c=>c.startsWith('WORKER_DOUBLE')));
assert.deepEqual(codes(cf.evaluateShift(sh({assignments:[{resourceType:'plant',resourceId:'p1'}]}),res,[])),['PLANT_COMPLIANCE_EXPIRED:block']);
assert.deepEqual(codes(cf.evaluateShift(sh({assignments:[{resourceType:'worker',resourceId:'gone'}]}),res,[])),['RESOURCE_MISSING:block']);
const inactive=new Map([['worker:w1',{...res.get('worker:w1'),active:false,competencies:[]}]]);
assert.deepEqual(codes(cf.evaluateShift(sh(),inactive,[])),['RESOURCE_INACTIVE:block']);
assert.deepEqual(cf.evaluateShift(sh({status:'Cancelled',assignments:[{resourceType:'worker',resourceId:'gone'}]}),res,[]),[]);
assert.equal(cf.blocking('Draft',[{code:'X',severity:'block',message:''}]).length,0,'drafts are never blocked');
assert.equal(cf.blocking('Planned',[{code:'X',severity:'block',message:''},{code:'Y',severity:'warn',message:''}]).length,1);
// Legacy mapping (pure, deterministic).
assert.deepEqual(rm.splitCompetencies('White card; white card, First aid\nEWP'),['White card','First aid','EWP']);
const mw=rm.mapWorker({id:'w',name:'Sam Lee',status:'Active',metadata:{rate:'x',competencyExpiry:'2026-02-30'}});
assert.equal(mw.columns.hourly_rate,null);assert.deepEqual(mw.issues.map(i=>i.field).sort(),['competencyExpiry','rate'],'invalid calendar date and rate are flagged');
assert.deepEqual(rm.mapWorker({id:'w',name:'Sam',status:'Active',metadata:{competencies:'White card'}}),rm.mapWorker({id:'w',name:'Sam',status:'Active',metadata:JSON.stringify({competencies:'White card'})}),'string and object metadata map identically');
// Offline queue semantics (pure): nothing dropped silently; retries idempotent; conflicts kept for the user.
(async()=>{
 const oq=load('lib/v1/offline-sync.ts');
 const mem=()=>{const m=new Map();return {m,list:async()=>[...m.values()].map(x=>structuredClone(x)),put:async i=>{m.set(i.id,structuredClone(i));},remove:async id=>{m.delete(id);}};};
 const st=mem(),t0=new Date('2026-03-01T00:00:00Z');
 const a=oq.newItem({id:'aaaaaaaaaaaaaaaa-1',userId:'u1',kind:'docket',label:'A',url:'/x',body:{n:1}},t0);
 assert.equal(a.body.clientRequestId,'aaaaaaaaaaaaaaaa-1','request id travels in the body');
 await st.put(a);await st.put(oq.newItem({id:'bbbbbbbbbbbbbbbb-2',userId:'u1',kind:'docket',label:'B',url:'/x',body:{}},new Date('2026-03-01T00:00:01Z')));
 await st.put(oq.newItem({id:'cccccccccccccccc-3',userId:'u2',kind:'docket',label:'other user',url:'/x',body:{}},t0));
 const sent=[];
 let out=await oq.syncQueue(st,async i=>{sent.push(i.id);return {ok:false,status:0,error:'offline'};},'u1',{now:t0});
 assert.deepEqual(sent,['aaaaaaaaaaaaaaaa-1'],'stops after a connectivity failure; other users\' items are never sent');
 assert.equal(st.m.size,3,'nothing dropped');assert.equal(st.m.get('aaaaaaaaaaaaaaaa-1').status,'failed');
 out=await oq.syncQueue(st,async()=>({ok:true,status:201,body:{}}),'u1',{now:t0});
 assert.deepEqual(out.map(o=>o.id),['bbbbbbbbbbbbbbbb-2'],'backoff defers the failed item; the next due item is sent');
 await st.put(oq.newItem({id:'eeeeeeeeeeeeeeee-5',userId:'u1',kind:'docket',label:'E',url:'/x',body:{}},new Date('2026-03-01T00:00:02Z')));
 await oq.syncQueue(st,async()=>({ok:false,status:0,error:'offline'}),'u1',{now:t0,only:'eeeeeeeeeeeeeeee-5'});
 out=await oq.syncQueue(st,async i=>({ok:true,status:201,body:{id:i.id}}),'u1',{now:t0,reconnected:true,only:'eeeeeeeeeeeeeeee-5'});
 assert.deepEqual(out.map(o=>o.result),['done'],'reconnecting retries immediately, ignoring backoff');
 out=await oq.syncQueue(st,async i=>i.id.startsWith('a')?{ok:false,status:409,body:{error:'Shift cancelled',code:'SHIFT_CANCELLED'}}:{ok:true,status:201,body:{}},'u1',{now:new Date(t0.getTime()+60_000)});
 const kept=st.m.get('aaaaaaaaaaaaaaaa-1');assert.equal(kept.status,'conflict');assert.equal(kept.code,'SHIFT_CANCELLED');assert.equal(kept.lastError,'Shift cancelled');
 out=await oq.syncQueue(st,async()=>{throw new Error('should not auto-retry a conflict');},'u1',{now:new Date(t0.getTime()+3600_000)});
 assert.equal(out.length,0,'conflicts wait for the user');
 out=await oq.syncQueue(st,async()=>({ok:false,status:503,body:{}}),'u1',{force:true,only:'aaaaaaaaaaaaaaaa-1'});
 assert.equal(st.m.get('aaaaaaaaaaaaaaaa-1').status,'failed','manual retry re-attempts; 5xx is retryable');
 out=await oq.syncQueue(st,async()=>({ok:true,status:200,body:{replay:true}}),'u1',{force:true});
 assert.equal(st.m.has('aaaaaaaaaaaaaaaa-1'),false,'removed only after the server accepted (a replay counts)');assert.equal(st.m.size,1);
 await st.put({...oq.newItem({id:'dddddddddddddddd-4',userId:'u1',kind:'incident',label:'D',url:'/x',body:{}}),status:'syncing'});
 await oq.recoverInterrupted(st);assert.equal(st.m.get('dddddddddddddddd-4').status,'failed','interrupted sends are retried');
 assert.equal(oq.backoff(1),2000);assert.equal(oq.backoff(20),oq.MAX_BACKOFF_MS);
 for(const [status,expected] of [[0,'retry'],[408,'retry'],[429,'retry'],[500,'retry'],[400,'conflict'],[403,'conflict'],[409,'conflict'],[422,'conflict']])assert.equal(oq.classify({ok:false,status,body:{}}),expected);
 console.log('PASS offline queue: per-user, ordered, backoff, conflicts retained, manual retry/discard, idempotent replay, interrupted recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
// External adapters (pure parts): ABR parsing/adapter, AI installation gates, billing signatures.
(async()=>{
 const abnLib=load('lib/platform/abn.ts');
 const found='callback({"Abn":"51824753556","AbnStatus":"Active","EntityName":"ALPHA CIVIL PTY LTD","EntityTypeName":"Australian Private Company","Gst":"2001-07-01","BusinessName":["Alpha Civil"],"AddressState":"NSW","AddressPostcode":"2000","Message":""})';
 const r=abnLib.parseAbrResponse(found,'51824753556',new Date('2026-01-01T00:00:00Z'));
 assert.equal(r.status,'found');assert.deepEqual([r.record.entityName,r.record.abnStatus,r.record.gstRegisteredFrom,r.record.source],['ALPHA CIVIL PTY LTD','Active','2001-07-01','ABR']);
 assert.equal(abnLib.parseAbrResponse('callback({"Abn":"","Message":"Search text is not a valid ABN or ACN"})','51824753556').status,'not-found');
 assert.equal(abnLib.parseAbrResponse('callback({"Message":"The GUID entered is not recognised as a Registered Party"})','51824753556').status,'error');
 assert.equal(abnLib.parseAbrResponse('<html>','51824753556').status,'error');
 assert.equal(abnLib.parseAbrResponse(found,'53004085616').status,'not-found','a record for a different ABN is never accepted');
 assert.equal((await abnLib.abrAdapter({}).lookup('51824753556')).status,'not-configured','no GUID → not configured, never a fake result');
 assert.equal((await abnLib.abrAdapter({ABR_GUID:'g'}).lookup('12345678901')).status,'invalid');
 let seen='';assert.equal((await abnLib.abrAdapter({ABR_GUID:'g u',ABR_BASE_URL:'https://abr.test/json'},async u=>{seen=u;return new Response(found);}).lookup('51 824 753 556')).status,'found');
 assert.equal(seen,'https://abr.test/json/AbnDetails.aspx?abn=51824753556&callback=callback&guid=g%20u');
 assert.equal((await abnLib.abrAdapter({ABR_GUID:'g'},async()=>new Response('x',{status:500})).lookup('51824753556')).status,'error');
 assert.equal((await abnLib.abrAdapter({ABR_GUID:'g'},async()=>{throw new TypeError('offline');}).lookup('51824753556')).status,'error');
 const ai=load('lib/platform/ai.ts');
 assert.equal(ai.aiEnvReady({OPENAI_API_KEY:'k',AI_API_KEY:'k',AI_PROVIDER:'openai',AI_MODEL:'m'}),false,'a provider key alone never enables AI');
 assert.equal(ai.aiEnvReady({AI_ENABLED:'true'}),false,'the flag alone is not enough');
 assert.equal(ai.aiEnvReady({AI_ENABLED:'true',AI_PROVIDER:'anthropic',AI_API_KEY:'k'}),false,'a model must be named');
 assert.equal(ai.aiEnvReady({AI_ENABLED:'true',AI_PROVIDER:'anthropic',AI_API_KEY:'k',AI_MODEL:'m'}),true);
 assert.equal(ai.aiEnvReady({AI_ENABLED:'yes',AI_PROVIDER:'anthropic',AI_API_KEY:'k',AI_MODEL:'m'}),false);
 assert.deepEqual(ai.jsonFrom('Sure: {"a":1} thanks'),{a:1});assert.throws(()=>ai.jsonFrom('no json'),/did not contain JSON/);
 let request;const prov=ai.providerFromEnv({AI_PROVIDER:'anthropic',AI_API_KEY:'k',AI_MODEL:'m',AI_BASE_URL:'https://ai.test'},async(u,i)=>{request={u,i};return new Response(JSON.stringify({model:'m',content:[{type:'text',text:'{"x":1}'}],usage:{input_tokens:5,output_tokens:7}}));});
 assert.deepEqual(await prov({system:'s',prompt:'p',maxTokens:10}),{text:'{"x":1}',inputTokens:5,outputTokens:7,model:'m'});assert.equal(request.u,'https://ai.test/v1/messages');assert.equal(request.i.headers['x-api-key'],'k');
 const bill=load('lib/platform/billing.ts');
 const raw='{"id":"evt_1"}',now=1_800_000_000,sig=bill.sign('secret',raw,now);
 assert.equal(bill.verifySignature('secret',raw,sig,now),true);
 assert.equal(bill.verifySignature('secret',raw+' ',sig,now),false,'tampered body');
 assert.equal(bill.verifySignature('other',raw,sig,now),false,'wrong secret');
 assert.equal(bill.verifySignature('secret',raw,sig,now+301),false,'replayed outside tolerance');
 assert.equal(bill.verifySignature('secret',raw,null,now),false);assert.equal(bill.verifySignature(undefined,raw,sig,now),false);
 assert.equal(bill.verifySignature('secret',raw,'t=1,v1=zz',now),false);
 const ents=bill.entitlementsFor('active',['pipeline','estimating']);assert.equal(ents.pipeline,'active');assert.equal(ents.commercial,'read_only');assert.equal(ents.core,undefined);
 assert(Object.values(bill.entitlementsFor('cancelled',['pipeline'])).every(v=>v==='read_only'),'cancellation keeps data read-only, never deleted');
 assert.equal(bill.entitlementsFor('past_due',['pipeline']).pipeline,'active','payment failure has a grace period');
 assert.equal(bill.billingConfigured({BILLING_PROVIDER:'x'}),false);assert.equal(bill.isPlatformOperator('Ops@Example.com',{PLATFORM_OPERATOR_EMAILS:'ops@example.com, x@y.z'}),true);assert.equal(bill.isPlatformOperator('a@b.c',{}),false);
 console.log('PASS adapters: ABR parse/adapter (not-configured/invalid/found/not-found/errors), AI gates (key alone never enables), provider call shape, billing signatures/tolerance/entitlement mapping');
})().catch(e=>{console.error(e);process.exitCode=1;});
console.log('PASS V1 logic: lifecycle guards, capability matrix and nine-role route gate, ABN checksum, forecast/claim/GST/retention arithmetic, risk ratings, register identifiers, estimate items, docket cost lines, legacy stage mapping, scheduling conflict engine, legacy resource mapping');
