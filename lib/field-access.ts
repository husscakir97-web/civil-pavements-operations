import type {DeliveryRecord} from './planning';
import {initialField,type FieldData,type FieldRecord,type Row} from './field';
import type {PreparationRecord} from './preparation';

const pick=(value:Record<string,unknown>,keys:readonly string[])=>Object.fromEntries(keys.filter(k=>k in value).map(k=>[k,value[k]]));
const shiftKeys=['jobId','date','start','finish','location','supervisor','supervisorUserId','scope','instructions','preStart','siteContact','tonnes','area','delayHours','mix','permit','tmp','tgs','occupancyStart','occupancyFinish'];
const jobKeys=['client','site','workType','specification','scope','siteContact','occupancyStart','occupancyFinish'];
const resourceKeys=['resourceId','category','name','role','hours','payload','trips','userId','attendance','start','finish','breakMinutes','additional'];

// Allowlists keep future financial metadata private by default.
export function fieldDelivery(record:DeliveryRecord,kind:'jobs'|'shifts'):DeliveryRecord{
 const metadata=pick(record.metadata,kind==='jobs'?jobKeys:shiftKeys);
 if(kind==='shifts')metadata.assignments=(Array.isArray(record.metadata.assignments)?record.metadata.assignments:[]).map(r=>pick(r,resourceKeys));
 return {id:record.id,name:record.name,status:record.status,metadata};
}
// Office roles without commercial access (scheduler, supervisor, read-only) see the full
// operational record but never rates, budgets, costs or contract values.
const moneyKeys=new Set(['rate','hourlyRate','dayRate','cost','amount','value','price','sellRate','contractValue','approvedBudget','estimateSnapshot','materialCost','otherCost','budget','margin','grossMargin','directCost','totalCost','quoteValue','estimatedValue']);
export function withoutMoney(record:DeliveryRecord):DeliveryRecord{
 const clean=(v:unknown):unknown=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v as Record<string,unknown>).filter(([k])=>!moneyKeys.has(k)).map(([k,x])=>[k,clean(x)])):v;
 return {...record,metadata:clean(record.metadata) as Record<string,unknown>};
}
export function fieldData(data:FieldData):FieldData{
 const out=pick(data,Object.keys(initialField({id:'',name:'',status:'',metadata:{}}))) as FieldData;
 delete (out as Partial<FieldData>).materialCost;delete (out as Partial<FieldData>).otherCost;
 out.resources=data.resources.map(r=>pick(r,resourceKeys) as Row);
 out.variations=data.variations.map(r=>pick(r,['description','instructionBy','status']) as Row);
 return out;
}
export function fieldRecord(record:FieldRecord):FieldRecord{
 return {shiftId:record.shiftId,revision:record.revision,status:record.status,updatedAt:record.updatedAt,data:fieldData(record.data),plan:fieldDelivery(record.plan,'shifts'),job:fieldDelivery(record.job,'jobs')};
}
// Approved operational prose is deliberately shared with field staff; source
// pages, tender links, commercial matrix entries and arbitrary row fields are not.
export function fieldPreparationDocument(record:PreparationRecord):PreparationRecord{
 const allowed=['Activity','Activity/location','Hazard or risk','Cause','Consequence','Initial likelihood','Initial consequence','Initial rating','Controls','Residual likelihood','Residual consequence','Residual rating','Review','Inspection/test','Specification reference','Acceptance criteria','Frequency/lot','Inspector','Hold/witness point','Required evidence','Result','Release authority','Sign-off','shiftId','sourceRowId','action','actorId'];
 return {...record,opportunity_id:null,data:{...record.data,sourcePages:[],attachments:[],evidence:[],manifest:[],matrix:{},entitlements:{},origin:undefined,rows:record.data.rows.map(r=>({...r,sourceId:'',sourceRef:'',evidence:[],weighting:'',fields:pick(r.fields,allowed) as Record<string,string>}))}};
}
// A field save must never overwrite hidden prices with zero, or accept a rate
// supplied by the browser. Preserve the frozen server values by resource ID.
export function preserveFieldPricing(incoming:FieldData,previous:FieldData):FieldData{
 const data=fieldData(incoming);
 data.materialCost=previous.materialCost;data.otherCost=previous.otherCost;
 data.resources=data.resources.map((r,i)=>{
  const old=r.resourceId?previous.resources.find(p=>p.resourceId===r.resourceId&&p.category===r.category):previous.resources[i]?.name===r.name?previous.resources[i]:undefined;
  return {...r,rate:old?.rate??''};
 });
 data.variations=data.variations.map(r=>({...r,cost:previous.variations.find(p=>p.description===r.description&&p.instructionBy===r.instructionBy)?.cost??''}));
 data.pricingReviewRequired=Boolean(previous.pricingReviewRequired)||!data.materialCost||!data.otherCost||data.resources.some(r=>r.rate==='')||data.variations.some(r=>r.cost==='');
 return data;
}
