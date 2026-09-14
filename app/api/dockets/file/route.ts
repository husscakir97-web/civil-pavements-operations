import { cleanText, requireBindings } from "@/lib/dockets-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, bucket } = requireBindings();
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    if (!id) return Response.json({ error: "A docket ID is required." }, { status: 400 });
    const row = await db
      .prepare("SELECT source_key AS sourceKey, source_name AS sourceName FROM dockets WHERE organisation_id = ? AND id = ?")
      .bind("roadworx-sydney", id)
      .first<{ sourceKey: string; sourceName: string }>();
    if (!row?.sourceKey) return Response.json({ error: "The original file is unavailable." }, { status: 404 });
    const object = await bucket.get(row.sourceKey);
    if (!object) return Response.json({ error: "The original file is unavailable." }, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Disposition", `inline; filename="${row.sourceName.replaceAll('"', "")}"`);
    headers.set("Cache-Control", "private, max-age=120");
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("load docket file", error);
    return Response.json({ error: "The original file could not be opened." }, { status: 503 });
  }
}
