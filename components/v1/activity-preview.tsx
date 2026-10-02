'use client';
import {activityPreview, previewNumber} from '@/lib/seams/activity-preview';
import {Btn,Field,field} from './kit';

export function ActivityPreview({quantity,unit,productionPerDay,calendarDays,writable,onApply,hours,rate,basis,canViewCosts,onChange}:{quantity:string|number;unit:string;productionPerDay:string|number;calendarDays:number;writable:boolean;onApply:(days:number)=>void;hours:string;rate:string;basis:'unit'|'hour';canViewCosts:boolean;onChange:(key:'productiveHoursPerDay'|'directCostRate'|'costRateBasis',value:string)=>void}) {
 const result=activityPreview({quantity:previewNumber(quantity),unit,productionPerDay:previewNumber(productionPerDay),productiveHoursPerDay:previewNumber(hours),rate:previewNumber(rate),rateBasis:basis});
 const number=(n:number|null)=>n===null?'Unknown':n.toLocaleString('en-AU',{maximumFractionDigits:2});
 return <section aria-label="Activity production preview" className="grid gap-3 rounded-lg border bg-slate-50 p-3 sm:col-span-2">
  <div><h3 className="font-semibold">Production & direct cost preview</h3><p className="text-xs text-slate-600">Assumptions are saved with this activity. Close without saving to discard changes. Approved estimate baselines are not changed.</p></div>
  <div className="grid gap-3 sm:grid-cols-2">
   <Field label="Productive hours per working day"><input className={field} type="number" min="0" max="24" step="0.01" disabled={!writable} value={hours} onChange={e=>onChange('productiveHoursPerDay',e.target.value)}/></Field>
   {canViewCosts&&<><Field label="Direct cost rate (AUD)"><input className={field} type="number" min="0" step="0.01" disabled={!writable} value={rate} onChange={e=>onChange('directCostRate',e.target.value)}/></Field>
   <Field label="Rate basis"><select className={field} disabled={!writable} value={basis} onChange={e=>onChange('costRateBasis',e.target.value)}><option value="hour">Per productive activity hour</option><option value="unit">Per quantity unit ({unit||'unit missing'})</option></select></Field></>}
  </div>
  <div role="status" aria-live="polite" aria-atomic="true" className="space-y-1 text-sm">
   <p>Working days: <strong>{number(result.workingDays)}</strong> · Productive activity hours: <strong>{number(result.productiveHours)}</strong></p>
   {canViewCosts?<p>Planned direct cost: <strong>{result.directCost===null?'Unknown':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(result.directCost)}</strong></p>:<p>Cost preview requires financial access. Saved rates are preserved.</p>}
   <p>Calendar duration to save: <strong>{calendarDays} days</strong></p>
   {result.missing.length>0&&<ul className="list-disc pl-5 text-amber-900">{result.missing.filter(m=>canViewCosts||!m.includes('direct cost rate')).map(m=><li key={m}>{m}</li>)}</ul>}
  </div>
  {writable&&<Btn type="button" variant="secondary" disabled={result.minimumCalendarDays===null||result.minimumCalendarDays>3650} onClick={()=>{if(result.minimumCalendarDays!==null)onApply(result.minimumCalendarDays);}}>Use {result.minimumCalendarDays??'…'} calendar days (work every day)</Btn>}
  <p className="text-xs text-slate-600">Working days are rounded up only when applied. Add non-working days to the calendar duration yourself. Hours are productive time, not elapsed shift time or total crew hours. Requirements are text, not allocated resources; availability has not been checked. Direct cost excludes overhead, contingency and margin. Approved baselines are unchanged.</p>
 </section>;
}
