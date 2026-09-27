import { assignments, plannedCost, interval, type DeliveryRecord } from './planning';
export type Row = Record<string,string|number|boolean>;
export type FieldData = {
 pricingReviewRequired?:boolean;
 arrival:string; departure:string; productionStart:string; productionFinish:string;
 preStart:boolean; preStartNotes:string; tonnes:string; loads:string; trips:string; area:string; chainage:string;
 materialCost:string; otherCost:string; wastage:string; wastageReason:string; diary:string;
 clientName:string; clientSignature:string; clientDeclinedReason:string; supervisorName:string; supervisorSignature:string;
 resources:Row[]; delays:Row[]; cycles:Row[]; checks:Row[]; instructions:Row[]; standDowns:Row[]; incidents:Row[]; variations:Row[];
 attachments:{id:string;name:string;url:string}[]; reviewed:boolean;
};
export type FieldRecord = {shiftId:string;revision:number;status:string;data:FieldData;plan:DeliveryRecord;job:DeliveryRecord;updatedAt:string};
export function initialField(plan:DeliveryRecord):FieldData {
 return {arrival:'',departure:'',productionStart:'',productionFinish:'',preStart:false,preStartNotes:'',tonnes:'',loads:'',trips:'',area:'',chainage:'',materialCost:'',otherCost:'',wastage:'',wastageReason:'',diary:'',clientName:String(plan.metadata.siteContact||''),clientSignature:'',clientDeclinedReason:'',supervisorName:String(plan.metadata.supervisor||''),supervisorSignature:'',reviewed:false,resources:assignments(plan).map(a=>({...a,attendance:'Unconfirmed',start:'',finish:'',breakMinutes:0,hours:'',additional:false})),delays:[],cycles:[],checks:[],instructions:[],standDowns:[],incidents:[],variations:[],attachments:[]};
}
export function hours(start:unknown,finish:unknown):number {
 if(!start||!finish)return 0;
 const a=Date.parse(String(start)),b=Date.parse(String(finish));
 return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?(b-a)/3600000:0;
}
export function resourceHours(r:Row) {return r.attendance==='Absent'||r.attendance==='Not used'?0:r.start&&r.finish?Math.max(0,hours(r.start,r.finish)-Number(r.breakMinutes||0)/60):Number(r.hours||0);}
export function fieldMetrics(f:FieldData,p:DeliveryRecord,j:DeliveryRecord) {
 const a=assignments(p), rs=f.resources;
 const labour=(r:{category?:unknown})=>['workers','crews'].includes(String(r.category));
 const truck=(r:{role?:unknown})=>String(r.role).toLowerCase().includes('truck');
 const sum=(rows:Row[],predicate:(r:Row)=>boolean)=>rows.filter(predicate).reduce((n,r)=>n+resourceHours(r),0);
 const actualCost=rs.reduce((n,r)=>n+resourceHours(r)*Number(r.rate||0),0)+Number(f.materialCost||0)+Number(f.otherCost||0);
 const pc=plannedCost(p),duration=(interval(p.metadata)[1]-interval(p.metadata)[0])/3600000;
 const delay=f.delays.reduce((n,r)=>n+hours(r.start,r.finish),0);
 const budget=j.metadata.approvedBudget as Record<string,number>|undefined;
 const revenue=Number(j.metadata.contractValue||budget?.sellRate||0);
 return {rows:[['Labour hours',a.filter(labour).reduce((n,r)=>n+r.hours,0),sum(rs,labour)],['Plant hours',a.filter(r=>r.category==='plant'&&!truck(r)).reduce((n,r)=>n+r.hours,0),sum(rs,r=>r.category==='plant'&&!truck(r))],['Truck hours',a.filter(truck).reduce((n,r)=>n+r.hours,0),sum(rs,truck)],['Truck trips',a.filter(truck).reduce((n,r)=>n+r.trips,0),Number(f.trips||0)],['Tonnes',Number(p.metadata.tonnes||0),Number(f.tonnes||0)],['Area (m²)',Number(p.metadata.area||0),Number(f.area||0)],['Production (t/hour)',duration>0?Number(p.metadata.tonnes||0)/duration:0,hours(f.productionStart,f.productionFinish)>0?Number(f.tonnes||0)/hours(f.productionStart,f.productionFinish):0],['Delay hours',Number(p.metadata.delayHours||0),delay],['Shift cost ($)',pc,actualCost]] as [string,number,number][],actualCost,plannedCost:pc,marginEffect:revenue>0?-(actualCost-pc)/revenue*100:null,waiting: f.cycles.reduce((n,r)=>n+hours(r.waitStart,r.waitFinish),0)};
}
export function incomplete(f:FieldData,financial=true):string[] {
 const errors:string[]=[];
 for(const [k,label] of [['arrival','Site arrival'],['departure','Site departure'],['tonnes','Tonnes (enter 0 if none)'],['loads','Loads'],['trips','Trips'],['area','Area'],['wastage','Wastage'],['materialCost','Actual material cost'],['otherCost','Other actual costs'],['diary','Site diary'],['supervisorName','Supervisor name'],['supervisorSignature','Supervisor signature']] as const)if((financial||!['materialCost','otherCost'].includes(k))&&!String(f[k]||'').trim())errors.push(label);
 if(!f.preStart)errors.push('Pre-start completion');
 if(!f.reviewed)errors.push('Confirm delays, instructions, incidents and variations reviewed');
 if(!f.clientName||(!f.clientSignature&&!f.clientDeclinedReason))errors.push('Client representative and signature or reason unavailable');
 if(Number(f.tonnes)>0&&(!f.productionStart||!f.productionFinish||!f.checks.length))errors.push('Production times and temperature / quality checks');
 if(Number(f.wastage)>0&&!f.wastageReason.trim())errors.push('Material wastage reason');
 if(!f.resources.length)errors.push('Actual resources');
 f.resources.forEach((r,i)=>{if(!r.name||!r.attendance||r.attendance==='Unconfirmed')errors.push(`Resource ${i+1}: confirm attendance / use`);if(financial&&!['Absent','Not used'].includes(String(r.attendance))&&(r.rate===undefined||r.rate===''))errors.push(`Resource ${i+1}: enter cost rate (0 if no charge)`);if(!['Absent','Not used'].includes(String(r.attendance))&&((r.hours===''||r.hours===undefined)&&!(r.start&&r.finish)))errors.push(`Resource ${i+1}: actual hours or start / finish`);});
 for(const [key,required] of Object.entries({delays:['start','finish','cause','party'],cycles:['truck','start','finish'],checks:['time','temperature','result'],instructions:['time','representative','details'],standDowns:['start','finish','reason','party'],incidents:['time','type','details','action'],variations:['description','instructionBy','cost']})) (f[key as keyof FieldData] as Row[]).forEach((r,i)=>{if(required.some(k=>(financial||k!=='cost')&&(r[k]===undefined||r[k]==='')))errors.push(`${key} ${i+1}: complete details`);});
 return [...errors,...invalidField(f)];
}
export function invalidField(f:FieldData):string[] {
 const errors:string[]=[];
 for(const key of ['tonnes','loads','trips','area','wastage','materialCost','otherCost'] as const)if(f[key]!==undefined&&f[key]!==''&&(!Number.isFinite(Number(f[key]))||Number(f[key])<0))errors.push(`${key}: use a non-negative number`);
 const pairs:[[unknown,unknown,string]]|[unknown,unknown,string][]=[[f.arrival,f.departure,'Site times'],[f.productionStart,f.productionFinish,'Production times']];
 for(const key of ['resources','delays','cycles','standDowns'] as const)f[key].forEach((r,i)=>{pairs.push([r.start,r.finish,`${key} ${i+1}`]);if(key==='cycles')pairs.push([r.waitStart,r.waitFinish,`Waiting ${i+1}`]);for(const k of ['hours','rate','breakMinutes'])if(r[k]!==undefined&&r[k]!==''&&(!Number.isFinite(Number(r[k]))||Number(r[k])<0))errors.push(`${key} ${i+1}: invalid ${k}`);});
 for(const [start,finish,label] of pairs)if(start&&finish&&(!Number.isFinite(Date.parse(String(start)))||!Number.isFinite(Date.parse(String(finish)))||Date.parse(String(finish))<Date.parse(String(start))))errors.push(`${label}: finish must follow start (check overnight dates)`);
 if(f.arrival&&f.productionStart&&f.productionStart<f.arrival)errors.push('Production starts before site arrival');
 if(f.departure&&f.productionFinish&&f.productionFinish>f.departure)errors.push('Production finishes after site departure');
 return errors;
}
