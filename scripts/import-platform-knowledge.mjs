import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';

const PLATFORM_ORG='__infrastruct_platform__';
const file=process.argv[2];
const activate=process.argv.includes('--activate');
if(!file)throw new Error('Usage: npm run knowledge:import-platform -- <pack.json> [--activate]');

const raw=JSON.parse(await fs.readFile(path.resolve(file),'utf8'));
if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Knowledge pack JSON must be an object.');
if(!raw.pack||typeof raw.pack!=='object')throw new Error('Missing pack object.');
if(!Array.isArray(raw.sources)||!raw.sources.length)throw new Error('At least one authoritative source is required.');
if(!Array.isArray(raw.rules))throw new Error('rules must be an array.');
if(activate&&raw.verified!==true)throw new Error('Refusing to activate: pack JSON must contain "verified": true.');
for(const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'])if(!process.env[key])throw new Error('Missing '+key);

const pool=mysql.createPool({
 host:process.env.MYSQL_HOST,
 port:Number(process.env.MYSQL_PORT||3306),
 database:process.env.MYSQL_DATABASE,
 user:process.env.MYSQL_USER,
 password:process.env.MYSQL_PASSWORD,
 charset:'utf8mb4',
 connectionLimit:2,
 ssl:process.env.MYSQL_SSL_CA?{ca:process.env.MYSQL_SSL_CA,rejectUnauthorized:true}:undefined,
});
const conn=await pool.getConnection();
const now=new Date().toISOString();
const day=/^\d{4}-\d{2}-\d{2}$/;
const req=(v,name)=>{if(typeof v!=='string'||!v.trim())throw new Error('Missing '+name);return v.trim();};
const opt=v=>typeof v==='string'&&v.trim()?v.trim():null;
const validDate=(v,name)=>{const x=opt(v);if(x&&!day.test(x))throw new Error(name+' must be YYYY-MM-DD');return x;};
const enumOf=(v,name,values)=>{if(!values.includes(v))throw new Error(name+' must be one of '+values.join(', '));return v;};
const sourceTypes=['public','licensed','legislation','authority','standard','contract','client','manufacturer','organisation','project'];
const severities=['block','warning','advisory'];
const ruleTypes=['requirement','minimum','maximum','range','prohibited','advisory'];
const ops=['eq','neq','in','not_in','exists','not_exists','gt','gte','lt','lte','contains','between'];
const contextTypes=['organisation','project','tender','client','asset','asset_category'];
const validatePredicate=(p,name)=>{
 if(!p||typeof p!=='object'||Array.isArray(p))throw new Error(name+' must be an object');
 req(p.field,name+'.field');enumOf(p.op,name+'.op',ops);
 if(!['exists','not_exists'].includes(p.op)&&!('value' in p))throw new Error(name+'.value is required for '+p.op);
 return p;
};
const validateConditions=(c,name)=>{
 const x=c&&typeof c==='object'&&!Array.isArray(c)?c:{all:[],any:[]};
 const all=Array.isArray(x.all)?x.all:[],any=Array.isArray(x.any)?x.any:[];
 all.forEach((p,i)=>validatePredicate(p,name+'.all['+i+']'));any.forEach((p,i)=>validatePredicate(p,name+'.any['+i+']'));
 return {all,any};
};

await conn.beginTransaction();
try{
 const packKey=req(raw.pack.packKey,'pack.packKey');
 const contextType=enumOf(raw.pack.contextType||'organisation','pack.contextType',contextTypes);
 const contextId=contextType==='organisation'?null:opt(raw.pack.contextId);
 if(contextType!=='organisation'&&!contextId)throw new Error('pack.contextId is required for '+contextType);
 const desiredStatus=activate?'current':'draft';
 const [[existingPack]]=await conn.execute('SELECT id FROM knowledge_packs WHERE organisation_id=? AND pack_key=? FOR UPDATE',[PLATFORM_ORG,packKey]);
 const packId=existingPack?.id||randomUUID();
 if(existingPack){
  await conn.execute(`UPDATE knowledge_packs SET name=?,description=?,discipline=?,jurisdiction=?,context_type=?,context_id=?,version_label=?,status=?,locked=1,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[
   req(raw.pack.name,'pack.name'),opt(raw.pack.description),opt(raw.pack.discipline),opt(raw.pack.jurisdiction),contextType,contextId,opt(raw.pack.versionLabel),desiredStatus,now,PLATFORM_ORG,packId,
  ]);
 }else{
  await conn.execute(`INSERT INTO knowledge_packs (id,organisation_id,pack_key,name,description,discipline,jurisdiction,context_type,context_id,version_label,status,locked,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1,'platform-import',?,?)`,[
   packId,PLATFORM_ORG,packKey,req(raw.pack.name,'pack.name'),opt(raw.pack.description),opt(raw.pack.discipline),opt(raw.pack.jurisdiction),contextType,contextId,opt(raw.pack.versionLabel),desiredStatus,now,now,
  ]);
 }

 const sourceIds=new Map();
 for(const [index,s] of raw.sources.entries()){
  const sourceKey=req(s.key,'sources['+index+'].key');
  const referenceCode=opt(s.referenceCode);
  const sourceType=enumOf(s.sourceType,'sources['+index+'].sourceType',sourceTypes);
  const sourceUrl=opt(s.sourceUrl),documentId=opt(s.documentId);
  if(!sourceUrl&&!documentId)throw new Error('sources['+index+'] requires sourceUrl or documentId');
  const effectiveFrom=validDate(s.effectiveFrom,'sources['+index+'].effectiveFrom'),effectiveTo=validDate(s.effectiveTo,'sources['+index+'].effectiveTo');
  if(effectiveFrom&&effectiveTo&&effectiveTo<effectiveFrom)throw new Error('sources['+index+'] effectiveTo is before effectiveFrom');
  const [[found]]=await conn.execute('SELECT id FROM knowledge_sources WHERE organisation_id=? AND pack_id=? AND (reference_code=? OR title=?) ORDER BY id LIMIT 1',[PLATFORM_ORG,packId,referenceCode,req(s.title,'sources['+index+'].title')]);
  const id=found?.id||randomUUID();sourceIds.set(sourceKey,id);
  if(found){
   await conn.execute(`UPDATE knowledge_sources SET title=?,authority=?,source_type=?,reference_code=?,revision_label=?,jurisdiction=?,effective_from=?,effective_to=?,source_url=?,document_id=?,licence_note=?,status=?,verified_by=?,verified_at=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[
    req(s.title,'sources['+index+'].title'),opt(s.authority),sourceType,referenceCode,opt(s.revisionLabel),opt(s.jurisdiction),effectiveFrom,effectiveTo,sourceUrl,documentId,opt(s.licenceNote),desiredStatus,activate?'platform-import':null,activate?now:null,now,PLATFORM_ORG,id,
   ]);
  }else{
   await conn.execute(`INSERT INTO knowledge_sources (id,organisation_id,pack_id,title,authority,source_type,reference_code,revision_label,jurisdiction,effective_from,effective_to,source_url,document_id,licence_note,status,verified_by,verified_at,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'platform-import',?,?)`,[
    id,PLATFORM_ORG,packId,req(s.title,'sources['+index+'].title'),opt(s.authority),sourceType,referenceCode,opt(s.revisionLabel),opt(s.jurisdiction),effectiveFrom,effectiveTo,sourceUrl,documentId,opt(s.licenceNote),desiredStatus,activate?'platform-import':null,activate?now:null,now,now,
   ]);
  }
 }

 const importedCodes=[];
 for(const [index,r] of raw.rules.entries()){
  const sourceId=sourceIds.get(req(r.sourceKey,'rules['+index+'].sourceKey'));
  if(!sourceId)throw new Error('rules['+index+'] references unknown sourceKey');
  const ruleCode=req(r.ruleCode,'rules['+index+'].ruleCode');importedCodes.push(ruleCode);
  const type=enumOf(r.ruleType||'requirement','rules['+index+'].ruleType',ruleTypes);
  const severity=enumOf(r.severity||'warning','rules['+index+'].severity',severities);
  const appliesWhen=validateConditions(r.appliesWhen,'rules['+index+'].appliesWhen');
  const assertion=r.assertion==null?null:validatePredicate(r.assertion,'rules['+index+'].assertion');
  if(type!=='advisory'&&!assertion)throw new Error('rules['+index+'] needs an assertion');
  const effectiveFrom=validDate(r.effectiveFrom,'rules['+index+'].effectiveFrom'),effectiveTo=validDate(r.effectiveTo,'rules['+index+'].effectiveTo');
  if(effectiveFrom&&effectiveTo&&effectiveTo<effectiveFrom)throw new Error('rules['+index+'] effectiveTo is before effectiveFrom');
  const [[found]]=await conn.execute('SELECT id FROM knowledge_rules WHERE organisation_id=? AND pack_id=? AND rule_code=? FOR UPDATE',[PLATFORM_ORG,packId,ruleCode]);
  const id=found?.id||randomUUID();
  const values=[sourceId,req(r.title,'rules['+index+'].title'),opt(r.discipline),req(r.topic,'rules['+index+'].topic'),type,JSON.stringify(appliesWhen),assertion?JSON.stringify(assertion):null,severity,req(r.message,'rules['+index+'].message'),opt(r.sourceClause),opt(r.sourcePage),effectiveFrom,effectiveTo,desiredStatus,now];
  if(found){
   await conn.execute(`UPDATE knowledge_rules SET source_id=?,title=?,discipline=?,topic=?,rule_type=?,applies_when=?,assertion=?,severity=?,message=?,source_clause=?,source_page=?,effective_from=?,effective_to=?,status=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...values,PLATFORM_ORG,id]);
  }else{
   await conn.execute(`INSERT INTO knowledge_rules (id,organisation_id,pack_id,source_id,rule_code,title,discipline,topic,rule_type,applies_when,assertion,severity,message,source_clause,source_page,effective_from,effective_to,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'platform-import',?,?)`,[
    id,PLATFORM_ORG,packId,sourceId,ruleCode,...values.slice(1,-1),now,now,
   ]);
  }
 }
 // Do not delete omitted rules. Retire them explicitly in a later controlled pack if necessary.
 await conn.commit();
 console.log(JSON.stringify({packId,packKey,status:desiredStatus,sources:sourceIds.size,rules:importedCodes.length,activated:activate},null,2));
}catch(error){
 await conn.rollback();throw error;
}finally{
 conn.release();await pool.end();
}
