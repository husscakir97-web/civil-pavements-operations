import {currentOrganisationId} from '@/lib/platform/context';
import {withActor} from '@/lib/platform/route';
import { cleanText, requireBindings } from "@/lib/dockets-db";
import { attachmentHeaders, encodeFilename, inlinePreviewType, objectBytes, safeContentType } from "@/lib/platform/upload-safety";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const { db, bucket } = requireBindings();
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    if (!id) return Response.json({ error: "A docket ID is required." }, { status: 400 });
    const row = await db
      .prepare("SELECT source_key AS sourceKey, source_name AS sourceName FROM dockets WHERE organisation_id = ? AND id = ?")
      .bind(currentOrganisationId(), id)
      .first<{ sourceKey: string; sourceName: string }>();
    if (!row?.sourceKey) return Response.json({ error: "The original file is unavailable." }, { status: 404 });
    const object = await bucket.get(row.sourceKey);
    if (!object) return Response.json({ error: "The original file is unavailable." }, { status: 404 });
    // Inline previews only for PDF/photos whose extension, stored MIME AND file signature all agree; everything else
    // (legacy rows included) is a download with a fixed type. nosniff is always set.
    const declared = new Headers();
    object.writeHttpMetadata(declared);
    const bytes = await objectBytes(object);
    const previewType = inlinePreviewType(row.sourceName, declared.get("Content-Type"), bytes);
    if (!previewType) return new Response(bytes as BodyInit, { headers: attachmentHeaders(row.sourceName, safeContentType(row.sourceName)) });
    return new Response(bytes as BodyInit, { headers: {
      "Content-Type": previewType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeFilename(row.sourceName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=120",
    } });
  } catch (error) {
    console.error("load docket file", error);
    return Response.json({ error: "The original file could not be opened." }, { status: 503 });
  }
}

export const GET=withActor(handleGET,'read','dockets');
