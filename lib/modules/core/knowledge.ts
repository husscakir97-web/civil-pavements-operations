import {z} from 'zod';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {exec,nowIso,one,query,tx,uuid,type Row,type Conn} from '@/lib/platform/sql';
import {conditionSetSchema,evaluateKnowledgeRule,knowledgeSummary,predicateSchema,type KnowledgeRuleForCheck} from '@/lib/platform/knowledge-rules';

const actor=()=>actorContext.getStore()!;
const text=(max:number)=>z.preprocess(v=>v===''?null:v,z.string().trim().max(max).nullable().optional());
const day=z.preprocess(v=>v===''?null:v,z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Use YYYY-MM-DD.').nullable().optional());

export const KNOWLEDGE_PACK_STATUSES=['draft','current','retired'] as const;
export const KNOWLEDGE_SOURCE_STATUSES=['draft','current','superseded','retired'] as const;
export const KNOWLEDGE_RULE_STATUSES=['draft','current','retired'] as const;
export const KNOWLEDGE_CONTEXTS=['organisation','project','tender','client','asset','asset_category'] as const;
export const KNOWLEDGE_SOURCE_TYPES=['public','licensed','legislation','authority','standard','contract','client','manufacturer','organisation','project'] as const;
export const KNOWLEDGE_SEVERITIES=['block','warning','advisory'] as const;
export const KNOWLEDGE_RULE_TYPES=['requirement','minimum','maximum','range','prohibited','advisory'] as const;

const packInput=z.object({
 packKey:z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/i,'Use letters, numbers, dots, dashes or underscores.'),
 name:z.string().trim().min(1).max(255),description:text(4000),discipline:text(80),jurisdiction:text(80),
 contextType:z.enum(KNOWLEDGE_CONTEXTS).default('organisation'),contextId:text(191),versionLabel:text(60),
});
const sourceInput=z.object({
 packId:z.string().max(191),title:z.string().trim().min(1).max(255),authority:text(180),
 sourceType:z.enum(KNOWLEDGE_SOURCE_TYPES),referenceCode:text(120),revisionLabel:text(80),jurisdiction:text(80),
 effectiveFrom:day,effectiveTo:day,sourceUrl:text(512),documentId:text(191),licenceNote:text(4000),
});
const ruleInput=z.object({
 packId:z.string().max(191),sourceId:z.string().max(191),ruleCode:z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/i),
 title:z.string().trim().min(1).max(255),discipline:text(80),topic:z.string().trim().min(1).max(120),
 ruleType:z.enum(KNOWLEDGE_RULE_TYPES),appliesWhen:conditionSetSchema,assertion:predicateSchema.nullable().optional(),
 severity:z.enum(KNOWLEDGE_SEVERITIES),message:z.string().trim().min(1).max(4000),sourceClause:text(120),sourcePage:text(60),
 effectiveFrom:day,effectiveTo:day,
});
const checkInput=z.object({
 context:z.record(z.string(),z.unknown()),topics:z.array(z.string().max(120)).max(50).optional(),
 scope:z.object({projectId:text(191),tenderId:text(191),clientId:text(191),assetId:text(191),assetCategory:text(191)}).default({}),
 onDate:day,
});

function viewer(){const a=actor();if(!can(a.role,'knowledge.view'))fail(403,'You are not authorised to view civil knowledge.');return a;}
function editor(){const a=actor();if(!can(a.role,'knowledge.edit'))fail(403,'You are not authorised to change controlled civil knowledge.');return a;}
const parseJson=<T>(value:unknown,fallback:T):T=>{try{return typeof value==='string'?JSON.parse(value) as T:(value as T)??fallback;}catch{return fallback;}};

export async function listKnowledge(packId?:string|null){
 const a=viewer();
 const packs=await query(`SELECT p.*,COUNT(DISTINCT s.id) source_count,COUNT(DISTINCT r.id) rule_count
  FROM knowledge_packs p
  LEFT JOIN knowledge_sources s ON s.organisation_id=p.organisation_id AND s.pack_id=p.id
  LEFT JOIN knowledge_rules r ON r.organisation_id=p.organisation_id AND r.pack_id=p.id
  WHERE p.organisation_id=? GROUP BY p.id ORDER BY p.status='current' DESC,p.name`,[a.organisationId]);
 if(!packId)return {packs,sources:[],rules:[]};
 const pack=packs.find(p=>p.id===packId);if(!pack)fail(404,'Knowledge pack not found.');
 const [sources,rules]=await Promise.all([
  query('SELECT * FROM knowledge_sources WHERE organisation_id=? AND pack_id=? ORDER BY status=\'current\' DESC,title',[a.organisationId,packId]),
  query(`SELECT r.*,s.title source_title,s.authority source_authority,s.reference_code source_reference_code,s.revision_label source_revision_label,
   s.jurisdiction source_jurisdiction,s.status source_status
   FROM knowledge_rules r JOIN knowledge_sources s ON s.organisation_id=r.organisation_id AND s.id=r.source_id
   WHERE r.organisation_id=? AND r.pack_id=? ORDER BY r.status='current' DESC,r.topic,r.title`,[a.organisationId,packId]),
 ]);
 return {packs,sources,rules:rules.map(r=>({...r,applies_when:parseJson(r.applies_when,{all:[],any:[]}),assertion:parseJson(r.assertion,null)}))};
}

export async function saveKnowledgePack(id:string|null,revision:number|null,raw:unknown){
 const a=editor(),v=packInput.parse(raw),now=nowIso();
 if(v.contextType!=='organisation'&&!v.contextId)fail(422,'Choose the project, tender, client or asset context for this pack.');
 if(v.contextType==='organisation')v.contextId=null;
 return tx(async conn=>{
  if(!id){
   id=uuid();
   await exec('INSERT INTO knowledge_packs (id,organisation_id,pack_key,name,description,discipline,jurisdiction,context_type,context_id,version_label,status,locked,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,\'draft\',0,1,?,?,?)',[id,a.organisationId,v.packKey,v.name,v.description??null,v.discipline??null,v.jurisdiction??null,v.contextType,v.contextId??null,v.versionLabel??null,a.userId,now,now],conn);
   await audit({event:'knowledge.pack.created',entityType:'knowledge_pack',entityId:id,summary:`Knowledge pack created: ${v.name}`,after:v},conn);
  }else{
   const current=await one('SELECT * FROM knowledge_packs WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);if(!current)fail(404,'Knowledge pack not found.');
   if(Number(current.locked))fail(409,'This knowledge pack is locked and cannot be edited.');
   if(revision!=null&&Number(current.revision)!==revision)fail(409,'This knowledge pack was changed by someone else. Refresh and retry.');
   await exec('UPDATE knowledge_packs SET pack_key=?,name=?,description=?,discipline=?,jurisdiction=?,context_type=?,context_id=?,version_label=?,status=IF(status=\'current\',\'draft\',status),revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[v.packKey,v.name,v.description??null,v.discipline??null,v.jurisdiction??null,v.contextType,v.contextId??null,v.versionLabel??null,now,a.organisationId,id],conn);
   await audit({event:'knowledge.pack.updated',entityType:'knowledge_pack',entityId:id,summary:`Knowledge pack updated: ${v.name}`,before:current,after:v},conn);
  }
  return {id};
 });
}

async function requirePack(packId:string,conn:Conn){
 const a=actor(),p=await one('SELECT * FROM knowledge_packs WHERE organisation_id=? AND id=?',[a.organisationId,packId],conn);if(!p)fail(404,'Knowledge pack not found.');if(Number(p.locked))fail(409,'This knowledge pack is locked.');return p;
}
export async function saveKnowledgeSource(id:string|null,revision:number|null,raw:unknown){
 const a=editor(),v=sourceInput.parse(raw),now=nowIso();
 if(v.effectiveFrom&&v.effectiveTo&&v.effectiveTo<v.effectiveFrom)fail(422,'Source effective-to date must be on or after effective-from.');
 if(!v.sourceUrl&&!v.documentId)fail(422,'Add either a source URL or a controlled document reference.');
 return tx(async conn=>{
  await requirePack(v.packId,conn);
  if(v.documentId&&!await one('SELECT id FROM documents WHERE organisation_id=? AND id=?',[a.organisationId,v.documentId],conn))fail(400,'Controlled source document not found.');
  if(!id){
   id=uuid();await exec('INSERT INTO knowledge_sources (id,organisation_id,pack_id,title,authority,source_type,reference_code,revision_label,jurisdiction,effective_from,effective_to,source_url,document_id,licence_note,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'draft\',1,?,?,?)',[id,a.organisationId,v.packId,v.title,v.authority??null,v.sourceType,v.referenceCode??null,v.revisionLabel??null,v.jurisdiction??null,v.effectiveFrom??null,v.effectiveTo??null,v.sourceUrl??null,v.documentId??null,v.licenceNote??null,a.userId,now,now],conn);
   await audit({event:'knowledge.source.created',entityType:'knowledge_source',entityId:id,summary:`Knowledge source created: ${v.title}`,after:v},conn);
  }else{
   const current=await one('SELECT * FROM knowledge_sources WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);if(!current)fail(404,'Knowledge source not found.');
   if(revision!=null&&Number(current.revision)!==revision)fail(409,'This knowledge source changed. Refresh and retry.');
   await exec('UPDATE knowledge_sources SET pack_id=?,title=?,authority=?,source_type=?,reference_code=?,revision_label=?,jurisdiction=?,effective_from=?,effective_to=?,source_url=?,document_id=?,licence_note=?,status=IF(status=\'current\',\'draft\',status),verified_by=NULL,verified_at=NULL,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[v.packId,v.title,v.authority??null,v.sourceType,v.referenceCode??null,v.revisionLabel??null,v.jurisdiction??null,v.effectiveFrom??null,v.effectiveTo??null,v.sourceUrl??null,v.documentId??null,v.licenceNote??null,now,a.organisationId,id],conn);
   await audit({event:'knowledge.source.updated',entityType:'knowledge_source',entityId:id,summary:`Knowledge source updated: ${v.title}`,before:current,after:v},conn);
  }return {id};
 });
}

export async function saveKnowledgeRule(id:string|null,revision:number|null,raw:unknown){
 const a=editor(),v=ruleInput.parse(raw),now=nowIso();
 if(v.effectiveFrom&&v.effectiveTo&&v.effectiveTo<v.effectiveFrom)fail(422,'Rule effective-to date must be on or after effective-from.');
 if(v.ruleType!=='advisory'&&!v.assertion)fail(422,'A requirement rule needs a deterministic assertion.');
 return tx(async conn=>{
  await requirePack(v.packId,conn);
  const source=await one('SELECT id,pack_id FROM knowledge_sources WHERE organisation_id=? AND id=?',[a.organisationId,v.sourceId],conn);if(!source||source.pack_id!==v.packId)fail(400,'Choose a source from this knowledge pack.');
  const applies=JSON.stringify(v.appliesWhen),assertion=v.assertion?JSON.stringify(v.assertion):null;
  if(!id){
   id=uuid();await exec('INSERT INTO knowledge_rules (id,organisation_id,pack_id,source_id,rule_code,title,discipline,topic,rule_type,applies_when,assertion,severity,message,source_clause,source_page,effective_from,effective_to,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'draft\',1,?,?,?)',[id,a.organisationId,v.packId,v.sourceId,v.ruleCode,v.title,v.discipline??null,v.topic,v.ruleType,applies,assertion,v.severity,v.message,v.sourceClause??null,v.sourcePage??null,v.effectiveFrom??null,v.effectiveTo??null,a.userId,now,now],conn);
   await audit({event:'knowledge.rule.created',entityType:'knowledge_rule',entityId:id,summary:`Knowledge rule created: ${v.title}`,after:v},conn);
  }else{
   const current=await one('SELECT * FROM knowledge_rules WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);if(!current)fail(404,'Knowledge rule not found.');
   if(revision!=null&&Number(current.revision)!==revision)fail(409,'This knowledge rule changed. Refresh and retry.');
   await exec('UPDATE knowledge_rules SET pack_id=?,source_id=?,rule_code=?,title=?,discipline=?,topic=?,rule_type=?,applies_when=?,assertion=?,severity=?,message=?,source_clause=?,source_page=?,effective_from=?,effective_to=?,status=IF(status=\'current\',\'draft\',status),revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[v.packId,v.sourceId,v.ruleCode,v.title,v.discipline??null,v.topic,v.ruleType,applies,assertion,v.severity,v.message,v.sourceClause??null,v.sourcePage??null,v.effectiveFrom??null,v.effectiveTo??null,now,a.organisationId,id],conn);
   await audit({event:'knowledge.rule.updated',entityType:'knowledge_rule',entityId:id,summary:`Knowledge rule updated: ${v.title}`,before:current,after:v},conn);
  }return {id};
 });
}

export async function transitionKnowledge(entity:'pack'|'source'|'rule',id:string,status:string){
 const a=editor(),now=nowIso();
 const config=entity==='pack'?{table:'knowledge_packs',statuses:KNOWLEDGE_PACK_STATUSES,type:'knowledge_pack'}:entity==='source'?{table:'knowledge_sources',statuses:KNOWLEDGE_SOURCE_STATUSES,type:'knowledge_source'}:{table:'knowledge_rules',statuses:KNOWLEDGE_RULE_STATUSES,type:'knowledge_rule'};
 if(!(config.statuses as readonly string[]).includes(status))fail(400,'Invalid knowledge status.');
 return tx(async conn=>{
  const current=await one(`SELECT * FROM ${config.table} WHERE organisation_id=? AND id=? FOR UPDATE`,[a.organisationId,id],conn);if(!current)fail(404,'Knowledge record not found.');
  if(entity==='pack'&&Number(current.locked))fail(409,'This knowledge pack is locked.');
  if(status==='current'){
   if(entity==='source'){
    if(!current.source_url&&!current.document_id)fail(422,'A current source must reference a URL or controlled document.');
   }else if(entity==='rule'){
    const source=await one('SELECT status FROM knowledge_sources WHERE organisation_id=? AND id=?',[a.organisationId,current.source_id],conn);if(source?.status!=='current')fail(422,'Make the governing source current before activating this rule.');
    const pack=await one('SELECT status FROM knowledge_packs WHERE organisation_id=? AND id=?',[a.organisationId,current.pack_id],conn);if(pack?.status!=='current')fail(422,'Make the knowledge pack current before activating this rule.');
   }else{
    const count=await one<{n:number}>('SELECT COUNT(*) n FROM knowledge_sources WHERE organisation_id=? AND pack_id=? AND status=\'current\'',[a.organisationId,id],conn);
    if(!Number(count?.n))fail(422,'A current knowledge pack needs at least one verified current source.');
   }
  }
  const verified=status==='current'&&entity==='source';
  await exec(`UPDATE ${config.table} SET status=?,revision=revision+1,updated_at=?${verified?',verified_by=?,verified_at=?':''} WHERE organisation_id=? AND id=?`,verified?[status,now,a.userId,now,a.organisationId,id]:[status,now,a.organisationId,id],conn);
  await audit({event:`knowledge.${entity}.status`,entityType:config.type,entityId:id,summary:`Knowledge ${entity} moved to ${status}`,before:{status:current.status},after:{status}},conn);
  return {id,status};
 });
}

const contextMatch=(pack:Row,scope:z.infer<typeof checkInput>['scope'])=>{
 if(pack.context_type==='organisation')return true;
 const key=pack.context_type==='project'?'projectId':pack.context_type==='tender'?'tenderId':pack.context_type==='client'?'clientId':pack.context_type==='asset'?'assetId':'assetCategory';
 return Boolean(pack.context_id&&(scope as Record<string,unknown>)[key]===pack.context_id);
};

export async function checkKnowledge(raw:unknown){
 const a=viewer(),v=checkInput.parse(raw),onDate=v.onDate||nowIso().slice(0,10);
 const rows=await query(`SELECT r.*,p.context_type,p.context_id,p.name pack_name,
  s.title source_title,s.authority source_authority,s.reference_code source_reference_code,s.revision_label source_revision_label,
  s.jurisdiction source_jurisdiction,s.effective_from source_effective_from,s.effective_to source_effective_to
  FROM knowledge_rules r
  JOIN knowledge_packs p ON p.organisation_id=r.organisation_id AND p.id=r.pack_id
  JOIN knowledge_sources s ON s.organisation_id=r.organisation_id AND s.id=r.source_id
  WHERE r.organisation_id=? AND r.status='current' AND p.status='current' AND s.status='current'
  AND (r.effective_from IS NULL OR r.effective_from<=?) AND (r.effective_to IS NULL OR r.effective_to>=?)
  AND (s.effective_from IS NULL OR s.effective_from<=?) AND (s.effective_to IS NULL OR s.effective_to>=?)
  ORDER BY r.topic,r.title`,[a.organisationId,onDate,onDate,onDate,onDate]);
 const topics=new Set((v.topics||[]).map(x=>x.toLowerCase()));
 const rules:KnowledgeRuleForCheck[]=rows.filter(r=>contextMatch(r,v.scope)&&(!topics.size||topics.has(String(r.topic).toLowerCase()))).map(r=>({
  id:r.id,ruleCode:r.rule_code,title:r.title,topic:r.topic,ruleType:r.rule_type,
  appliesWhen:conditionSetSchema.parse(parseJson(r.applies_when,{all:[],any:[]})),
  assertion:r.assertion?predicateSchema.parse(parseJson(r.assertion,null)):null,
  severity:r.severity,message:r.message,
  source:{id:r.source_id,title:r.source_title,authority:r.source_authority,referenceCode:r.source_reference_code,revisionLabel:r.source_revision_label,jurisdiction:r.source_jurisdiction,sourceClause:r.source_clause,sourcePage:r.source_page,effectiveFrom:r.source_effective_from,effectiveTo:r.source_effective_to},
 }));
 const results=rules.map(r=>evaluateKnowledgeRule(r,v.context)).filter(r=>r.applicability!=='not_applicable');
 return {onDate,summary:knowledgeSummary(results),results};
}
