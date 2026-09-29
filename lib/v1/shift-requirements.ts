import {z} from 'zod';
export const requirementsInput=z.array(z.object({category:z.enum(['workers','crews','plant','suppliers','subcontractors']),role:z.string().trim().max(100),quantity:z.number().int().min(1).max(1000)})).max(100);
export type Requirement=z.infer<typeof requirementsInput>[number];
export function coverage(requirements:Requirement[],assigned:Array<{category:string;role:string;resourceId:string}>){
 const used=new Set<string>();
 // Specific roles consume first, then generic requirements; no double-counting.
 const ranked=requirements.map((r,index)=>({...r,index})).sort((a,b)=>Number(Boolean(b.role))-Number(Boolean(a.role)));
 const result=ranked.map(r=>{const candidates=assigned.filter(a=>a.category===r.category&&(!r.role||a.role.toLowerCase()===r.role.toLowerCase())&&!used.has(a.resourceId));const selected=candidates.slice(0,r.quantity);selected.forEach(a=>used.add(a.resourceId));return {...r,filled:selected.length,missing:Math.max(0,r.quantity-selected.length)};});
 return result.sort((a,b)=>a.index-b.index);
}
export function copyShift<T extends {id:string;name:string;status:string;metadata:Record<string,unknown>}>(shift:T,date:string,includeResources:boolean){
 const m=shift.metadata;
 // Explicit allowlist: approvals, evidence, actuals and dispatch acknowledgements never copy.
 const keys=['jobId','start','finish','classification','scope','location','supervisor','siteContact','requiredCompetencies','requirements','area','tonnes','mix','instructions'];
 return {id:'',name:shift.name,status:'Draft',metadata:{...Object.fromEntries(keys.filter(k=>k in m).map(k=>[k,structuredClone(m[k])])),date,assignments:includeResources?structuredClone(m.assignments||[]):[],checks:{},files:[]}};
}
