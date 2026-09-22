import {withActor} from '@/lib/platform/route';
import type { Database } from '@/lib/platform/database';
import {requireActor,authError} from '@/lib/authz';
import { requireEstimateDb, DEFAULT_ORGANISATION_ID as ORG, jsonError, safeJson } from '@/lib/estimates-db';
import { belongsToJob, periodBounds } from '@/lib/commercial-links';
export const dynamic='force-dynamic';
type Meta=Record<string,unknown>;
type RecordRow={id:string;name:string;status:string;metadata:Meta;shift_id?:string;data?:string;amount?:number;quantity?:number;vehicle?:string;notes?:string;project?:string;client?:string;docket_no?:string;work_date?:string;links?:string};
const money=(n:unknown)=>Number(n)||0;
const category=(r:Meta)=>{const s=JSON.stringify(r).toLowerCase();if(/asphalt|material|ac10|ac14|ac20|sma|tonne/.test(s))return 'Asphalt and materials';if(/traffic|ptcd|vms|tma|awv/.test(s))return 'Traffic control';if(/profil/.test(s))return 'Profiling';if(/truck|cartage|haul|delivery/.test(s))return 'Trucks and cartage';if(/subcontract/.test(s))return 'Subcontractors';if(/supplier/.test(s))return 'Suppliers';if(/travel|accommodation|lafha/.test(s))return 'Travel and accommodation';if(/delay|stand.?down|waiting/.test(s))return 'Delays and stand-downs';if(/plant|paver|roller|excavat|grader|sweeper/.test(s))return 'Plant';return 'Labour';};
async function rows(db:Database,t:string){const r=await db.prepare(`SELECT * FROM ${t} WHERE organisation_id=? AND lower(status)!='archived' ORDER BY ${t==='field_records'?'updated_at':'created_at'} DESC`).bind(ORG()).all<RecordRow>();return r.results.map((x:RecordRow)=>({...x,id:String(x.id||x.shift_id),name:String(x.name||x.shift_id),status:x.status||'active',metadata:safeJson<Meta>(x.metadata||x.data,{})}));}
async function handleGET(request:Request){try{const db=requireEstimateDb();await requireActor(request,db,'read');const [jobs,shifts,dockets,fields,commercial]=await Promise.all([rows(db,'jobs'),rows(db,'shifts'),db.prepare("SELECT * FROM dockets WHERE organisation_id=? AND status IN ('approved','included_claim','invoiced') ORDER BY work_date DESC").bind(ORG()).all<RecordRow>(),rows(db,'field_records'),rows(db,'commercial_records')]);const docketRows=dockets.results.map((d:RecordRow)=>({...d,metadata:{amount:d.amount,quantity:d.quantity,vehicle:d.vehicle,notes:d.notes,project:d.project,status:d.status}}));const fieldRows=fields.map((f:RecordRow)=>({...f,metadata:safeJson<Meta>(f.data,{})}));const output=jobs.map((job:RecordRow)=>{const jm=job.metadata as Meta;const budget=(jm.approvedBudget||{}) as Meta;const relatedShifts=shifts.filter((s:RecordRow)=>s.metadata.jobId===job.id);const relatedDockets=docketRows.filter((d:RecordRow)=>belongsToJob(d,job));const relatedFields=fieldRows.filter((f:RecordRow)=>relatedShifts.some((s:RecordRow)=>s.id===f.shift_id));const committed=relatedShifts.reduce((n,s)=>n+Number(s.metadata.materialCost||0)+Number(s.metadata.otherCost||0)+((s.metadata.assignments||[]) as Meta[]).reduce((v,a)=>v+money(a.hours)*money(a.rate),0),0);const actual=relatedDockets.reduce((n,d)=>n+money(d.amount),0)+relatedFields.reduce((n,f)=>n+money(f.metadata.materialCost)+money(f.metadata.otherCost)+((f.metadata.resources||[]) as Meta[]).reduce((v,a)=>v+money(a.hours)*money(a.rate),0),0);const claimed=relatedDockets.filter((d:RecordRow)=>['included_claim','invoiced'].includes(d.status)).reduce((n,d)=>n+money(d.amount),0);const invoiced=relatedDockets.filter((d:RecordRow)=>d.status==='invoiced').reduce((n,d)=>n+money(d.amount),0);const forecastCost=Math.max(committed,actual);const revenue=money(jm.contractValue||budget.sellRate);const forecastRevenue=revenue;const profit=forecastRevenue-forecastCost;const tonnes=relatedShifts.reduce((n,s)=>n+money(s.metadata.tonnes),0),area=relatedShifts.reduce((n,s)=>n+money(s.metadata.area),0);const categories:Record<string,number>={};for(const d of relatedDockets)categories[category(d.metadata)]=(categories[category(d.metadata)]||0)+money(d.amount);for(const f of relatedFields)for(const r of (f.metadata.resources||[]) as Meta[])categories[category(r)]=(categories[category(r)]||0)+money(r.hours)*money(r.rate);const alerts:string[]=[];if(tonnes>money(budget.totalTonnes))alerts.push('Planned tonnes exceed approved estimate');if(committed>money(budget.directCost))alerts.push('Committed costs exceed approved budget');if(relatedDockets.some((d:RecordRow)=>!d.amount))alerts.push('Unpriced docket');if(relatedDockets.some((d:RecordRow)=>!d.status||d.status==='review'))alerts.push('Dockets need review or supplier cost');if(relatedFields.some((f:RecordRow)=>(Array.isArray(f.metadata.delays)&&f.metadata.delays.length>0)))alerts.push('Delay / stand-down recorded');return {id:job.id,name:job.name,client:String(jm.client||''),baseline:{revenue,cost:money(budget.directCost),margin:money(budget.grossMargin)},current:{committed,actual,accrued:actual,claimed,invoiced,paid:0,unbilled:relatedDockets.filter(d=>d.status==='approved').reduce((n,d)=>n+money(d.amount),0),unapprovedVariations:commercial.filter((c:RecordRow)=>c.metadata.jobId===job.id&&c.status!=='Approved').reduce((n,c)=>n+money(c.metadata.submittedValue),0),forecastCost,forecastRevenue,profit,margin:forecastRevenue?profit/forecastRevenue*100:0},metrics:{tonnes,area,shifts:relatedShifts.length,dockets:relatedDockets.length},categories,alerts};});const claimable=docketRows.filter((d:RecordRow)=>d.status==='approved').map((d:RecordRow)=>({id:d.id,docketNo:d.docket_no,amount:money(d.amount),workDate:d.work_date,client:d.client,project:d.project,links:safeJson(d.links,{})}));return Response.json({jobs:output,variations:commercial,claimable,claimPeriods:[...new Set(docketRows.map((d:RecordRow)=>String(d.work_date||'').slice(0,7)).filter(Boolean))]});}catch(e){console.error(e);return authError(e);}}
async function handlePOST(req:Request){try{
 const db=requireEstimateDb();await requireActor(req,db,'approve');const b=await req.json() as Meta, now=new Date().toISOString();
 if(b.action==='claim'){
  const ids=[...new Set(Array.isArray(b.docketIds)?b.docketIds.map(String):[])], jobId=String(b.jobId||''), period=String(b.claimPeriod||''), bounds=periodBounds(period);
  if(!ids.length||ids.length>100||!jobId||!bounds)return jsonError('Select a job, a valid claim period and 1–100 approved dockets.');
  const job=await db.prepare('SELECT id,name,metadata FROM jobs WHERE organisation_id=? AND id=?').bind(ORG(),jobId).first<RecordRow>();
  if(!job)return jsonError('Selected job not found.',404);
  const placeholders=ids.map(()=>'?').join(',');
  const result=await db.prepare(`SELECT * FROM dockets WHERE organisation_id=? AND id IN (${placeholders}) AND status='approved' AND work_date>=? AND work_date<?`).bind(ORG(),...ids,bounds.start,bounds.end).all<RecordRow>();
  const eligible=result.results.filter(d=>belongsToJob(d,job));
  if(eligible.length!==ids.length)return jsonError('Every docket must be approved, in this period and linked to this job.');
  const already=await db.prepare(`SELECT docket_id FROM claim_items WHERE organisation_id=? AND docket_id IN (${placeholders})`).bind(ORG(),...ids).all<RecordRow>();
  if(already.results.length)return jsonError('One or more dockets have already been claimed.',409);
  const claimId=crypto.randomUUID();
  const writes=[db.prepare('INSERT INTO claims (id,organisation_id,job_id,claim_period,status,metadata,created_at) VALUES (?,?,?,?,?,?,?)').bind(claimId,ORG(),jobId,period,'Draft',JSON.stringify({jobName:job.name}),now)];
  for(const d of eligible)writes.push(db.prepare('INSERT INTO claim_items (id,organisation_id,claim_id,docket_id,line_item,amount,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),ORG(),claimId,d.id,'',money(d.amount),now));
  writes.push(db.prepare(`UPDATE dockets SET status='included_claim',updated_at=? WHERE organisation_id=? AND id IN (${placeholders})`).bind(now,ORG(),...ids));
  writes.push(db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),ORG(),'claim.created','recorded',JSON.stringify({claimId,jobId,period,docketIds:ids}),now));
  await db.batch(writes);
  return Response.json({claimId,claimed:ids.length,claimPeriod:period,status:'Draft'});
 }
 if(b.action==='variation'){
  if(!String(b.description||'').trim()||!b.jobId)return jsonError('A job and description are required.');
  const job=await db.prepare('SELECT id FROM jobs WHERE organisation_id=? AND id=?').bind(ORG(),String(b.jobId)).first<RecordRow>();
  if(!job)return jsonError('Job not found.',404);
  const id=crypto.randomUUID(), metadata={...b,recordType:'variation',approvalHistory:[],createdAt:now};
  await db.prepare('INSERT INTO commercial_records (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(id,ORG(),String(b.description),String(b.status||'Draft'),JSON.stringify(metadata),now).run();
  return Response.json({variation:{id}},{status:201});
 }
 if(b.action==='export')return GET(req);
 return jsonError('Unknown commercial action.');
}catch(e){console.error(e);if((e as {status?:number})?.status)return authError(e);return jsonError(String(e).includes('UNIQUE')?'A docket was claimed by another request. Refresh before retrying.':'Commercial action failed.',String(e).includes('UNIQUE')?409:503);}}

export const GET=withActor(handleGET,'read');

export const POST=withActor(handlePOST,'approve');
