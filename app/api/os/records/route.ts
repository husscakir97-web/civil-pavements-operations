import {withActor} from '@/lib/platform/route';
import { cleanText, jsonError, nowIso, requireEstimateDb, safeJson } from "@/lib/estimates-db";
import { mergeJob } from '@/lib/planning';
import { requireActor } from '@/lib/authz';

export const dynamic = "force-dynamic";

const TABLES = {
  opportunities: "opportunities",
  jobs: "jobs",
  planning: "shifts",
  field: "work_packages",
  commercial: "commercial_records",
  qa: "qa_safety_records",
  workers: "workers",
  plant: "plant",
  crews: "crews",
  suppliers: "suppliers",
  subcontractors: "subcontractors",
} as const;

type ModuleKey = keyof typeof TABLES;

function resolveTable(module: string, resourceType: string) {
  if (module === "resources") return TABLES[resourceType as keyof typeof TABLES] ?? null;
  return TABLES[module as ModuleKey] ?? null;
}

function parseMetadata(value: unknown) {
  return safeJson<Record<string, unknown>>(value, {});
}

function serialiseRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    status: String(row.status ?? "active"),
    metadata: parseMetadata(row.metadata),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
  };
}

async function handleGET(request: Request) {
  try {
    const db = requireEstimateDb(); const actor=await requireActor(request, db, 'read', true);
    const params = new URL(request.url).searchParams;
    const moduleKey = cleanText(params.get("module"), 40);
    const resourceType = cleanText(params.get("resourceType"), 40);
    const table = resolveTable(moduleKey, resourceType);
    if (!table) return jsonError("This workspace is not configured yet.", 400);
    const result = await db
      .prepare(`SELECT id, name, status, metadata, created_at AS createdAt FROM ${table} WHERE organisation_id = ? ORDER BY created_at DESC LIMIT 200`)
      .bind(actor.organisationId)
      .all<Record<string, unknown>>();
    return Response.json({ module: moduleKey, resourceType, records: result.results.map(serialiseRow) });
  } catch (error) {
    console.error("load operations records", error);
    return jsonError("The workspace records could not be loaded.", 503);
  }
}

async function handlePOST(request: Request) {
  try {
    const db = requireEstimateDb(); const actor=await requireActor(request, db, 'write', true);
    const body = await request.json() as Record<string, unknown>;
    const moduleKey = cleanText(body.module, 40);
    const resourceType = cleanText(body.resourceType, 40);
    const table = resolveTable(moduleKey, resourceType);
    if (!table) return jsonError("This workspace is not configured yet.", 400);
    const name = cleanText(body.name, 180);
    const status = cleanText(body.status, 50) || "active";
    if (table === 'shifts' || (table === 'jobs' && /ready|in progress/i.test(status))) return jsonError('Use the delivery workspace for readiness transitions.', 409);
    if (!name) return jsonError("A name is required.");
    const id = crypto.randomUUID();
    const now = nowIso();
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    await db.batch([
      db.prepare(`INSERT INTO ${table} (id, organisation_id, name, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, actor.organisationId, name, status, JSON.stringify(metadata), now),
      db.prepare(`INSERT INTO audit_events (id, organisation_id, name, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), actor.organisationId, `record.created:${moduleKey}`, "recorded", JSON.stringify({ recordId: id, resourceType }), now),
    ]);
    return Response.json({ record: { id, name, status, metadata, createdAt: now } }, { status: 201 });
  } catch (error) {
    console.error("create operations record", error);
    return jsonError("The record could not be created.", 503);
  }
}

async function handlePUT(request: Request) {
  try {
    const db = requireEstimateDb(); const actor=await requireActor(request, db, 'write', true);
    const body = await request.json() as Record<string, unknown>;
    const moduleKey = cleanText(body.module, 40);
    const resourceType = cleanText(body.resourceType, 40);
    const table = resolveTable(moduleKey, resourceType);
    const id = cleanText(body.id, 100);
    if (!table) return jsonError("This workspace is not configured yet.", 400);
    if (!id) return jsonError("A record ID is required.");
    const name = cleanText(body.name, 180);
    const status = cleanText(body.status, 50) || "active";
    if (table === 'shifts' || (table === 'jobs' && /ready|in progress/i.test(status))) return jsonError('Use the delivery workspace for readiness transitions.', 409);
    const existing = await db.prepare(`SELECT metadata FROM ${table} WHERE organisation_id = ? AND id = ?`).bind(actor.organisationId,id).first<{metadata:string}>();
    if (!existing) return jsonError('Record not found.',404);
    const previous = parseMetadata(existing.metadata);
    const patch = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string,unknown> : {};
    const metadata = table === 'jobs' ? mergeJob(previous,patch) : {...previous,...patch};
    const result = await db.prepare(`UPDATE ${table} SET name = ?, status = ?, metadata = ? WHERE organisation_id = ? AND id = ?`)
      .bind(name, status, JSON.stringify(metadata), actor.organisationId, id).run();
    if (!result.success || result.meta.changes === 0) return jsonError("The record was not found.", 404);
    await db.prepare(`INSERT INTO audit_events (id, organisation_id, name, status, metadata, created_at) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), actor.organisationId, `record.updated:${moduleKey}`, "recorded", JSON.stringify({ recordId:id, previous, metadata }), nowIso()).run();
    return Response.json({ record: { id, name, status, metadata } });
  } catch (error) {
    console.error("update operations record", error);
    return jsonError("The record could not be updated.", 503);
  }
}

async function handleDELETE(request: Request) {
  try { const db=requireEstimateDb(); const actor=await requireActor(request,db,'write',true); const p=new URL(request.url).searchParams; const moduleKey=cleanText(p.get('module'),40); const resourceType=cleanText(p.get('resourceType'),40); const table=resolveTable(moduleKey,resourceType); const id=cleanText(p.get('id'),100); if(!table||!id) return jsonError('A record and module are required.'); const r=await db.prepare(`UPDATE ${table} SET status='Archived' WHERE organisation_id=? AND id=?`).bind(actor.organisationId,id).run(); if(!r.success||r.meta.changes===0) return jsonError('Record not found.',404); await db.prepare(`INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.organisationId,`record.archived:${moduleKey}`,'recorded',JSON.stringify({recordId:id}),nowIso()).run(); return Response.json({archived:true,id}); } catch(e){ return jsonError('The record could not be archived.',503); }
}

export const GET=withActor(handleGET,'read');

export const POST=withActor(handlePOST,'write');

export const PUT=withActor(handlePUT,'write');

export const DELETE=withActor(handleDELETE,'write');
