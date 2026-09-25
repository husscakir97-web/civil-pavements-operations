import {withActor} from '@/lib/platform/route';
import {jsonError,cleanText} from '@/lib/estimates-db';
import {HttpError} from '@/lib/platform/http';
import {awardEstimate} from '@/lib/seams/award-to-project';
export const dynamic = "force-dynamic";
// Direct (non-tender) award. Requires an approved estimate revision; the
// project baseline is created from that frozen revision by the award seam.
async function handlePOST(request: Request) {
  try {
    const body = await request.json() as { estimateId?: unknown };
    const estimateId = cleanText(body.estimateId, 100);
    if (!estimateId) return jsonError("An estimate ID is required.");
    const result = await awardEstimate(estimateId);
    if ('alreadyAwarded' in result && result.alreadyAwarded) return Response.json({ alreadyAwarded: true, jobId: result.jobId, estimateId });
    if (!result.projectCreated) return Response.json(result, { status: 201 });
    const r = result as Extract<typeof result, { baselineId: string }>;
    return Response.json({
      awarded: true,
      job: { id: r.jobId, name: r.name, status: "awarded", projectNumber: r.projectNumber, approvedBudget: r.approvedBudget, sourceEstimateId: estimateId, sourceRevisionId: r.estimateRevisionId },
      estimate: { id: estimateId, status: "Awarded", approvedRevisionId: r.estimateRevisionId, approvedBudget: r.approvedBudget },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.message, error.status, error.details);
    console.error("award estimate", error);
    return jsonError("The estimate could not be awarded.", 503);
  }
}
export const POST=withActor(handlePOST,'approve','estimating');
