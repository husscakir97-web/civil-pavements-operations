// Planning v0.1 calculation engine: one deterministic implementation, no database, no network.
const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const m={exports:{}};
new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.resolve('lib/v1/planning.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports,require);
const P=m.exports;
let n=0;const ok=name=>{n++;console.log('PASS '+name);};
const act=(id,over={})=>({...P.blankActivity('activity',id,id),...over});
const doc=(activities,dependencies=[],sharedCosts=[])=>({activities,dependencies,sharedCosts});

// Units: conversion within a dimension, rejection across dimensions.
assert.equal(P.unitFactor('km','m'),1000);assert.equal(P.unitFactor('m2','ha'),1/10000);assert.equal(P.unitFactor('m','t'),null);assert.equal(P.unitFactor('widgets','widgets'),1);assert.equal(P.unitFactor('m3','m²'),null);
ok('unit conversion within a dimension; incompatible units rejected');

// Derived duration: 1200 m2 at 100 m2/hour, 8 h/day = 1.5 days. Incompatible productivity unit is a validation error.
const a1=act('act00001',{name:'Milling',durationMode:'derived',quantity:1200,unit:'m2',productivity:100,productivityUnit:'m2',hoursPerDay:8});
assert.equal(P.activityDuration(a1).days,1.5);
assert.equal(P.activityDuration({...a1,unit:'m',productivityUnit:'t'}).days,null);
assert.ok(P.validatePlan(doc([{...a1,productivityUnit:'t'}])).some(i=>/incompatible/.test(i.message)));
ok('derived duration and incompatible-unit rejection');

// Missing is unknown (null); a known zero stays zero.
const b1=act('act00002',{name:'Prep',durationMode:'derived',quantity:null,unit:'m2',productivity:50,productivityUnit:'m2',hoursPerDay:8,requirements:[{id:'rq000001',kind:'labour',name:'Crew',quantity:4,rate:60,rateBasis:'hour',resourceRef:null}]});
let r=P.calculatePlan(doc([b1]),{rates:true});
assert.equal(r.activities['act00002'].durationDays,null);assert.equal(r.activities['act00002'].finish,null);assert.equal(r.activities['act00002'].cost.total,null);assert.equal(r.cost.total,null);assert.equal(r.duration.complete,false);assert.equal(r.duration.days,null);
const free=act('act00003',{durationDays:2,hoursPerDay:8,requirements:[{id:'rq000002',kind:'plant',name:'Loan roller',quantity:1,rate:0,rateBasis:'day',resourceRef:null}]});
r=P.calculatePlan(doc([free]),{rates:true});assert.equal(r.activities['act00003'].cost.total,0);assert.equal(r.cost.total,0);
const unknownRate=act('act00004',{durationDays:2,hoursPerDay:8,requirements:[{id:'rq000003',kind:'plant',name:'Roller',quantity:1,rate:null,rateBasis:'day',resourceRef:null},{id:'rq000004',kind:'labour',name:'Crew',quantity:2,rate:50,rateBasis:'day',resourceRef:null}]});
r=P.calculatePlan(doc([unknownRate]),{rates:true});assert.equal(r.activities['act00004'].cost.total,null);assert.equal(r.activities['act00004'].cost.knownSubtotal,200);assert.equal(r.activities['act00004'].cost.unknownCount,1);assert.equal(r.cost.total,null);assert.equal(r.cost.knownTotal,200);
ok('missing values are unknown, known zero stays zero, known subtotal is reported');

// Parallel paths join at the LATEST predecessor finish; a diamond is not the sum.
const mill=act('act-mill',{durationDays:3}),prep=act('act-prep',{durationDays:2}),pave=act('act-pave',{durationDays:1}),ms=P.blankActivity('milestone','Handover','ms000000');
r=P.calculatePlan(doc([mill,prep,pave,ms],[{from:'act-mill',to:'act-pave'},{from:'act-prep',to:'act-pave'},{from:'act-pave',to:'ms000000'}]),{rates:false});
assert.equal(r.activities['act-pave'].start,3);assert.deepEqual(r.activities['act-pave'].drivers,['act-mill']);assert.equal(r.activities['act-pave'].finish,4);assert.equal(r.activities['ms000000'].start,4);assert.equal(r.activities['ms000000'].finish,4);assert.equal(r.duration.days,4);
assert.equal(r.cost,undefined);assert.equal(r.activities['act-mill'].cost,undefined);
ok('parallel join uses the latest predecessor finish; zero-duration milestone');

// Cycles and bad dependencies are rejected.
const cyc=doc([act('act-cyc1',{durationDays:1}),act('act-cyc2',{durationDays:1}),act('act-cyc3',{durationDays:1})],[{from:'act-cyc1',to:'act-cyc2'},{from:'act-cyc2',to:'act-cyc3'},{from:'act-cyc3',to:'act-cyc1'}]);
assert.ok(P.validatePlan(cyc).some(i=>/loop/.test(i.message)));
assert.ok(P.validatePlan(doc([act('act-self',{durationDays:1})],[{from:'act-self',to:'act-self'}])).length);
assert.ok(P.validatePlan(doc([act('act-dup1',{durationDays:1}),act('act-dup2',{durationDays:1})],[{from:'act-dup1',to:'act-dup2'},{from:'act-dup1',to:'act-dup2'}])).some(i=>/Duplicate/.test(i.message)));
assert.ok(P.validatePlan(doc([act('act-err1',{durationDays:1})],[{from:'act-err1',to:'nope0000'}])).length);
assert.deepEqual(P.validatePlan(doc([mill,prep,pave],[{from:'act-mill',to:'act-pave'},{from:'act-prep',to:'act-pave'}])),[]);
ok('cycle, self-link, duplicate and unknown-id dependencies rejected; multiple predecessors accepted');

// Shared cost counted once; activity setup is explicit and owned by its activity.
const s1=act('act-sh-a',{durationDays:1,hoursPerDay:8,sharedCostIds:['sh000001'],costItems:[{id:'ci000001',label:'Setup',amount:100}],requirements:[{id:'rq000010',kind:'labour',name:'Crew',quantity:2,rate:50,rateBasis:'day',resourceRef:null}]});
const s2=act('act-sh-b',{durationDays:1,hoursPerDay:8,sharedCostIds:['sh000001']});
r=P.calculatePlan(doc([s1,s2],[],[{id:'sh000001',label:'Mobilisation',amount:1000}]),{rates:true});
assert.equal(r.activities['act-sh-a'].cost.total,200);assert.equal(r.activities['act-sh-b'].cost.total,0);assert.equal(r.cost.sharedTotal,1000);assert.equal(r.cost.total,1200);assert.deepEqual(r.cost.sharedCosts[0].usedBy,['act-sh-a','act-sh-b']);
ok('shared cost counted once at plan level; activity setup in the activity');

// Cost arithmetic: count × rate × hours/day × days (hourly) and no hours dependence for daily rates.
const c1=act('act-cost',{durationDays:2,hoursPerDay:10,requirements:[{id:'rq000020',kind:'labour',name:'Operator',quantity:2,rate:55.5,rateBasis:'hour',resourceRef:null},{id:'rq000021',kind:'plant',name:'Truck',quantity:1,rate:800,rateBasis:'day',resourceRef:null}]});
r=P.calculatePlan(doc([c1]),{rates:true});assert.equal(r.activities['act-cost'].cost.runCost,2*55.5*10*2+1600);
const noHours={...c1,hoursPerDay:null};r=P.calculatePlan(doc([noHours]),{rates:true});assert.equal(r.activities['act-cost'].cost.total,null);assert.equal(r.activities['act-cost'].cost.requirements[1].amount,1600);
ok('resource arithmetic, hourly vs daily basis, unknown hours');

// Redaction removes every rate and amount.
const red=P.redactRates(doc([s1],[],[{id:'sh000001',label:'Mobilisation',amount:1000}]));
assert.ok(!JSON.stringify(red).includes('1000')&&red.activities[0].requirements[0].rate===null&&red.activities[0].costItems[0].amount===null);
ok('redaction strips rates and amounts');

// Determinism: identical input gives identical output regardless of dependency order.
const dd=doc([mill,prep,pave],[{from:'act-mill',to:'act-pave'},{from:'act-prep',to:'act-pave'}]),de=doc([mill,prep,pave],[{from:'act-prep',to:'act-pave'},{from:'act-mill',to:'act-pave'}]);
assert.deepEqual(P.calculatePlan(dd,{rates:true}),P.calculatePlan(de,{rates:true}));
ok('deterministic calculation');
// Precision and range: validation, preview and storage (migration 0026) share one contract; nothing is rounded on save.
const priced=(rate,extra={})=>act('act-prec1',{durationDays:2,hoursPerDay:8,requirements:[{id:'rq000090',kind:'labour',name:'Crew',quantity:1,rate,rateBasis:'hour',resourceRef:null}],...extra});
assert.deepEqual(P.validatePlan(doc([priced(95.125)])),[],'a rate keeps 4 decimal places');
assert.equal(P.calculatePlan(doc([priced(95.125)]),{rates:true}).activities['act-prec1'].cost.total,P.money(95.125*8*2));
assert.ok(P.validatePlan(doc([priced(95.12345)])).some(i=>/at most 4 decimal places/.test(i.message)),'a fifth decimal place is rejected, not rounded');
assert.equal(P.calculatePlan(doc([priced(95.12345)]),{rates:true}).activities['act-prec1'].cost.total,null,'an unstorable value previews as unknown, never as a rounded or exact total');
const withSetup=amount=>act('act-prec2',{durationDays:1,costItems:[{id:'ci000090',label:'Setup',amount}]});
assert.ok(P.validatePlan(doc([withSetup(95.125)])).some(i=>/at most 2 decimal places/.test(i.message)),'a dollar amount keeps cents');
assert.deepEqual(P.validatePlan(doc([withSetup(95.12)])),[]);
const slow=p=>act('act-prec3',{durationMode:'derived',quantity:1,unit:'m',productivity:p,productivityUnit:'m',hoursPerDay:8});
assert.deepEqual(P.validatePlan(doc([slow(0.0004)])),[],'very small positive productivity is storable');
assert.equal(P.activityDuration(slow(0.0004)).days,312.5);
assert.ok(P.validatePlan(doc([slow(0.0000004)])).some(i=>/at most 6 decimal places/.test(i.message)),'productivity below the stored precision is rejected, not stored as zero');
assert.ok(P.validatePlan(doc([slow(0)])).length,'zero productivity is invalid');
assert.ok(P.validatePlan(doc([act('act-prec4',{durationDays:1e9})])).some(i=>/between 0 and/.test(i.message)),'ranges match the column');
assert.ok(P.validatePlan(doc([act('act-prec5',{quantity:1e9+1})])).length);
for(const [k,spec] of Object.entries(P.FIELDS)){assert.ok(P.fits(spec.max,spec)&&!P.fits(spec.max+1,spec),k+' range');assert.ok(!P.fits(-1,spec),k+' negative');}
ok('precision and range contract shared by validation and preview');
console.log(`Planning engine: ${n} groups passed`);
