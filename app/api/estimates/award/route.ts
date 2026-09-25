import {withActor} from '@/lib/platform/route';
import {packStatements} from '@/lib/ims-pack';
import {
  DEFAULT_RATE_LIBRARY,
  calculateEstimate,
  normaliseEstimateData,
  validateEstimate,
  type EstimateData,
  type EstimateTotals,
  type ValidationResult,
} from "@/lib/estimate-calculations";
import {
  currentOrganisationId,
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
  status?: string;
  revisionNumber?: number;
  currentRevisionId?: string;
  data?: EstimateData;
  totals?: EstimateTotals;
  validation?: ValidationResult;
  jobId?: string;
  approvedRevisionId?: string;
  approvedBudget?: EstimateTotals;
  approvedSnapshot?: EstimateData;
  awardedAt?: string;
  [key: string]: unknown;
};

async function handlePOST(request: Request) {
  try {
    const db = requireEstimateDb(); await requireActor(request, db, 'approve');
    const body = await request.json() as { estimateId?: unknown };
    const estimateId = cleanText(body.estimateId, 100);
    if (!estimateId) return jsonError("An estimate ID is required.");
    const row = await db
      .prepare("SELECT id, organisation_id, name, status, metadata, created_at FROM estimates WHERE organisation_id = ? AND id = ? LIMIT 1")
      .bind(currentOrganisationId(), estimateId)
      .first<GenericRow>();
    if (!row) return jsonError("The estimate was not found.", 404);
    const metadata = safeJson<EstimateMetadata>(row.metadata, {});
    if (metadata.jobId) {
      return Response.json({ alreadyAwarded: true, jobId: metadata.jobId, estimateId });
    }
    const data = normaliseEstimateData(metadata.data ?? {}, DEFAULT_RATE_LIBRARY);
    const totals = calculateEstimate(data);
    const validation = validateEstimate(data, totals);
    if (validation.errors.length > 0) {
      return jsonError("Resolve validation errors before awarding this estimate.", 422, { validation, totals });
    }
    const now = nowIso();
    const revisionNumber = Number(metadata.revisionNumber || 1) + 1;
    const revisionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const jobName = data.projectName || data.name || row.name;
    const nextMetadata: EstimateMetadata = {
      ...metadata,
      status: "Awarded",
      revisionNumber,
      currentRevisionId: revisionId,
      data,
      totals,
      validation,
      jobId,
      approvedRevisionId: revisionId,
      approvedBudget: totals,
      approvedSnapshot: data,
      awardedAt: now,
    };
    const revisionMetadata = {
      estimateId,
      revisionNumber,
      data,
      totals,
      validation,
      reason: "Awarded — approved budget baseline",
      approvedBudget: totals,
      createdAt: now,
    };
    const jobMetadata = {
      client: data.clientName,
      site: data.site,
      contractValue: totals.sellRate,
      workType: data.workType,
      scope: data.specification,
      specification: data.specification,
      sourceEstimateId: estimateId,
      sourceOpportunityId: metadata.sourceOpportunityId || null,
      sourceRevisionId: revisionId,
      approvedBudget: totals,
      estimateSnapshot: data,
      awardedAt: now,
      status: "Awarded",
    };
    const requirementCopies = metadata.sourceOpportunityId ? await db.prepare('SELECT * FROM tender_requirements WHERE organisation_id=? AND opportunity_id=?').bind(currentOrganisationId(),String(metadata.sourceOpportunityId)).all<Record<string,unknown>>() : {results:[]};
    await db.batch([
      ...packStatements(db,currentOrganisationId(),jobId,now),
      ...requirementCopies.results.map(r=>db.prepare('INSERT INTO job_ims_items (id,organisation_id,job_id,title,document_type,mandatory,status,source_requirement_id,linked_document_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id').bind(crypto.randomUUID(),currentOrganisationId(),jobId,String(r.title),'Tender requirement',Number(r.mandatory),'Missing',String(r.id),r.linked_document_id || null,JSON.stringify({sourceDocument:r.source_document,sourcePage:r.source_page}),now,now)),
      db.prepare(
        `INSERT INTO jobs (id, organisation_id, name, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(jobId, currentOrganisationId(), jobName, "awarded", JSON.stringify(jobMetadata), now),
      db.prepare("UPDATE estimates SET status = ?, metadata = ? WHERE organisation_id = ? AND id = ?")
        .bind("Awarded", JSON.stringify(nextMetadata), currentOrganisationId(), estimateId),
      db.prepare(
        `INSERT INTO quote_revisions (id, organisation_id, name, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(revisionId, currentOrganisationId(), `${row.name} · Rev ${revisionNumber}`, "Awarded", JSON.stringify(revisionMetadata), now),
      db.prepare(
        `INSERT INTO audit_events (id, organisation_id, name, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), currentOrganisationId(), `estimate.awarded:${estimateId}`, "recorded", JSON.stringify({ jobId, revisionId, approvedBudget: totals }), now),
    ]);
    return Response.json({
      awarded: true,
      job: { id: jobId, name: jobName, status: "awarded", approvedBudget: totals, sourceEstimateId: estimateId, sourceRevisionId: revisionId },
      estimate: { id: estimateId, status: "Awarded", revisionNumber, approvedRevisionId: revisionId, approvedBudget: totals },
      validation,
    }, { status: 201 });
  } catch (error) {
    console.error("award estimate", error);
    return jsonError("The estimate could not be awarded.", 503);
  }
}

export const POST=withActor(handlePOST,'approve','estimating');
