import {withActor} from '@/lib/platform/route';
import { DEFAULT_RATE_LIBRARY, calculateEstimate, normaliseEstimateData, validateEstimate } from "@/lib/estimate-calculations";
import { currentOrganisationId, jsonError, nowIso, requireEstimateDb, safeJson } from "@/lib/estimates-db";

async function handlePOST(request: Request) {
  try {
    const db = requireEstimateDb();
    const { opportunityId } = await request.json() as { opportunityId?: string };
    if (!opportunityId) return jsonError("An opportunity ID is required.");
    const opportunity = await db.prepare("SELECT id,name,status,metadata FROM opportunities WHERE organisation_id=? AND id=?").bind(currentOrganisationId(), opportunityId).first<{id:string;name:string;status:string;metadata:string}>();
    if (!opportunity) return jsonError("Opportunity not found.", 404);
    const meta = safeJson<Record<string, unknown>>(opportunity.metadata, {});
    if (meta.convertedEstimateId) return Response.json({ estimateId: meta.convertedEstimateId, alreadyConverted: true });
    const data = normaliseEstimateData({ name: opportunity.name, clientName: meta.client ?? meta.builder ?? "", projectName: meta.project ?? opportunity.name, site: meta.site ?? meta.location ?? "", workType: meta.workTypes ?? meta.workPackages ?? "", specification: meta.workPackages ?? "", notes: meta.notes ?? meta.nextAction ?? "" }, DEFAULT_RATE_LIBRARY);
    const totals = calculateEstimate(data); const validation = validateEstimate(data, totals); const now = nowIso(); const estimateId = crypto.randomUUID(); const revisionId = crypto.randomUUID();
    const estimateMeta = { status: "Draft", revisionNumber: 1, currentRevisionId: revisionId, data, totals, validation, sourceOpportunityId: opportunityId, createdAt: now, updatedAt: now };
    await db.batch([
      db.prepare("INSERT INTO estimates (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)").bind(estimateId, currentOrganisationId(), data.name || opportunity.name, "Draft", JSON.stringify(estimateMeta), now),
      db.prepare("INSERT INTO quote_revisions (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)").bind(revisionId, currentOrganisationId(), `${opportunity.name} · Rev 1`, "Draft", JSON.stringify({ estimateId, revisionNumber: 1, data, totals, validation, reason: "Converted from opportunity" }), now),
      db.prepare("UPDATE opportunities SET metadata=? WHERE organisation_id=? AND id=?").bind(JSON.stringify({ ...meta, convertedEstimateId: estimateId, convertedAt: now }), currentOrganisationId(), opportunityId),
      db.prepare("INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), currentOrganisationId(), `opportunity.converted:${opportunityId}`, "recorded", JSON.stringify({ estimateId }), now),
    ]);
    return Response.json({ estimateId, estimate: { id: estimateId, status: "Draft", data, totals }, opportunityId }, { status: 201 });
  } catch (error) { console.error(error); return jsonError("Opportunity could not be converted.", 503); }
}

export const POST=withActor(handlePOST,'write','pipeline');
