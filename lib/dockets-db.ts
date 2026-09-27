import { env } from '@/lib/platform/runtime';

export { currentOrganisationId } from '@/lib/platform/context';

export type DocketInput = {
  docketNo: string;
  workDate: string;
  client: string;
  project: string;
  crew: string;
  vehicle: string;
  startTime: string;
  finishTime: string;
  breakHours: number;
  labourHours: number;
  quantity: number;
  quantityUnit: string;
  amount: number;
  poNumber: string;
  notes: string;
  status: "uploaded" | "processing" | "review" | "matched" | "approved" | "included_claim" | "invoiced" | "rejected" | "ready" | "duplicate";
  confidence: number;
  sourceName: string;
  rawText: string;
  sourcePage?: number;
  sourceCrop?: string;
  fieldConfidence?: Record<string, number>;
  lineItems?: Array<Record<string, unknown>>;
  links?: Record<string, string>;
  extractionMethod?: string;
  profileId?: string;
};

export function requireBindings() {
  if (!env.DB || !env.BUCKET) {
    throw new Error("Docket storage is temporarily unavailable.");
  }
  return { db: env.DB, bucket: env.BUCKET };
}

export function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function cleanNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cleanStatus(value: unknown): DocketInput["status"] {
  const allowed = ["uploaded","processing","review","matched","approved","included_claim","invoiced","rejected","duplicate","ready"];
  return allowed.includes(String(value)) ? String(value) as DocketInput["status"] : "review";
}

export function mandatoryMissing(record: DocketInput) {
  const missing: string[] = [];
  if (!record.docketNo || record.docketNo === "UNREAD") missing.push("Docket number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.workDate)) missing.push("Work date");
  if (!record.client) missing.push("Client");
  if (!record.project) missing.push("Project or site");
  const type = String(record.links?.docketType || record.links?.type || "").toLowerCase();
  if (/(labour|labor|plant|traffic|hire)/.test(type) && !record.startTime) missing.push("Start time");
  if (/(labour|labor|plant|traffic|hire)/.test(type) && !record.finishTime) missing.push("Finish time");
  if (/(material|delivery|asphalt|weighbridge|cartage)/.test(type) && !(record.quantity > 0 || (record.lineItems?.length ?? 0) > 0)) missing.push("Quantity");
  return missing;
}

export function parseMonth(month: string | null) {
  const safe = /^\d{4}-\d{2}$/.test(month ?? "")
    ? month!
    : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = safe.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return { start: `${safe}-01`, end: next };
}
