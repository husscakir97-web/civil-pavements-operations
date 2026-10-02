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
console.log(`Planning engine: ${n} groups passed`);
