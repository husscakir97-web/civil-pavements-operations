// Planning v0.1: one deterministic implementation shared by the browser preview and the authoritative
// server validation (docs/PLANNING-V0-1-DECISION.md). Pure functions only: no I/O, no clock, no randomness.
// Missing values are UNKNOWN (null) and are never coerced to zero; a known zero stays a known zero.
// Time is RELATIVE (working days from the start of the plan); no real-world availability is implied.
// Arithmetic convention mirrors the estimate engine (hours = quantity ÷ productivity per hour) but, unlike
// it, nothing is defaulted to zero. This file never reads or writes estimates, resources or bookings.

export type ActivityKind='activity'|'milestone';
export type DurationMode='entered'|'derived';
export type RequirementKind='labour'|'plant';
export type RateBasis='hour'|'day';
export type ResourceRef={type:'worker'|'plant';id:string};

export type Requirement={id:string;kind:RequirementKind;name:string;quantity:number|null;rate:number|null;rateBasis:RateBasis;resourceRef:ResourceRef|null};
export type CostItem={id:string;label:string;amount:number|null};
export type PlanActivity={
 id:string;kind:ActivityKind;name:string;notes:string;
 quantity:number|null;unit:string|null;productivity:number|null;productivityUnit:string|null;
 durationMode:DurationMode;durationDays:number|null;hoursPerDay:number|null;
 /** Optional informational date. Never used by the calculation. */
 plannedStart:string|null;
 requirements:Requirement[];
 /** Setup costs owned by this activity (counted in its cost). */
 costItems:CostItem[];
 /** Plan-level shared costs this activity relies on (attribution only; counted once at plan level). */
 sharedCostIds:string[];
};
export type Dependency={from:string;to:string};
export type PlanDocument={activities:PlanActivity[];dependencies:Dependency[];sharedCosts:CostItem[]};
export type Positions=Record<string,{x:number;y:number}>;
export type Issue={path:string;message:string};

export const LIMITS={activities:200,dependencies:600,requirements:30,costItems:20,sharedCosts:50,name:180} as const;
/** Numeric contract shared by input validation, the live preview and storage (migration 0026). Each `scale` equals the column's decimal places and each `max` fits its column; nothing is rounded during persistence. */
export type FieldSpec={scale:number;max:number;positive?:boolean;label:string};
export const FIELDS={
 quantity:{scale:3,max:999_999_999,label:'quantity'},        // planning_activities.quantity decimal(15,3)
 productivity:{scale:6,max:999_999_999,positive:true,label:'productivity'}, // planning_activities.productivity decimal(15,6)
 durationDays:{scale:3,max:100_000,label:'duration'},         // planning_activities.duration_days decimal(9,3)
 hoursPerDay:{scale:2,max:24,positive:true,label:'productive hours per day'}, // planning_activities.hours_per_day decimal(5,2)
 count:{scale:3,max:999_999_999,label:'count'},               // planning_requirements.quantity decimal(15,3)
 rate:{scale:4,max:999_999_999,label:'rate'},                 // planning_requirements.rate decimal(15,4)
 amount:{scale:2,max:999_999_999,label:'amount'},             // planning_cost_items.amount decimal(15,2)
} as const satisfies Record<string,FieldSpec>;
/** True when the value can be stored exactly: within range and no more decimal places than the column keeps. */
export const fits=(v:unknown,f:FieldSpec):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=f.max&&(!f.positive||v>0)&&Number(v.toFixed(f.scale))===v;
export const ID_PATTERN=/^[A-Za-z0-9_-]{8,64}$/;

// ---------------------------------------------------------------------------------------------- units
const UNIT_TABLE:Record<string,{dim:string;factor:number}>={
 m:{dim:'length',factor:1},km:{dim:'length',factor:1000},
 m2:{dim:'area',factor:1},ha:{dim:'area',factor:10000},
 m3:{dim:'volume',factor:1},
 t:{dim:'mass',factor:1000},kg:{dim:'mass',factor:1},
 ea:{dim:'count',factor:1},each:{dim:'count',factor:1},item:{dim:'count',factor:1},
 l:{dim:'liquid',factor:1},kl:{dim:'liquid',factor:1000},
};
export const KNOWN_UNITS=Object.keys(UNIT_TABLE);
export const normaliseUnit=(unit:string|null|undefined)=>String(unit??'').trim().toLowerCase().replace(/²/g,'2').replace(/³/g,'3');
/** Factor to convert a quantity in `from` into `to`; null when the units are incompatible. Identical unknown units are compatible. */
export function unitFactor(from:string|null|undefined,to:string|null|undefined):number|null{
 const a=normaliseUnit(from),b=normaliseUnit(to);
 if(!a||!b)return null;
 if(a===b)return 1;
 const x=UNIT_TABLE[a],y=UNIT_TABLE[b];
 return x&&y&&x.dim===y.dim?x.factor/y.factor:null;
}

// ---------------------------------------------------------------------------------------------- rounding
export const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const days=(n:number)=>Math.round((n+Number.EPSILON)*1000)/1000;
const known=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);

// ---------------------------------------------------------------------------------------------- construction helpers
export const newId=()=>(globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`).replace(/[^A-Za-z0-9_-]/g,'');
export function blankActivity(kind:ActivityKind,name:string,id:string=newId()):PlanActivity{
 return {id,kind,name,notes:'',quantity:null,unit:null,productivity:null,productivityUnit:null,durationMode:'entered',durationDays:kind==='milestone'?0:null,hoursPerDay:null,plannedStart:null,requirements:[],costItems:[],sharedCostIds:[]};
}
export const emptyDocument=():PlanDocument=>({activities:[],dependencies:[],sharedCosts:[]});

// ---------------------------------------------------------------------------------------------- validation (authoritative on the server)
const num=(v:unknown,path:string,issues:Issue[],f:FieldSpec)=>{
 if(v===null||v===undefined)return;
 if(!known(v)||v<0||v>f.max)issues.push({path,message:`Enter a ${f.label} between 0 and ${f.max.toLocaleString('en-AU')}.`});
 else if(Number(v.toFixed(f.scale))!==v)issues.push({path,message:`Use at most ${f.scale} decimal place${f.scale===1?'':'s'} for ${f.label} (${v} cannot be stored exactly).`});
 else if(f.positive&&v<=0)issues.push({path,message:`The ${f.label} must be above zero (leave it empty if unknown).`});
};
/** Returns the dependency cycle as an id path (first id repeated at the end), or null. Deterministic. */
export function findCycle(ids:readonly string[],deps:readonly Dependency[]):string[]|null{
 const next=new Map<string,string[]>(ids.map(i=>[i,[]]));
 for(const d of deps)next.get(d.from)?.push(d.to);
 const state=new Map<string,0|1|2>();const stack:string[]=[];
 const visit=(id:string):string[]|null=>{
  state.set(id,1);stack.push(id);
  for(const n of next.get(id)||[]){
   if(state.get(n)===1)return [...stack.slice(stack.indexOf(n)),n];
   if(!state.get(n)){const c=visit(n);if(c)return c;}
  }
  stack.pop();state.set(id,2);return null;
 };
 for(const id of ids)if(!state.get(id)){const c=visit(id);if(c)return c;}
 return null;
}
export function validatePlan(doc:PlanDocument):Issue[]{
 const issues:Issue[]=[];
 if(doc.activities.length>LIMITS.activities)issues.push({path:'activities',message:`A plan holds at most ${LIMITS.activities} activities.`});
 if(doc.dependencies.length>LIMITS.dependencies)issues.push({path:'dependencies',message:`A plan holds at most ${LIMITS.dependencies} dependencies.`});
 if(doc.sharedCosts.length>LIMITS.sharedCosts)issues.push({path:'sharedCosts',message:`A plan holds at most ${LIMITS.sharedCosts} shared costs.`});
 const ids=new Set<string>(),all=new Set<string>();
 const claim=(id:string,path:string)=>{if(!ID_PATTERN.test(id))issues.push({path,message:'Invalid identifier.'});else if(all.has(id))issues.push({path,message:'Duplicate identifier.'});all.add(id);};
 const shared=new Set<string>();
 doc.sharedCosts.forEach((c,i)=>{claim(c.id,`sharedCosts.${i}.id`);shared.add(c.id);if(!c.label.trim())issues.push({path:`sharedCosts.${i}.label`,message:'Name the shared cost.'});num(c.amount,`sharedCosts.${i}.amount`,issues,FIELDS.amount);});
 doc.activities.forEach((a,i)=>{
  const p=`activities.${i}`;
  claim(a.id,`${p}.id`);ids.add(a.id);
  if(!a.name.trim())issues.push({path:`${p}.name`,message:'Name the activity.'});
  if(a.name.length>LIMITS.name)issues.push({path:`${p}.name`,message:`Keep the name under ${LIMITS.name} characters.`});
  if(a.plannedStart!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(a.plannedStart))issues.push({path:`${p}.plannedStart`,message:'Enter a valid date or leave it empty.'});
  num(a.quantity,`${p}.quantity`,issues,FIELDS.quantity);num(a.productivity,`${p}.productivity`,issues,FIELDS.productivity);num(a.durationDays,`${p}.durationDays`,issues,FIELDS.durationDays);num(a.hoursPerDay,`${p}.hoursPerDay`,issues,FIELDS.hoursPerDay);
  if(a.kind==='milestone'){
   if(a.requirements.length||a.costItems.length||a.sharedCostIds.length)issues.push({path:p,message:'A milestone has no duration, resources or costs.'});
   if(a.durationDays!==null&&a.durationDays!==0)issues.push({path:`${p}.durationDays`,message:'A milestone has zero duration.'});
  }else if(a.durationMode==='entered'&&known(a.durationDays)&&a.durationDays<=0)issues.push({path:`${p}.durationDays`,message:'An activity needs a duration above zero (use a milestone for zero duration, or leave it unknown).'});
  if(a.durationMode==='derived'&&a.kind==='activity'){
   if(!a.unit&&known(a.quantity))issues.push({path:`${p}.unit`,message:'Choose the quantity unit.'});
   if(a.unit&&a.productivityUnit&&unitFactor(a.unit,a.productivityUnit)===null)issues.push({path:`${p}.productivityUnit`,message:`Productivity is in ${a.productivityUnit} per hour, which is incompatible with the quantity unit ${a.unit}.`});
   if(known(a.quantity)&&a.quantity===0)issues.push({path:`${p}.quantity`,message:'A derived duration needs a quantity above zero.'});
  }
  if(a.requirements.length>LIMITS.requirements)issues.push({path:`${p}.requirements`,message:`At most ${LIMITS.requirements} resource requirements per activity.`});
  a.requirements.forEach((r,j)=>{
   const q=`${p}.requirements.${j}`;claim(r.id,`${q}.id`);
   if(!r.name.trim())issues.push({path:`${q}.name`,message:'Name the resource.'});
   num(r.quantity,`${q}.quantity`,issues,FIELDS.count);num(r.rate,`${q}.rate`,issues,FIELDS.rate);
   if(r.resourceRef&&(!r.resourceRef.id||r.resourceRef.id.length>191))issues.push({path:`${q}.resourceRef`,message:'Invalid resource reference.'});
   if(r.resourceRef&&r.resourceRef.type!==(r.kind==='plant'?'plant':'worker'))issues.push({path:`${q}.resourceRef`,message:r.kind==='plant'?'A plant line can only be linked to a plant item.':'A labour line can only be linked to a worker.'});
  });
  if(a.costItems.length>LIMITS.costItems)issues.push({path:`${p}.costItems`,message:`At most ${LIMITS.costItems} setup costs per activity.`});
  a.costItems.forEach((c,j)=>{claim(c.id,`${p}.costItems.${j}.id`);if(!c.label.trim())issues.push({path:`${p}.costItems.${j}.label`,message:'Name the setup cost.'});num(c.amount,`${p}.costItems.${j}.amount`,issues,FIELDS.amount);});
  const seen=new Set<string>();
  a.sharedCostIds.forEach((s,j)=>{if(!shared.has(s))issues.push({path:`${p}.sharedCostIds.${j}`,message:'Unknown shared cost.'});if(seen.has(s))issues.push({path:`${p}.sharedCostIds.${j}`,message:'Shared cost listed twice.'});seen.add(s);});
 });
 const pairs=new Set<string>();
 doc.dependencies.forEach((d,i)=>{
  const p=`dependencies.${i}`;
  if(!ids.has(d.from)||!ids.has(d.to))issues.push({path:p,message:'A dependency must connect two activities in this plan.'});
  else if(d.from===d.to)issues.push({path:p,message:'An activity cannot depend on itself.'});
  const key=`${d.from}>${d.to}`;if(pairs.has(key))issues.push({path:p,message:'Duplicate dependency.'});pairs.add(key);
 });
 if(!issues.some(i=>i.path.startsWith('dependencies'))){
  const cycle=findCycle([...ids],doc.dependencies);
  if(cycle){const names=new Map(doc.activities.map(a=>[a.id,a.name]));issues.push({path:'dependencies',message:`These dependencies form a loop: ${cycle.map(id=>names.get(id)||id).join(' → ')}.`});}
 }
 return issues;
}

// ---------------------------------------------------------------------------------------------- calculation
export type RequirementCost={id:string;hours:number|null;amount:number|null};
export type ActivityResult={
 id:string;durationDays:number|null;durationSource:'entered'|'derived'|'milestone'|'unknown';
 /** Relative working days from plan start; null when any predecessor or this duration is unknown. */
 start:number|null;finish:number|null;
 /** Latest predecessor(s) whose finish determined the start. */
 drivers:string[];
 /** Cost outputs are omitted entirely when rates are not visible to the viewer. */
 cost?:{requirements:RequirementCost[];runCost:number|null;setupCost:number|null;total:number|null;knownSubtotal:number;unknownCount:number;sharedCostIds:string[]};
};
export type PlanResult={
 order:string[];activities:Record<string,ActivityResult>;
 duration:{days:number|null;complete:boolean;unknownActivities:string[]};
 cost?:{total:number|null;knownTotal:number;unknownCount:number;runTotal:number;activitySetupTotal:number;sharedTotal:number;sharedCosts:{id:string;label:string;amount:number|null;usedBy:string[]}[]};
};

/** Deterministic topological order (ties broken by document order). Assumes the graph is acyclic (validatePlan). */
export function topologicalOrder(doc:PlanDocument):string[]{
 const index=new Map(doc.activities.map((a,i)=>[a.id,i]));
 const indeg=new Map(doc.activities.map(a=>[a.id,0]));
 const out=new Map<string,string[]>(doc.activities.map(a=>[a.id,[]]));
 for(const d of doc.dependencies){if(!index.has(d.from)||!index.has(d.to))continue;out.get(d.from)!.push(d.to);indeg.set(d.to,(indeg.get(d.to)||0)+1);}
 const ready=doc.activities.filter(a=>!indeg.get(a.id)).map(a=>a.id);
 const order:string[]=[];
 while(ready.length){
  ready.sort((x,y)=>index.get(x)!-index.get(y)!);
  const id=ready.shift()!;order.push(id);
  for(const n of out.get(id)!){indeg.set(n,indeg.get(n)!-1);if(!indeg.get(n))ready.push(n);}
 }
 return order;
}

export function activityDuration(a:PlanActivity):{days:number|null;source:ActivityResult['durationSource']}{
 if(a.kind==='milestone')return {days:0,source:'milestone'};
 if(a.durationMode==='entered')return known(a.durationDays)&&a.durationDays>0?{days:days(a.durationDays),source:'entered'}:{days:null,source:'unknown'};
 const factor=unitFactor(a.unit,a.productivityUnit);
 if(!known(a.quantity)||a.quantity<=0||!known(a.productivity)||a.productivity<=0||!known(a.hoursPerDay)||a.hoursPerDay<=0||factor===null)return {days:null,source:'unknown'};
 const hours=a.quantity*factor/a.productivity;
 return {days:days(hours/a.hoursPerDay),source:'derived'};
}

/** A value that could not be stored exactly is never previewed as if it could: it counts as unknown until it is corrected (validatePlan reports why). */
function previewable(doc:PlanDocument):PlanDocument{
 const f=(v:number|null,spec:FieldSpec)=>v!==null&&!fits(v,spec)?null:v;
 return {...doc,
  sharedCosts:doc.sharedCosts.map(c=>({...c,amount:f(c.amount,FIELDS.amount)})),
  activities:doc.activities.map(a=>({...a,quantity:f(a.quantity,FIELDS.quantity),productivity:f(a.productivity,FIELDS.productivity),durationDays:f(a.durationDays,FIELDS.durationDays),hoursPerDay:f(a.hoursPerDay,FIELDS.hoursPerDay),
   requirements:a.requirements.map(r=>({...r,quantity:f(r.quantity,FIELDS.count),rate:f(r.rate,FIELDS.rate)})),costItems:a.costItems.map(c=>({...c,amount:f(c.amount,FIELDS.amount)}))}))};
}

export function calculatePlan(input:PlanDocument,options:{rates:boolean}):PlanResult{
 const doc=previewable(input);
 const order=topologicalOrder(doc);
 const byId=new Map(doc.activities.map(a=>[a.id,a]));
 const preds=new Map<string,string[]>(doc.activities.map(a=>[a.id,[]]));
 for(const d of doc.dependencies)preds.get(d.to)?.push(d.from);
 const results:Record<string,ActivityResult>={};
 for(const id of order){
  const a=byId.get(id)!;
  const {days:duration,source}=activityDuration(a);
  const ps=preds.get(id)!.map(p=>results[p]);
  // Parallel paths join at the LATEST predecessor finish (never the sum of durations).
  let start:number|null=0;const drivers:string[]=[];
  if(ps.some(p=>p.finish===null))start=null;
  else if(ps.length){start=Math.max(...ps.map(p=>p.finish!));for(const p of ps)if(p.finish===start)drivers.push(p.id);}
  const finish=start!==null&&duration!==null?days(start+duration):null;
  const r:ActivityResult={id,durationDays:duration,durationSource:source,start,finish,drivers};
  if(options.rates)r.cost=activityCost(a,duration);
  results[id]=r;
 }
 const unknownActivities=order.filter(id=>results[id].finish===null);
 const finishes=order.map(id=>results[id].finish);
 const complete=unknownActivities.length===0&&order.length>0;
 const out:PlanResult={order,activities:results,duration:{days:complete?Math.max(...(finishes as number[])):null,complete,unknownActivities}};
 if(options.rates)out.cost=planCost(doc,results);
 return out;
}

function activityCost(a:PlanActivity,duration:number|null):NonNullable<ActivityResult['cost']>{
 if(a.kind==='milestone')return {requirements:[],runCost:0,setupCost:0,total:0,knownSubtotal:0,unknownCount:0,sharedCostIds:[]};
 let unknown=0,knownSub=0,run=0,runKnown=true;
 const requirements:RequirementCost[]=a.requirements.map(r=>{
  const perDay=r.rateBasis==='hour'?(known(a.hoursPerDay)?a.hoursPerDay:null):1;
  const quantity=r.quantity,rate=r.rate;
  const hours=known(duration)&&known(a.hoursPerDay)?days(duration*a.hoursPerDay):null;
  if(!known(quantity)||!known(rate)||perDay===null||!known(duration)){unknown++;runKnown=false;return {id:r.id,hours,amount:null};}
  const amount=money(quantity*rate*perDay*duration);knownSub+=amount;run+=amount;return {id:r.id,hours,amount};
 });
 let setup=0,setupKnown=true;
 for(const c of a.costItems){if(known(c.amount)){setup+=c.amount;knownSub+=c.amount;}else{unknown++;setupKnown=false;}}
 const runCost=runKnown?money(run):null,setupCost=setupKnown?money(setup):null;
 return {requirements,runCost,setupCost,total:runCost!==null&&setupCost!==null?money(runCost+setupCost):null,knownSubtotal:money(knownSub),unknownCount:unknown,sharedCostIds:[...a.sharedCostIds]};
}

function planCost(doc:PlanDocument,results:Record<string,ActivityResult>):NonNullable<PlanResult['cost']>{
 let knownTotal=0,unknown=0,run=0,setup=0,shared=0;
 for(const a of doc.activities){
  const c=results[a.id].cost!;
  unknown+=c.unknownCount;
  for(let i=0;i<a.requirements.length;i++){const amt=c.requirements[i].amount;if(amt!==null){run+=amt;knownTotal+=amt;}}
  for(const item of a.costItems)if(known(item.amount)){setup+=item.amount;knownTotal+=item.amount;}
 }
 // A shared cost is counted ONCE at plan level however many activities rely on it.
 const sharedCosts=doc.sharedCosts.map(s=>({id:s.id,label:s.label,amount:known(s.amount)?s.amount:null,usedBy:doc.activities.filter(a=>a.sharedCostIds.includes(s.id)).map(a=>a.id)}));
 for(const s of sharedCosts){if(s.amount===null)unknown++;else{shared+=s.amount;knownTotal+=s.amount;}}
 return {total:unknown===0?money(knownTotal):null,knownTotal:money(knownTotal),unknownCount:unknown,runTotal:money(run),activitySetupTotal:money(setup),sharedTotal:money(shared),sharedCosts};
}

// ---------------------------------------------------------------------------------------------- redaction (applied on the server before any response or export)
/** Removes every rate and amount. Callers must also call calculatePlan with rates:false. */
export function redactRates(doc:PlanDocument):PlanDocument{
 return {
  ...doc,
  sharedCosts:doc.sharedCosts.map(c=>({...c,amount:null})),
  activities:doc.activities.map(a=>({...a,requirements:a.requirements.map(r=>({...r,rate:null})),costItems:a.costItems.map(c=>({...c,amount:null}))})),
 };
}
