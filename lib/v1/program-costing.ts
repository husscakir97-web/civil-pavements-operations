import {z} from 'zod';

// Match the existing DECIMAL(...,2) storage: reject silent save/reload rounding.
export const programmeNumber=z.number().finite().min(0).max(1e12)
 .refine(n=>Math.abs(n*100-Math.round(n*100))<0.001,'Use at most two decimal places.').nullable();
const reference=z.string().min(1).max(191).nullable().optional();
export const costingFields={
 productiveHoursPerDay:programmeNumber.refine(n=>n===null||n<=24,'Use up to 24 hours per working day.').optional(),
 directCostRate:programmeNumber.optional(),
 costRateBasis:z.enum(['unit','hour']).optional(),
 sourceEstimateRevisionId:reference,
 sourceEstimateItemId:reference,
};
export const financialInputKeys=['directCostRate','costRateBasis','sourceEstimateRevisionId','sourceEstimateItemId'] as const;
export const costingInput=z.object(costingFields);
export type ProgrammeCosting=z.infer<typeof costingInput>;
export const costingColumns=['productive_hours_per_day','direct_cost_rate','cost_rate_basis','source_estimate_revision_id','source_estimate_item_id'] as const;
const inputKeys=['productiveHoursPerDay',...financialInputKeys] as const;

/** Omitted fields from an older client preserve saved inputs; explicit null clears. */
export function costingValues(input:ProgrammeCosting,current:Record<string,unknown>|null){
 return costingColumns.map((column,i)=>input[inputKeys[i]]!==undefined?input[inputKeys[i]]:current?.[column]??(column==='cost_rate_basis'?'hour':null));
}

export type EstimateItemReference={revisionId:string;itemId:string;description:string;unit:string};
/** Source references only: never returns rates or mutates an approved snapshot. */
export function programmeEstimateItems(project:Record<string,unknown>):EstimateItemReference[]{
 let metadata:Record<string,unknown>={};
 try{metadata=typeof project.metadata==='string'?JSON.parse(project.metadata):project.metadata as Record<string,unknown>||{};}catch{return [];}
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return [];
 const revisionId=String(project.source_estimate_revision_id||metadata.sourceRevisionId||'');
 const snapshot=metadata.estimateSnapshot as {items?:unknown[]}|undefined;
 if(!revisionId||!Array.isArray(snapshot?.items))return [];
 const items=snapshot.items.filter((i):i is Record<string,unknown>=>Boolean(i&&typeof i==='object'));
 return items.filter(i=>typeof i.id==='string'&&i.id.length>0&&i.id.length<=191&&items.filter(other=>other.id===i.id).length===1)
  .map(i=>({revisionId,itemId:String(i.id),description:String(i.description||i.id),unit:String(i.unit||'')}));
}

export function publicProgrammeActivity<T extends Record<string,unknown>>(row:T,canViewCosts:boolean){
 if(canViewCosts)return row;
 const out={...row};
 for(const column of costingColumns.slice(1))delete out[column];
 return out;
}
