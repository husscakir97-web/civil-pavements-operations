'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Plus} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,field,Section,Stat,money,pct,dateText,PageHeader} from './kit';
import {RegisterView} from './register-view';
import {allowedTransitions} from '@/lib/platform/workflow';
import {useNav} from './nav';
import {retention,gst,type Forecast} from '@/lib/platform/finance';

type Line={lineType:string;sourceId:string|null;description:string;contractValue:number|null;previousClaimed:number;remaining:number|null;docketVersion?:string};
type Retention={enabled:boolean;pct:number;cap:number|null;withheld:number;released:number;held:number};
type Claim={id:string;revision:number;number:number;period:string;status:string;grossAmount:number;retentionWithheld:number;retentionReleased:number;retentionReleaseReason:string|null;netAmount:number;gstOnNet:number;certifiedRetention:number|null;certifiedNet:number|null;certifiedAmount:number|null;variance:number|null;submittedAt:string|null;certifiedAt:string|null;lines:Array<Line&{contractValue:number;id:string;thisClaim:number;claimedToDate:number}>};
type Invoice={id:string;claimId:string|null;invoiceNumber:string;invoiceDate:string;dueDate:string|null;amountExGst:number;gst:number;total:number;status:string;paidAmount:number;outstanding:number};

const MoneyRow=({label,value,total,hint,tone}:{label:string;value:ReactNode;total?:boolean;hint?:string;tone?:string})=><div className={`flex items-baseline justify-between gap-3 py-1.5 text-sm ${total?'border-t border-slate-300 font-semibold':''}`}><span className={total?'':'text-slate-600'}>{label}{hint&&<span className="block text-xs font-normal text-slate-500">{hint}</span>}</span><span className={`tabular-nums ${tone||''}`}>{value}</span></div>;
const MoneyCard=({title,children}:{title:string;children:ReactNode})=><section aria-label={title} className="rounded-lg border bg-white p-3"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>{children}</section>;
/** The project's money as a story: contract, cost, revenue, result. Every figure comes from the forecast. */
export function ForecastSummary({f,budget,actual}:{f:Forecast;budget?:Record<string,number>|null;actual?:Record<string,number>}){
 const marginTone=f.forecastMarginPct==null?'':f.forecastMarginPct<0?'text-red-700':f.forecastMarginPct<5?'text-amber-700':'text-emerald-700';
 return <div className="grid gap-4">
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
   <MoneyCard title="Contract"><MoneyRow label="Original contract" value={money(f.originalContract)}/><MoneyRow label="+ Approved variations" value={money(f.approvedVariations)} hint={f.pendingVariations?`${money(f.pendingVariations)} pending, not included`:undefined}/><MoneyRow total label="= Current contract" value={money(f.currentContract)}/></MoneyCard>
   <MoneyCard title="Cost"><MoneyRow label="Original budget" value={money(f.originalBudget)}/><MoneyRow label="+ Approved budget change" value={money(f.approvedVariationCost)}/><MoneyRow total label="= Current budget" value={money(f.currentBudget)}/><div className="mt-2"/><MoneyRow label="Actual" value={money(f.actual)}/><MoneyRow label="Committed" value={money(f.committed)}/><MoneyRow label="Accrued" value={money(f.accrued)}/><MoneyRow total label="Forecast final cost" value={money(f.forecastFinalCost)} hint={`${money(f.costToComplete)} to complete`}/></MoneyCard>
   <MoneyCard title="Revenue"><MoneyRow label="Claimed" value={money(f.claimed)}/><MoneyRow label="Certified" value={money(f.certified)}/><MoneyRow label="Invoiced" value={money(f.invoiced)}/><MoneyRow label="Paid" value={money(f.paid)} hint={f.outstanding?`${money(f.outstanding)} outstanding`:undefined}/><MoneyRow total label="Unbilled work" value={money(f.unbilled)} hint={`Earned ${money(f.earnedRevenue)} · ${f.percentComplete}% complete by cost`}/></MoneyCard>
   <MoneyCard title="Result"><MoneyRow label="Forecast revenue" value={money(f.forecastRevenue)}/><MoneyRow label="− Forecast cost" value={money(f.forecastFinalCost)}/><MoneyRow total label="= Forecast profit" value={money(f.forecastProfit)} tone={f.forecastProfit<0?'text-red-700':''}/><MoneyRow total label="Forecast margin" value={pct(f.forecastMarginPct)} tone={marginTone}/></MoneyCard>
  </div>
  {budget&&actual&&<details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Budget vs actual by category</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Category</th><th>Budget</th><th>Actual</th><th>Variance</th></tr></thead><tbody className="divide-y">{Object.keys(budget).map(k=><tr key={k}><td className="py-2 capitalize">{k}</td><td>{money(budget[k])}</td><td>{money(actual[k]??0)}</td><td className={(actual[k]??0)>budget[k]?'text-red-700':''}>{money((actual[k]??0)-budget[k])}</td></tr>)}</tbody></table></div></details>}
  <p className="text-xs text-slate-500">Calculated from recorded baselines, approved variations, posted costs, claims and invoices. Forecast final cost = spend to date + remaining current budget.</p>
 </div>;
}

const PRESET_KEY='infrastruct.claimPreset';
/** Another tab (e.g. an approved docket in Delivery) can ask for a line to be pre-selected in the next claim. */
export function presetClaimLine(projectId:string,lineType:string,sourceId:string){try{sessionStorage.setItem(PRESET_KEY,JSON.stringify({projectId,key:`${lineType}:${sourceId}`}));}catch{/* storage unavailable: the user picks the line in the builder */}}
function takePreset(projectId:string){try{const raw=sessionStorage.getItem(PRESET_KEY);if(!raw)return null;sessionStorage.removeItem(PRESET_KEY);const v=JSON.parse(raw) as {projectId:string;key:string};return v.projectId===projectId?v.key:null;}catch{return null;}}

export function ProjectCommercial({projectId,closed,onChanged}:{projectId:string;closed:boolean;onChanged?:()=>void}){
 const [tick,setTick]=useState(0);const {can}=useSession();
 const {data,error,loading,refresh:reload}=useApi<{financials:{forecast:Forecast;hasBaseline:boolean;budgetByCategory:Record<string,number>|null;actualByCategory:Record<string,number>};estimateVsActual:EvA}>(`/api/projects/control?id=${projectId}`);
 const [claimState,setClaimState]=useState<{claimable:Line[];openClaim:boolean}>({claimable:[],openClaim:false});
 const [preset,setPreset]=useState<string|null>(()=>takePreset(projectId));
 // Variations and claims affect each other and the money spine: refresh all three together.
 const refresh=()=>{reload();setTick(t=>t+1);onChanged?.();};
 return <div className="grid gap-4">
  <Section title="Financial position" description={data&&!data.financials.hasBaseline?'This project has no baseline yet. Record one from Setup to enable budget comparisons.':undefined} actions={<Btn variant="ghost" onClick={refresh}>Refresh</Btn>}>
   <ErrorState error={error} onRetry={refresh}/>{loading&&!data?<Loading/>:data&&<ForecastSummary f={data.financials.forecast} budget={data.financials.budgetByCategory} actual={data.financials.actualByCategory}/>}
  </Section>
  <RegisterView register="variations" parentId={projectId} hideCreate={closed} onChanged={refresh} description="Approved variations increase the current contract value and budget, and can be claimed. The original baseline is never rewritten."
   rowActions={r=>{
    if(String(r.status)!=='approved'||closed||!can('claim.edit'))return null;
    const line=claimState.claimable.find(l=>l.lineType==='variation'&&l.sourceId===r.id);
    if(!line||(line.remaining??0)<=0)return <span className="text-xs text-slate-500">Fully claimed</span>;
    return <Btn variant="secondary" className="min-h-9 py-1" disabled={claimState.openClaim} title={claimState.openClaim?'Finish or delete the open claim first':undefined} onClick={()=>setPreset(`variation:${r.id}`)}>Include in next claim</Btn>;
   }}/>
  <ClaimsPanel key={tick} projectId={projectId} closed={closed} preset={preset} onPresetUsed={()=>setPreset(null)} onData={setClaimState} onChanged={()=>{reload();onChanged?.();}}/>
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

function ClaimsPanel({projectId,closed,onChanged,preset,onPresetUsed,onData}:{projectId:string;closed:boolean;onChanged:()=>void;preset?:string|null;onPresetUsed?:()=>void;onData?:(s:{claimable:Line[];openClaim:boolean})=>void}){
 const {can,role}=useSession();
 const {data,error,loading,refresh}=useApi<{claims:Claim[];invoices:Invoice[];claimable:Line[];retention:Retention}>(`/api/commercial/claims?projectId=${projectId}`);
 const [building,setBuilding]=useState(false);const {busy,error:actionError,run}=useAction();
 const [acting,setActing]=useState<{claimId:string;kind:'certify'|'invoice'|'payment'}|null>(null);
 const openClaim=Boolean(data?.claims.some(c=>['draft','internal_approval'].includes(c.status)));
 useEffect(()=>{if(data)onData?.({claimable:data.claimable,openClaim:data.claims.some(c=>['draft','internal_approval'].includes(c.status))});},[data,onData]);
 const showBuilder=(building||Boolean(preset))&&Boolean(data)&&!openClaim;
 const done=()=>{refresh();onChanged();};
 const post=(body:Record<string,unknown>)=>run(()=>api('/api/commercial/claims',{method:'POST',body}),done);
 return <Section title="Progress claims and invoices" description="Claim contract works, approved variations and approved dockets. A docket can only be claimed once." actions={!closed&&can('claim.edit')&&<Btn onClick={()=>setBuilding(true)} disabled={openClaim||!data?.claimable.length&&!(data?.retention.held)} title={openClaim?'Finish or delete the open claim before starting another.':!data?.claimable.length&&!(data?.retention.held)?'Nothing is claimable yet: approve variations or dockets, or record a baseline.':undefined}><Plus aria-hidden className="size-4"/>New claim</Btn>}>
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
     {['submitted','certified','invoiced','paid'].includes(c.status)&&<a className="text-sm underline" href={`/api/commercial/claims?claimId=${encodeURIComponent(c.id)}&projectId=${encodeURIComponent(projectId)}&revision=${c.revision}`}>Client review PDF (ex GST)</a>}
     {moves.map(t=><Btn key={t.to} variant="secondary" busy={busy} onClick={()=>void post({action:'transition',claimId:c.id,to:t.to})}>{t.label}</Btn>)}
     {c.status==='draft'&&can('claim.edit')&&<Btn variant="danger" busy={busy} onClick={()=>{if(confirm('Delete this draft claim? Dockets are released back to approved.'))void post({action:'delete',claimId:c.id});}}>Delete draft</Btn>}
     {c.status==='submitted'&&can('claim.approve')&&<Btn variant="secondary" busy={busy} onClick={()=>setActing({claimId:c.id,kind:'certify'})}>Record certification</Btn>}
     {c.status==='certified'&&can('invoice.manage')&&<Btn variant="secondary" busy={busy} onClick={()=>setActing({claimId:c.id,kind:'invoice'})}>Create invoice</Btn>}
    </div>
    {inv&&<div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-slate-50 p-2 text-sm"><span>Invoice {inv.invoiceNumber} · {dateText(inv.invoiceDate)} · {money(inv.total,true)} incl. {money(inv.gst,true)} GST</span><StatusBadge machine="invoice" state={inv.status}/><a className="text-sm underline" href={`/api/commercial/claims?invoiceId=${inv.id}`}>PDF</a>{inv.status!=='draft'&&<span className="text-xs text-slate-500">Paid {money(inv.paidAmount,true)} · outstanding {money(inv.outstanding,true)}</span>}
     {can('invoice.manage')&&inv.status==='draft'&&<Btn variant="secondary" busy={busy} onClick={()=>{if(confirm(`Issue invoice ${inv.invoiceNumber} for ${money(inv.total,true)}? Issued invoices cannot be edited.`))void post({action:'invoice-action',invoiceId:inv.id,invoiceAction:'issue'});}}>Issue invoice</Btn>}
     {can('invoice.manage')&&['issued','part_paid'].includes(inv.status)&&<Btn variant="secondary" busy={busy} onClick={()=>setActing({claimId:c.id,kind:'payment'})}>Record payment</Btn>}
    </div>}
   {acting?.claimId===c.id&&<ClaimActionForm kind={acting.kind} claim={c} invoice={inv} busy={busy} onCancel={()=>setActing(null)} onSubmit={body=>void post(body).then(r=>{if(r!==undefined)setActing(null);})}/>}
    </li>;})}</ul>}
  <Sheet open={showBuilder} onOpenChange={o=>{if(!o){setBuilding(false);onPresetUsed?.();}}}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">New progress claim</SheetTitle><SheetDescription className="sr-only">Build a claim</SheetDescription>{showBuilder&&data&&<ClaimBuilder projectId={projectId} lines={data.claimable} retention={data.retention} preset={preset||null} onDone={()=>{setBuilding(false);onPresetUsed?.();done();}}/>}</SheetContent></Sheet>
 </Section>;
}

/** Inline forms for certification, invoicing and payment (replacing browser prompts). */
function ClaimActionForm({kind,claim,invoice,busy,onCancel,onSubmit}:{kind:'certify'|'invoice'|'payment';claim:Claim;invoice?:Invoice;busy:boolean;onCancel:()=>void;onSubmit:(body:Record<string,unknown>)=>void}){
 const [v,setV]=useState<Record<string,string>>(():Record<string,string>=>{const today=new Date().toISOString().slice(0,10),in30=new Date(Date.now()+30*86400000).toISOString().slice(0,10);return kind==='certify'?{amount:String(claim.grossAmount),date:today}:kind==='invoice'?{number:'',date:today,due:in30}:{amount:String(invoice?.outstanding??''),date:today};});
 const set=(k:string)=>(e:{target:{value:string}})=>setV(x=>({...x,[k]:e.target.value}));
 const body=kind==='certify'?{action:'certify',claimId:claim.id,certifiedAmount:Number(v.amount),certifiedDate:v.date||null}:kind==='invoice'?{action:'invoice',claimId:claim.id,invoiceNumber:v.number.trim(),invoiceDate:v.date,dueDate:v.due||null}:{action:'invoice-action',invoiceId:invoice?.id,invoiceAction:'payment',amount:Number(v.amount),date:v.date};
 const valid=kind==='invoice'?Boolean(v.number.trim()):v.amount!==''&&Number(v.amount)>=0;
 return <form className="mt-3 grid gap-3 rounded-lg border border-slate-300 bg-white p-3 sm:grid-cols-3" onSubmit={e=>{e.preventDefault();if(valid)onSubmit(body);}}>
  {kind==='certify'&&<><Field label="Certified amount (ex GST)" hint={`Claimed ${money(claim.grossAmount,true)}`}><input className={field} type="number" step="0.01" min={0} required value={v.amount} onChange={set('amount')}/></Field><Field label="Certified on"><input className={field} type="date" value={v.date} onChange={set('date')}/></Field></>}
  {kind==='invoice'&&<><Field label="Invoice number" required><input className={field} required autoFocus value={v.number} onChange={set('number')}/></Field><Field label="Invoice date"><input className={field} type="date" value={v.date} onChange={set('date')}/></Field><Field label="Due date"><input className={field} type="date" value={v.due} onChange={set('due')}/></Field></>}
  {kind==='payment'&&<><Field label="Payment received (incl. GST)" hint={invoice?`Outstanding ${money(invoice.outstanding,true)}`:undefined}><input className={field} type="number" step="0.01" min={0} required value={v.amount} onChange={set('amount')}/></Field><Field label="Received on"><input className={field} type="date" value={v.date} onChange={set('date')}/></Field></>}
  <div className="flex items-end gap-2 sm:col-span-3"><Btn busy={busy} type="submit" disabled={!valid}>{kind==='certify'?'Record certification':kind==='invoice'?'Create invoice':'Record payment'}</Btn><Btn variant="secondary" type="button" onClick={onCancel}>Cancel</Btn></div>
 </form>;
}

const GROUPS:Array<[string,string]>=[['contract','Contract work'],['variation','Variations'],['docket','Dockets'],['other','Other']];
function ClaimBuilder({projectId,lines,retention:terms,preset,onDone}:{projectId:string;lines:Line[];retention:Retention;preset:string|null;onDone:()=>void}){
 const {busy,error,run}=useAction();
 const [release,setRelease]=useState(''),[reason,setReason]=useState('');
 const [period,setPeriod]=useState(new Date().toISOString().slice(0,7));
 const key=(l:Line)=>`${l.lineType}:${l.sourceId}`;
 const [amounts,setAmounts]=useState<Record<string,string>>(()=>{const l=lines.find(x=>key(x)===preset);return l&&l.lineType!=='docket'?{[key(l)]:String(l.remaining??'')}:{};});
 const [basis,setBasis]=useState<Record<string,{reference:string;confirmed:boolean}>>({});
 const gross=Math.round(lines.reduce((n,l)=>n+(Number(amounts[key(l)])||0),0)*100)/100;
 // Same deterministic functions the server uses; the saved claim is authoritative.
 const preview=(()=>{try{const ret=retention({enabled:terms.enabled,pct:terms.pct,cap:terms.cap},gross,terms.held,Number(release)||0);return {...ret,gst:gst(ret.net)};}catch(e){return {error:(e as Error).message};}})();
 const chosen=lines.filter(l=>Number(amounts[key(l)]));
 const billingIncomplete=chosen.some(l=>l.lineType==='docket'&&(!basis[key(l)]?.confirmed||(basis[key(l)]?.reference.trim().length??0)<10));
 const submit=(send:boolean)=>run(async()=>{
  const created=await api<{claimId:string}>('/api/commercial/claims',{method:'POST',body:{action:'create',projectId,period,lines:chosen.map(l=>({lineType:l.lineType,sourceId:l.sourceId,thisClaim:Number(amounts[key(l)]),...(l.lineType==='docket'?{billingBasis:{confirmed:basis[key(l)]?.confirmed===true,reference:basis[key(l)]?.reference||'',expectedUpdatedAt:l.docketVersion||''}}:{})})),retentionRelease:Number(release)?{amount:Number(release),reason}:null}});
  if(send)await api('/api/commercial/claims',{method:'POST',body:{action:'transition',claimId:created.claimId,to:'internal_approval'}});
 },onDone);
 const lineRow=(l:Line)=><li key={key(l)} className={`grid items-center gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[1fr_9rem] ${Number(amounts[key(l)])?'border-[#172633] bg-slate-50':''}`}><div><p className="font-medium">{l.description}</p><p className="text-xs text-slate-500">{l.lineType==='docket'?'Approved evidence - client charge required':`Value ${money(l.contractValue,true)} · claimed ${money(l.previousClaimed,true)} · remaining ${money(l.remaining,true)}`}</p></div>
  {l.lineType==='docket'?<div className="grid gap-2 sm:col-span-2">
   <p className="text-xs text-slate-600">Enter the separately agreed client charge. Supplier cost and docket approval do not establish billability.</p>
   <Field label="Agreed client charge (ex GST)"><input className={field} type="number" min="0.01" step="0.01" value={amounts[key(l)]||''} onChange={e=>{setAmounts(a=>({...a,[key(l)]:e.target.value}));setBasis(b=>({...b,[key(l)]:{reference:b[key(l)]?.reference||'',confirmed:false}}));}}/></Field>
   <Field label="Client agreement or contract rate reference"><input className={field} maxLength={200} value={basis[key(l)]?.reference||''} onChange={e=>setBasis(b=>({...b,[key(l)]:{reference:e.target.value,confirmed:false}}))}/></Field>
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={basis[key(l)]?.confirmed===true} onChange={e=>setBasis(b=>({...b,[key(l)]:{reference:b[key(l)]?.reference||'',confirmed:e.target.checked}}))}/>I confirm this separately agreed client charge excludes GST and is not copied from supplier cost.</label>
  </div>
  :<div className="flex items-center gap-1"><input aria-label={`Amount for ${l.description}`} className={field} type="number" step="0.01" max={l.remaining??undefined} value={amounts[key(l)]||''} onChange={e=>setAmounts(a=>({...a,[key(l)]:e.target.value}))}/>{(l.remaining??0)>0&&!amounts[key(l)]&&<button type="button" className="whitespace-nowrap text-xs underline" onClick={()=>setAmounts(a=>({...a,[key(l)]:String(l.remaining)}))}>All</button>}</div>}</li>;
 return <form className="grid gap-5 p-5" onSubmit={e=>{e.preventDefault();void submit(true);}}>
  <Field label="Claim period"><input className={field} type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></Field>
  <div className="grid gap-4"><h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Claimable work</h3>
   {GROUPS.map(([type,label])=>{const group=lines.filter(l=>l.lineType===type);return group.length?<section key={type} aria-label={label} className="grid gap-2"><h4 className="text-sm font-semibold">{label} <span className="font-normal text-slate-500">({group.length})</span></h4><ul className="grid gap-2">{group.map(lineRow)}</ul></section>:null;})}
   {!lines.length&&<EmptyState title="Nothing is claimable yet." detail="Approve variations or dockets, or record a baseline."/>}</div>
  {terms.held>0&&<fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Release retention (held {money(terms.held,true)})</legend>
   <Field label="Amount to release (ex GST)"><input className={field} type="number" min={0} step="0.01" max={terms.held} value={release} onChange={e=>setRelease(e.target.value)}/></Field>
   <Field label="Reason" required={Boolean(Number(release))}><input className={field} placeholder="Practical completion, end of defects period…" value={reason} onChange={e=>setReason(e.target.value)}/></Field></fieldset>}
  <section aria-label="This claim" className="rounded-lg border bg-slate-50 p-3 text-sm">
   <h3 className="mb-1 font-semibold">This claim · {chosen.length} line{chosen.length===1?'':'s'}</h3>
   {'error' in preview?<p className="text-red-700">{preview.error}</p>:<dl className="grid gap-1">
    <div className="flex justify-between"><dt>Gross (ex GST)</dt><dd className="tabular-nums">{money(preview.gross,true)}</dd></div>
    <div className="flex justify-between"><dt>Retention{terms.enabled?` (${terms.pct}%${terms.cap!=null?`, cap ${money(terms.cap,true)}`:''})`:' (not enabled)'}</dt><dd className="tabular-nums">{preview.withheld?`−${money(preview.withheld,true)}`:'—'}</dd></div>
    {preview.released>0&&<div className="flex justify-between"><dt>Retention released</dt><dd className="tabular-nums">+{money(preview.released,true)}</dd></div>}
    <div className="flex justify-between border-t pt-1 font-semibold"><dt>Net (ex GST)</dt><dd className="tabular-nums">{money(preview.net,true)}</dd></div>
    <div className="flex justify-between"><dt>GST</dt><dd className="tabular-nums">{money(preview.gst.gst,true)}</dd></div>
    <div className="flex justify-between font-semibold"><dt>Total incl. GST</dt><dd className="tabular-nums">{money(preview.gst.total,true)}</dd></div></dl>}
   <p className="mt-2 text-xs text-slate-500">Figures are confirmed when the claim is saved.</p>
  </section>
  <ErrorState error={error}/>
  <div className="flex flex-wrap gap-2"><Btn busy={busy} disabled={billingIncomplete||(!gross&&!Number(release))} type="submit">Submit for internal approval</Btn><Btn variant="secondary" busy={busy} type="button" disabled={billingIncomplete||(!gross&&!Number(release))} onClick={()=>void submit(false)}>Save as draft</Btn></div>
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
