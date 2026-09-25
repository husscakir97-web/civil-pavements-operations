'use client';
// Extensions to the existing estimating engine UI: discipline-neutral work
// items (labour, plant, material, subcontract, other) and the revision
// approval workflow (draft → review → approved → superseded).
import {Plus,Trash2} from 'lucide-react';
import type {Dispatch,SetStateAction} from 'react';
import {COST_CATEGORIES,itemAmount,itemHours,type EstimateData,type EstimateItem} from '@/lib/estimate-calculations';
import {api,useApi,useAction,useSession,StatusBadge,ErrorState,Loading,Btn,money,dateText,field} from './kit';

export function EstimateItemsEditor({form,setForm,disabled}:{form:EstimateData;setForm:Dispatch<SetStateAction<EstimateData>>;disabled?:boolean}){
 const items=form.items||[];
 const update=(i:number,patch:Partial<EstimateItem>)=>setForm(f=>({...f,items:(f.items||[]).map((it,j)=>j===i?{...it,...patch}:it)}));
 const add=()=>setForm(f=>({...f,items:[...(f.items||[]),{id:`item-${Date.now()}`,section:items.at(-1)?.section||'General',costCode:'',category:'labour',description:'',quantity:0,unit:'item',productivity:0,rateBasis:'unit',rate:0}]}));
 const total=items.reduce((n,i)=>n+itemAmount(i),0);
 return <section className="no-print rounded-xl border bg-white p-4 shadow-sm sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Work sections and priced items</h3><p className="mt-1 text-sm text-slate-500">Any discipline: quantity × rate, or hours × rate where hours = quantity ÷ productivity. Items are included in direct cost.</p></div>
   <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.includePaving!==false} disabled={disabled} onChange={e=>setForm(f=>({...f,includePaving:e.target.checked}))}/>Include asphalt / paving quantity build-up</label></div>
  {items.length>0&&<div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-1 pr-2">Section</th><th className="pr-2">Cost code</th><th className="pr-2">Category</th><th className="pr-2">Description</th><th className="pr-2">Qty</th><th className="pr-2">Unit</th><th className="pr-2">Basis</th><th className="pr-2">Productivity /h</th><th className="pr-2">Hours</th><th className="pr-2">Rate</th><th className="pr-2 text-right">Amount</th><th/></tr></thead>
   <tbody>{items.map((it,i)=><tr key={it.id} className="align-top">
    <td className="py-1 pr-2"><input aria-label="Section" className={field} disabled={disabled} value={it.section} onChange={e=>update(i,{section:e.target.value})}/></td>
    <td className="pr-2"><input aria-label="Cost code" className={`${field} w-20`} disabled={disabled} value={it.costCode} onChange={e=>update(i,{costCode:e.target.value})}/></td>
    <td className="pr-2"><select aria-label="Category" className={field} disabled={disabled} value={it.category} onChange={e=>update(i,{category:e.target.value as EstimateItem['category']})}>{COST_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></td>
    <td className="pr-2"><input aria-label="Description" className={field} disabled={disabled} value={it.description} onChange={e=>update(i,{description:e.target.value})}/></td>
    <td className="pr-2"><input aria-label="Quantity" type="number" className={`${field} w-24`} disabled={disabled} value={it.quantity} onChange={e=>update(i,{quantity:Number(e.target.value)||0})}/></td>
    <td className="pr-2"><input aria-label="Unit" className={`${field} w-20`} disabled={disabled} value={it.unit} onChange={e=>update(i,{unit:e.target.value})}/></td>
    <td className="pr-2"><select aria-label="Rate basis" className={field} disabled={disabled} value={it.rateBasis} onChange={e=>update(i,{rateBasis:e.target.value as 'unit'|'hour'})}><option value="unit">per unit</option><option value="hour">per hour</option></select></td>
    <td className="pr-2"><input aria-label="Productivity" type="number" className={`${field} w-24`} disabled={disabled||it.rateBasis!=='hour'} value={it.productivity} onChange={e=>update(i,{productivity:Number(e.target.value)||0})}/></td>
    <td className="pr-2 pt-3 text-slate-600">{it.rateBasis==='hour'?itemHours(it).toFixed(1):'—'}</td>
    <td className="pr-2"><input aria-label="Rate" type="number" step="0.01" className={`${field} w-24`} disabled={disabled} value={it.rate} onChange={e=>update(i,{rate:Number(e.target.value)||0})}/></td>
    <td className="pr-2 pt-3 text-right font-medium">{money(itemAmount(it),true)}</td>
    <td>{!disabled&&<button aria-label="Remove item" className="p-2 text-slate-400 hover:text-red-600" onClick={()=>setForm(f=>({...f,items:(f.items||[]).filter((_,j)=>j!==i)}))}><Trash2 className="size-4"/></button>}</td>
   </tr>)}</tbody></table></div>}
  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">{!disabled&&<Btn variant="secondary" onClick={add}><Plus aria-hidden className="size-4"/>Add item</Btn>}<p className="text-sm">Items subtotal <strong>{money(total,true)}</strong></p></div>
 </section>;
}

type Revision={id:string;revisionNumber:number;status:string;submittedAt:string|null;approvedAt:string|null;decisionNotes:string|null;sellPrice?:number;directCost?:number;grossMarginPct?:number};
export function EstimateApprovalPanel({estimateId,onChanged,dirty}:{estimateId:string|null;onChanged?:()=>void;dirty?:boolean}){
 const {can}=useSession();
 const {data,error,loading,refresh}=useApi<{state:string;approvedRevisionId:string|null;awarded:boolean;revisions:Revision[]}>(estimateId?`/api/estimates/approval?estimateId=${estimateId}`:null);
 const {busy,error:actionError,run}=useAction();
 if(!estimateId)return <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">Save the estimate to start its approval workflow.</p>;
 if(loading&&!data)return <Loading/>;
 const act=(action:string,notes='')=>run(()=>api('/api/estimates/approval',{method:'POST',body:{estimateId,action,notes}}),()=>{refresh();onChanged?.();});
 return <section className="no-print rounded-xl border bg-white p-4 shadow-sm sm:p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-semibold">Estimate approval {data&&<StatusBadge machine="estimate" state={data.state}/>}</h3><p className="mt-1 text-sm text-slate-500">Approved revisions are frozen — including their rates. Editing after approval starts a new draft that must be approved again. Only an approved revision can be awarded.</p></div>
   <div className="flex flex-wrap gap-2">
    {data?.state!=='review'&&!data?.awarded&&can('estimate.edit')&&<Btn busy={busy} disabled={dirty} title={dirty?'Save your changes first':undefined} onClick={()=>void act('submit')}>Submit for review</Btn>}
    {data?.state==='review'&&can('estimate.approve')&&<><Btn busy={busy} onClick={()=>void act('approve',prompt('Approval notes (optional)')||'')}>Approve revision</Btn><Btn variant="danger" busy={busy} onClick={()=>{const n=prompt('What needs to change?');if(n)void act('reject',n);}}>Return for changes</Btn></>}
   </div></div>
  {dirty&&<p className="mt-2 text-xs text-amber-700">You have unsaved changes. Save the estimate before submitting it for review.</p>}
  <div className="mt-3"><ErrorState error={error||actionError} onRetry={refresh}/></div>
  {data&&data.revisions.length>0&&<ul className="mt-3 divide-y text-sm">{data.revisions.map(r=><li key={r.id} className="flex flex-wrap items-center gap-3 py-2"><span className="font-medium">Revision {r.revisionNumber}</span><StatusBadge machine="estimate" state={r.status}/>{r.sellPrice!=null&&<span>{money(r.sellPrice)} sell · {r.grossMarginPct?.toFixed(1)}% margin</span>}<span className="text-xs text-slate-500">{r.approvedAt?`Approved ${dateText(r.approvedAt)}`:r.submittedAt?`Submitted ${dateText(r.submittedAt)}`:''}</span>{r.decisionNotes&&<span className="text-xs text-slate-500">“{r.decisionNotes}”</span>}</li>)}</ul>}
 </section>;
}
