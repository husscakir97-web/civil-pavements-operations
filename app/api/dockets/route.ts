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
import { actorContext } from '@/lib/platform/context';
import { can } from '@/lib/platform/permissions';
import { docketCostStatements } from '@/lib/seams/docket-to-cost';

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function handleGET(request: Request) {
  try {
    const { db } = requireBindings();
    const { searchParams } = new URL(request.url);
    const { start, end } = parseMonth(searchParams.get("month"));
    const result = await db
      .prepare(
        `SELECT id, docket_no AS docketNo, work_date AS workDate,
          client, project, crew, vehicle, start_time AS startTime,
          finish_time AS finishTime, break_hours AS breakHours,
          labour_hours AS labourHours, quantity, quantity_unit AS quantityUnit,
          amount, po_number AS poNumber, notes, status, confidence,
          source_name AS sourceName, raw_text AS rawText, source_page AS sourcePage, source_crop AS sourceCrop, field_confidence AS fieldConfidence, line_items AS lineItems, links, extraction_method AS extractionMethod, profile_id AS profileId,
          created_at AS createdAt, updated_at AS updatedAt
        FROM dockets
        WHERE organisation_id = ? AND work_date >= ? AND work_date < ? AND lower(status) != 'archived'
        ORDER BY work_date DESC, created_at DESC`,
      )
      .bind(currentOrganisationId(), start, end)
      .all();
    return Response.json({ dockets: result.results.map((r: Record<string,unknown>) => ({...r,
      fieldConfidence: safeJson(r.fieldConfidence, {}),
      lineItems: safeJson(r.lineItems, []),
      links: safeJson(r.links, {}),
    })) });
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
    workDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.workDate ?? ""))
      ? String(raw.workDate)
      : new Date().toISOString().slice(0, 10),
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
    const invalid = records.flatMap((record, index) => record.status === "ready" ? mandatoryMissing(record).map(field => ({ index, field })) : []);
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
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
      sourceKey = `dockets/${records[0].workDate.slice(0, 7)}/${crypto.randomUUID()}-${safeName}`;
      await bucket.put(sourceKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
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
    const missing = record.status === "ready" ? mandatoryMissing(record) : [];
    if (missing.length) {
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), currentOrganisationId(), `docket.ready.rejected:${id}`, "rejected", JSON.stringify({ docketId: id, missing }), now).run();
      return Response.json({ error: "Docket remains Needs Review until mandatory fields are complete.", missing }, { status: 422 });
    }
    const now = new Date().toISOString();
    const previous = await db.prepare("SELECT status FROM dockets WHERE organisation_id = ? AND id = ?").bind(currentOrganisationId(), id).first<{ status: string }>();
    if (!previous) return jsonError("The docket was not found.", 404);
    if (["included_claim", "invoiced"].includes(previous.status)) return jsonError("This docket has been claimed and is locked. Reverse the claim line before changing it.", 409);
    const actor = actorContext.getStore()!;
    if ((record.status === "approved" || previous.status === "approved") && record.status !== previous.status && !can(actor.role, "docket.approve")) return jsonError("Only an authorised office user can approve or unapprove dockets.", 403);
    if (["included_claim", "invoiced"].includes(record.status)) return jsonError("Dockets are marked claimed by the claims workflow, not by editing.", 409);
    // SEAM: approved docket → actual cost (idempotent); leaving approved reverses unclaimed cost.
    const seam = record.status === "approved" || previous.status === "approved" ? await docketCostStatements(id, record.status, { docket_no: record.docketNo, work_date: record.workDate, amount: record.amount, quantity: record.quantity, quantity_unit: record.quantityUnit, labour_hours: record.labourHours, line_items: JSON.stringify(record.lineItems ?? []), links: JSON.stringify(record.links ?? {}), notes: record.notes }) : { statements: [], posted: 0, message: null };
    const update = db
      .prepare(
        `UPDATE dockets SET
          docket_no = ?, work_date = ?, client = ?, project = ?, crew = ?, vehicle = ?,
          start_time = ?, finish_time = ?, break_hours = ?, labour_hours = ?, quantity = ?,
          quantity_unit = ?, amount = ?, po_number = ?, notes = ?, status = ?,
          confidence = ?, field_confidence = ?, line_items = ?, links = ?, extraction_method = ?, profile_id = ?, updated_at = ?
        WHERE organisation_id = ? AND id = ?`,
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
        currentOrganisationId(),
        id,
      );
    await db.batch([update, ...seam.statements]);
    return Response.json({ docket: { ...raw, ...record, id, updatedAt: now }, costLinesPosted: seam.posted, message: seam.message });
  } catch (error) {
    if ((error as { status?: number }).status === 409) return jsonError((error as Error).message, 409);
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
