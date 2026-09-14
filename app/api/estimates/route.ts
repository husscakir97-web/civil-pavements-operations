import {
  DEFAULT_RATE_LIBRARY,
  ESTIMATE_STATUSES,
  calculateEstimate,
  normaliseEstimateData,
  validateEstimate,
  type EstimateData,
  type EstimateStatus,
  type EstimateTotals,
  type RateLibrary,
  type ValidationResult,
} from "@/lib/estimate-calculations";
import {
  DEFAULT_ORGANISATION_ID,
  cleanText,
  jsonError,
  nowIso,
  requireEstimateDb,
  safeJson,
  type GenericRow,
} from "@/lib/estimates-db";
import { requireActor } from '@/lib/authz';

export const dynamic = "force-dynamic";

type EstimateMetadata = {
  status: EstimateStatus;
  revisionNumber: number;
  currentRevisionId: string;
  data: EstimateData;
  totals: EstimateTotals;
  validation: ValidationResult;
  jobId?: string;
  approvedRevisionId?: string;
  approvedBudget?: EstimateTotals;
  approvedSnapshot?: EstimateData;
  awardedAt?: string;
  reopenedAt?: string;
  previousStatus?: EstimateStatus;
  lastReason?: string;
  updatedAt?: string;
};

function isStatus(value: unknown): value is EstimateStatus {
  return typeof value === "string" && ESTIMATE_STATUSES.includes(value as EstimateStatus);
}

function parseMetadata(value: unknown): Partial<EstimateMetadata> {
  return safeJson<Partial<EstimateMetadata>>(value, {});
}

function rowToEstimate(row: GenericRow) {
  const metadata = parseMetadata(row.metadata);
  const data = normaliseEstimateData(metadata.data ?? {}, DEFAULT_RATE_LIBRARY);
  const totals = metadata.totals ?? calculateEstimate(data);
  const validation = metadata.validation ?? validateEstimate(data, totals);
  const status = isStatus(metadata.status) ? metadata.status : isStatus(row.status) ? row.status : "Draft";
  return {
    id: row.id,
    name: row.name,
    status,
    createdAt: row.created_at,
    updatedAt: metadata.updatedAt ?? row.created_at,
    revisionNumber: Number(metadata.revisionNumber ?? 1),
    currentRevisionId: metadata.currentRevisionId ?? "",
    data,
    totals,
    validation,
    jobId: metadata.jobId ?? null,
    approvedRevisionId: metadata.approvedRevisionId ?? null,
    approvedBudget: metadata.approvedBudget ?? null,
    approvedSnapshot: metadata.approvedSnapshot ?? null,
    awardedAt: metadata.awardedAt ?? null,
    reopenedAt: metadata.reopenedAt ?? null,
    lastReason: metadata.lastReason ?? "",
  };
}

function metadataFor(
  data: EstimateData,
  totals: EstimateTotals,
  validation: ValidationResult,
  status: EstimateStatus,
  revisionNumber: number,
  currentRevisionId: string,
  previous: Partial<EstimateMetadata> = {},
): EstimateMetadata {
  return {
    ...previous,
    status,
    revisionNumber,
    currentRevisionId,
    data,
    totals,
    validation,
    updatedAt: nowIso(),
  };
}

async function getRateLibraries(db: D1Database): Promise<RateLibrary[]> {
  const result = await db
    .prepare("SELECT id, organisation_id, name, status, metadata, created_at FROM rate_libraries WHERE organisation_id = ? ORDER BY created_at ASC")
    .bind(DEFAULT_ORGANISATION_ID)
    .all<GenericRow>();
  if (result.results.length > 0) {
    return result.results.map((row) => ({
      ...DEFAULT_RATE_LIBRARY,
      ...safeJson<RateLibrary>(row.metadata, {} as RateLibrary),
      id: row.id,
      name: row.name,
    }));
  }
  const now = nowIso();
  await db
    .prepare(
      `INSERT OR IGNORE INTO rate_libraries (id, organisation_id, name, status, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      DEFAULT_RATE_LIBRARY.id,
      DEFAULT_ORGANISATION_ID,
      DEFAULT_RATE_LIBRARY.name,
      "active",
      JSON.stringify(DEFAULT_RATE_LIBRARY),
      now,
    )
    .run();
  return [DEFAULT_RATE_LIBRARY];
}

async function getLookups(db: D1Database) {
  const [clientsResult, opportunitiesResult, jobsResult, docketClientsResult] = await Promise.all([
    db.prepare("SELECT id, name, contact_name AS contactName, email, phone FROM clients WHERE organisation_id = ? ORDER BY name").bind(DEFAULT_ORGANISATION_ID).all(),
    db.prepare("SELECT id, name, status, metadata, created_at AS createdAt FROM opportunities WHERE organisation_id = ? ORDER BY created_at DESC").bind(DEFAULT_ORGANISATION_ID).all(),
    db.prepare("SELECT id, name, status, metadata, created_at AS createdAt FROM jobs WHERE organisation_id = ? ORDER BY created_at DESC LIMIT 50").bind(DEFAULT_ORGANISATION_ID).all(),
    db.prepare("SELECT client AS name FROM dockets WHERE organisation_id = ? AND TRIM(client) != '' GROUP BY client ORDER BY client LIMIT 50").bind(DEFAULT_ORGANISATION_ID).all<{ name: string }>(),
  ]);
  const clients: Array<{ id: string; name: string; source: string }> = (clientsResult.results as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    source: "client",
  }));
  const known = new Set(clients.map((row) => String(row.name).toLowerCase()));
  for (const row of docketClientsResult.results) {
    if (!known.has(row.name.toLowerCase())) clients.push({ id: `docket-${row.name}`, name: row.name, source: "docket" });
  }
  return {
    clients,
    opportunities: opportunitiesResult.results,
    jobs: jobsResult.results,
  };
}

async function getEstimateRow(db: D1Database, id: string) {
  return db
    .prepare("SELECT id, organisation_id, name, status, metadata, created_at FROM estimates WHERE organisation_id = ? AND id = ? LIMIT 1")
    .bind(DEFAULT_ORGANISATION_ID, id)
    .first<GenericRow>();
}

async function getRevisions(db: D1Database, estimateId: string) {
  const result = await db
    .prepare("SELECT id, name, status, metadata, created_at AS createdAt FROM quote_revisions WHERE organisation_id = ? ORDER BY created_at DESC")
    .bind(DEFAULT_ORGANISATION_ID)
    .all<Record<string, unknown>>();
  return result.results
    .map((row) => {
      const metadata = safeJson<Record<string, unknown>>(row.metadata, {});
      return { ...row, metadata };
    })
    .filter((row) => row.metadata.estimateId === estimateId)
    .sort((a, b) => Number((b.metadata.revisionNumber ?? 0)) - Number((a.metadata.revisionNumber ?? 0)));
}

export async function GET(request: Request) {
  try {
    const db = requireEstimateDb(); await requireActor(request, db, 'read');
    const id = cleanText(new URL(request.url).searchParams.get("id"), 100);
    const libraries = await getRateLibraries(db);
    if (id) {
      const row = await getEstimateRow(db, id);
      if (!row) return jsonError("The estimate was not found.", 404);
      return Response.json({ estimate: rowToEstimate(row), revisions: await getRevisions(db, id), rateLibraries: libraries });
    }
    const result = await db
      .prepare("SELECT id, organisation_id, name, status, metadata, created_at FROM estimates WHERE organisation_id = ? ORDER BY created_at DESC")
      .bind(DEFAULT_ORGANISATION_ID)
      .all<GenericRow>();
    return Response.json({
      estimates: result.results.map(rowToEstimate),
      rateLibraries: libraries,
      ...(await getLookups(db)),
    });
  } catch (error) {
    console.error("load estimates", error);
    return jsonError("Estimates could not be loaded.", 503);
  }
}

function auditStatement(db: D1Database, event: string, estimateId: string, metadata: Record<string, unknown>, now: string) {
  return db.prepare(
    `INSERT INTO audit_events (id, organisation_id, name, status, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), DEFAULT_ORGANISATION_ID, `${event}:${estimateId}`, "recorded", JSON.stringify(metadata), now);
}

function revisionStatement(
  db: D1Database,
  revisionId: string,
  estimateId: string,
  name: string,
  status: EstimateStatus,
  revisionNumber: number,
  data: EstimateData,
  totals: EstimateTotals,
  validation: ValidationResult,
  reason: string,
  now: string,
) {
  return db.prepare(
    `INSERT INTO quote_revisions (id, organisation_id, name, status, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    revisionId,
    DEFAULT_ORGANISATION_ID,
    `${name} · Rev ${revisionNumber}`,
    status,
    JSON.stringify({ estimateId, revisionNumber, data, totals, validation, reason, createdAt: now }),
    now,
  );
}

export async function POST(request: Request) {
  try {
    const db = requireEstimateDb(); await requireActor(request, db, 'write');
    const body = await request.json() as Record<string, unknown>;
    const libraries = await getRateLibraries(db);
    const library = libraries[0] ?? DEFAULT_RATE_LIBRARY;
    const data = normaliseEstimateData(body.data ?? body, library);
    const totals = calculateEstimate(data);
    const validation = validateEstimate(data, totals);
    const requestedStatus = isStatus(body.status) ? body.status : "Draft";
    if (requestedStatus !== "Draft" && validation.errors.length > 0) {
      return jsonError("Resolve validation errors before moving this estimate beyond Draft.", 422, { validation, totals });
    }
    const now = nowIso();
    const id = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const name = data.name || [data.clientName, data.projectName].filter(Boolean).join(" · ") || "New estimate";
    const metadata = metadataFor(data, totals, validation, requestedStatus, 1, revisionId);
    const statements = [
      db.prepare(
        `INSERT INTO estimates (id, organisation_id, name, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(id, DEFAULT_ORGANISATION_ID, name, requestedStatus, JSON.stringify(metadata), now),
      revisionStatement(db, revisionId, id, name, requestedStatus, 1, data, totals, validation, "Created", now),
      auditStatement(db, "estimate.created", id, { status: requestedStatus, revisionNumber: 1 }, now),
    ];
    await db.batch(statements);
    const row = await getEstimateRow(db, id);
    return Response.json({ estimate: row ? rowToEstimate(row) : null, validation, totals }, { status: 201 });
  } catch (error) {
    console.error("create estimate", error);
    return jsonError("The estimate could not be created.", 503);
  }
}

export async function PUT(request: Request) {
  try {
    const db = requireEstimateDb(); await requireActor(request, db, 'write');
    const body = await request.json() as Record<string, unknown>;
    const id = cleanText(body.id, 100);
    if (!id) return jsonError("An estimate ID is required.");
    const row = await getEstimateRow(db, id);
    if (!row) return jsonError("The estimate was not found.", 404);
    const current = rowToEstimate(row);
    const currentMetadata = parseMetadata(row.metadata);
    const libraries = await getRateLibraries(db);
    const data = normaliseEstimateData(body.data ?? current.data, libraries[0] ?? DEFAULT_RATE_LIBRARY);
    const totals = calculateEstimate(data);
    const validation = validateEstimate(data, totals);
    const action = cleanText(body.action, 30);
    const requestedStatus = isStatus(body.status) ? body.status : current.status;
    const status = action === "reopen" ? "Revised" : requestedStatus;
    if (status !== "Draft" && validation.errors.length > 0) {
      return jsonError("Resolve validation errors before moving this estimate beyond Draft.", 422, { validation, totals });
    }
    if (action === "reopen" && current.status !== "Awarded") {
      return jsonError("Only an awarded estimate can be reopened.", 409, { currentStatus: current.status });
    }
    const now = nowIso();
    const revisionNumber = Number(current.revisionNumber || 1) + 1;
    const revisionId = crypto.randomUUID();
    const name = data.name || current.name;
    const nextMetadata = metadataFor(
      data,
      totals,
      validation,
      status,
      revisionNumber,
      revisionId,
      {
        ...currentMetadata,
        ...(action === "reopen" ? { previousStatus: current.status, reopenedAt: now } : {}),
        lastReason: cleanText(body.reason, 500),
      },
    );
    const statements = [
      db.prepare("UPDATE estimates SET name = ?, status = ?, metadata = ? WHERE organisation_id = ? AND id = ?")
        .bind(name, status, JSON.stringify(nextMetadata), DEFAULT_ORGANISATION_ID, id),
      revisionStatement(db, revisionId, id, name, status, revisionNumber, data, totals, validation, cleanText(body.reason, 500) || (action === "reopen" ? "Reopened for revision" : "Saved revision"), now),
      auditStatement(db, action === "reopen" ? "estimate.reopened" : "estimate.revised", id, { status, revisionNumber, reason: cleanText(body.reason, 500) }, now),
    ];
    await db.batch(statements);
    const saved = await getEstimateRow(db, id);
    return Response.json({ estimate: saved ? rowToEstimate(saved) : null, validation, totals, action: action || "save" });
  } catch (error) {
    console.error("save estimate", error);
    return jsonError("The estimate could not be saved.", 503);
  }
}
