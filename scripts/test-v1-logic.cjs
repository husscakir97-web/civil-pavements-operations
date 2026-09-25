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
assert.throws(()=>fin.claimLine(1000,400,601),/exceeds the remaining/);assert.throws(()=>fin.claimLine(1000,100,-200),/negative adjustment/);
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
console.log('PASS V1 logic: lifecycle guards, capability matrix, ABN checksum, forecast/claim/GST arithmetic, risk ratings, register identifiers, estimate items, docket cost lines, legacy stage mapping');
