'use client';
// Organisation onboarding (progressive, skippable) and the company profile it creates.
import {useState} from 'react';
import {Check} from 'lucide-react';
import {api,useApi,useAction,useSession,ErrorState,Loading,Btn,Field,FieldGroup,field,Section,PageHeader,dateText} from './kit';
import {BUSINESS_ACTIVITIES,REGIONS,WORKFORCE,PROJECT_SIZES,TENDERING,HSEQ_MATURITY,ESTIMATING,ONBOARDING_STEPS} from '@/lib/v1/onboarding';

type Profile=Record<string,unknown>&{completed?:boolean;onboarding_step?:number};
const listToText=(v:unknown)=>Array.isArray(v)?v.join('\n'):'';
const textToList=(v:string)=>v.split(/\n|,/).map(s=>s.trim()).filter(Boolean);

function Chips({options,value,onChange}:{options:readonly string[];value:string[];onChange:(v:string[])=>void}){
 return <div className="flex flex-wrap gap-2">{options.map(o=>{const on=value.includes(o);return <button type="button" key={o} aria-pressed={on} onClick={()=>onChange(on?value.filter(x=>x!==o):[...value,o])} className={`min-h-10 rounded-full border px-3 text-sm ${on?'border-orange-400 bg-orange-50 text-orange-900':'bg-white text-slate-700 hover:bg-slate-50'}`}>{on&&<Check aria-hidden className="mr-1 inline size-3.5"/>}{o}</button>;})}</div>;
}
function Choice({options,value,onChange}:{options:readonly string[];value:unknown;onChange:(v:string)=>void}){return <select className={field} value={String(value||'')} onChange={e=>onChange(e.target.value)}><option value="">Choose…</option>{options.map(o=><option key={o}>{o}</option>)}</select>;}

type Registry={status:'not-configured'|'invalid'|'not-found'|'error';message:string}|{status:'found';record:{abn:string;entityName:string;entityType:string;abnStatus:string;gstRegisteredFrom:string|null;businessNames:string[];lookedUpAt:string}};
/** Official ABN Register confirmation: look up, show what the register says, and only save when an admin confirms. */
function AbnVerify({abn,onVerified}:{abn:string;onVerified:()=>void}){
 const {busy,error,run}=useAction();const [reg,setReg]=useState<Registry|null>(null);
 return <div className="mb-4 grid gap-2 rounded-lg border bg-slate-50 p-3 text-sm">
  <div className="flex flex-wrap items-center gap-2"><span>Confirm this ABN against the Australian Business Register.</span><Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api<{registry:Registry}>(`/api/platform/abn?abn=${abn}&lookup=1`),r=>setReg(r.registry))}>Look up on the ABN Register</Btn></div>
  {reg&&reg.status!=='found'&&<p role="status" className={reg.status==='not-configured'?'text-slate-600':'text-red-700'}>{reg.message}</p>}
  {reg?.status==='found'&&<div className="grid gap-1 rounded border bg-white p-3"><p><strong>{reg.record.entityName}</strong> · {reg.record.entityType}</p><p>ABN status: {reg.record.abnStatus} · {reg.record.gstRegisteredFrom?`GST registered from ${dateText(reg.record.gstRegisteredFrom)}`:'Not registered for GST'}</p>{reg.record.businessNames.length>0&&<p className="text-xs text-slate-500">Business names: {reg.record.businessNames.join(', ')}</p>}<p className="text-xs text-slate-500">Source: ABN Lookup (abr.business.gov.au), retrieved {new Date(reg.record.lookedUpAt).toLocaleString('en-AU')}</p>
   <div className="flex gap-2"><Btn busy={busy} onClick={()=>void run(()=>api('/api/platform/abn',{method:'POST',body:{abn,useLegalName:true}}),onVerified)}>Confirm and use these details</Btn><Btn variant="ghost" onClick={()=>setReg(null)}>Not my business</Btn></div></div>}
  <ErrorState error={error}/>
 </div>;
}
function Step({step,draft,set,abn}:{step:number;draft:Profile;set:(k:string,v:unknown)=>void;abn:{valid:boolean|null;message:string}}){
 const t=(k:string)=>String(draft[k]??'');
 if(step===0)return <div className="grid gap-4 sm:grid-cols-2">
  <Field label="Legal business name" required><input className={field} value={t('legal_name')} onChange={e=>set('legal_name',e.target.value)} autoComplete="organization"/></Field>
  <Field label="Trading name"><input className={field} value={t('trading_name')} onChange={e=>set('trading_name',e.target.value)}/></Field>
  <Field label="ABN" hint={abn.message||'11 digits. We check the ATO checksum now; you can confirm it against the ABN Register from the company profile.'}><input className={field} inputMode="numeric" value={t('abn')} onChange={e=>set('abn',e.target.value)} aria-invalid={abn.valid===false}/></Field>
  <div/>
  <Field label="Registered address"><textarea className={`${field} min-h-20`} value={t('registered_address')} onChange={e=>set('registered_address',e.target.value)}/></Field>
  <Field label="Operating address"><textarea className={`${field} min-h-20`} value={t('operating_address')} onChange={e=>set('operating_address',e.target.value)}/></Field>
 </div>;
 if(step===1)return <div className="grid gap-5">
  <FieldGroup label="Business activities"><Chips options={BUSINESS_ACTIVITIES} value={(draft.business_activities as string[])||[]} onChange={v=>set('business_activities',v)}/></FieldGroup>
  <FieldGroup label="Operating regions"><Chips options={REGIONS} value={(draft.operating_regions as string[])||[]} onChange={v=>set('operating_regions',v)}/></FieldGroup>
  <Field label="Other disciplines" hint="One per line"><textarea className={`${field} min-h-20`} value={listToText(draft.disciplines)} onChange={e=>set('disciplines',textToList(e.target.value))}/></Field>
  <Field label="Key clients" hint="One per line"><textarea className={`${field} min-h-20`} value={listToText(draft.key_clients)} onChange={e=>set('key_clients',textToList(e.target.value))}/></Field>
 </div>;
 if(step===2)return <div className="grid gap-4 sm:grid-cols-2">
  <Field label="Workforce size"><Choice options={WORKFORCE} value={draft.workforce_size} onChange={v=>set('workforce_size',v)}/></Field>
  <Field label="Typical project size"><Choice options={PROJECT_SIZES} value={draft.typical_project_size} onChange={v=>set('typical_project_size',v)}/></Field>
  <Field label="Plant and equipment"><textarea className={`${field} min-h-24`} value={t('plant_summary')} onChange={e=>set('plant_summary',e.target.value)} placeholder="e.g. 2 × 20t excavators, 1 × profiler, 3 × tippers"/></Field>
  <Field label="Certifications held" hint="One per line. Certification is issued by external bodies."><textarea className={`${field} min-h-24`} value={listToText(draft.certifications)} onChange={e=>set('certifications',textToList(e.target.value))}/></Field>
 </div>;
 return <div className="grid gap-4 sm:grid-cols-3">
  <Field label="Tendering activity"><Choice options={TENDERING} value={draft.tendering_activity} onChange={v=>set('tendering_activity',v)}/></Field>
  <Field label="HSEQ maturity"><Choice options={HSEQ_MATURITY} value={draft.hseq_maturity} onChange={v=>set('hseq_maturity',v)}/></Field>
  <Field label="Estimating approach"><Choice options={ESTIMATING} value={draft.estimating_approach} onChange={v=>set('estimating_approach',v)}/></Field>
  <p className="text-xs leading-5 text-slate-500 sm:col-span-3">Infrastruct helps you operate systems aligned with ISO 9001, ISO 45001 and ISO 14001. It does not certify your business; certification remains with external bodies.</p>
 </div>;
}

function useAbn(value:string){
 const digits=value.replace(/\s/g,'');
 const {data}=useApi<{valid:boolean;message:string}>(digits.length===11?`/api/platform/abn?abn=${digits}`:null);
 return digits.length===0?{valid:null,message:''}:digits.length!==11?{valid:false,message:'An ABN has 11 digits.'}:{valid:data?.valid??null,message:data?.message||''};
}

export function Onboarding({onDone}:{onDone:()=>void}){
 const {data,error,loading,refresh}=useApi<{profile:Profile}>('/api/platform/onboarding');
 if(loading&&!data)return <Loading/>;
 if(error)return <ErrorState error={error} onRetry={refresh}/>;
 return <OnboardingForm key="form" initial={data!.profile} onDone={onDone}/>;
}
function OnboardingForm({initial,onDone}:{initial:Profile;onDone:()=>void}){
 const {refresh}=useSession();
 const [draft,setDraft]=useState<Profile>(initial),[step,setStep]=useState(Math.min(Number(initial.onboarding_step||0),3));
 const {busy,error,run}=useAction();const abn=useAbn(String(draft.abn||''));
 const set=(k:string,v:unknown)=>setDraft(d=>({...d,[k]:v}));
 const payload=(extra:Record<string,unknown>)=>{const p:Record<string,unknown>={...extra};for(const k of ['legal_name','trading_name','abn','registered_address','operating_address','business_activities','disciplines','operating_regions','workforce_size','typical_project_size','plant_summary','key_clients','certifications','tendering_activity','hseq_maturity','estimating_approach'])if(draft[k]!==undefined&&draft[k]!==null&&draft[k]!=='')p[k]=draft[k];return p;};
 const save=(next:number,complete=false)=>run(()=>api('/api/platform/onboarding',{method:'PUT',body:payload({onboarding_step:next,...(complete?{complete:true}:{})})}),async()=>{if(complete){await refresh();onDone();}else setStep(next);});
 return <div className="mx-auto max-w-3xl">
  <PageHeader title="Set up your organisation" subtitle="A few questions so Infrastruct fits the way you work. You can skip anything that is not critical and finish later in Admin → Company."/>
  <ol className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Onboarding steps">{ONBOARDING_STEPS.map((s,i)=><li key={s} className={`rounded-lg border px-3 py-2 text-xs ${i===step?'border-orange-400 bg-orange-50 font-semibold':i<step?'bg-emerald-50 text-emerald-800':'bg-white text-slate-500'}`}>{i+1}. {s}</li>)}</ol>
  <Section title={ONBOARDING_STEPS[step]}><Step step={step} draft={draft} set={set} abn={abn}/></Section>
  <div className="mt-4"><ErrorState error={error}/></div>
  <div className="mt-4 flex flex-wrap justify-between gap-2">
   <Btn variant="ghost" disabled={step===0||busy} onClick={()=>setStep(step-1)}>Back</Btn>
   <div className="flex flex-wrap gap-2">{step<3&&<Btn variant="secondary" busy={busy} onClick={()=>void save(step+1)}>Skip for now</Btn>}{step<3?<Btn busy={busy} disabled={step===0&&abn.valid===false} onClick={()=>void save(step+1)}>Save and continue</Btn>:<Btn busy={busy} onClick={()=>void save(4,true)}>Finish setup</Btn>}</div>
  </div>
 </div>;
}

export function CompanyProfile(){
 const {data,error,loading,refresh}=useApi<{profile:Profile;canEdit:boolean}>('/api/platform/onboarding');
 const [editing,setEditing]=useState(false);
 if(loading&&!data)return <Loading/>;
 if(error)return <ErrorState error={error} onRetry={refresh}/>;
 const p=data!.profile;
 if(editing)return <OnboardingForm initial={{...p,onboarding_step:0}} onDone={()=>{setEditing(false);refresh();}}/>;
 const row=(label:string,v:unknown)=><div className="grid gap-0.5 border-b py-2 text-sm sm:grid-cols-3"><dt className="text-slate-500">{label}</dt><dd className="sm:col-span-2">{Array.isArray(v)?(v.length?v.join(', '):<span className="text-slate-400">Not provided</span>):v?String(v):<span className="text-slate-400">Not provided</span>}</dd></div>;
 return <Section title="Company profile" description={p.completed?'Onboarding complete':'Onboarding not finished — complete the remaining steps when ready.'} actions={data!.canEdit&&<Btn variant="secondary" onClick={()=>setEditing(true)}>Edit profile</Btn>}>
  {Boolean(data!.canEdit&&p.abn&&p.abn_verification!=='abr-verified')&&<AbnVerify abn={String(p.abn)} onVerified={refresh}/>}
  <dl>{row('Legal name',p.legal_name)}{row('Trading name',p.trading_name)}{row('ABN',p.abn?`${String(p.abn).replace(/(\d{2})(\d{3})(\d{3})(\d{3})/,'$1 $2 $3 $4')} · checksum valid · ${p.abn_verification==='abr-verified'?`confirmed on the ABN Register${p.abn_lookup_at?` ${dateText(String(p.abn_lookup_at).slice(0,10))}`:''}: ${p.abn_entity_name||''}${p.abn_status?` (${p.abn_status})`:''}${p.gst_registered_from?`, GST registered from ${dateText(p.gst_registered_from)}`:', not registered for GST'}`:'not yet confirmed on the ABN Register'}`:null)}{row('Registered address',p.registered_address)}{row('Operating address',p.operating_address)}{row('Business activities',p.business_activities)}{row('Operating regions',p.operating_regions)}{row('Disciplines',p.disciplines)}{row('Workforce',p.workforce_size)}{row('Typical project size',p.typical_project_size)}{row('Plant and equipment',p.plant_summary)}{row('Key clients',p.key_clients)}{row('Certifications',p.certifications)}{row('Tendering activity',p.tendering_activity)}{row('HSEQ maturity',p.hseq_maturity)}{row('Estimating approach',p.estimating_approach)}</dl>
 </Section>;
}
