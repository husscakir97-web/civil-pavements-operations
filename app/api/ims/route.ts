import {withActor} from '@/lib/platform/route';
import { requireActor, authError } from '@/lib/authz';
import { cleanText, jsonError, nowIso, requireEstimateDb, safeJson } from '@/lib/estimates-db';

export const dynamic = 'force-dynamic';

const DOCUMENT_STATUSES = ['Draft', 'Internal Review', 'Approved', 'Submitted', 'Accepted', 'Superseded', 'Expired', 'Rejected'];
const REQUIREMENT_STATUSES = ['Draft', 'Internal Review', 'Approved', 'Submitted', 'Accepted', 'Missing', 'Expired', 'Clarification Required'];
import {CORE_PACK} from '@/lib/ims-pack';

function row<T extends Record<string, unknown>>(value: T) {
  return { ...value, metadata: safeJson(value.metadata, {}) };
}

async function handleGET(request: Request) {
  try {
    const db = requireEstimateDb();
    const actor = await requireActor(request, db, 'read');
    const p = new URL(request.url).searchParams;
    const opportunityId = cleanText(p.get('opportunityId'), 100);
    const jobId = cleanText(p.get('jobId'), 100);
    const [documents, requirements, items, tasks] = await Promise.all([
      db.prepare(`SELECT * FROM ims_documents WHERE organisation_id=? ${jobId ? "AND (job_id=? OR scope='organisation')" : ''} ORDER BY updated_at DESC`).bind(...(jobId ? [actor.organisationId, jobId] : [actor.organisationId])).all<Record<string, unknown>>(),
      opportunityId ? db.prepare('SELECT * FROM tender_requirements WHERE organisation_id=? AND opportunity_id=? ORDER BY mandatory DESC, due_date, title').bind(actor.organisationId, opportunityId).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
      jobId ? db.prepare('SELECT * FROM job_ims_items WHERE organisation_id=? AND job_id=? ORDER BY mandatory DESC, title').bind(actor.organisationId, jobId).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
      db.prepare("SELECT * FROM workflow_tasks WHERE organisation_id=? AND status!='Archived' ORDER BY due_date, created_at DESC LIMIT 100").bind(actor.organisationId).all<Record<string, unknown>>(),
    ]);
    const [jobs,opportunities] = await Promise.all(['jobs','opportunities'].map(table=>db.prepare(`SELECT id,name FROM ${table} WHERE organisation_id=? AND lower(status)!='archived' ORDER BY name`).bind(actor.organisationId).all<{id:string;name:string}>()));
    return Response.json({ jobs:jobs.results,opportunities:opportunities.results,documents: documents.results.map(row), requirements: requirements.results.map(row), jobPack: items.results.map(row), tasks: tasks.results.map(row), corePack: CORE_PACK });
  } catch (error) { return authError(error); }
}

async function handlePOST(request: Request) {
  try {
    const db = requireEstimateDb();
    const actor = await requireActor(request, db, 'write');
    const body = await request.json() as Record<string, unknown>;
    const action = cleanText(body.action, 30);
    const now = nowIso();
    for (const [field,table] of [['jobId','jobs'],['storageAttachmentId','attachments'],['linkedDocumentId','ims_documents']] as const) {
      if(body[field] && !await db.prepare(`SELECT id FROM ${table} WHERE id=? AND organisation_id=?`).bind(cleanText(body[field],100),actor.organisationId).first()) return jsonError('Linked record not found.',404);
    }
    if (action === 'document') {
      const title = cleanText(body.title, 180), type = cleanText(body.documentType, 100);
      if (!title || !type) return jsonError('Document title and type are required.');
      const id = crypto.randomUUID();
      const document = { id, organisation_id: actor.organisationId, scope: cleanText(body.jobId,100) ? 'project' : 'organisation', job_id: cleanText(body.jobId, 100) || null, title, document_type: type, revision: 1, owner_user_id: cleanText(body.ownerUserId, 100) || actor.userId, approver_user_id: null, status: 'Draft', effective_date: cleanText(body.effectiveDate, 20) || null, review_date: cleanText(body.reviewDate, 20) || null, expiry_date: cleanText(body.expiryDate, 20) || null, source_requirement_id: cleanText(body.sourceRequirementId, 100) || null, storage_attachment_id: cleanText(body.storageAttachmentId, 100) || null, metadata: JSON.stringify(typeof body.metadata === 'object' && body.metadata ? body.metadata : {}), created_at: now, updated_at: now };
      await db.batch([
        db.prepare('INSERT INTO ims_documents (id,organisation_id,scope,job_id,title,document_type,revision,owner_user_id,approver_user_id,status,effective_date,review_date,expiry_date,source_requirement_id,storage_attachment_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...Object.values(document)),
        db.prepare('INSERT INTO ims_document_revisions (id,organisation_id,document_id,revision,status,snapshot,changed_by_user_id,change_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.organisationId, id, 1, 'Draft', JSON.stringify(document), actor.userId, 'Created', now),
        db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.organisationId, 'ims.document.created', 'recorded', JSON.stringify({ documentId: id, title }), now),
      ]);
      return Response.json({ document: row(document) }, { status: 201 });
    }
    if (action === 'requirement') {
      const opportunityId = cleanText(body.opportunityId, 100), title = cleanText(body.title, 180);
      if (!opportunityId || !title) return jsonError('Opportunity and requirement title are required.');
      const exists = await db.prepare('SELECT id FROM opportunities WHERE id=? AND organisation_id=?').bind(opportunityId, actor.organisationId).first();
      if (!exists) return jsonError('Opportunity not found.', 404);
      const id = crypto.randomUUID();
      const requirement = { id, organisation_id: actor.organisationId, opportunity_id: opportunityId, title, requirement_type: cleanText(body.requirementType, 50) || 'Project-specific', source_document: cleanText(body.sourceDocument, 180), source_page: cleanText(body.sourcePage, 20), owner_user_id: cleanText(body.ownerUserId, 100) || actor.userId, due_date: cleanText(body.dueDate, 20) || null, status: 'Missing', mandatory: body.mandatory === false ? 0 : 1, clarification: cleanText(body.clarification, 500), linked_document_id: cleanText(body.linkedDocumentId, 100) || null, metadata: JSON.stringify(typeof body.metadata === 'object' && body.metadata ? body.metadata : {}), created_at: now, updated_at: now };
      await db.batch([
        db.prepare('INSERT INTO tender_requirements (id,organisation_id,opportunity_id,title,requirement_type,source_document,source_page,owner_user_id,due_date,status,mandatory,clarification,linked_document_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...Object.values(requirement)),
        db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.organisationId, 'ims.requirement.created', 'recorded', JSON.stringify({ requirementId: id, opportunityId }), now),
      ]);
      return Response.json({ requirement: row(requirement) }, { status: 201 });
    }
    if (action === 'job-pack') {
      const jobId = cleanText(body.jobId, 100); if (!jobId) return jsonError('Job is required.');
      const exists = await db.prepare('SELECT id FROM jobs WHERE id=? AND organisation_id=?').bind(jobId, actor.organisationId).first();
      if (!exists) return jsonError('Job not found.', 404);
      const rows = CORE_PACK.map(([title, type]) => ({ id: crypto.randomUUID(), organisation_id: actor.organisationId, job_id: jobId, title, document_type: type, mandatory: 1, status: 'Missing', source_requirement_id: null, linked_document_id: null, due_date: null, metadata: '{}', created_at: now, updated_at: now }));
      await db.batch(rows.map(item => db.prepare('INSERT INTO job_ims_items (id,organisation_id,job_id,title,document_type,mandatory,status,source_requirement_id,linked_document_id,due_date,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id').bind(...Object.values(item))).concat([db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.organisationId, 'ims.job_pack.created', 'recorded', JSON.stringify({ jobId, itemCount: rows.length }), now)]));
      return Response.json({ jobPack: rows }, { status: 201 });
    }
    return jsonError('Unknown IMS action.');
  } catch (error) { console.error('ims create', error); return authError(error); }
}

async function handlePATCH(request: Request) {
  try {
    const db = requireEstimateDb(); const actor = await requireActor(request, db, 'approve');
    const body = await request.json() as Record<string, unknown>; const kind = cleanText(body.kind, 20); const id = cleanText(body.id, 100); const status = cleanText(body.status, 40); if (!id || !status) return jsonError('Record and status are required.');
    const now = nowIso();
    if (kind === 'document') {
      if (!DOCUMENT_STATUSES.includes(status)) return jsonError('Invalid document status.');
      const current = await db.prepare('SELECT * FROM ims_documents WHERE id=? AND organisation_id=?').bind(id, actor.organisationId).first<Record<string, unknown>>(); if (!current) return jsonError('Document not found.', 404);
      if (['Superseded', 'Accepted'].includes(String(current.status)) && status !== 'Superseded') return jsonError('Submitted or approved documents require a new revision; the existing record is protected.', 409);
      if (['Approved','Submitted','Accepted'].includes(String(current.status)) && !['Submitted','Accepted','Superseded','Expired'].includes(status)) return jsonError('Create a new revision to change approved content.',409);
      if (['Approved', 'Submitted', 'Accepted'].includes(status)) {
        if (!current.storage_attachment_id) return jsonError('Upload evidence before approval.', 422);
        const attachment = await db.prepare('SELECT id FROM attachments WHERE id=? AND organisation_id=?').bind(current.storage_attachment_id, actor.organisationId).first();
        if (!attachment) return jsonError('Source file is unavailable.', 422);
        if (current.expiry_date && String(current.expiry_date) < now.slice(0,10)) return jsonError('Expired documents cannot be approved.', 422);
        if ((status==='Approved'&&current.status!=='Internal Review') || (status==='Submitted'&&current.status!=='Approved') || (status==='Accepted'&&current.status!=='Submitted')) return jsonError('Complete the preceding review or approval stage first.',409);
      }
      await db.batch([db.prepare('UPDATE ims_documents SET status=?,approver_user_id=?,updated_at=? WHERE id=? AND organisation_id=?').bind(status, actor.userId, now, id, actor.organisationId), db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.organisationId, `ims.document.${status.toLowerCase().replaceAll(' ', '-')}`, 'recorded', JSON.stringify({ documentId: id, by: actor.userId, previous:current, status }), now)]);
      return Response.json({ updated: true, id, status });
    }
    if (kind === 'requirement' || kind === 'job-pack') {
      if (!REQUIREMENT_STATUSES.includes(status)) return jsonError('Invalid requirement status.');
      const table = kind === 'requirement' ? 'tender_requirements' : 'job_ims_items';
      const current = await db.prepare(`SELECT * FROM ${table} WHERE id=? AND organisation_id=?`).bind(id, actor.organisationId).first<Record<string, unknown>>();
      if (!current) return jsonError('Requirement not found.', 404);
      const documentId = cleanText(body.documentId ?? current.linked_document_id, 100) || null;
      if (['Approved', 'Accepted', 'Submitted'].includes(status)) {
        if (!documentId) return jsonError('Link approved evidence before completing this requirement.', 422);
        const evidence = await db.prepare('SELECT * FROM ims_documents WHERE id=? AND organisation_id=?').bind(documentId, actor.organisationId).first<Record<string, unknown>>();
        if (!evidence || !['Approved', 'Accepted'].includes(String(evidence.status)) || !evidence.storage_attachment_id || (evidence.expiry_date && String(evidence.expiry_date) < now.slice(0,10))) return jsonError('Evidence must be approved, have a source file and be current.', 422);
        if (evidence.scope === 'project' && evidence.job_id !== current.job_id) return jsonError('Evidence belongs to another project.', 422);
      }
      await db.batch([
        db.prepare(`UPDATE ${table} SET status=?,linked_document_id=?,updated_at=? WHERE id=? AND organisation_id=?`).bind(status, documentId, now, id, actor.organisationId),
        db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.organisationId, 'ims.requirement.updated', 'recorded', JSON.stringify({recordId:id,kind,previous:current,status,documentId,actorId:actor.userId}), now),
      ]);
      return Response.json({updated:true,id,status});
    }
    return jsonError('Unknown IMS record type.');
  } catch (error) { return authError(error); }
}

async function handlePUT(request:Request){
 try{
  const db=requireEstimateDb(),actor=await requireActor(request,db,'write'),body=await request.json() as Record<string,unknown>;
  const id=cleanText(body.id,100),reason=cleanText(body.reason,500),now=nowIso();
  if(!reason)return jsonError('A revision reason is required.');
  const current=await db.prepare('SELECT * FROM ims_documents WHERE id=? AND organisation_id=?').bind(id,actor.organisationId).first<Record<string,unknown>>();
  if(!current)return jsonError('Document not found.',404);
  if(Number(body.revision)!==Number(current.revision))return jsonError('Document changed. Reload before saving.',409);
  const attachmentId=cleanText(body.storageAttachmentId,100);
  if(!attachmentId || !await db.prepare('SELECT id FROM attachments WHERE id=? AND organisation_id=?').bind(attachmentId,actor.organisationId).first())return jsonError('Upload a source file for this revision.',422);
  const revision=Number(current.revision)+1;
  const snapshot={...current,revision,status:'Draft',storage_attachment_id:attachmentId,updated_at:now,approver_user_id:null};
  await db.batch([
   db.prepare('INSERT INTO ims_document_revisions (id,organisation_id,document_id,revision,status,snapshot,changed_by_user_id,change_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,id,revision,'Draft',JSON.stringify(snapshot),actor.userId,reason,now),
   db.prepare('UPDATE ims_documents SET revision=?,status=?,storage_attachment_id=?,approver_user_id=NULL,updated_at=? WHERE id=? AND organisation_id=? AND revision=?').bind(revision,'Draft',attachmentId,now,id,actor.organisationId,current.revision),
   db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'ims.document.revised','recorded',JSON.stringify({documentId:id,previous:current,next:snapshot,reason,actorId:actor.userId}),now),
  ]);
  return Response.json({document:row(snapshot)});
 }catch(e){return authError(e);}
}

export const GET=withActor(handleGET,'read');

export const POST=withActor(handlePOST,'write');

export const PATCH=withActor(handlePATCH,'write');

export const PUT=withActor(handlePUT,'write');
