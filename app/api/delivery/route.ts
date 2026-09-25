import {fieldDelivery,withoutMoney} from '@/lib/field-access';
import {can} from '@/lib/platform/permissions';
import {withActor} from '@/lib/platform/route';
import type { Database } from '@/lib/platform/database';
import { imsBlockers } from '@/lib/ims-readiness';
import { requireActor } from '@/lib/authz';
import { currentOrganisationId, currentOrganisationId as ORG, requireEstimateDb, safeJson, jsonError } from '@/lib/estimates-db';
import { CHECKS, SHIFT_STATUSES, mergeJob, shiftWarnings, type DeliveryRecord, type Meta } from '@/lib/planning';
import { evaluateShift, blocking, loadResources, loadNearbyShifts, shiftInput, type Conflict } from '@/lib/modules/operations/conflicts';
import { shiftStatements } from '@/lib/v1/resource-sync';
export const dynamic = 'force-dynamic';
const tables = ['jobs','shifts','workers','crews','plant','suppliers','subcontractors'] as const;
async function load(db: Database, table: string): Promise<DeliveryRecord[]> {
  const r = await db.prepare(`SELECT * FROM ${table} WHERE organisation_id = ? ORDER BY created_at DESC`).bind(ORG()).all<Record<string,unknown>>();
  return r.results.map(r => ({id:String(r.id), name:String(r.name), status:String(r.status), metadata:safeJson<Meta>(r.metadata,{}), createdAt:String(r.created_at)}));
}
async function handleGET(request: Request) {
  try { const db=requireEstimateDb(); const actor=await requireActor(request, db, 'field-read'); if(actor.role==='field'){const [jobs,shifts]=await Promise.all([load(db,'jobs'),load(db,'shifts')]);return Response.json({jobs:jobs.map(r=>fieldDelivery(r,'jobs')),shifts:shifts.map(r=>fieldDelivery(r,'shifts')),workers:[],crews:[],plant:[],suppliers:[],subcontractors:[]},{headers:{'Cache-Control':'private, no-store'}});} const rows=await Promise.all(tables.map(t=>load(db,t))); const money=can(actor.role,'commercial.view'); return Response.json(Object.fromEntries(tables.map((t,i)=>[t,money?rows[i]:rows[i].map(withoutMoney)])),{headers:{'Cache-Control':'private, no-store'}}); }
  catch(e) { console.error(e); return jsonError('Unable to load dispatch records. Please retry.',503); }
}
async function handlePOST(request:Request) {
  try {
    const body=await request.json() as {kind:string;record:DeliveryRecord};
    if (!['jobs','shifts'].includes(body.kind)) return jsonError('Invalid record type.');
    const db=requireEstimateDb(); const actor=await requireActor(request, db, 'write'); const record=body.record;
    if (!record?.name?.trim()) return jsonError('Name is required.');
    const existing=record.id ? (await load(db,body.kind)).find(r=>r.id===record.id) : undefined;
    if(record.id && !existing) return jsonError('Record no longer exists.',404);
    const id=existing?.id || crypto.randomUUID();
    const metadata=body.kind==='jobs' ? mergeJob(existing?.metadata || {},record.metadata || {}) : {...existing?.metadata,...record.metadata};
    const saved={...record,id,metadata};
    let warnings:string[]=[];
    let conflicts:Conflict[]=[];
    const sync:{sql:string;params:unknown[]}[]=[];
    if(body.kind==='jobs' && existing){
      const current=await db.prepare('SELECT stage FROM jobs WHERE organisation_id=? AND id=?').bind(ORG(),id).first<{stage:string|null}>();
      if(current?.stage==='closed') return jsonError('This project is closed. Reopen it from the project workspace before changing it.',409);
    }
    if(body.kind==='jobs' && record.status==='Ready to Commence'){
      const blockers=await imsBlockers(db,ORG(),id);
      if(blockers.length)return jsonError('Complete mandatory IMS requirements before commencement.',422,{warnings:blockers});
    }
    if(body.kind==='shifts') {
      if(!SHIFT_STATUSES.includes(record.status)) return jsonError('Invalid shift status.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(metadata.date)) || !/^\d{2}:\d{2}$/.test(String(metadata.start)) || !/^\d{2}:\d{2}$/.test(String(metadata.finish))) return jsonError('Date, start and finish are required.');
      const jobs=await load(db,'jobs'); if(!jobs.some(j=>j.id===metadata.jobId)) return jsonError('Select an existing job.');
      const stage=await db.prepare('SELECT stage FROM jobs WHERE organisation_id=? AND id=?').bind(currentOrganisationId(),String(metadata.jobId)).first<{stage:string|null}>();
      if(stage?.stage==='closed') return jsonError('This project is closed. Reopen it before scheduling work.',409);
      const byTable=await Promise.all(tables.slice(2).map(t=>load(db,t)));
      const resources=byTable.flat();
      warnings=shiftWarnings(saved,jobs,await load(db,'shifts'),resources);
      // Deterministic conflict engine over typed resources (double-booking, inactive,
      // competencies, plant compliance). Blocks apply to Planned / Ready / In Progress.
      const input=shiftInput({...saved,metadata});
      conflicts=evaluateShift(input,await loadResources(db,ORG(),input.assignments),await loadNearbyShifts(db,ORG(),input.date));
      const blocks=blocking(record.status,conflicts);
      if(blocks.length) return jsonError(`Resolve ${blocks.length===1?'this scheduling conflict':`these ${blocks.length} scheduling conflicts`} or save the shift as Draft.`,409,{conflicts,warnings});
      const known={jobIds:new Set(jobs.map(j=>j.id)),resources:new Map(byTable.flatMap((rows,i)=>rows.map(r=>[r.id,tables[i+2]] as [string,string])))};
      sync.push(...shiftStatements(ORG(),{id,name:record.name.trim(),status:record.status,metadata},known,new Date().toISOString(),()=>crypto.randomUUID(),actor.userId).statements);
      if (['Ready','In Progress'].includes(record.status)) warnings.push(...await imsBlockers(db,ORG(),String(metadata.jobId)));
      const checks=metadata.checks as Record<string,boolean> || {};
      if (['Ready','In Progress'].includes(record.status) && (warnings.length || CHECKS.some(c=>!checks[c]))) return jsonError('Resolve warnings and complete the checklist before marking Ready or In Progress.',422,{warnings});
    }
    const now=new Date().toISOString();
    const write=existing ? db.prepare(`UPDATE ${body.kind} SET name=?,status=?,metadata=? WHERE id=? AND organisation_id=?`).bind(record.name.trim(),record.status,JSON.stringify(metadata),id,ORG()) : db.prepare(`INSERT INTO ${body.kind} (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`).bind(id,ORG(),record.name.trim(),record.status,JSON.stringify(metadata),now);
    await db.batch([write,...sync.map(s=>db.prepare(s.sql).bind(...s.params)),db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),ORG(),`${body.kind}.${existing?'updated':'created'}`,'recorded',JSON.stringify({recordId:id}),now)]);
    return Response.json({record:saved,warnings,conflicts},{status:existing?200:201});
  } catch(e) { console.error(e);return jsonError('Unable to save. Your changes are still in the form.',503); }
}

export const GET=withActor(handleGET,'field-read','operations');

export const POST=withActor(handlePOST,'write','operations');
