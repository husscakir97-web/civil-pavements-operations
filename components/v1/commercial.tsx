'use client';
import {useState} from 'react';
import {Plus} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,field,Section,Stat,money,pct,dateText,PageHeader} from './kit';
import {RegisterView} from './register-view';
import {allowedTransitions} from '@/lib/platform/workflow';
import {useNav} from './nav';
import type {Forecast} from '@/lib/platform/finance';

type Line={lineType:string;sourceId:string|null;description:string;contractValue:number;previousClaimed:number;remaining:number};
type Retention={enabled:boolean;pct:number;cap:number|null;withheld:number;released:number;held:number};
type Claim={id:string;number:number;period:string;status:string;grossAmount:number;retentionWithheld:number;retentionReleased:number;retentionReleaseReason:string|null;netAmount:number;gstOnNet:number;certifiedRetention:number|null;certifiedNet:number|null;certifiedAmount:number|null;variance:number|null;submittedAt:string|null;certifiedAt:string|null;lines:Array<Line&{id:string;thisClaim:number;claimedToDate:number}>};
type Invoice={id:string;claimId:string|null;invoiceNumber:string;invoiceDate:string;dueDate:string|null;amountExGst:number;gst:number;total:number;status:string;paidAmount:number;outstanding:number};

export function ForecastSummary({f,budget,actual}:{f:Forecast;budget?:Record<string,number>|null;actual?:Record<string,number>}){
 return <div className="grid gap-4">
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Original contract" value={money(f.originalContract)}/><Stat label="Approved variations" value={money(f.approvedVariations)} hint={f.pendingVariations?`${money(f.pendingVariations)} pending`:undefined}/><Stat label="Current contract value" value={money(f.currentContract)}/><Stat label="Forecast margin" value={pct(f.forecastMarginPct)} tone={f.forecastMarginPct==null?undefined:f.forecastMarginPct<0?'bad':f.forecastMarginPct<5?'warn':'good'} hint={`${money(f.forecastProfit)} profit`}/>
   <Stat label="Original budget" value={money(f.originalBudget)}/><Stat label="Current budget" value={money(f.currentBudget)}/><Stat label="Actual / committed / accrued" value={money(f.actual)} hint={`${money(f.committed)} committed · ${money(f.accrued)} accrued`}/><Stat label="Forecast final cost" value={money(f.forecastFinalCost)} hint={`${money(f.costToComplete)} to complete`}/>
   <Stat label="Claimed (ex GST)" value={money(f.claimed)} hint={`${money(f.certified)} certified`}/><Stat label="Invoiced" value={money(f.invoiced)} hint={`${money(f.paid)} paid · ${money(f.outstanding)} outstanding`}/><Stat label="Earned revenue" value={money(f.earnedRevenue)} hint={`${f.percentComplete}% complete by cost`}/><Stat label="Unbilled work" value={money(f.unbilled)} hint="Earned revenue less claimed"/></div>
  {budget&&actual&&<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Category</th><th>Budget</th><th>Actual</th><th>Variance</th></tr></thead><tbody className="divide-y">{Object.keys(budget).map(k=><tr key={k}><td className="py-2 capitalize">{k}</td><td>{money(budget[k])}</td><td>{money(actual[k]??0)}</td><td className={(actual[k]??0)>budget[k]?'text-red-700':''}>{money((actual[k]??0)-budget[k])}</td></tr>)}</tbody></table></div>}
  <p className="text-xs text-slate-500">All figures are calculated from recorded baselines, approved variations, posted costs, claims and invoices. Forecast final cost = spend to date + remaining current budget.</p>
 </div>;
}

export function ProjectCommercial({projectId,closed,onChanged}:{projectId:string;closed:boolean;onChanged?:()=>void}){
 const [tick,setTick]=useState(0);
 const {data,error,loading,refresh:reload}=useApi<{financials:{forecast:Forecast;hasBaseline:boolean;budgetByCategory:Record<string,number>|null;actualByCategory:Record<string,number>};estimateVsActual:EvA}>(`/api/projects/control?id=${projectId}`);
 // Variations and claims affect each other and the money spine: refresh all three together.
 const refresh=()=>{reload();setTick(t=>t+1);onChanged?.();};
 return <div className="grid gap-4">
  <Section title="Money spine" description={data&&!data.financials.hasBaseline?'This project has no baseline yet. Record one from Setup to enable budget comparisons.':undefined} actions={<Btn variant="secondary" onClick={refresh}>Refresh</Btn>}>
   <ErrorState error={error} onRetry={refresh}/>{loading&&!data?<Loading/>:data&&<ForecastSummary f={data.financials.forecast} budget={data.financials.budgetByCategory} actual={data.financials.actualByCategory}/>}
  </Section>
  <RegisterView register="variations" parentId={projectId} hideCreate={closed} onChanged={refresh} description="Approved variations increase the current contract value and budget. The original baseline is never rewritten."/>
  <ClaimsPanel key={tick} projectId={projectId} closed={closed} onChanged={()=>{reload();onChanged?.();}}/>
  {data&&<EstimateVsActualView eva={data.estimateVsActual}/>}
 </div>;
}

type EvA={available:boolean;categories:Array<{category:string;estimated:number|null;actual:number;variance:number|null;variancePct:number|null}>;cost:{estimated:number|null;actual:number;forecastFinal:number};labourHours:{estimated:number|null;actual:number|null;source:string};quantity:{estimated:number|null;actual:number|null;unit:string|null};margin:{tender:number|null;forecast:number|null};docketsCounted:number;fieldRecordsCounted:number};
export function EstimateVsActualView({eva}:{eva:EvA}){
 return <Section title="Estimate vs actual" description={`Deterministic comparison from ${eva.docketsCounted} approved docket(s) and ${eva.fieldRecordsCounted} submitted field record(s).`}>
  {!eva.available?<EmptyState title="No estimate baseline is linked to this project." detail="Projects created from an awarded estimate compare automatically."/>:<div className="grid gap-4">
   <div className="grid gap-3 sm:grid-cols-4"><Stat label="Estimated cost" value={money(eva.cost.estimated)}/><Stat label="Actual cost to date" value={money(eva.cost.actual)}/><Stat label="Labour hours (est. / actual)" value={`${eva.labourHours.estimated??'N/A'} / ${eva.labourHours.actual??'N/A'}`}/><Stat label="Margin (tender / forecast)" value={`${pct(eva.margin.tender)} / ${pct(eva.margin.forecast)}`}/></div>
   {eva.quantity.estimated!=null&&<p className="text-sm">Quantity: estimated {eva.quantity.estimated} {eva.quantity.unit} · recorded {eva.quantity.actual??'N/A'} {eva.quantity.unit}</p>}
   <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Category</th><th>Estimated</th><th>Actual</th><th>Variance</th></tr></thead><tbody className="divide-y">{eva.categories.map(c=><tr key={c.category}><td className="py-2 capitalize">{c.category}</td><td>{money(c.estimated)}</td><td>{money(c.actual)}</td><td>{c.variance==null?'N/A':`${money(c.variance)} (${pct(c.variancePct)})`}</td></tr>)}</tbody></table>
  </div>}
 </Section>;
}

function ClaimsPanel({projectId,closed,onChanged}:{projectId:string;closed:boolean;onChanged:()=>void}){
 const {can,role}=useSession();
 const {data,error,loading,refresh}=useApi<{claims:Claim[];invoices:Invoice[];claimable:Line[];retention:Retention}>(`/api/commercial/claims?projectId=${projectId}`);
 const [building,setBuilding]=useState(false);const {busy,error:actionError,run}=useAction();
 const done=()=>{refresh();onChanged();};
 const post=(body:Record<string,unknown>)=>run(()=>api('/api/commercial/claims',{method:'POST',body}),done);
 return <Section title="Progress claims and invoices" description="Claim contract works, approved variations and approved dockets. A docket can only be claimed once." actions={!closed&&can('claim.edit')&&<Btn onClick={()=>setBuilding(true)} disabled={!data?.claimable.length&&!(data?.retention.held)} title={!data?.claimable.length&&!(data?.retention.held)?'Nothing is claimable yet: approve variations or dockets, or record a baseline.':undefined}><Plus aria-hidden className="size-4"/>New claim</Btn>}>
  <ErrorState error={error||actionError} onRetry={refresh}/>
  {data&&<p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">{data.retention.enabled?<>Retention {data.retention.pct}%{data.retention.cap!=null?<> capped at {money(data.retention.cap,true)}</>:null} · withheld to date {money(data.retention.withheld,true)} · released {money(data.retention.released,true)} · <strong>held {money(data.retention.held,true)}</strong></>:<>Retention is not enabled for this project. Turn it on in Setup before the first claim if the contract withholds retention.{data.retention.held>0&&<> Retention held from earlier claims: <strong>{money(data.retention.held,true)}</strong>.</>}</>}</p>}
  {loading&&!data?<Loading/>:!data?.claims.length?<EmptyState title="No progress claims have been prepared for this project." detail={data?.claimable.length?`${data.claimable.length} line(s) are ready to claim.`:'Approve variations or dockets, or record a baseline, to create claimable lines.'}/>:
   <ul className="grid gap-3">{data.claims.map(c=>{const inv=data.invoices.find(i=>i.claimId===c.id);const moves=allowedTransitions('claim',c.status,role);return <li key={c.id} className="rounded-lg border p-3">
    <div className="flex flex-wrap items-center gap-2"><strong>Claim {c.number}</strong><span className="text-sm text-slate-500">{c.period}</span><StatusBadge machine="claim" state={c.status}/></div>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-6"><div><dt className="text-xs text-slate-500">Gross</dt><dd>{money(c.grossAmount,true)}</dd></div><div><dt className="text-xs text-slate-500">Retention</dt><dd>{c.retentionWithheld?`−${money(c.retentionWithheld,true)}`:'—'}</dd></div><div><dt className="text-xs text-slate-500">Release</dt><dd>{c.retentionReleased?`+${money(c.retentionReleased,true)}`:'—'}</dd></div><div><dt className="text-xs text-slate-500">Net (ex GST)</dt><dd className="font-semibold">{money(c.netAmount,true)}</dd></div><div><dt className="text-xs text-slate-500">GST</dt><dd>{money(c.gstOnNet,true)}</dd></div><div><dt className="text-xs text-slate-500">Net incl. GST</dt><dd>{money(c.netAmount+c.gstOnNet,true)}</dd></div>
     {c.certifiedAmount!=null&&<><div><dt className="text-xs text-slate-500">Certified gross</dt><dd>{money(c.certifiedAmount,true)}</dd></div><div><dt className="text-xs text-slate-500">Certified retention</dt><dd>{c.certifiedRetention?`−${money(c.certifiedRetention,true)}`:'—'}</dd></div><div><dt className="text-xs text-slate-500">Certified net</dt><dd className="font-semibold">{money(c.certifiedNet,true)}</dd></div><div className="col-span-2 sm:col-span-3"><dt className="text-xs text-slate-500">Variance to claimed gross</dt><dd>{money(c.variance,true)}</dd></div></>}</dl>
    {c.retentionReleaseReason&&<p className="mt-1 text-xs text-slate-500">Retention release: {c.retentionReleaseReason}</p>}
    <table className="mt-2 w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="py-1">Line</th><th>Value</th><th>Previous</th><th>This claim</th><th>To date</th><th>Remaining</th></tr></thead><tbody>{c.lines.map(l=><tr key={l.id}><td className="py-1 pr-2">{l.description}</td><td>{money(l.contractValue,true)}</td><td>{money(l.previousClaimed,true)}</td><td>{money(l.thisClaim,true)}</td><td>{money(l.claimedToDate,true)}</td><td>{money(l.contractValue-l.claimedToDate,true)}</td></tr>)}</tbody></table>
    <div className="mt-2 flex flex-wrap gap-2">
     {moves.map(t=><Btn key={t.to} variant="secondary" busy={busy} onClick={()=>void post({action:'transition',claimId:c.id,to:t.to})}>{t.label}</Btn>)}
     {c.status==='draft'&&can('claim.edit')&&<Btn variant="danger" busy={busy} onClick={()=>{if(confirm('Delete this draft claim? Dockets are released back to approved.'))void post({action:'delete',claimId:c.id});}}>Delete draft</Btn>}
     {c.status==='submitted'&&can('claim.approve')&&<Btn variant="secondary" busy={busy} onClick={()=>{const v=prompt('Certified amount (ex GST)',String(c.grossAmount));if(v!==null&&v!=='')void post({action:'certify',claimId:c.id,certifiedAmount:Number(v)});}}>Record certification</Btn>}
     {c.status==='certified'&&can('invoice.manage')&&<Btn variant="secondary" busy={busy} onClick={()=>{const n=prompt('Invoice number');if(n)void post({action:'invoice',claimId:c.id,invoiceNumber:n,invoiceDate:new Date().toISOString().slice(0,10),dueDate:new Date(Date.now()+30*86400000).toISOString().slice(0,10)});}}>Create invoice</Btn>}
    </div>
    {inv&&<div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-slate-50 p-2 text-sm"><span>Invoice {inv.invoiceNumber} · {dateText(inv.invoiceDate)} · {money(inv.total,true)} incl. {money(inv.gst,true)} GST</span><StatusBadge machine="invoice" state={inv.status}/><a className="text-sm underline" href={`/api/commercial/claims?invoiceId=${inv.id}`}>PDF</a>{inv.status!=='draft'&&<span className="text-xs text-slate-500">Paid {money(inv.paidAmount,true)} · outstanding {money(inv.outstanding,true)}</span>}
     {can('invoice.manage')&&inv.status==='draft'&&<Btn variant="secondary" busy={busy} onClick={()=>void post({action:'invoice-action',invoiceId:inv.id,invoiceAction:'issue'})}>Issue</Btn>}
     {can('invoice.manage')&&['issued','part_paid'].includes(inv.status)&&<Btn variant="secondary" busy={busy} onClick={()=>{const v=prompt('Payment received (incl. GST)',String(inv.outstanding));if(v)void post({action:'invoice-action',invoiceId:inv.id,invoiceAction:'payment',amount:Number(v),date:new Date().toISOString().slice(0,10)});}}>Record payment</Btn>}
    </div>}
   </li>;})}</ul>}
  <Sheet open={building} onOpenChange={setBuilding}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">New progress claim</SheetTitle><SheetDescription className="sr-only">Build a claim</SheetDescription>{building&&data&&<ClaimBuilder projectId={projectId} lines={data.claimable} retention={data.retention} onDone={()=>{setBuilding(false);done();}}/>}</SheetContent></Sheet>
 </Section>;
}

function ClaimBuilder({projectId,lines,retention,onDone}:{projectId:string;lines:Line[];retention:Retention;onDone:()=>void}){
 const {busy,error,run}=useAction();
 const [release,setRelease]=useState(''),[reason,setReason]=useState('');
 const [period,setPeriod]=useState(new Date().toISOString().slice(0,7));
 const [amounts,setAmounts]=useState<Record<string,string>>({});
 const key=(l:Line)=>`${l.lineType}:${l.sourceId}`;
 const total=lines.reduce((n,l)=>n+(Number(amounts[key(l)])||0),0);
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/commercial/claims',{method:'POST',body:{action:'create',projectId,period,lines:lines.filter(l=>Number(amounts[key(l)])).map(l=>({lineType:l.lineType,sourceId:l.sourceId,thisClaim:Number(amounts[key(l)])})),retentionRelease:Number(release)?{amount:Number(release),reason}:null}}),onDone);}}>
  <Field label="Claim period"><input className={field} type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></Field>
  <ul className="grid gap-2">{lines.map(l=><li key={key(l)} className="grid items-center gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[1fr_9rem]"><div><p className="font-medium">{l.description}</p><p className="text-xs text-slate-500">Value {money(l.contractValue,true)} · previously claimed {money(l.previousClaimed,true)} · remaining {money(l.remaining,true)}</p></div>
   {l.lineType==='docket'?<label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={Boolean(amounts[key(l)])} onChange={e=>setAmounts(a=>({...a,[key(l)]:e.target.checked?String(l.contractValue):''}))}/>Claim in full</label>:<input aria-label={`Amount for ${l.description}`} className={field} type="number" step="0.01" max={l.remaining} value={amounts[key(l)]||''} onChange={e=>setAmounts(a=>({...a,[key(l)]:e.target.value}))}/>}</li>)}</ul>
  {retention.held>0&&<fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Release retention (held {money(retention.held,true)})</legend>
   <Field label="Amount to release (ex GST)"><input className={field} type="number" min={0} step="0.01" max={retention.held} value={release} onChange={e=>setRelease(e.target.value)}/></Field>
   <Field label="Reason" required={Boolean(Number(release))}><input className={field} placeholder="Practical completion, end of defects period…" value={reason} onChange={e=>setReason(e.target.value)}/></Field></fieldset>}
  <p className="text-sm">This claim: <strong>{money(total,true)}</strong> gross (ex GST){retention.enabled&&total>0?<> · retention is calculated when the claim is saved at {retention.pct}%{retention.cap!=null?<>, capped at {money(retention.cap,true)} in total</>:null}</>:null}</p>
  <ErrorState error={error}/>
  <Btn className="justify-self-start" busy={busy} disabled={!total&&!Number(release)} type="submit">Create draft claim</Btn>
 </form>;
}

export function CommercialArea(){
 const {data,error,loading,refresh}=useApi<{projects:Array<Forecast&{id:string;name:string;projectNumber:string|null;clientName:string|null;stage:string;hasBaseline:boolean;retentionHeld:number}>}>('/api/commercial/portfolio');
 const {navigate}=useNav();
 return <div className="grid gap-4">
  <PageHeader title="Commercial" subtitle="Current contract value, cost, forecast and billing for every live project. Open a project to manage its variations, claims and invoices."/>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!data?.projects.length?<EmptyState title="No projects yet." detail="Projects are created when a tender or estimate is awarded."/>:
   <section className="surface overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Project</th><th>Stage</th><th>Current contract</th><th>Actual cost</th><th>Forecast final cost</th><th>Forecast margin</th><th>Claimed</th><th>Retention held</th><th>Unbilled</th></tr></thead>
    <tbody className="divide-y">{data.projects.map(p=><tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={()=>navigate('Projects',undefined,p.id,'commercial')}><td className="px-4 py-2.5"><span className="font-medium">{p.name}</span><span className="block text-xs text-slate-500">{[p.projectNumber,p.clientName].filter(Boolean).join(' · ')}{!p.hasBaseline&&' · no baseline'}</span></td><td><StatusBadge machine="project" state={p.stage}/></td><td>{money(p.currentContract)}</td><td>{money(p.actual)}</td><td>{money(p.forecastFinalCost)}</td><td className={p.forecastMarginPct!=null&&p.forecastMarginPct<0?'text-red-700':''}>{pct(p.forecastMarginPct)}</td><td>{money(p.claimed)}</td><td>{money(p.retentionHeld)}</td><td>{money(p.unbilled)}</td></tr>)}</tbody></table></section>}
 </div>;
}
