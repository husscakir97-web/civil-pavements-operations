import { imsBlockers } from '@/lib/ims-readiness';
import { requireActor } from '@/lib/authz';
import { DEFAULT_ORGANISATION_ID as ORG, requireEstimateDb, safeJson, jsonError } from '@/lib/estimates-db';
import { CHECKS, SHIFT_STATUSES, mergeJob, shiftWarnings, type DeliveryRecord, type Meta } from '@/lib/planning';
export const dynamic = 'force-dynamic';
const tables = ['jobs','shifts','workers','crews','plant','suppliers','subcontractors'] as const;
async function load(db: D1Database, table: string): Promise<DeliveryRecord[]> {
  const r = await db.prepare(`SELECT * FROM ${table} WHERE organisation_id = ? ORDER BY created_at DESC`).bind(ORG).all<Record<string,unknown>>();
  return r.results.map(r => ({id:String(r.id), name:String(r.name), status:String(r.status), metadata:safeJson<Meta>(r.metadata,{}), createdAt:String(r.created_at)}));
}
export async function GET(request: Request) {
  try { const db=requireEstimateDb(); await requireActor(request, db, 'read'); const rows=await Promise.all(tables.map(t=>load(db,t))); return Response.json(Object.fromEntries(tables.map((t,i)=>[t,rows[i]]))); }
  catch(e) { console.error(e); return jsonError('Unable to load dispatch records. Please retry.',503); }
}
export async function POST(request:Request) {
  try {
    const body=await request.json() as {kind:string;record:DeliveryRecord};
    if (!['jobs','shifts'].includes(body.kind)) return jsonError('Invalid record type.');
    const db=requireEstimateDb(); await requireActor(request, db, 'write'); const record=body.record;
    if (!record?.name?.trim()) return jsonError('Name is required.');
    const existing=record.id ? (await load(db,body.kind)).find(r=>r.id===record.id) : undefined;
    if(record.id && !existing) return jsonError('Record no longer exists.',404);
    const id=existing?.id || crypto.randomUUID();
    const metadata=body.kind==='jobs' ? mergeJob(existing?.metadata || {},record.metadata || {}) : {...existing?.metadata,...record.metadata};
    const saved={...record,id,metadata};
    let warnings:string[]=[];
    if(body.kind==='jobs' && record.status==='Ready to Commence'){
      const blockers=await imsBlockers(db,ORG,id);
      if(blockers.length)return jsonError('Complete mandatory IMS requirements before commencement.',422,{warnings:blockers});
    }
    if(body.kind==='shifts') {
      if(!SHIFT_STATUSES.includes(record.status)) return jsonError('Invalid shift status.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(metadata.date)) || !/^\d{2}:\d{2}$/.test(String(metadata.start)) || !/^\d{2}:\d{2}$/.test(String(metadata.finish))) return jsonError('Date, start and finish are required.');
      const jobs=await load(db,'jobs'); if(!jobs.some(j=>j.id===metadata.jobId)) return jsonError('Select an existing job.');
      const resources=(await Promise.all(tables.slice(2).map(t=>load(db,t)))).flat();
      warnings=shiftWarnings(saved,jobs,await load(db,'shifts'),resources);
      if (['Ready','In Progress'].includes(record.status)) warnings.push(...await imsBlockers(db,ORG,String(metadata.jobId)));
      const checks=metadata.checks as Record<string,boolean> || {};
      if (['Ready','In Progress'].includes(record.status) && (warnings.length || CHECKS.some(c=>!checks[c]))) return jsonError('Resolve warnings and complete the checklist before marking Ready or In Progress.',422,{warnings});
    }
    const now=new Date().toISOString();
    const write=existing ? db.prepare(`UPDATE ${body.kind} SET name=?,status=?,metadata=? WHERE id=? AND organisation_id=?`).bind(record.name.trim(),record.status,JSON.stringify(metadata),id,ORG) : db.prepare(`INSERT INTO ${body.kind} (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`).bind(id,ORG,record.name.trim(),record.status,JSON.stringify(metadata),now);
    await db.batch([write,db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),ORG,`${body.kind}.${existing?'updated':'created'}`,'recorded',JSON.stringify({recordId:id}),now)]);
    return Response.json({record:saved,warnings},{status:existing?200:201});
  } catch(e) { console.error(e);return jsonError('Unable to save. Your changes are still in the form.',503); }
}
