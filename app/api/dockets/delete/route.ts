import {withActor} from '@/lib/platform/route';
import { cleanText, requireBindings, currentOrganisationId } from "@/lib/dockets-db";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function handlePOST(request: Request) {
  try {
    const { db } = requireBindings();
    const input = (await request.json()) as { id?: unknown };
    const id = cleanText(input.id, 80);
    if (!id) return jsonError("A docket ID is required.");

    const row = await db
      .prepare("SELECT source_key AS sourceKey, status FROM dockets WHERE organisation_id = ? AND id = ?")
      .bind(currentOrganisationId(), id)
      .first<{ sourceKey: string; status: string }>();
    if (!row) return jsonError("The docket was not found. It may already have been deleted.", 404);
    if (["approved", "included_claim", "invoiced"].includes(row.status)) return jsonError("Approved or claimed dockets carry posted costs and cannot be archived. Return the docket to review first.", 409);

    const result = await db.prepare("UPDATE dockets SET status = 'archived' WHERE organisation_id = ? AND id = ?").bind(currentOrganisationId(), id).run();
    if (!result.success) return jsonError("The docket could not be deleted.", 503);

    return Response.json({ archived: true, id });
  } catch (error) {
    console.error("delete docket", error);
    return jsonError("The docket could not be deleted.", 503);
  }
}

export const POST=withActor(handlePOST,'write','dockets');
