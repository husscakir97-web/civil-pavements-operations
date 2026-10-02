import {withActor} from '@/lib/platform/route';
import {
  cleanNumber,
  cleanStatus,
  cleanText,
  parseMonth,
  requireBindings,
  type DocketInput,
  currentOrganisationId,
  mandatoryMissing,
} from "@/lib/dockets-db";
import { safeJson } from '@/lib/estimates-db';
import { tx, query, one } from '@/lib/platform/sql';
import { requireSeam } from '@/lib/platform/entitlements';
import { actorContext } from '@/lib/platform/context';
import { can } from '@/lib/platform/permissions';
import { docketCostStatements, nextAllocationLinks, jobOf } from '@/lib/seams/docket-to-cost';
import { orgWideProjects, canAccessProject, memberProjectIds } from '@/lib/platform/project-access';
import { checkUpload, DOCKET_UPLOAD_NAME } from '@/lib/platform/upload-safety';

export const dynamic = "force-dynamic";

class Refusal extends Error { constructor(message: string, readonly status: number) { super(message); } }
// The checks that must pass before a docket may be marked ready or approved. Approval posts cost against the work date, so it needs a real one.
function approvalGate(record: DocketInput) {
  if (record.status === "ready") return mandatoryMissing(record);
  if (record.status === "approved" && !/^\d{4}-\d{2}-\d{2}$/.test(record.workDate)) return ["Work date"];
  return [] as string[];
}
// Projects must be active (not disabled or read-only) for posted costs to be corrected.
async function projectsWritable() { try { return await requireSeam('docket.cost'); } catch { return false; } }

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

const DOCKET_COLUMNS = `id, docket_no AS docketNo, work_date AS workDate,
          client, project, crew, vehicle, start_time AS startTime,
          finish_time AS finishTime, break_hours AS breakHours,
          labour_hours AS labourHours, quantity, quantity_unit AS quantityUnit,
          amount, po_number AS poNumber, notes, status, confidence,
          source_name AS sourceName, raw_text AS rawText, source_page AS sourcePage, source_crop AS sourceCrop, field_confidence AS fieldConfidence, line_items AS lineItems, links, extraction_method AS extractionMethod, profile_id AS profileId,
          created_at AS createdAt, updated_at AS updatedAt`;
const present = (r: Record<string,unknown>) => ({...r,
  fieldConfidence: safeJson(r.fieldConfidence, {}),
  lineItems: safeJson(r.lineItems, []),
  links: safeJson(r.links, {}),
});
// Dockets that carry no project cannot post cost. Rejected and duplicate records are not part of the queue.
const UNALLOCATED_EXCLUDED = "('archived','rejected','duplicate')";

async function handleGET(request: Request) {
  try {
    const { db } = requireBindings();
    const { searchParams } = new URL(request.url);
    const org = currentOrganisationId();
    const actor = actorContext.getStore()!;
    // One current record by id (own organisation only): the review dialog reloads from here so it never edits an old upload snapshot.
    const byId = cleanText(searchParams.get("id"), 80);
    if (byId) {
      const row = await db.prepare(`SELECT ${DOCKET_COLUMNS} FROM dockets WHERE organisation_id = ? AND id = ? AND lower(status) != 'archived'`).bind(org, byId).first<Record<string, unknown>>();
      if (!row) return jsonError("The docket was not found.", 404);
      return Response.json({ docket: present(row) });
    }
    // Projects a docket may be allocated to (the actor's own project scope applies; closed projects are shown but cannot be chosen).
    if (searchParams.get("projects") === "1") {
      const jobs = await db.prepare("SELECT id, name, project_number AS number, stage FROM jobs WHERE organisation_id = ? AND lower(status) != 'archived' ORDER BY created_at DESC LIMIT 300").bind(org).all<{id:string;name:string;number:string|null;stage:string|null}>();
      const scope = orgWideProjects(actor) ? null : new Set(await memberProjectIds());
      return Response.json({ projects: jobs.results.filter(j => !scope || scope.has(j.id)).map(j => ({ id: j.id, name: j.name, number: j.number, stage: j.stage || "setup" })) });
    }
    const counted = await db.prepare(`SELECT id, status, links FROM dockets WHERE organisation_id = ? AND lower(status) NOT IN ${UNALLOCATED_EXCLUDED}`).bind(org).all<{id:string;status:string;links:string}>();
    const open = counted.results.filter(r => !jobOf(safeJson(r.links, {})));
    const unallocated = { count: open.length, approved: open.filter(r => r.status === "approved").length };
    if (searchParams.get("unallocated") === "1") {
      const ids = new Set(open.map(r => r.id));
      const rows = await db.prepare(`SELECT ${DOCKET_COLUMNS} FROM dockets WHERE organisation_id = ? AND lower(status) NOT IN ${UNALLOCATED_EXCLUDED} ORDER BY work_date DESC, created_at DESC`).bind(org).all<Record<string,unknown>>();
      return Response.json({ dockets: rows.results.filter(r => ids.has(String(r.id))).slice(0, 500).map(present), unallocated });
    }
    const { start, end } = parseMonth(searchParams.get("month"));
    const result = await db
      .prepare(
        `SELECT ${DOCKET_COLUMNS}
        FROM dockets
        WHERE organisation_id = ? AND ((work_date >= ? AND work_date < ?) OR work_date = '') AND lower(status) != 'archived'
        ORDER BY work_date DESC, created_at DESC`,
      )
      .bind(org, start, end)
      .all();
    return Response.json({ dockets: result.results.map((r: Record<string,unknown>) => present(r)), unallocated });
  } catch (error) {
    console.error("load dockets", error);
    return jsonError("The month could not be loaded.", 503);
  }
}

function parseRecord(value: FormDataEntryValue | Record<string, unknown> | null): DocketInput {
  const raw = typeof value === "string"
    ? JSON.parse(value) as Record<string, unknown>
    : value instanceof File
      ? {}
      : value ?? {};
  return {
    docketNo: cleanText(raw.docketNo, 80) || "UNREAD",
    // An unknown work date stays unknown: never today's date. Undated dockets are listed in every month for review.
    workDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.workDate ?? "")) ? String(raw.workDate) : "",
    client: cleanText(raw.client, 160),
    project: cleanText(raw.project, 200),
    crew: cleanText(raw.crew, 160),
    vehicle: cleanText(raw.vehicle, 80),
    startTime: cleanText(raw.startTime, 20),
    finishTime: cleanText(raw.finishTime, 20),
    breakHours: cleanNumber(raw.breakHours),
    labourHours: cleanNumber(raw.labourHours),
    quantity: cleanNumber(raw.quantity),
    quantityUnit: cleanText(raw.quantityUnit, 20) || "t",
    amount: cleanNumber(raw.amount),
    poNumber: cleanText(raw.poNumber, 80),
    notes: cleanText(raw.notes, 1000),
    status: cleanStatus(raw.status),
    confidence: Math.max(0, Math.min(100, cleanNumber(raw.confidence))),
    sourceName: cleanText(raw.sourceName, 240),
    rawText: cleanText(raw.rawText, 12000),
    sourcePage: cleanNumber(raw.sourcePage) || undefined, sourceCrop: cleanText(raw.sourceCrop,120) || "full-page", fieldConfidence: typeof raw.fieldConfidence === "object" ? raw.fieldConfidence as Record<string,number> : {}, lineItems: Array.isArray(raw.lineItems) ? raw.lineItems as Array<Record<string,unknown>> : [], links: typeof raw.links === "object" ? raw.links as Record<string,string> : {}, extractionMethod: cleanText(raw.extractionMethod,40) || "local-ocr", profileId: cleanText(raw.profileId,120),
  };
}

async function handlePOST(request: Request) {
  try {
    const { db, bucket } = requireBindings();
    const form = await request.formData();
    const input = form.get("records") ?? form.get("record");
    const decoded = typeof input === "string" ? JSON.parse(input) : input;
    const values = Array.isArray(decoded) ? decoded : [decoded];
    if (!values.length || values.length > 200) {
      return jsonError("Upload between 1 and 200 dockets at a time.");
    }
    const records = values.map((value) => parseRecord(value as Record<string, unknown>));
    const invalid = records.flatMap((record, index) => approvalGate(record).map(field => ({ index, field })));
    if (invalid.length) {
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), currentOrganisationId(), "docket.ready.rejected", "rejected", JSON.stringify({ missing: invalid }), now).run();
      return Response.json({ error: "Docket remains Needs Review until mandatory fields are complete.", missing: invalid }, { status: 422 });
    }
    for (const record of records) {
      if (!record.amount && record.lineItems?.length) {
        const calculated = record.lineItems.reduce((sum, item) => sum + (Number(item.amount) || Number(item.quantity || 0) * Number(item.rate || 0)), 0);
        if (calculated > 0) { record.amount = calculated; record.notes = `${record.notes ? `${record.notes} ` : ""}Amount system-calculated from matched line-item rates; confirm before approval.`; }
      }
    }
    const file = form.get("file");
    const now = new Date().toISOString();
    let sourceKey = "";

    if (file instanceof File && file.size > 0) {
      if (file.size > 25 * 1024 * 1024) return jsonError("Each file must be under 25 MB.");
      // Extension, contents and type must agree (PDF or photo only); the stored type is the fixed mapping, never the client's.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const verdict = checkUpload(file.name, bytes, DOCKET_UPLOAD_NAME);
      if (!verdict.ok) return jsonError(verdict.reason, verdict.status);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
      sourceKey = `dockets/${records[0].workDate.slice(0, 7) || "undated"}/${crypto.randomUUID()}-${safeName}`;
      await bucket.put(sourceKey, bytes, {
        httpMetadata: { contentType: verdict.contentType },
      });
    }

    const seen = new Set<string>();
    const saved = [];
    const statements = [];
    for (const record of records) {
      const duplicateKey = `${record.docketNo.toUpperCase()}|${record.workDate}`;
      const duplicate = record.docketNo !== "UNREAD"
        ? await db
          .prepare("SELECT id FROM dockets WHERE organisation_id = ? AND UPPER(docket_no) = ? AND work_date = ? AND lower(status) != 'archived' LIMIT 1")
          .bind(currentOrganisationId(), record.docketNo.toUpperCase(), record.workDate)
          .first()
        : null;
      if (duplicate || seen.has(duplicateKey)) record.status = "duplicate";
      if (record.docketNo !== "UNREAD") seen.add(duplicateKey);
      const id = crypto.randomUUID();
      statements.push(db.prepare(
        `INSERT INTO dockets (
          id, organisation_id, docket_no, work_date, client, project, crew, vehicle,
          start_time, finish_time, break_hours, labour_hours, quantity,
          quantity_unit, amount, po_number, notes, status, confidence,
          source_name, source_key, raw_text, source_page, source_crop, field_confidence, line_items, links, extraction_method, profile_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        currentOrganisationId(),
        record.docketNo,
        record.workDate,
        record.client,
        record.project,
        record.crew,
        record.vehicle,
        record.startTime,
        record.finishTime,
        record.breakHours,
        record.labourHours,
        record.quantity,
        record.quantityUnit,
        record.amount,
        record.poNumber,
        record.notes,
        record.status,
        record.confidence,
        record.sourceName,
        sourceKey,
        record.rawText,
        record.sourcePage ?? null, record.sourceCrop ?? "full-page", JSON.stringify(record.fieldConfidence ?? {}), JSON.stringify(record.lineItems ?? []), JSON.stringify(record.links ?? {}), record.extractionMethod ?? "local-ocr", record.profileId ?? "",
        now,
        now,
      ));
      saved.push({ id, ...record, sourceKey, createdAt: now, updatedAt: now });
    }
    await db.batch(statements);

    return Response.json({ dockets: saved, docket: saved[0] });
  } catch (error) {
    console.error("save docket", error);
    return jsonError("The docket could not be saved.", 503);
  }
}

async function handlePUT(request: Request) {
  try {
    const { db } = requireBindings();
    const raw = (await request.json()) as Record<string, unknown>;
    const id = cleanText(raw.id, 80);
    if (!id) return jsonError("A docket ID is required.");
    const record = parseRecord(raw);
    const missing = approvalGate(record);
    if (missing.length) {
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), currentOrganisationId(), `docket.ready.rejected:${id}`, "rejected", JSON.stringify({ docketId: id, missing }), now).run();
      return Response.json({ error: "Docket remains Needs Review until mandatory fields are complete.", missing }, { status: 422 });
    }
    const now = new Date().toISOString();
    const org = currentOrganisationId();
    const actor = actorContext.getStore()!;
    const sent = (raw.links && typeof raw.links === "object" && !Array.isArray(raw.links)) ? raw.links as Record<string, unknown> : null;
    const first = await db.prepare("SELECT status, links FROM dockets WHERE organisation_id = ? AND id = ?").bind(org, id).first<{ status: string; links: string }>();
    if (!first) return jsonError("The docket was not found.", 404);
    // Coordinated check-and-write. Lock order is always project rows (by id) and then the docket, the same order claims and project
    // closure use (they lock the project first), so a reallocation, a claim and a closure cannot interleave or deadlock. Everything is
    // re-read under the locks; the earlier read above only says which projects to lock.
    const firstFrom = jobOf(safeJson<Record<string, unknown>>(first.links, {}));
    const toLock = [...new Set([firstFrom, jobOf(sent ?? {})].filter(Boolean))].sort();
    const outcome = await tx(async (conn) => {
      const jobs = toLock.length ? await query<{ id: string; stage: string | null; status: string }>("SELECT id, stage, status FROM jobs WHERE organisation_id = ? AND id IN (?) ORDER BY id FOR UPDATE", [org, toLock], conn) : [];
      const previous = await one<{ status: string; links: string; updatedAt: string }>("SELECT status, links, updated_at AS updatedAt FROM dockets WHERE organisation_id = ? AND id = ? FOR UPDATE", [org, id], conn);
      if (!previous) throw new Refusal("The docket was not found.", 404);
      if (["included_claim", "invoiced"].includes(previous.status)) throw new Refusal("This docket has been claimed and is locked. Reverse the claim line before changing it.", 409);
      if ((record.status === "approved" || previous.status === "approved") && record.status !== previous.status && !can(actor.role, "docket.approve")) throw new Refusal("Only an authorised office user can approve or unapprove dockets.", 403);
      if (["included_claim", "invoiced"].includes(record.status)) throw new Refusal("Dockets are marked claimed by the claims workflow, not by editing.", 409);
      // Project allocation. jobId and the allocation sequence are decided here, never taken from the client. Moving or clearing the project of a
      // docket whose cost is posted is an audited cost correction (reverse and re-post, history kept) that needs docket.approve and a reason.
      const stored = safeJson<Record<string, unknown>>(previous.links, {});
      if (jobOf(stored) !== firstFrom) throw new Refusal("This docket's project changed while you were saving. Reload it and try again.", 409);
      const allocation = nextAllocationLinks(stored, sent ?? stored);
      const reason = cleanText(raw.allocationReason, 500);
      // A stale form must not overwrite someone else's allocation or status: a change of project requires the version it was made against, and any
      // request that supplies one is checked against the locked row.
      const expected = cleanText(raw.expectedUpdatedAt, 64);
      if (allocation.changed && !expected) throw new Refusal("Reload the docket before changing its project (expectedUpdatedAt is required).", 422);
      if (expected && expected !== String(previous.updatedAt ?? "")) throw new Refusal("This docket was changed by someone else since you opened it. Reload it and try again.", 409);
      if (allocation.changed) {
        if (allocation.to) {
          const job = jobs.find((j) => j.id === allocation.to);
          if (!job || String(job.status).toLowerCase() === "archived" || (!orgWideProjects(actor) && !await canAccessProject(allocation.to))) throw new Refusal("Project not found.", 404);
          if (job.stage === "closed") throw new Refusal("This project is closed. Reopen it before allocating dockets to it.", 409);
        }
        if (previous.status === "approved") {
          if (!can(actor.role, "docket.approve")) throw new Refusal("Only an authorised office user can move posted costs.", 403);
          if (allocation.from && reason.length < 10) throw new Refusal("Give a reason (at least 10 characters) for moving costs between projects.", 422);
          // Posted costs belong to Projects: with it disabled or read-only the ledger cannot be corrected, so the allocation must not change either.
          if (allocation.from && !await projectsWritable()) throw new Refusal("Projects is not enabled for editing, so costs already posted to a project cannot be moved or cleared.", 409);
        }
      }
      record.links = allocation.links as Record<string, string>;
      // SEAM: approved docket → actual cost (idempotent); leaving approved reverses unclaimed cost.
      const seam = record.status === "approved" || previous.status === "approved" ? await docketCostStatements(id, record.status, { docket_no: record.docketNo, work_date: record.workDate, amount: record.amount, quantity: record.quantity, quantity_unit: record.quantityUnit, labour_hours: record.labourHours, line_items: JSON.stringify(record.lineItems ?? []), links: JSON.stringify(record.links ?? {}), notes: record.notes }, { reason }, conn) : { statements: [], posted: 0, message: null };
      const update = db
        .prepare(
          `UPDATE dockets SET
            docket_no = ?, work_date = ?, client = ?, project = ?, crew = ?, vehicle = ?,
            start_time = ?, finish_time = ?, break_hours = ?, labour_hours = ?, quantity = ?,
            quantity_unit = ?, amount = ?, po_number = ?, notes = ?, status = ?,
            confidence = ?, field_confidence = ?, line_items = ?, links = ?, extraction_method = ?, profile_id = ?, updated_at = ?
          WHERE organisation_id = ? AND id = ? AND status = ?`,
        )
        .bind(
          record.docketNo,
          record.workDate,
          record.client,
          record.project,
          record.crew,
          record.vehicle,
          record.startTime,
          record.finishTime,
          record.breakHours,
          record.labourHours,
          record.quantity,
          record.quantityUnit,
          record.amount,
          record.poNumber,
          record.notes,
          record.status,
          record.confidence, JSON.stringify(record.fieldConfidence ?? {}), JSON.stringify(record.lineItems ?? []), JSON.stringify(record.links ?? {}), record.extractionMethod ?? "local-ocr", record.profileId ?? "",
          now,
          org,
          id,
          previous.status,
        );
      // Allocating a docket that has no posted cost yet is audited too (a correction of posted cost is audited by the seam).
      const allocationAudit = allocation.changed && !(previous.status === "approved" && allocation.from)
        ? [db.prepare("INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(crypto.randomUUID(), org, actor.userId, actor.email, "docket.allocated", "docket", id, allocation.to || allocation.from || null, `Docket ${record.docketNo} ${allocation.to ? "allocated to a project" : "project cleared"}`, JSON.stringify({ projectId: allocation.from || null }), JSON.stringify({ projectId: allocation.to || null }), now)]
        : [];
      for (const statement of [update, ...allocationAudit, ...seam.statements]) {
        const result = await statement.execute(conn);
        if (statement === update && result.meta.changes !== 1) throw new Refusal("This docket changed while you were saving. Reload it and try again.", 409);
      }
      return seam;
    });
    return Response.json({ docket: { ...raw, ...record, id, updatedAt: now }, costLinesPosted: outcome.posted, message: outcome.message });
  } catch (error) {
    if (error instanceof Refusal) return jsonError(error.message, error.status);
    if ([409, 422].includes((error as { status?: number }).status ?? 0)) return jsonError((error as Error).message, (error as { status: number }).status);
    console.error("update docket", error);
    return jsonError("Changes could not be saved.", 503);
  }
}

async function handleDELETE(request: Request) {
  try {
    const { db, bucket } = requireBindings();
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    if (!id) return jsonError("A docket ID is required.");

    const row = await db
      .prepare("SELECT source_key AS sourceKey, status FROM dockets WHERE organisation_id = ? AND id = ?")
      .bind(currentOrganisationId(), id)
      .first<{ sourceKey: string; status: string }>();
    if (!row) return jsonError("The docket was not found.", 404);
    if (["approved", "included_claim", "invoiced"].includes(row.status)) return jsonError("Approved or claimed dockets carry posted costs and cannot be deleted. Return the docket to review first.", 409);

    await db.prepare("DELETE FROM dockets WHERE organisation_id = ? AND id = ?").bind(currentOrganisationId(), id).run();

    if (row.sourceKey) {
      const sharedFile = await db
        .prepare("SELECT id FROM dockets WHERE organisation_id = ? AND source_key = ? LIMIT 1")
        .bind(currentOrganisationId(), row.sourceKey)
        .first();
      if (!sharedFile) {
        try {
          await bucket.delete(row.sourceKey);
        } catch (error) {
          console.error("delete docket source", error);
        }
      }
    }

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("delete docket", error);
    return jsonError("The docket could not be deleted.", 503);
  }
}

export const GET=withActor(handleGET,'read','dockets');

export const POST=withActor(handlePOST,'write','dockets');

export const PUT=withActor(handlePUT,'write','dockets');

export const DELETE=withActor(handleDELETE,'write','dockets');
