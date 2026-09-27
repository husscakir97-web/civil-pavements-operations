// The single AI orchestration service. Every AI call in the product goes through run().
//
// AI runs only when ALL of these hold (checked on every call, reported by availability()):
//   1. AI_ENABLED=true (an explicit operator switch; a provider key alone never enables AI);
//   2. provider credentials: AI_PROVIDER (anthropic|openai), AI_API_KEY and AI_MODEL;
//   3. the organisation is entitled to the `ai` module (active);
//   4. an organisation admin has switched AI on for the organisation (organisation_profiles.ai_enabled);
//   5. the person holds the capability the feature requires.
// Every call is recorded once in ai_usage_ledger by (organisation, idempotency key):
// a repeat returns the stored suggestions and never calls (or bills) the provider twice.
// Output is stored only as ai_suggestions with status `suggested`, linked to its source.
// Applying a suggestion is a separate, permissioned human action that writes Draft/Suggested
// records only (lib/modules/*/ai-apply code paths); AI never approves, issues or submits.
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from './context';
import {can,type Capability} from './permissions';
import {fail} from './http';
import {one,query,exec,tx,nowIso,uuid,type Row} from './sql';
import {getEntitlements} from './entitlements';

export type AiFeature='tender.requirements'|'tender.extract'|'response.draft'|'swms.assist'|'ims.draft';
export const AI_FEATURES:Record<AiFeature,{label:string;capability:Capability}>={
 'tender.requirements':{label:'Tender requirement suggestions',capability:'pipeline.edit'},
 'tender.extract':{label:'Tender document analysis',capability:'pipeline.edit'},
 'response.draft':{label:'Non-price response drafting',capability:'pipeline.edit'},
 'swms.assist':{label:'SWMS hazard and control suggestions',capability:'hseq.edit'},
 'ims.draft':{label:'IMS document drafting',capability:'library.edit'},
};

export type AiGate={key:'flag'|'credentials'|'entitlement'|'organisation'|'permission';ok:boolean;detail:string};
export function envGates(env:Record<string,string|undefined>=process.env):AiGate[]{
 const provider=env.AI_PROVIDER,ready=['anthropic','openai'].includes(provider||'')&&Boolean(env.AI_API_KEY)&&Boolean(env.AI_MODEL);
 return [
  {key:'flag',ok:env.AI_ENABLED==='true',detail:env.AI_ENABLED==='true'?'AI is switched on for this installation.':'AI is switched off for this installation (AI_ENABLED is not true).'},
  {key:'credentials',ok:ready,detail:ready?`Provider ${provider} configured.`:'No AI provider is configured (AI_PROVIDER, AI_API_KEY and AI_MODEL are required).'},
 ];
}
export const aiEnvReady=(env:Record<string,string|undefined>=process.env)=>envGates(env).every(g=>g.ok);

export async function availability(feature:AiFeature,conn?:PoolConnection){
 const a=actorContext.getStore()!;
 const gates=[...envGates()];
 const ent=(await getEntitlements(a.organisationId)).ai;
 gates.push({key:'entitlement',ok:ent==='active',detail:ent==='active'?'Your organisation is entitled to AI assistance.':'AI assistance is not part of your organisation\'s plan.'});
 const p=await one<{ai_enabled:number}>('SELECT ai_enabled FROM organisation_profiles WHERE organisation_id=?',[a.organisationId],conn);
 gates.push({key:'organisation',ok:Boolean(Number(p?.ai_enabled)),detail:Number(p?.ai_enabled)?'An administrator has switched AI on for your organisation.':'An administrator has not switched AI on for your organisation.'});
 const cap=AI_FEATURES[feature].capability;
 gates.push({key:'permission',ok:can(a.role,cap),detail:can(a.role,cap)?'You may use this feature.':'Your role cannot use this feature.'});
 return {feature,available:gates.every(g=>g.ok),gates};
}

// ------------------------------------------------------------------ providers
export type Completion={text:string;inputTokens:number;outputTokens:number;model:string};
export type AiProvider=(req:{system:string;prompt:string;maxTokens:number})=>Promise<Completion>;
export function providerFromEnv(env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch):AiProvider{
 const key=env.AI_API_KEY!,model=env.AI_MODEL!;
 const call=async(url:string,init:RequestInit)=>{
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60_000);
  try{const r=await fetcher(url,{...init,signal:abort.signal});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`Provider returned ${r.status}`);return body as Row;}
  finally{clearTimeout(timer);}
 };
 if(env.AI_PROVIDER==='anthropic')return async({system,prompt,maxTokens})=>{
  const b=await call(`${(env.AI_BASE_URL||'https://api.anthropic.com').replace(/\/$/,'')}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:maxTokens,system,messages:[{role:'user',content:prompt}]})});
  return {text:(b.content||[]).filter((c:Row)=>c.type==='text').map((c:Row)=>c.text).join(''),inputTokens:Number(b.usage?.input_tokens||0),outputTokens:Number(b.usage?.output_tokens||0),model:String(b.model||model)};
 };
 return async({system,prompt,maxTokens})=>{
  const b=await call(`${(env.AI_BASE_URL||'https://api.openai.com').replace(/\/$/,'')}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,max_tokens:maxTokens,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:prompt}]})});
  return {text:String(b.choices?.[0]?.message?.content||''),inputTokens:Number(b.usage?.prompt_tokens||0),outputTokens:Number(b.usage?.completion_tokens||0),model:String(b.model||model)};
 };
}

// ------------------------------------------------------------------ orchestration
export type SuggestionInput={field?:string|null;content:unknown;sourceDocumentId?:string|null;sourceLocation?:string|null;confidence?:number|null};
export type AiRunInput={feature:AiFeature;idempotencyKey:string;entityType:string;entityId:string;system:string;prompt:string;maxTokens?:number;
 /** Turns the model's text into source-linked suggestions; throw to reject malformed output. */
 parse:(text:string)=>SuggestionInput[]};
export type StoredSuggestion={id:string;field:string|null;content:unknown;sourceDocumentId:string|null;sourceLocation:string|null;confidence:number|null;extractedAt:string;status:string};

const presentSuggestion=(s:Row):StoredSuggestion=>({id:s.id,field:s.field,content:(()=>{try{return JSON.parse(s.content);}catch{return s.content;}})(),sourceDocumentId:s.source_document_id,sourceLocation:s.source_location,confidence:s.confidence==null?null:Number(s.confidence),extractedAt:s.extracted_at,status:s.status});
export async function suggestionsFor(entityType:string,entityId:string,feature?:AiFeature){
 const a=actorContext.getStore()!;
 return (await query(`SELECT * FROM ai_suggestions WHERE organisation_id=? AND entity_type=? AND entity_id=?${feature?' AND feature=?':''} ORDER BY created_at`,[a.organisationId,entityType,entityId,...(feature?[feature]:[])])).map(presentSuggestion);
}

export async function run(input:AiRunInput,provider?:AiProvider){
 const a=actorContext.getStore()!;
 const gate=await availability(input.feature);
 if(!gate.available)fail(403,gate.gates.filter(g=>!g.ok).map(g=>g.detail).join(' '),{code:'AI_UNAVAILABLE',gates:gate.gates});
 // Claim the idempotency key before calling the provider.
 const claimed=await tx(async conn=>{
  const existing=await one('SELECT * FROM ai_usage_ledger WHERE organisation_id=? AND idempotency_key=? FOR UPDATE',[a.organisationId,input.idempotencyKey],conn);
  if(existing&&existing.status==='completed')return {ledgerId:existing.id as string,replay:true};
  if(existing&&existing.status==='pending')fail(409,'This AI request is already running. Try again shortly.',{code:'AI_IN_PROGRESS'});
  const now=nowIso();
  if(existing){await exec("UPDATE ai_usage_ledger SET status='pending',error=NULL,requested_by=?,completed_at=NULL WHERE id=?",[a.userId,existing.id],conn);return {ledgerId:existing.id as string,replay:false};}
  const id=uuid();
  await exec("INSERT INTO ai_usage_ledger (id,organisation_id,idempotency_key,feature,provider,model,status,entity_type,entity_id,requested_by,created_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)",[id,a.organisationId,input.idempotencyKey,input.feature,process.env.AI_PROVIDER||'unknown',process.env.AI_MODEL||null,input.entityType,input.entityId,a.userId,now],conn);
  return {ledgerId:id,replay:false};
 });
 if(claimed.replay)return {ledgerId:claimed.ledgerId,replay:true,suggestions:(await query('SELECT * FROM ai_suggestions WHERE organisation_id=? AND ledger_id=? ORDER BY created_at',[a.organisationId,claimed.ledgerId])).map(presentSuggestion)};
 let completion:Completion,parsed:SuggestionInput[];
 try{
  completion=await (provider||providerFromEnv())({system:input.system,prompt:input.prompt,maxTokens:input.maxTokens||2000});
  parsed=input.parse(completion.text);
 }catch(e){
  await exec("UPDATE ai_usage_ledger SET status='failed',error=?,completed_at=? WHERE id=?",[String((e as Error).message||'AI request failed').slice(0,500),nowIso(),claimed.ledgerId]);
  fail(502,'The AI service could not complete this request. Nothing was changed; you can retry or continue manually.',{code:'AI_FAILED'});
 }
 return tx(async conn=>{
  const now=nowIso(),rows:StoredSuggestion[]=[];
  for(const s of parsed!.slice(0,200)){
   const id=uuid(),content=typeof s.content==='string'?s.content:JSON.stringify(s.content);
   const confidence=s.confidence==null||!Number.isFinite(Number(s.confidence))?null:Math.max(0,Math.min(1,Number(s.confidence)));
   await exec("INSERT INTO ai_suggestions (id,organisation_id,ledger_id,feature,entity_type,entity_id,field,content,source_document_id,source_location,confidence,extracted_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'suggested',?)",[id,a.organisationId,claimed.ledgerId,input.feature,input.entityType,input.entityId,s.field??null,content.slice(0,60000),s.sourceDocumentId??null,s.sourceLocation?String(s.sourceLocation).slice(0,120):null,confidence,now,now],conn);
   rows.push({id,field:s.field??null,content:s.content,sourceDocumentId:s.sourceDocumentId??null,sourceLocation:s.sourceLocation??null,confidence,extractedAt:now,status:'suggested'});
  }
  await exec("UPDATE ai_usage_ledger SET status='completed',model=?,input_tokens=?,output_tokens=?,completed_at=? WHERE id=?",[completion!.model,completion!.inputTokens,completion!.outputTokens,now,claimed.ledgerId],conn);
  return {ledgerId:claimed.ledgerId,replay:false,suggestions:rows};
 });
}

/** A person accepts or rejects a suggestion. `apply` writes the Draft/Suggested record inside the same transaction. */
export async function decide(id:string,decision:'accepted'|'rejected',apply?:(s:StoredSuggestion,conn:PoolConnection)=>Promise<string|null>){
 const a=actorContext.getStore()!;
 return tx(async conn=>{
  const s=await one("SELECT * FROM ai_suggestions WHERE organisation_id=? AND id=? FOR UPDATE",[a.organisationId,id],conn);
  if(!s)fail(404,'Suggestion not found.');
  if(s!.status!=='suggested')fail(409,'This suggestion has already been decided.');
  const cap=AI_FEATURES[s!.feature as AiFeature]?.capability;
  if(!cap||!can(a.role,cap))fail(403,'You are not authorised to act on this suggestion.');
  const applied=decision==='accepted'&&apply?await apply(presentSuggestion(s!),conn):null;
  await exec('UPDATE ai_suggestions SET status=?,decided_by=?,decided_at=?,applied_entity_id=? WHERE organisation_id=? AND id=?',[decision,a.userId,nowIso(),applied,a.organisationId,id],conn);
  return {id,status:decision,appliedEntityId:applied,suggestion:presentSuggestion(s!)};
 });
}

export async function usage(limit=50){
 const a=actorContext.getStore()!;
 return query('SELECT id,feature,provider,model,status,input_tokens,output_tokens,error,entity_type,entity_id,requested_by,created_at,completed_at FROM ai_usage_ledger WHERE organisation_id=? ORDER BY created_at DESC LIMIT ?',[a.organisationId,limit]);
}

/** Model output is untrusted: extract the first JSON object, never execute or follow it. */
export function jsonFrom(text:string):Row{
 const start=text.indexOf('{'),end=text.lastIndexOf('}');
 if(start<0||end<=start)throw new Error('The AI response did not contain JSON.');
 return JSON.parse(text.slice(start,end+1));
}
