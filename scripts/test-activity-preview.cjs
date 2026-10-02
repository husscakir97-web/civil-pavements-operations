const ts=require('typescript'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const cache={};function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n),m,m.exports);return m.exports;}
const {activityPreview,previewNumber}=load('lib/seams/activity-preview.ts');
const {mergeJob}=load('lib/planning.ts');const {projectProgram}=load('lib/v1/program.ts');
const input=Object.freeze({quantity:100,unit:'m2',productionPerDay:40,productiveHoursPerDay:8,rate:120,rateBasis:'hour'});
assert.deepEqual(activityPreview(input),{workingDays:2.5,productiveHours:20,directCost:2400,missing:[],minimumCalendarDays:3});
assert.equal(activityPreview({...input,quantity:200}).directCost,4800);
assert.equal(activityPreview({...input,productionPerDay:80}).directCost,1200);
assert.equal(activityPreview(input).directCost,2400);
assert.equal(activityPreview({...input,rateBasis:'unit',rate:3}).directCost,300);
for(const v of ['',null,undefined,'NaN',Infinity,-1])assert.equal(previewNumber(v),null);
assert.equal(previewNumber('0'),0);
assert.equal(activityPreview({...input,quantity:null}).directCost,null);
assert.equal(activityPreview({...input,quantity:0}).directCost,0);
assert.equal(activityPreview({...input,rate:0}).directCost,0);
assert.equal(activityPreview({...input,rate:null}).directCost,null);
for(const productionPerDay of [0,null,-1]){const p=activityPreview({...input,productionPerDay});assert.equal(p.productiveHours,null);assert.equal(p.workingDays,null);assert.equal(p.directCost,null);}
for(const productiveHoursPerDay of [0,null,25])assert.equal(activityPreview({...input,productiveHoursPerDay}).productiveHours,null);
assert.equal(activityPreview({...input,unit:''}).directCost,null);
assert.equal(activityPreview({...input,productiveHoursPerDay:null,rateBasis:'unit'}).directCost,12000);
const baseline={approvedBudget:{directCost:123},estimateSnapshot:{quantity:5},sourceEstimateId:'estimate',sourceRevisionId:'r1',awardedAt:'2026-01-01'};
const before=JSON.stringify(baseline);activityPreview(input);assert.deepEqual(mergeJob(baseline,{approvedBudget:{directCost:999},estimateSnapshot:{quantity:999}}),baseline);assert.equal(JSON.stringify(baseline),before);
// Date-only calendar arithmetic across both Sydney DST boundaries. No claim about elapsed shift hours.
for(const [start,finish] of [['2026-10-03','2026-10-05'],['2026-04-04','2026-04-06']])assert.equal(projectProgram([{id:'a',name:'Synthetic',start_date:start,duration_days:3,predecessor_id:null,status:'planned'}])[0].finish,finish);
console.log('PASS connected preview: repeated edits, unknown/zero, unit/hour basis, baseline preservation, date-only DST boundaries');
