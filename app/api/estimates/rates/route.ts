import {withActor} from '@/lib/platform/route';
import {actorContext} from '@/lib/platform/context';
import {
  DEFAULT_RATE_LIBRARY,
  type RateItem,
  type RateLibrary,
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

function normaliseItems(value: unknown): RateItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const parsed = Number(raw.rate);
    return {
      id: cleanText(raw.id, 80) || `item-${index + 1}`,
      name: cleanText(raw.name, 120) || "Rate item",
      unit: cleanText(raw.unit, 40) || "item",
      rate: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
      notes: cleanText(raw.notes, 240),
    };
  });
}

function normaliseLibrary(value: unknown): RateLibrary {
  const raw = (value ?? {}) as Record<string, unknown>;
  const numberValue = (input: unknown, fallback: number) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };
  return {
    id: cleanText(raw.id, 100),
    name: cleanText(raw.name, 160) || DEFAULT_RATE_LIBRARY.name,
    targetMarginPct: numberValue(raw.targetMarginPct, DEFAULT_RATE_LIBRARY.targetMarginPct),
    gstPct: numberValue(raw.gstPct, DEFAULT_RATE_LIBRARY.gstPct),
    materials: normaliseItems(raw.materials),
    labour: normaliseItems(raw.labour),
    plant: normaliseItems(raw.plant),
    traffic: normaliseItems(raw.traffic),
    subcontractors: normaliseItems(raw.subcontractors),
    allowances: normaliseItems(raw.allowances),
  };
}

async function handlePOST(request: Request) {
  try {
    const db = requireEstimateDb(); await requireActor(request, db, 'admin');
    const input = await request.json() as Record<string,unknown>;
    const previous = input.id ? await db.prepare('SELECT metadata FROM rate_libraries WHERE organisation_id=? AND id=?').bind(currentOrganisationId(), cleanText(input.id,100)).first<{metadata:string}>() : null;
    const library = normaliseLibrary({...safeJson<Record<string,unknown>>(previous?.metadata,{}),...input});
    const id = library.id || crypto.randomUUID();
    const now = nowIso();
    const result = await db.prepare("SELECT id FROM rate_libraries WHERE organisation_id = ? AND id = ? LIMIT 1")
      .bind(currentOrganisationId(), id).first<{ id: string }>();
    if (result) {
      await db.prepare("UPDATE rate_libraries SET name = ?, status = ?, metadata = ? WHERE organisation_id = ? AND id = ?")
        .bind(library.name, "active", JSON.stringify({ ...library, id }), currentOrganisationId(), id).run();
    } else {
      await db.prepare(
        `INSERT INTO rate_libraries (id, organisation_id, name, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(id, currentOrganisationId(), library.name, "active", JSON.stringify({ ...library, id }), now).run();
    }
    const actor = actorContext.getStore()!;
    await db.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,summary,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), currentOrganisationId(), actor.userId, actor.email, result ? 'rates.updated' : 'rates.created', 'rate_library', id, `Rate library ${library.name} ${result ? 'updated' : 'created'}. Approved estimate revisions keep their frozen rates.`, previous?.metadata ?? null, JSON.stringify({ ...library, id }), now).run();
    return Response.json({ rateLibrary: { ...library, id } });
  } catch (error) {
    console.error("save rate library", error);
    return jsonError("The rate library could not be saved.", 503);
  }
}

async function handlePUT(request: Request) {
  return POST(request);
}

async function handleGET(request: Request) {
  try {
    const db = requireEstimateDb(); await requireActor(request, db, 'read');
    const result = await db.prepare("SELECT id, organisation_id, name, status, metadata, created_at FROM rate_libraries WHERE organisation_id = ? ORDER BY created_at ASC")
      .bind(currentOrganisationId()).all<GenericRow>();
    return Response.json({ rateLibraries: result.results.map((row) => ({ ...DEFAULT_RATE_LIBRARY, ...safeJson<RateLibrary>(row.metadata, DEFAULT_RATE_LIBRARY), id: row.id, name: row.name })) });
  } catch (error) {
    console.error("load rate libraries", error);
    return jsonError("Rate libraries could not be loaded.", 503);
  }
}

export const POST=withActor(handlePOST,'admin','estimating');

export const PUT=withActor(handlePUT,'admin','estimating');

export const GET=withActor(handleGET,'read','estimating');
