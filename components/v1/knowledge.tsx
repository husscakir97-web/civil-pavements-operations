'use client';

import {useState,type FormEvent} from 'react';
import {Plus,TriangleAlert} from 'lucide-react';
import {api,Btn,EmptyState,ErrorState,Field,Loading,PageHeader,Pill,Section,field,useAction,useApi,useSession} from './kit';

type Pack={id:string;pack_key:string;name:string;description:string|null;discipline:string|null;jurisdiction:string|null;context_type:string;context_id:string|null;version_label:string|null;status:string;locked:number;revision:number;source_count:number;rule_count:number;origin?:'platform'|'organisation'};
type Source={id:string;pack_id:string;title:string;authority:string|null;source_type:string;reference_code:string|null;revision_label:string|null;jurisdiction:string|null;effective_from:string|null;effective_to:string|null;source_url:string|null;document_id:string|null;licence_note:string|null;status:string;revision:number;origin?:'platform'|'organisation'};
type Predicate={field:string;op:string;value?:unknown};
type Rule={id:string;pack_id:string;source_id:string;rule_code:string;title:string;discipline:string|null;topic:string;rule_type:string;applies_when:{all:Predicate[];any:Predicate[]};assertion:Predicate|null;severity:string;message:string;source_clause:string|null;source_page:string|null;effective_from:string|null;effective_to:string|null;status:string;revision:number;source_title:string;source_authority:string|null;source_reference_code:string|null;source_revision_label:string|null;source_status:string;origin?:'platform'|'organisation'};
type Data={packs:Pack[];sources:Source[];rules:Rule[]};

const OPS=['eq','neq','in','not_in','exists','not_exists','gt','gte','lt','lte','contains','between'];
const SOURCE_TYPES=['public','licensed','legislation','authority','standard','contract','client','manufacturer','organisation','project'];
const RULE_TYPES=['requirement','minimum','maximum','range','prohibited','advisory'];
const SEVERITIES=['block','warning','advisory'];
const CONTEXTS=['organisation','project','tender','client','asset','asset_category'];

const tone=(status:string)=>status==='current'?'success':status==='draft'?'warning':'neutral';
const titleCase=(s:string)=>s.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());
const parseValue=(raw:string,op:string):unknown=>{
 const value=raw.trim();
 if(['exists','not_exists'].includes(op))return undefined;
 if(['in','not_in','between'].includes(op))return value.split(',').map(x=>{const s=x.trim(),n=Number(s);return s!==''&&Number.isFinite(n)?n:s;});
 const n=Number(value);return value!==''&&Number.isFinite(n)?n:value;
};
const showValue=(v:unknown)=>Array.isArray(v)?v.join(', '):v==null?'':String(v);

export function KnowledgeAdmin(){
 const session=useSession();
 const [selected,setSelected]=useState<string|null>(null);
 const listState=useApi<Data>('/api/platform/knowledge');
 const effectiveSelected=selected||listState.data?.packs[0]?.id||null;
 const detailState=useApi<Data>(effectiveSelected?'/api/platform/knowledge?packId='+encodeURIComponent(effectiveSelected):null);
 const data=detailState.data||listState.data;
 const error=detailState.error||listState.error;
 const loading=(listState.loading&&!listState.data)||(Boolean(effectiveSelected)&&detailState.loading&&!detailState.data);
 const refresh=()=>{listState.refresh();detailState.refresh();};
 const active=data?.packs.find(p=>p.id===effectiveSelected)||null;
 return <div className="grid gap-4">
  <PageHeader title="Civil Knowledge" subtitle="Controlled, versioned rules with source provenance. Infrastruct validates against these rules; it does not invent standards." badges={<Pill>Core</Pill>}/>
  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
   <div className="flex gap-3"><TriangleAlert className="mt-0.5 size-5 shrink-0"/><div><p className="font-semibold">Authoritative content only</p><p className="mt-1 text-xs leading-5 text-amber-800">Do not copy copyrighted standards into Infrastruct unless your organisation has the right to do so. Record the source, revision and clause, then encode only the controlled requirement your organisation is authorised to use.</p></div></div>
  </div>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:<div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
   <Section title="Knowledge packs" description="Organisation or context-specific rule sets." actions={session.can('knowledge.edit')?<PackEditor onSaved={id=>{setSelected(id);refresh();}}/>:undefined}>
    {!data?.packs.length?<EmptyState title="No knowledge packs yet." detail="Create a pack, add an authoritative source, then add deterministic rules."/>:<div className="grid gap-2">{data.packs.map(p=><button key={p.id} onClick={()=>setSelected(p.id)} className={'rounded-xl border p-3 text-left '+(effectiveSelected===p.id?'border-orange-300 bg-orange-50':'bg-white hover:bg-slate-50')}><div className="flex items-start justify-between gap-2"><span className="font-semibold">{p.name}</span><span className="flex items-center gap-1.5">{p.origin==='platform'&&<Pill tone="info">Infrastruct</Pill>}<Pill tone={tone(p.status)}>{p.status}</Pill></span></div><p className="mt-1 text-xs text-slate-500">{[p.discipline,p.jurisdiction,p.version_label].filter(Boolean).join(' · ')||'General knowledge'}</p><p className="mt-2 text-[11px] text-slate-400">{p.source_count} source{Number(p.source_count)===1?'':'s'} · {p.rule_count} rule{Number(p.rule_count)===1?'':'s'}</p></button>)}</div>}
   </Section>
   {!active?<Section title="Knowledge pack"><EmptyState title="Choose or create a knowledge pack."/></Section>:<PackWorkspace pack={active} sources={data?.sources||[]} rules={data?.rules||[]} refresh={refresh}/>}
  </div>}
 </div>;
}

function PackEditor({pack,onSaved}:{pack?:Pack;onSaved:(id:string)=>void}){
 const [open,setOpen]=useState(false);
 const [v,setV]=useState(()=>({packKey:pack?.pack_key||'',name:pack?.name||'',description:pack?.description||'',discipline:pack?.discipline||'',jurisdiction:pack?.jurisdiction||'NSW',contextType:pack?.context_type||'organisation',contextId:pack?.context_id||'',versionLabel:pack?.version_label||''}));
 const {busy,error,run}=useAction();
 const save=(e:FormEvent)=>{e.preventDefault();void run(()=>api<{id:string}>('/api/platform/knowledge',{method:'POST',body:{action:'savePack',id:pack?.id||null,revision:pack?.revision??null,pack:v}}),r=>{setOpen(false);onSaved(r.id);});};
 if(!open)return <Btn variant={pack?'ghost':'secondary'} onClick={()=>setOpen(true)}>{pack?'Edit':'New pack'}</Btn>;
 return <form onSubmit={save} className="grid w-full gap-3 rounded-xl border bg-slate-50 p-3 sm:min-w-[520px] sm:grid-cols-2">
  <Field label="Pack key" required><input className={field} required value={v.packKey} onChange={e=>setV({...v,packKey:e.target.value})} placeholder="pavements-nsw"/></Field>
  <Field label="Name" required><input className={field} required value={v.name} onChange={e=>setV({...v,name:e.target.value})} placeholder="Pavements — NSW"/></Field>
  <Field label="Discipline"><input className={field} value={v.discipline} onChange={e=>setV({...v,discipline:e.target.value})} placeholder="Pavements"/></Field>
  <Field label="Jurisdiction"><input className={field} value={v.jurisdiction} onChange={e=>setV({...v,jurisdiction:e.target.value})} placeholder="NSW"/></Field>
  <Field label="Version label"><input className={field} value={v.versionLabel} onChange={e=>setV({...v,versionLabel:e.target.value})} placeholder="2026"/></Field>
  <Field label="Applies to"><select className={field} value={v.contextType} onChange={e=>setV({...v,contextType:e.target.value,contextId:e.target.value==='organisation'?'':v.contextId})}>{CONTEXTS.map(x=><option key={x} value={x}>{titleCase(x)}</option>)}</select></Field>
  {v.contextType!=='organisation'&&<Field label="Context ID" required><input className={field} required value={v.contextId} onChange={e=>setV({...v,contextId:e.target.value})} placeholder={v.contextType+' ID'}/></Field>}
  <Field label="Description"><textarea className={field+' min-h-20'} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field>
  {error&&<p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
  <div className="flex gap-2 sm:col-span-2"><Btn type="submit" busy={busy}>Save pack</Btn><Btn type="button" variant="ghost" onClick={()=>setOpen(false)}>Cancel</Btn></div>
 </form>;
}

function PackWorkspace({pack,sources,rules,refresh}:{pack:Pack;sources:Source[];rules:Rule[];refresh:()=>void}){
 const {can}=useSession();
 const editable=can('knowledge.edit')&&pack.origin!=='platform';
 const {busy,error,run}=useAction();
 const move=(entity:'pack'|'source'|'rule',id:string,status:string)=>void run(()=>api('/api/platform/knowledge',{method:'POST',body:{action:'transition',entity,id,status}}),refresh);
 return <div className="grid gap-4">
  <Section title={pack.name} description={pack.description||'Controlled civil knowledge pack.'} actions={<div className="flex flex-wrap gap-2">{editable&&<PackEditor pack={pack} onSaved={refresh}/>}<Pill tone={tone(pack.status)}>{pack.status}</Pill></div>}>
   <div className="grid gap-3 sm:grid-cols-4"><Info label="Key" value={pack.pack_key}/><Info label="Discipline" value={pack.discipline||'General'}/><Info label="Jurisdiction" value={pack.jurisdiction||'Any'}/><Info label="Context" value={pack.context_type+(pack.context_id?' · '+pack.context_id:'')}/></div>
   {editable&&<div className="mt-4 flex flex-wrap gap-2">{pack.status!=='current'&&<Btn busy={busy} onClick={()=>move('pack',pack.id,'current')}>Make current</Btn>}{pack.status==='current'&&<Btn variant="secondary" busy={busy} onClick={()=>move('pack',pack.id,'retired')}>Retire pack</Btn>}</div>}
   {error&&<p className="mt-3 text-sm text-red-700">{error}</p>}
  </Section>
  <Section title="Authoritative sources" description="A rule cannot become Current until its source is Current." actions={editable?<SourceEditor packId={pack.id} onSaved={refresh}/>:undefined}>
   {!sources.length?<EmptyState title="No sources in this pack." detail="Add a public, licensed, authority, contract, client, manufacturer or organisation source."/>:<div className="grid gap-2">{sources.map(s=><div key={s.id} className="rounded-xl border bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{s.title}</p><p className="mt-0.5 text-xs text-slate-500">{[s.authority,s.reference_code,s.revision_label,s.jurisdiction].filter(Boolean).join(' · ')||titleCase(s.source_type)}</p></div><div className="flex items-center gap-2"><Pill tone={tone(s.status)}>{s.status}</Pill>{editable&&<SourceEditor packId={pack.id} source={s} onSaved={refresh}/>}</div></div><p className="mt-2 text-xs text-slate-500">{s.source_url||s.document_id?<>Source: {s.source_url||'controlled document '+s.document_id}</>:'No source location recorded'}</p>{editable&&<div className="mt-3 flex gap-2">{s.status!=='current'&&<Btn variant="secondary" busy={busy} onClick={()=>move('source',s.id,'current')}>Verify & make current</Btn>}{s.status==='current'&&<Btn variant="ghost" busy={busy} onClick={()=>move('source',s.id,'superseded')}>Supersede</Btn>}</div>}</div>)}</div>}
  </Section>
  <Section title="Machine-readable rules" description="Rules are deterministic checks. The source clause stays attached to every result." actions={editable&&sources.length?<RuleEditor pack={pack} sources={sources} onSaved={refresh}/>:undefined}>
   {!rules.length?<EmptyState title="No rules in this pack." detail={sources.length?'Add the first controlled rule.':'Add a source before creating rules.'}/>:<div className="grid gap-2">{rules.map(r=><div key={r.id} className="rounded-xl border bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{r.title}</p><p className="mt-0.5 text-xs text-slate-500">{r.rule_code} · {r.topic} · {titleCase(r.rule_type)}</p></div><div className="flex items-center gap-2"><Pill tone={r.severity==='block'?'danger':r.severity==='warning'?'warning':'neutral'}>{r.severity}</Pill><Pill tone={tone(r.status)}>{r.status}</Pill>{editable&&<RuleEditor pack={pack} sources={sources} rule={r} onSaved={refresh}/>}</div></div><p className="mt-2 text-sm text-slate-700">{r.message}</p><p className="mt-2 text-xs text-slate-500">{[r.source_authority,r.source_reference_code,r.source_revision_label,r.source_clause&&'Clause '+r.source_clause,r.source_page&&'Page '+r.source_page].filter(Boolean).join(' · ')||r.source_title}</p>{editable&&<div className="mt-3 flex gap-2">{r.status!=='current'&&<Btn variant="secondary" busy={busy} onClick={()=>move('rule',r.id,'current')}>Make current</Btn>}{r.status==='current'&&<Btn variant="ghost" busy={busy} onClick={()=>move('rule',r.id,'retired')}>Retire</Btn>}</div>}</div>)}</div>}
  </Section>
 </div>;
}

function SourceEditor({packId,source,onSaved}:{packId:string;source?:Source;onSaved:()=>void}){
 const [open,setOpen]=useState(false);
 const [v,setV]=useState(()=>({packId,title:source?.title||'',authority:source?.authority||'',sourceType:source?.source_type||'authority',referenceCode:source?.reference_code||'',revisionLabel:source?.revision_label||'',jurisdiction:source?.jurisdiction||'NSW',effectiveFrom:source?.effective_from||'',effectiveTo:source?.effective_to||'',sourceUrl:source?.source_url||'',documentId:source?.document_id||'',licenceNote:source?.licence_note||''}));
 const {busy,error,run}=useAction();
 const save=(e:FormEvent)=>{e.preventDefault();void run(()=>api('/api/platform/knowledge',{method:'POST',body:{action:'saveSource',id:source?.id||null,revision:source?.revision??null,source:v}}),()=>{setOpen(false);onSaved();});};
 if(!open)return <Btn variant="ghost" onClick={()=>setOpen(true)}>{source?'Edit':'Add source'}</Btn>;
 return <form onSubmit={save} className="mt-3 grid gap-3 rounded-xl border bg-slate-50 p-3 sm:grid-cols-2">
  <Field label="Source title" required><input className={field} required value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field>
  <Field label="Authority / issuer"><input className={field} value={v.authority} onChange={e=>setV({...v,authority:e.target.value})} placeholder="TfNSW, Standards Australia, client…"/></Field>
  <Field label="Source type"><select className={field} value={v.sourceType} onChange={e=>setV({...v,sourceType:e.target.value})}>{SOURCE_TYPES.map(x=><option key={x} value={x}>{titleCase(x)}</option>)}</select></Field>
  <Field label="Reference code"><input className={field} value={v.referenceCode} onChange={e=>setV({...v,referenceCode:e.target.value})} placeholder="Specification / standard reference"/></Field>
  <Field label="Revision"><input className={field} value={v.revisionLabel} onChange={e=>setV({...v,revisionLabel:e.target.value})}/></Field>
  <Field label="Jurisdiction"><input className={field} value={v.jurisdiction} onChange={e=>setV({...v,jurisdiction:e.target.value})}/></Field>
  <Field label="Effective from"><input className={field} type="date" value={v.effectiveFrom} onChange={e=>setV({...v,effectiveFrom:e.target.value})}/></Field>
  <Field label="Effective to"><input className={field} type="date" value={v.effectiveTo} onChange={e=>setV({...v,effectiveTo:e.target.value})}/></Field>
  <Field label="Source URL"><input className={field} value={v.sourceUrl} onChange={e=>setV({...v,sourceUrl:e.target.value})} placeholder="https://…"/></Field>
  <Field label="Controlled document ID"><input className={field} value={v.documentId} onChange={e=>setV({...v,documentId:e.target.value})} placeholder="Optional document ID"/></Field>
  <Field label="Licence / use note"><textarea className={field+' min-h-20'} value={v.licenceNote} onChange={e=>setV({...v,licenceNote:e.target.value})}/></Field>
  {error&&<p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
  <div className="flex gap-2 sm:col-span-2"><Btn type="submit" busy={busy}>Save source</Btn><Btn type="button" variant="ghost" onClick={()=>setOpen(false)}>Cancel</Btn></div>
 </form>;
}

function RuleEditor({pack,sources,rule,onSaved}:{pack:Pack;sources:Source[];rule?:Rule;onSaved:()=>void}){
 const initialConditions=rule?.applies_when?.all?.length?rule.applies_when.all:[{field:'',op:'eq',value:''}];
 const [open,setOpen]=useState(false);
 const [conditions,setConditions]=useState(initialConditions.map(x=>({field:x.field,op:x.op,value:showValue(x.value)})));
 const [assertion,setAssertion]=useState(()=>({field:rule?.assertion?.field||'',op:rule?.assertion?.op||'gte',value:showValue(rule?.assertion?.value)}));
 const [v,setV]=useState(()=>({packId:pack.id,sourceId:rule?.source_id||sources.find(s=>s.status==='current')?.id||sources[0]?.id||'',ruleCode:rule?.rule_code||'',title:rule?.title||'',discipline:rule?.discipline||pack.discipline||'',topic:rule?.topic||'',ruleType:rule?.rule_type||'requirement',severity:rule?.severity||'warning',message:rule?.message||'',sourceClause:rule?.source_clause||'',sourcePage:rule?.source_page||'',effectiveFrom:rule?.effective_from||'',effectiveTo:rule?.effective_to||''}));
 const {busy,error,run}=useAction();
 const payload=()=>({...v,appliesWhen:{all:conditions.filter(x=>x.field.trim()).map(x=>({field:x.field.trim(),op:x.op,...(!['exists','not_exists'].includes(x.op)?{value:parseValue(x.value,x.op)}:{})})),any:[]},assertion:v.ruleType==='advisory'?null:{field:assertion.field.trim(),op:assertion.op,...(!['exists','not_exists'].includes(assertion.op)?{value:parseValue(assertion.value,assertion.op)}:{})}});
 const save=(e:FormEvent)=>{e.preventDefault();void run(()=>api('/api/platform/knowledge',{method:'POST',body:{action:'saveRule',id:rule?.id||null,revision:rule?.revision??null,rule:payload()}}),()=>{setOpen(false);onSaved();});};
 if(!open)return <Btn variant="ghost" onClick={()=>setOpen(true)}>{rule?'Edit':'Add rule'}</Btn>;
 return <form onSubmit={save} className="mt-3 grid gap-4 rounded-xl border bg-slate-50 p-3">
  <div className="grid gap-3 sm:grid-cols-3">
   <Field label="Rule code" required><input className={field} required value={v.ruleCode} onChange={e=>setV({...v,ruleCode:e.target.value})} placeholder="asphalt.ac14.min-depth"/></Field>
   <Field label="Title" required><input className={field} required value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field>
   <Field label="Topic" required><input className={field} required value={v.topic} onChange={e=>setV({...v,topic:e.target.value})} placeholder="asphalt"/></Field>
   <Field label="Source" required><select className={field} required value={v.sourceId} onChange={e=>setV({...v,sourceId:e.target.value})}>{sources.map(s=><option key={s.id} value={s.id}>{s.title} ({s.status})</option>)}</select></Field>
   <Field label="Rule type"><select className={field} value={v.ruleType} onChange={e=>setV({...v,ruleType:e.target.value})}>{RULE_TYPES.map(x=><option key={x} value={x}>{titleCase(x)}</option>)}</select></Field>
   <Field label="Severity"><select className={field} value={v.severity} onChange={e=>setV({...v,severity:e.target.value})}>{SEVERITIES.map(x=><option key={x} value={x}>{titleCase(x)}</option>)}</select></Field>
  </div>
  <div><div className="mb-2 flex items-center justify-between"><div><p className="text-sm font-semibold">Applies when</p><p className="text-xs text-slate-500">All conditions below must match. Dot paths can target structured inputs such as asphalt.mix or project.specification.</p></div><Btn type="button" variant="secondary" onClick={()=>setConditions(x=>[...x,{field:'',op:'eq',value:''}])}><Plus className="size-4"/>Condition</Btn></div>
   <div className="grid gap-2">{conditions.map((x,i)=><div key={i} className="grid gap-2 sm:grid-cols-[1fr_130px_1fr_auto]"><input aria-label="Condition field" className={field} value={x.field} onChange={e=>setConditions(rows=>rows.map((r,j)=>j===i?{...r,field:e.target.value}:r))} placeholder="asphalt.mix"/><select aria-label="Condition operator" className={field} value={x.op} onChange={e=>setConditions(rows=>rows.map((r,j)=>j===i?{...r,op:e.target.value}:r))}>{OPS.map(op=><option key={op}>{op}</option>)}</select><input aria-label="Condition value" className={field} disabled={['exists','not_exists'].includes(x.op)} value={x.value} onChange={e=>setConditions(rows=>rows.map((r,j)=>j===i?{...r,value:e.target.value}:r))} placeholder="AC14"/><Btn type="button" variant="ghost" onClick={()=>setConditions(rows=>rows.filter((_,j)=>j!==i))}>Remove</Btn></div>)}</div>
  </div>
  {v.ruleType!=='advisory'&&<div><p className="mb-2 text-sm font-semibold">Requirement / assertion</p><div className="grid gap-2 sm:grid-cols-[1fr_130px_1fr]"><input className={field} required value={assertion.field} onChange={e=>setAssertion({...assertion,field:e.target.value})} placeholder="asphalt.compactedDepthMm"/><select className={field} value={assertion.op} onChange={e=>setAssertion({...assertion,op:e.target.value})}>{OPS.map(op=><option key={op}>{op}</option>)}</select><input className={field} disabled={['exists','not_exists'].includes(assertion.op)} required={!['exists','not_exists'].includes(assertion.op)} value={assertion.value} onChange={e=>setAssertion({...assertion,value:e.target.value})} placeholder="40"/></div></div>}
  <div className="grid gap-3 sm:grid-cols-4">
   <Field label="Message" required><textarea className={field+' min-h-20'} required value={v.message} onChange={e=>setV({...v,message:e.target.value})} placeholder="Explain the controlled requirement without reproducing the source."/></Field>
   <Field label="Source clause"><input className={field} value={v.sourceClause} onChange={e=>setV({...v,sourceClause:e.target.value})}/></Field>
   <Field label="Source page"><input className={field} value={v.sourcePage} onChange={e=>setV({...v,sourcePage:e.target.value})}/></Field>
   <Field label="Discipline"><input className={field} value={v.discipline} onChange={e=>setV({...v,discipline:e.target.value})}/></Field>
   <Field label="Effective from"><input className={field} type="date" value={v.effectiveFrom} onChange={e=>setV({...v,effectiveFrom:e.target.value})}/></Field>
   <Field label="Effective to"><input className={field} type="date" value={v.effectiveTo} onChange={e=>setV({...v,effectiveTo:e.target.value})}/></Field>
  </div>
  {error&&<p className="text-sm text-red-700">{error}</p>}
  <div className="flex gap-2"><Btn type="submit" busy={busy}>Save rule</Btn><Btn type="button" variant="ghost" onClick={()=>setOpen(false)}>Cancel</Btn></div>
 </form>;
}

function Info({label,value}:{label:string;value:string}){return <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm font-medium text-slate-800">{value}</p></div>;}
