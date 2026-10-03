// Runs the demonstration stages for one organisation through guarded writers. Separated from the CLI so the write boundary can be
// tested on its own: whatever the plan said, a write may never carry the id of a record that existed before the import began.
import {createHash} from 'node:crypto';
import {DIVISIONS} from './import-plan.mjs';
import {guardedCall,guardedDb,makeProvenance} from './import-guards.mjs';
import {STAGES,hydrate} from './stages.mjs';

const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

/**
 * raw: database connection. rawCall/rawForm: the signed-in HTTP writers (an isolated app bound to this database).
 * baseline: the pre-import snapshot (digests only) from which provenance is derived.
 * crash: optional "<METHOD> <path> [action]" (+ "#n") test instrumentation; it only makes the process stop abruptly after that
 * mutation succeeded, to prove resume from durable state. It never bypasses a guard.
 */
export async function applyImport({raw,org,seedDate,rawCall,rawForm,baseline,stages:only=[],stopAfter,crash,log=console.log}){
 const provenance=makeProvenance(baseline);
 let crashSeen=0;
 const crashing=crash?async(path,method='GET',body)=>{
  const res=await rawCall(path,method,body);
  if(method!=='GET'&&res.status<400){const [pat,nth='1']=crash.split('#'),label=`${method} ${path.split('?')[0]}${body?.action?' '+body.action:''}${body?.to?' to='+body.to:''}`;if(label.includes(pat)&&++crashSeen===Number(nth)){log('CRASH after: '+label);process.exit(99);}}
  return res;
 }:rawCall;
 const call=guardedCall(crashing,provenance),db=guardedDb(raw,org,provenance);
 const form=async(path,fields)=>{if(path.split('?')[0]!=='/api/dockets')throw new Error(`Refused by the import guard: form upload to ${path} is not an allowed demonstration write.`);return rawForm(path,fields);};
 const must=async(promise,codes,label)=>{const res=await promise;if(!codes.includes(res.status))throw new Error(`${label} -> ${res.status} ${JSON.stringify(res.body).slice(0,300)}`);return res.body;};
 const one=async(sql,params=[])=>(await db.query(sql,params))[0][0]??null,all=async(sql,params=[])=>(await db.query(sql,params))[0];
 const ctx={db,org,call,form,must,one,all,log,SEED_DATE:seedDate,d:n=>addDays(seedDate,n),addDays,created:{},ids:{},note:(k,n=1)=>{ctx.created[k]=(ctx.created[k]||0)+n;},tag:createHash('sha1').update(org).digest('hex').slice(0,8)};

 // divisions: only an exact name-and-description match that did NOT exist before the import began is reused; any other division with
 // one of these codes is somebody else's and stops the import.
 const divisionsStage=async c=>{
  for(const [code,name,description] of DIVISIONS){
   const exact=await c.one('SELECT id FROM business_units WHERE organisation_id=? AND code=? AND name=? AND description=?',[org,code,name,description]);
   const any=await c.one('SELECT id FROM business_units WHERE organisation_id=? AND code=?',[org,code]);
   if(any&&!(exact&&!provenance.isOriginal(exact.id)))throw new Error(`Refused by the import guard: a division with code ${code} existed before the import began; it is never adopted or modified.`);
   if(exact){c.ids['division:'+code]=exact.id;continue;}
   const made=await must(c.call('/api/business-units','POST',{name,code,description}),[201],'division '+code);
   c.ids['division:'+code]=made.id||made.division?.id;c.note('divisions');
  }
 };
 await hydrate(ctx);
 for(const k of Object.keys(ctx.ids))if(k.startsWith('division:'))delete ctx.ids[k]; // rebuilt by the divisions stage with ownership checks
 for(const r of await all('SELECT id,code,name,description FROM business_units WHERE organisation_id=?',[org])){const d=DIVISIONS.find(x=>x[0]===r.code&&x[1]===r.name&&x[2]===r.description);if(d&&!provenance.isOriginal(r.id))ctx.ids['division:'+r.code]=r.id;}
 const all_=[['divisions',divisionsStage],...STAGES.filter(([n])=>n!=='company'&&n!=='verify')].filter(([n])=>!only.length||only.includes(n));
 for(const [name,fn] of all_){
  log(`== ${name}`);await fn(ctx);
  if(stopAfter===name){log(`Stopped after "${name}" as requested; run a fresh dry run and apply again to resume.`);return {created:ctx.created,stopped:true};}
 }
 return {created:ctx.created,stopped:false};
}
