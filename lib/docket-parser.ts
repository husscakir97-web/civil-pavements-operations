export type DocketStatus = "uploaded" | "processing" | "review" | "matched" | "approved" | "included_claim" | "invoiced" | "rejected" | "ready" | "duplicate";

export type DocketRecord = {
  id: string;
  updatedAt?: string;
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
  status: DocketStatus;
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
  // Client-side only (not stored): every contributing page and every warning, so assembly never loses either.
  pages?: number[];
  warnings?: string[];
};

type SourceContext = {
  pageNumber?: number;
  pageCount?: number;
  sectionNumber?: number;
  sectionCount?: number;
};

const labelBoundary =
  /\||(?=\s+(?:docket|dkt|ticket|date|client|customer|project|job|site|location|start|finish|total|amount|p\.?o\.?|wol|rego|vehicle|quantity|qty|crew|employee|operator|driver|supervisor)\b\s*[:#-])/i;

function tidyText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/O\s*r\s*d\s*e\s*r\s+N\s*o\.?/gi, "Order No.")
    .replace(/J\s*o\s*b\s+L\s*o\s*c\s*a\s*t\s*i\s*o\s*n/gi, "Job Location")
    .replace(/R\s*e\s*g\s*o\s*\/\s*T\s*f\s*N\s*S\s*W\s+I\s*t\s*e\s*(?:m|in)\s+N\s*o\.?/gi, "Rego / TfNSW Item No.")
    .replace(/I\s*t\s*e\s*m\s+D\s*e\s*s\s*c\s*r\s*i\s*p\s*t\s*i\s*o\s*n/gi, "Item Description")
    .replace(/[ \t]*\|[ \t]*(?=(?:date|client|customer|project|site|start|finish|rego|vehicle|quantity|qty|order|po|docket)\b)/gi, '\n')
    .replace(/[ \t]{2,}(?=(?:date|client|customer|project|site|start|finish|rego|vehicle|quantity|qty|order|po|docket)\b[ \t]*(?:no\.?|number|time)?[ \t]*[:#])/gi, '\n')
    .replace(/((?:job location|client|customer|project|site|date|operator|driver|order no))[. :]+(?=\n|$)/gi, '$1:')
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").replace(/ {3,}/g, "  ").trim())
    .filter(Boolean)
    .join("\n");
}

function cleanValue(value: string) {
  // A value that is itself a label ("Project:") means the field was left blank and the next printed label was captured.
  if (/^[a-z][a-z .\/&-]{1,30}:\s*$/i.test(value.trim())) return '';
  if (/^(?:job\s*site|job\s*ste|contact|day|rego\s*no\.?|customer\s*(?:name|sign)?|operator|sign|date|start\s*time|finish\s*time|total\s*hours)[\s:._-]*$/i.test(value.trim())) return '';
  if (/^(?:overtime|shift|date|contractor|item description|day of the week|start|finish|totals?|signature)\b/i.test(value.trim())) return '';
  return value
    .split(labelBoundary)[0]
    .split(/\.{4,}|_{4,}|-{6,}/)[0]
    .replace(/^[\s:#.=\-]+|[\s|]+$/g, "")
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, 200);
}

function isReadableValue(value: string, minimumLetters = 3) {
  const compact = value.replace(/\s/g, "");
  if (!compact || (value.match(/[a-z]/gi)?.length ?? 0) < minimumLetters) return false;
  const readable = compact.match(/[a-z0-9&'(),./+\-]/gi)?.length ?? 0;
  const punctuation = compact.match(/[<>^{}@$*\\|]/g)?.length ?? 0;
  if (readable / compact.length < 0.72 || punctuation > 1) return false;
  return !/(?:odometer read|signature|staff no|time lost|total payable|attachments?|mins|hrs)$/i.test(value);
}

function readableField(text: string, patterns: RegExp[], minimumLetters = 3) {
  const value = field(text, patterns);
  return isReadableValue(value, minimumLetters) ? value : "";
}

function referenceField(text: string, patterns: RegExp[]) {
  const value = field(text, patterns).toUpperCase().replace(/\s+/g, "");
  if (!/[0-9]/.test(value) || /[^A-Z0-9./-]/.test(value)) return "";
  return value;
}

function field(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = cleanValue(match[1]);
      if (value) return value;
    }
  }
  return "";
}

function parseNumber(value: string) {
  const normalised = value
    .replace(/[$,]/g, "")
    .replace(/\b[oO](?=\d)/g, "0")
    .replace(/(?<=\d)[oO]\b/g, "0");
  const parsed = Number.parseFloat(normalised);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberField(text: string, patterns: RegExp[]) {
  return parseNumber(field(text, patterns));
}

function normaliseTime(value: string) {
  const raw = value.trim().toLowerCase().replace(".", ":").replace(/\s+/g, "");
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))\s*(am|pm)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || hour > 24) return "";
  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;
  if (hour === 24 && minute !== 0) return "";
  if (hour === 24) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTime(text: string, labels: string) {
  const value = field(text, [
    new RegExp(
      `(?:^|\\n)\\s*(?:${labels})\\s*(?:time)?\\s*[:#=-]?\\s*([0-2]?\\d(?::|\\.)?\\d{2}\\s*(?:am|pm)?)`,
      "im",
    ),
  ]);
  return normaliseTime(value);
}

function makeIsoDate(day: number, month: number, year: number) {
  const fullYear = year < 100 ? 2000 + year : year;
  const candidate = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    candidate.getUTCFullYear() !== fullYear
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return "";
  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateValue(value: string) {
  value = value.replace(/(\d)[ \t]*[/.\-~][ \t]*(?=\d)/g, '$1/').replace(/\b(20\d)[ \t]+(\d)\b/g, '$1$2');
  const iso = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return makeIsoDate(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  const australian = value.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2}|\d{2})\b/);
  if (australian) {
    return makeIsoDate(Number(australian[1]), Number(australian[2]), Number(australian[3]));
  }

  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const words = value.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\s*,?\s*(20\d{2}|\d{2})\b/i,
  );
  if (words) {
    const month = months.findIndex((name) => name.startsWith(words[2].toLowerCase()));
    if (month >= 0) return makeIsoDate(Number(words[1]), month + 1, Number(words[3]));
  }
  return "";
}

// Dates that are NOT the date the work was done: when a docket was signed off, printed, invoiced or due.
const NON_WORK_DATE_LINE = /\b(?:sign(?:ed)?[ -]?off|signed|sign[ -]?date|approved|approval|printed|created|issued|invoice[d]?|due|received|generated|submitted|signature|authorised|authorized)\b/i;

function dateInLine(line: string) {
  return parseDateValue(line);
}

/** The date a docket was signed off ("Signed off on 28/09/2026 by …"); never used as the work date. */
export function findSignOffDate(text: string) {
  for (const line of text.split("\n")) {
    const match = line.match(/sign(?:ed)?[ -]?off\b[^\d\n]{0,30}(\d{1,2}[/.\-]\d{1,2}[/.\-](?:20\d{2}|\d{2})|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/i)
      ?? line.match(/\b(?:signed|approved)\b[^\d\n]{0,30}(\d{1,2}[/.\-]\d{1,2}[/.\-](?:20\d{2}|\d{2}))/i);
    if (match) {
      const date = parseDateValue(match[1]);
      if (date) return date;
    }
  }
  return "";
}

/** Layout used by some booking systems: the line after the job / contract reference reads "Client - Project". */
function headerClientProject(text: string) {
  const lines = text.split("\n").slice(0, 25);
  let anchor = -1;
  lines.forEach((line, index) => { if (/^(?:contract[ \t]*(?:code|no|number|ref)|job|booking)\b/i.test(line) && /\d/.test(line)) anchor = index; });
  if (anchor < 0) return { client: "", project: "" };
  for (const line of lines.slice(anchor + 1, anchor + 4)) {
    const match = line.match(/^([A-Za-z][^:\d]{2,80}?)[ \t]+-[ \t]+([^:]{3,120})$/);
    if (match && !/\d{1,2}[:.]\d{2}/.test(line) && !/^(?:start|finish|docket|notes?|worker|physical|signed)/i.test(line)) return { client: match[1].trim(), project: match[2].trim() };
  }
  return { client: "", project: "" };
}

// Job / booking reference and contract reference are distinct from the docket identity, the PO and each other.
export function findJobReference(text: string) {
  for (const line of text.split("\n").slice(0, 40)) {
    const match = line.match(/^(?:job|booking)[ \t]*(?:no\.?|number|ref(?:erence)?|code)?[ \t]*[:#=-]?[ \t]*([a-z0-9][a-z0-9\-/.]*\d[a-z0-9\-/.]*)[ \t]*$/i);
    if (match && !parseDateValue(match[1])) return match[1].toUpperCase();
  }
  return "";
}

export function findContractReference(text: string) {
  for (const line of text.split("\n").slice(0, 40)) {
    const match = line.match(/^contract[ \t]*(?:code|no\.?|number|ref(?:erence)?)[ \t]*[:#=-]?[ \t]*(\S.{1,60})$/i);
    if (match && /[a-z0-9]/i.test(match[1]) && /\d/.test(match[1])) return match[1].replace(/[ \t]+/g, " ").trim().toUpperCase();
  }
  return "";
}

// ---- Docket identity -------------------------------------------------------------------------------------------------
// A docket is identified by a labelled number ("Docket number: 4742"), never by a heading ("WORKS DOCKET") or the page count.
// One rule decides whether a candidate value may be an identity, and it is used by the primary lookup and by every fallback.
const DOCKET_LABEL = String.raw`(?:delivery[ \t]+docket|works?[ \t]+docket|job[ \t]+docket|docket|dkt|ticket|delivery[ \t]+note)`;
const IDENTITY_LINE = new RegExp(String.raw`^[ \t]*([^:\n]{0,45}?)\b${DOCKET_LABEL}[ \t]*(?:(?:no\.?|number|num|id|#)[ \t]*){0,2}(?:[:#=-][ \t]*|[ \t]+)([a-z0-9][a-z0-9\-/.:]{1,})`, "i");
// Other numbers that sit next to the word "docket" but are not this docket's identity.
const NOT_IDENTITY_PREFIX = /\b(?:physical|paper|manual|supplier|customer|client|booking|replaces|replaced|replacing|original|previous|prior|related|cancel(?:s|led)?|amended|amends|see|ref(?:erence)?|contract|job|order|purchase|po)\b/i;

/** The validated identity rule: a value with a digit that is not a date or a time, whose label is not a cross-reference or another number. */
export function acceptableIdentity(raw: string, context = "") {
  const value = raw.trim().replace(/[.\-/:]+$/, "");
  if (value.length < 2 || !/\d/.test(value)) return "";
  if (parseDateValue(value) || /^\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:am|pm)?$/i.test(value)) return "";
  if (NOT_IDENTITY_PREFIX.test(context)) return "";
  return value.toUpperCase();
}

// OCR and some forms stack the value under its label: "Docket number:" then "55621" on the next line. Only an explicit number label counts
// (a bare heading followed by a number is not an identity) and the next line must be a single token.
const STACKED_IDENTITY_LABEL = new RegExp(String.raw`^[ \t]*([^:\n]{0,45}?)\b${DOCKET_LABEL}[ \t]*(?:(?:(?:no\.?|number|num|id|#)[ \t]*){1,2}[:#=-]?|[:#=-])[ \t]*$`, "i");

export function docketIdentities(text: string) {
  const found: Array<{ value: string; index: number }> = [];
  const lines = text.split("\n");
  let offset = 0;
  lines.forEach((line, lineIndex) => {
    const match = line.match(IDENTITY_LINE);
    let value = match ? acceptableIdentity(match[2], match[1]) : "";
    if (!value) {
      const stacked = line.match(STACKED_IDENTITY_LABEL);
      const next = (lines[lineIndex + 1] ?? "").trim();
      if (stacked && /^[a-z0-9][a-z0-9\-/.:]{1,}$/i.test(next)) value = acceptableIdentity(next, stacked[1]);
    }
    if (value) found.push({ value, index: offset });
    offset += line.length + 1;
  });
  return found;
}

// ---- Resource table (rows of people / plant with times and hours) -----------------------------------------------------
type ResourceRow = {
  role: string; name: string; date: string; start: string; finish: string;
  breakHours: number; travelHours: number; hours: number; hoursFrom: "document" | "times" | "last-value";
  rate: number | null; amount: number | null; plant: boolean; yearInferred: boolean; ambiguous: boolean; mismatch: boolean; line: string;
};
const VEHICLE_ROLE = /^(?:ute|truck|vehicle|van|trailer|tma|vms|awv|ptcd|bus|car|tipper|plant)$/i;
const RESOURCE_ROW = /^([A-Za-z][A-Za-z/&. ]{0,24}?)[ \t]*:[ \t]*(.+?)[ \t]+(?:(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)[ \t]+)?(\d{1,2}[:.]\d{2})[ \t]+(\d{1,2}[:.]\d{2})((?:[ \t]+(?:\d+(?:\.\d+)?|-))*)[ \t]*$/;

/** True for a line that is one resource row (used to avoid counting a row twice when pages repeat it). */
export function isResourceRowLine(line: string) {
  return RESOURCE_ROW.test(line.trim());
}

const COLUMN_WORDS = /\b(?:first|break|travel|lafha|total|hours?|rate|amount|allowance)\b/g;

function resourceColumns(lines: string[]) {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!(/\bstart\b/.test(lower) && /\bfinish\b/.test(lower) && /\b(?:break|travel|lafha|total|hours?)\b/.test(lower))) continue;
    const afterFinish = lower.slice(lower.indexOf("finish") + 6)
      .replace(/\bon[ \t]+site\b/g, " ")
      // compound column names are one column each
      .replace(/\b(?:first|unpaid|meal|lunch)[ \t]+break\b|\bbreak[ \t]+(?:time|hours?)\b/g, "break")
      .replace(/\btravel[ \t]+(?:time|hours?)\b/g, "travel")
      .replace(/\b(?:total|paid|worked)[ \t]+hours?\b|\bhours[ \t]+(?:total|worked)\b/g, "total");
    // A lone "first" is the top half of a two-line "First / Break" header.
    const columns = (afterFinish.match(COLUMN_WORDS) ?? []).map((word) => word === "first" ? "break" : word === "hour" ? "hours" : word);
    const duplicates = new Set(columns).size !== columns.length;
    const bothTotals = columns.includes("total") && columns.includes("hours");
    return { columns, ambiguous: duplicates || bothTotals || columns.length === 0 };
  }
  return { columns: [] as string[], ambiguous: false };
}

function rowDate(value: string | undefined, signOff: string) {
  if (!value) return "";
  const parts = value.split("/").map(Number);
  if (parts.length === 3) return makeIsoDate(parts[0], parts[1], parts[2]);
  if (!signOff) return "";
  // No year printed: the work was done on or before the sign-off, in the nearest such year.
  const signYear = Number(signOff.slice(0, 4));
  const candidate = makeIsoDate(parts[0], parts[1], signYear);
  if (!candidate) return "";
  return candidate > signOff ? makeIsoDate(parts[0], parts[1], signYear - 1) : candidate;
}

export function parseResourceTable(text: string, signOff = "") {
  const lines = text.split("\n");
  const header = resourceColumns(lines);
  const columns = header.columns;
  const rows: ResourceRow[] = [];
  const vehicles: string[] = [];
  for (const line of lines) {
    const match = line.match(RESOURCE_ROW);
    if (match) {
      const start = normaliseTime(match[4]);
      const finish = normaliseTime(match[5]);
      if (!start || !finish) continue;
      const values = (match[6].trim() ? match[6].trim().split(/[ \t]+/) : []);
      const numeric = values.map((value) => value === "-" ? null : Number(value));
      const named: Record<string, number | null> = {};
      // Columns are only trusted when the header is recognised and matches the number of values; otherwise the row is flagged, never reinterpreted.
      const reliable = columns.length > 0 && !header.ambiguous && values.length === columns.length;
      const singleTotal = columns.length === 0 && values.length === 1;
      if (reliable) numeric.forEach((value, index) => { named[columns[index]] = value; });
      else if (singleTotal) named.total = numeric[0];
      const ambiguous = values.length > 0 && !reliable && !singleTotal;
      const breakHours = named.break ?? 0;
      const computed = Math.round(hoursBetween(start, finish, breakHours) * 100) / 100;
      const lastValue = [...numeric].reverse().find((value) => value != null && value > 0 && value <= 24) ?? null;
      const stated = named.total ?? named.hours ?? (ambiguous ? lastValue : null);
      const hours = stated ?? computed;
      rows.push({
        role: match[1].trim(), name: match[2].trim(), date: rowDate(match[3], signOff), start, finish, breakHours,
        travelHours: named.travel ?? 0,
        hours, hoursFrom: ambiguous && stated != null ? "last-value" : stated != null ? "document" : "times",
        rate: named.rate ?? null, amount: named.amount ?? null,
        plant: VEHICLE_ROLE.test(match[1].trim()),
        yearInferred: Boolean(match[3]) && match[3].split("/").length < 3,
        ambiguous,
        mismatch: reliable && stated != null && Math.abs(stated - computed) > 0.25,
        line,
      });
      continue;
    }
    const vehicle = line.match(/^(ute|truck|vehicle|van|trailer|tma|vms|awv|ptcd|tipper)[ \t]*:[ \t]*([A-Z0-9][A-Z0-9 -]{1,12})$/i);
    if (vehicle && /\d/.test(vehicle[2]) && !vehicles.includes(vehicle[2].trim().toUpperCase())) vehicles.push(vehicle[2].trim().toUpperCase());
  }
  const labelled = rows.some((row) => !row.ambiguous) || header.columns.length > 0;
  return { rows, vehicles, columns, headerFound: labelled, ambiguous: rows.some((row) => row.ambiguous) || (rows.length > 0 && header.ambiguous) };
}

/** Where the work date comes from: a labelled work date, then the resource rows, then a single unlabelled date. Never today, never a sign-off. */
function findWorkDate(text: string, rows: ResourceRow[]) {
  for (const line of text.split("\n")) {
    if (NON_WORK_DATE_LINE.test(line)) continue;
    const match = line.match(/^[ \t]*(?:work date|date of work|date worked|service date|docket date|delivery date|shift date|job date|date)[ \t]*[:#=-]?[ \t]*(.+)$/i);
    const labelled = match ? parseDateValue(match[1]) : "";
    if (labelled) return { value: labelled, found: true, from: "label" as const };
  }
  const rowDates = rows.map((row) => row.date).filter(Boolean).sort();
  if (rowDates.length) return { value: rowDates[0], found: true, from: "rows" as const, multiple: new Set(rowDates).size > 1, last: rowDates[rowDates.length - 1] };
  const others = [...new Set(text.split("\n").filter((line) => !NON_WORK_DATE_LINE.test(line)).map(dateInLine).filter(Boolean))];
  if (others.length === 1) return { value: others[0], found: true, from: "text" as const };
  return { value: "", found: false, from: "none" as const };
}

function hoursBetween(start: string, finish: string, breakHours: number) {
  if (!start || !finish) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [finishHour, finishMinute] = finish.split(":").map(Number);
  let minutes = finishHour * 60 + finishMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return Math.max(0, minutes / 60 - breakHours);
}

function inferProfile(text: string) {
  const lower = text.toLowerCase();
  if (/weighbridge|tare weight|gross weight|net weight/.test(lower)) return "Weighbridge / material";
  if (/traffic control|traffic controller|traffic coordinator|tct\b|ptcd|vms\b|tma\b|awv\b|(?:^|\n)\s*tc\s*:/.test(lower)) return "Traffic control";
  if (/asphalt|profil(?:e|ing)|mill(?:ing)?|paver|tonnage|hotmix/.test(lower)) return "Asphalt / profiling";
  if (/plant hire|hired equipment|plant\s*\/\s*truck|machine hours|engine hours|excavator|skid steer|roller|sweeper/.test(lower)) return "Plant / equipment";
  if (/timesheet|time sheet|employee name|labour hours|crew hours/.test(lower)) return "Labour / timesheet";
  if (/delivery docket|delivered to|load no|consignment|quantity delivered/.test(lower)) return "Delivery / cartage";
  return "General works";
}

function quantityDetails(text: string) {
  const labelled = field(text, [
    /(?:^|\n)\s*(?:net weight|total tonnes|total tonnage|quantity delivered|quantity|qty|total units|total loads|area|length)\s*[:#=-]?\s*([\d,.]+\s*(?:tonnes?|tons?|t\b|m2|m²|sqm|m3|m³|cum|lm\b|hours?|hrs?|hr\b|loads?|trips?|shifts?|units?)?)/im,
  ]);
  // Unlabelled values may be opening hours, phone numbers or form instructions.
  const source = labelled;
  const number = source.match(/[\d,.]+/)?.[0] ?? "";
  const lower = source.toLowerCase();
  const unit = /ton|\bt\b/.test(lower) ? "t"
    : /m2|m²|sqm/.test(lower) ? "m²"
      : /m3|m³|cum/.test(lower) ? "m³"
        : /\blm\b/.test(lower) ? "lm"
          : /hour|hrs?|\bhr\b/.test(lower) ? "hr"
            : /load/.test(lower) ? "load"
              : /trip/.test(lower) ? "trip"
                : /shift/.test(lower) ? "shift" : "unit";
  return { quantity: parseNumber(number), unit };
}

function filenameReference(fileName: string) {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const labelled = base.match(
    /(?:docket|dkt|ticket)[_\s-]*(?:no|number)?[_\s-]*([a-z0-9][a-z0-9_-]{2,})/i,
  );
  const reference = labelled?.[1]
    ?? '';
  return reference ? acceptableIdentity(reference.replaceAll("_", "-")) : '';
}

function tfnswFormReference(text: string) {
  const digitMap: Record<string, string> = {
    O: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", B: "8",
  };
  const digit = (value: string) => digitMap[value] ?? value;
  const candidates = text
    .split("\n")
    .flatMap((line) => line.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/F[A-Z0-9]{6}/g) ?? []);
  for (const candidate of candidates) {
    const digits = candidate.slice(1).split('').map(digit);
    if (digits.some((value) => !/^\d$/.test(value))) continue;
    return `F${digits.join('')}`;
  }
  return "";
}

const HEADER_LINE = /^(?:client|customer|project|site|job location|work location|location|work date|date|contract|job|order|po|supplier|company|abn|attention)\b[^:\n]{0,24}[:#=-]/i;
const HEADER_KEYS: Record<string, RegExp> = {
  client: /^(?:client|customer)\b[^:\n]{0,24}[:#=-]/i,
  project: /^(?:project|site|job location|work location|location)\b[^:\n]{0,24}[:#=-]/i,
  date: /^(?:work date|date)\b[^:\n]{0,24}[:#=-]/i,
};
const isTitleLine = (line: string) => {
  const value = line.trim();
  return value.length > 0 && value.length <= 40 && !/\d/.test(value) && new RegExp(String.raw`\b${DOCKET_LABEL}\b`, "i").test(value);
};

/** Index (into `lines`) where a docket's own block starts: its identity line plus the header lines and title directly above it. */
function blockStartLine(lines: string[], identityLine: number, headerFirst: boolean) {
  let start = identityLine;
  if (isTitleLine(lines[start - 1] ?? "")) start -= 1;
  if (headerFirst) while (start > 0 && start > identityLine - 10 && HEADER_LINE.test((lines[start - 1] ?? "").trim())) start -= 1;
  return start;
}

/**
 * Splits text only where a different, genuine docket identity starts. Headings, repeated page headers, cross-references to other
 * docket numbers and page counts never create a boundary. Without two distinct identities the text is one docket. Each docket keeps the
 * client/project/date lines printed directly above its own number; a header shared by the whole page is inherited only for the fields a
 * docket does not have itself, and that inheritance is marked so the record is reviewed.
 */
export function splitDocketText(rawText: string) {
  const text = tidyText(rawText);
  if (!text) return [];

  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) { lineStarts.push(offset); offset += line.length + 1; }
  const lineOf = (index: number) => lineStarts.findIndex((start, i) => index >= start && index < (lineStarts[i + 1] ?? Infinity));

  const identityLines: number[] = [];
  let current = "";
  for (const identity of docketIdentities(text)) {
    if (identity.value === current) continue;
    identityLines.push(lineOf(identity.index));
    current = identity.value;
  }
  if (identityLines.length < 2) return [text];

  // Header-first pages print client/project lines above the docket number; identity-first pages print them below it.
  const firstDirect = blockStartLine(lines, identityLines[0], true);
  const headerFirst = lines.slice(firstDirect, identityLines[0]).some((line) => HEADER_LINE.test(line.trim()));
  const starts = identityLines.map((line, index) => index === 0 ? 0 : Math.max(blockStartLine(lines, line, headerFirst), identityLines[index - 1] + 1));
  const commonLines = lines.slice(0, identityLines[0]);
  const common = commonLines.join("\n");
  const segments = starts.map((start, index) => {
    const body = lines.slice(start, starts[index + 1] ?? lines.length);
    if (index === 0) return body.join("\n").trim();
    if (!common || common.length >= 700) return body.join("\n").trim();
    const inherited: string[] = [];
    const kept = commonLines.filter((line) => {
      const key = Object.entries(HEADER_KEYS).find(([, pattern]) => pattern.test(line.trim()))?.[0];
      if (!key) return true;
      if (body.some((own) => HEADER_KEYS[key].test(own.trim()))) return false;
      inherited.push(key);
      return true;
    });
    const marker = inherited.length ? [`[inherited from page header: ${[...new Set(inherited)].join(", ")}]`] : [];
    return [...kept, ...marker, ...body].join("\n").trim();
  }).filter((segment) => segment.length > 60);
  return segments.length > 1 ? segments : [text];
}

export function parseDocket(
  rawText: string,
  fileName: string,
  ocrConfidence: number,
  context: SourceContext = {},
): DocketRecord {
  const text = tidyText(rawText);
  const profile = inferProfile(text);
  const isTfnswPlantSheet = /\btransport\b/i.test(text) && /\bnsw\b/i.test(text)
    && /hired\s+equipment/i.test(text) && /plant\s*\/\s*truck/i.test(text);
  // Every source of an identity goes through acceptableIdentity: no dates, times, physical numbers or cross-references.
  const runSheet = text.split("\n").map((line) => {
    const match = line.match(/^\s*(?:run sheet|document|reference|ref)\s*(?:no\.?|number|num|id|#)?\s*[:#=-]?\s*([a-z0-9][a-z0-9\-/.:]{1,})/i);
    const value = match ? acceptableIdentity(match[1]) : "";
    return /^[A-Z0-9./-]+$/.test(value) ? value : "";
  }).find(Boolean) ?? "";
  const docketNo = (isTfnswPlantSheet ? tfnswFormReference(text) : "") || docketIdentities(text)[0]?.value || runSheet || filenameReference(fileName);
  const signOffDate = findSignOffDate(text);
  const table = parseResourceTable(text, signOffDate);
  const labourRows = table.rows.filter((row) => !row.plant);
  const date = findWorkDate(text, table.rows);
  const jobReference = findJobReference(text);
  const contractReference = findContractReference(text);
  const extractedClient = readableField(text, [
    /(?:^|\n)\s*(?:client name|customer name|account name|ordered by|sold to|client|customer|principal|hirer)\s*[:#=-]?\s*([^\n]+)/im,
  ]);
  const header = headerClientProject(text);
  const labelledProject = readableField(text, [
    /(?:^|\n)[ \t]*(?:project name|job location|job site|job name|work location|delivery address|site address)[ \t]*[:#=-]?[ \t]*([^\n]+)/im,
    // A bare word is only a label when followed by a delimiter, so the heading "WORKS DOCKET" is not a project.
    /(?:^|\n)[ \t]*(?:project|site|location|works)[ \t]*[:#=-][ \t]*([^\n]+)/im,
  ]);
  const client = isTfnswPlantSheet ? "Transport for NSW" : extractedClient || header.client;
  const project = labelledProject || (extractedClient ? "" : header.project);
  const inferred = [
    !isTfnswPlantSheet && !extractedClient && header.client && "client / project split from the header line",
    date.from === "rows" && table.rows.some((row) => row.yearInferred) && "work date year taken from the sign-off date",
  ].filter(Boolean) as string[];
  const inheritedHeader = text.match(/^\[inherited from page header: ([^\]]+)\]/m)?.[1];
  if (inheritedHeader) inferred.push(`${inheritedHeader} taken from the page header shared by several dockets`);
  const tableWarnings = [
    table.ambiguous && "resource table columns could not be matched reliably; printed totals were kept as read and break/travel were not inferred",
    table.rows.some((row) => row.mismatch) && `${table.rows.filter((row) => row.mismatch).length} resource row(s) show a total that differs from start/finish minus break; the printed total was kept`,
  ].filter(Boolean) as string[];
  const crew = labourRows.length ? [...new Set(labourRows.map((row) => row.name.replace(/\s*\(.*?\)\s*/g, " ").trim()))].join(", ").slice(0, 160) : readableField(text, [
    /(?:^|\n)\s*(?:crew name|crew|employee name|employee|operator|driver|team|supervisor|leading hand)\s*[:#=-]?\s*([^\n]+)/im,
  ]);
  const vehicle = referenceField(text, [
    /(?:^|\n)\s*(?:vehicle\s*\/?\s*rego|vehicle\s*registration|truck\s*rego|rego(?:\s*\/\s*tfnsw item)?|registration|vehicle|fleet|plant no|unit no|machine no)\s*(?:no\.?|number|id)?\s*[:#=-]?\s*([a-z0-9][a-z0-9 /-]{1,30})/im,
  ]);
  const poNumber = referenceField(text, [
    /(?:^|\n)\s*(?:purchase order|p\.?o\.?|work order|wol|order)\s*(?:no\.?|number|#)?\s*[:#=-]?\s*([a-z0-9][a-z0-9\-/.]{2,})/im,
  ]);
  const tableStarts = labourRows.map((row) => row.start).sort();
  const tableFinishes = labourRows.map((row) => row.finish).sort();
  const startTime = tableStarts[0] ?? parseTime(text, "start|from|commence|time in|arrival|on site");
  const finishTime = tableFinishes[tableFinishes.length - 1] ?? parseTime(text, "finish|to|end|time out|departure|off site");

  const breakValue = field(text, [
    /(?:^|\n)\s*(?:unpaid break|meal break|break|lunch)\s*[:#=-]?\s*([\d.]+\s*(?:minutes?|mins?|hours?|hrs?|hr)?)/im,
  ]);
  let breakHours = parseNumber(breakValue);
  if (/min/i.test(breakValue)) breakHours /= 60;
  // Per-person break from the resource rows when they all agree.
  const rowBreaks = [...new Set(labourRows.map((row) => row.breakHours))];
  if (rowBreaks.length === 1) breakHours = rowBreaks[0];

  const explicitHours = numberField(text, [
    /(?:^|\n)\s*(?:total labour hours|labour hours|crew hours|worked hours|total hours|hours worked|machine hours|engine hours)\s*[:#=-]?\s*([\d,.]+)/im,
  ]);
  const crewCount = numberField(text, [
    /(?:^|\n)\s*(?:crew size|number of workers|no\.? of workers|persons?|people)\s*[:#=-]?\s*(\d{1,2})/im,
    /\b(\d{1,2})\s*(?:person|people|worker|controller)s?\b/i,
  ]);
  const shiftHours = hoursBetween(startTime, finishTime, breakHours);
  // Resource rows are the evidence: three 10-hour rows are 30 labour hours. Travel is a separate quantity and is not added.
  const rowHours = Math.round(labourRows.reduce((sum, row) => sum + row.hours, 0) * 100) / 100;
  const travelHours = Math.round(labourRows.reduce((sum, row) => sum + row.travelHours, 0) * 100) / 100;
  const labourHours = labourRows.length ? rowHours : explicitHours || (shiftHours * Math.max(1, crewCount || 1));
  const { quantity, unit } = quantityDetails(text);
  const amount = numberField(text, [
    /(?:^|\n)\s*(?:total amount|amount ex\.?\s*gst|total ex\.?\s*gst|net total|subtotal|docket value|invoice total|value)\s*[:#=-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/im,
    /(?:^|\n)\s*total\s*[:#=-]\s*\$\s*([\d,]+(?:\.\d{1,2})?)/im,
  ]);

  const timeBased = /Traffic control|Labour|Plant/.test(profile);
  const quantityBased = /Weighbridge|Delivery|Asphalt/.test(profile);
  const checks = [
    { present: Boolean(docketNo), weight: 22 },
    { present: date.found, weight: 18 },
    { present: Boolean(client), weight: 15 },
    { present: Boolean(project), weight: 13 },
    { present: Boolean(poNumber), weight: 8 },
    { present: timeBased ? Boolean(startTime && finishTime) : true, weight: 12 },
    { present: quantityBased ? quantity > 0 : true, weight: 12 },
  ];
  const completeness = checks.reduce((sum, check) => sum + (check.present ? check.weight : 0), 0);
  const ocrScore = Math.max(0, Math.min(100, ocrConfidence));
  const confidence = Math.round(Math.max(0, Math.min(100, ocrScore * 0.52 + completeness * 0.48)));

  const missing = [
    !docketNo && "docket number",
    !date.found && "work date",
    !client && "client",
    !project && "project / site",
    timeBased && !(startTime && finishTime) && "start / finish time",
    quantityBased && !quantity && "quantity",
  ].filter(Boolean) as string[];
  const sourceParts = [
    context.pageNumber && context.pageCount
      ? `page ${context.pageNumber} of ${context.pageCount}` : "",
    context.sectionNumber && context.sectionCount && context.sectionCount > 1
      ? `docket ${context.sectionNumber} of ${context.sectionCount} on the page` : "",
  ].filter(Boolean);
  const notes = [
    `Detected format: ${profile}.`,
    sourceParts.length ? `Source: ${sourceParts.join(", ")}.` : "",
    missing.length ? `Check ${missing.join(", ")} against the original.` : "",
    !date.found ? 'No work date was found on the docket, so none has been filled in; enter it from the original.' : '',
    date.from === "rows" && "multiple" in date && date.multiple ? `Rows are dated ${date.value} to ${date.last}; the earliest is used as the work date.` : '',
    signOffDate ? `Signed off ${signOffDate}.` : '',
    labourRows.length ? `${labourRows.length} resource ${labourRows.length === 1 ? "row" : "rows"}: ${rowHours} labour hours${travelHours ? `, ${travelHours} travel hours kept separate` : ""}. Rates, amounts and PO not shown on the docket stay blank.` : '',
    inferred.length ? `Check against the original: ${inferred.join("; ")}.` : '',
    tableWarnings.length ? `Check the resource table: ${tableWarnings.join("; ")}.` : '',
  ].filter(Boolean).join(" ");
  const warnings = [
    missing.length ? `Check ${missing.join(", ")} against the original.` : "",
    !date.found ? "No work date was found on the docket, so none has been filled in." : "",
    ...inferred.map((note) => `Check against the original: ${note}.`),
    ...tableWarnings.map((note) => `Resource table: ${note}.`),
  ].filter(Boolean);
  const fieldConfidence: Record<string, number> = {
    docketNo: docketNo ? Math.min(99, ocrScore + 8) : 12,
    workDate: !date.found ? 15 : inferred.some((note) => note.startsWith("work date")) ? Math.min(70, ocrScore) : Math.min(99, ocrScore + 5),
    client: client ? Math.min(98, ocrScore) : 18,
    project: project ? Math.min(98, ocrScore - 2) : 18,
    vehicle: vehicle || table.vehicles.length ? Math.min(98, ocrScore - 3) : 25,
    poNumber: poNumber ? Math.min(97, ocrScore - 1) : 20,
    quantity: quantity ? Math.min(98, ocrScore) : 18,
    amount: amount ? Math.min(97, ocrScore - 2) : 30,
  };
  const resourceItems: Array<Record<string, unknown>> = labourRows.length ? [
    ...table.rows.filter((row) => !row.plant || row.hours > 0).map((row) => ({
      kind: row.plant ? "plant" : "labour", description: `${row.role}${row.name ? ` — ${row.name.replace(/\s*\(.*?\)\s*/g, " ").trim()}` : ""}`,
      workDate: row.date, startTime: row.start, finishTime: row.finish, breakHours: row.breakHours,
      quantity: row.hours, unit: "hr", rate: row.rate, amount: row.amount, valueSource: "unpriced",
    })),
    ...table.rows.filter((row) => row.travelHours > 0).map((row) => ({
      kind: "travel", description: `Travel — ${row.name.replace(/\s*\(.*?\)\s*/g, " ").trim()}`,
      workDate: row.date, quantity: row.travelHours, unit: "hr", rate: null, amount: null, valueSource: "unpriced",
    })),
  ] : [];
  const lineItems = resourceItems.length ? resourceItems : quantity > 0 ? [{ description: profile, quantity, unit, rate: amount && quantity ? Math.round(amount / quantity * 100) / 100 : 0, amount, valueSource: amount ? "document" : "pending-rate-match" }] : [];
  // Mandatory-field presence always overrides the aggregate OCR score.
  const ready = confidence >= 78 && missing.length === 0 && inferred.length === 0 && tableWarnings.length === 0;

  return {
    id: crypto.randomUUID(),
    docketNo: docketNo || "UNREAD",
    workDate: date.value,
    client,
    project,
    crew,
    vehicle: vehicle || table.vehicles.join(", ").slice(0, 80),
    startTime,
    finishTime,
    breakHours: Math.round(breakHours * 100) / 100,
    labourHours: Math.round(labourHours * 100) / 100,
    quantity,
    quantityUnit: labourRows.length && !quantity ? "hr" : unit,
    amount,
    poNumber,
    notes,
    status: ready ? "ready" : "review",
    confidence,
    sourceName: fileName,
    rawText: text,
    sourcePage: context.pageNumber,
    sourceCrop: context.sectionNumber && context.sectionCount && context.sectionCount > 1 ? `section-${context.sectionNumber}-of-${context.sectionCount}` : "full-page",
    fieldConfidence,
    lineItems,
    links: {
      ...(jobReference ? { jobReference } : {}),
      ...(contractReference ? { contractReference } : {}),
      ...(signOffDate ? { signOffDate } : {}),
    },
    extractionMethod: "local-ocr",
    profileId: profile,
    pages: context.pageNumber ? [context.pageNumber] : undefined,
    warnings,
  };
}

export type DocketCandidate = {text:string;confidence:number};

// Rank extracted values, not the quantity of correctly read printed form labels.
export function docketCandidateScore(candidate:DocketCandidate) {
  const d=parseDocket(candidate.text,'',candidate.confidence);
  return (d.docketNo!=='UNREAD'?30:0)+(d.client?20:0)+(d.project?10:0)
    +((d.fieldConfidence?.workDate||0)>20?15:0)+(d.vehicle?8:0)+(d.poNumber?8:0)
    +(d.startTime&&d.finishTime?10:0)+Math.max(0,candidate.confidence)*0.2;
}

export function parseDocketPage(candidates:DocketCandidate[],fileName:string,context:SourceContext={}) {
  const ranked=[...candidates].filter(c=>c.text.trim()).sort((a,b)=>docketCandidateScore(b)-docketCandidateScore(a));
  if(!ranked.length)return [];
  const groups=ranked.map(c=>{const parts=splitDocketText(c.text);return (parts.length?parts:[c.text]).map((text,i)=>parseDocket(text,fileName,c.confidence,{...context,sectionNumber:i+1,sectionCount:parts.length||1}));});
  return groups[0].map(primary=>{
    const others=groups.slice(1).flatMap(group=>group.filter(d=>
      primary.docketNo!=='UNREAD'&&d.docketNo===primary.docketNo ||
      groups[0].length===1&&group.length===1&&(primary.docketNo==='UNREAD'||d.docketNo==='UNREAD')
    ));
    const result={...primary,fieldConfidence:{...primary.fieldConfidence}};
    const evidence:string[]=[];
    for(const key of ['docketNo','client','project','vehicle','poNumber','workDate'] as const){
      const valid=(d:DocketRecord)=>Boolean(d[key]&&d[key]!=='UNREAD'&&(d.fieldConfidence?.[key]||0)>20);
      const choices=[primary,...others].filter(valid);
      const unique=[...new Set(choices.map(d=>d[key].trim().toUpperCase()))];
      if(unique.length>1){result.fieldConfidence[key]=35;result.status='review';evidence.push(`${key} differs between OCR passes (${choices.map(d=>d[key]).join(' / ')}); verify original`);}
      else if(!valid(primary)&&unique.length===1){const source=choices[0];result[key]=source[key];result.fieldConfidence[key]=Math.min(75,source.fieldConfidence?.[key]||50);result.status='review';evidence.push(`${key} recovered from alternate OCR: ${source[key]}`);}
    }
    if(groups[0].length===1&&groups.slice(1).some(g=>g.length===1&&g[0].docketNo!=='UNREAD'&&primary.docketNo!=='UNREAD'&&g[0].docketNo!==primary.docketNo)){
      result.fieldConfidence.docketNo=35;result.status='review';evidence.push('OCR passes disagree on docket number; verify original');
    }
    if(evidence.length){result.notes=primary.notes+' '+evidence.join('. ');result.confidence=Math.min(result.confidence,75);result.warnings=[...(primary.warnings||[]),...evidence.map(e=>e.replace(/\.?$/,'.'))];result.status='review';}
    return result;
  });
}

// ---- Digital PDF text ------------------------------------------------------------------------------------------------
/**
 * Whether a PDF page's embedded text is readable. This is separate from whether every docket field was understood: a readable page
 * with missing fields goes to review, it does not trigger OCR. OCR is for pages with no usable text layer (scans, photos).
 */
export function isReadablePdfText(text: string) {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 80) return false;
  const labels = text.match(/docket|ticket|date|client|customer|project|site|quantity|total|hours?|job|contract|start|finish|signed|worker/gi)?.length ?? 0;
  const printable = compact.match(/[a-z0-9.,:;/()$%&'"+\-]/gi)?.length ?? 0;
  const words = text.match(/\b[a-z]{3,}\b/gi)?.length ?? 0;
  return labels >= 2 && words >= 8 && printable / compact.length >= 0.85;
}

// ---- Whole-document assembly -------------------------------------------------------------------------------------------
export type DocketPage = { text: string; confidence: number; candidates?: DocketCandidate[]; pageNumber: number; pageCount: number; method?: string };

const TITLE_WORDS = new RegExp(String.raw`\b${DOCKET_LABEL}\b|\btimesheet\b|\btime sheet\b`, "i");
const pageMarker = (page: number) => `[page ${page}]`;
const normalisedPage = (text: string) => text.replace(/^\[page \d+\]$/gim, "").replace(/\bpage[ \t]*\d{1,3}[ \t]*(?:of|\/)[ \t]*\d{1,3}\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();

/** A page (or section) with no docket identity continues the previous docket when it says so, or has no header of its own. */
function isContinuation(text: string) {
  if (hasContinuationMarker(text)) return true;
  const headerLabels = text.match(/(?:^|\n)[ \t]*(?:client|customer|project|job location|site|date|work date)[ \t]*[:#=-]/gi)?.length ?? 0;
  return !TITLE_WORDS.test(text) && headerLabels < 2;
}

/** The page says it continues another: "continued", or "Page 2 of 3". */
function hasContinuationMarker(text: string) {
  if (/\b(?:continued|continuation|cont['’]?d)\b/i.test(text)) return true;
  const pageOf = text.match(/\bpage[ \t]*(\d{1,3})[ \t]*(?:of|\/)[ \t]*\d{1,3}\b/i);
  return Boolean(pageOf && Number(pageOf[1]) > 1);
}

/** Who issued the docket: the ABN, else the first plain line above the docket number. Used to keep two suppliers' same number apart. */
function issuerKey(text: string) {
  const abn = text.match(/\bABN[ \t:]*([\d ]{11,14})/i)?.[1]?.replace(/\s/g, "");
  if (abn) return `abn:${abn}`;
  const first = text.split("\n").map((line) => line.trim()).filter(Boolean).find((line) => !isTitleLine(line) && !/^\[(?:page|inherited)/i.test(line) && !/^page\b/i.test(line));
  return first && /^[A-Za-z][A-Za-z0-9 &.'()-]{2,60}$/.test(first) && !HEADER_LINE.test(first) ? `name:${first.toLowerCase().replace(/\s+/g, " ")}` : "";
}
/** "same" / "different" / "unknown" (one side has no issuer, or they are different kinds of evidence). */
function compareIssuers(a: string, b: string) {
  if (!a || !b || a.split(":")[0] !== b.split(":")[0]) return "unknown" as const;
  return a === b ? "same" as const : "different" as const;
}

type Draft = { record: DocketRecord; parts: Array<{ page: number; text: string }>; confidence: number; warnings: string[]; review: boolean; methods: Set<string> };

/**
 * Turns the pages of one file into dockets. A docket is a genuine identity ("Docket number: N"), so a file may hold one docket over several
 * pages, several dockets on one page, or several dockets over several pages. Grouping is conservative:
 *  - a page identical to one already read is dropped with a warning (quantities are never counted twice), and resource rows repeated from an
 *    earlier page are not added again;
 *  - the same number from a different supplier is a different docket;
 *  - the same number with no supplier or continuation evidence is ambiguous: the records stay separate and are flagged for review;
 *  - a page with no identity continues the previous docket only when it says so or has no header of its own.
 * Every contributing page and every warning is kept on the merged record.
 */
export function parseDocketDocument(pages: DocketPage[], fileName: string) {
  const drafts: Draft[] = [];
  const flag = (draft: Draft, message: string) => { draft.review = true; if (!draft.warnings.includes(message)) draft.warnings.push(message); };
  for (const page of pages) {
    const records = parseDocketPage(page.candidates?.length ? page.candidates : [page], fileName, { pageNumber: page.pageNumber, pageCount: page.pageCount });
    records.forEach((record, index) => {
      if (page.method) record.extractionMethod = page.method;
      const last = drafts[drafts.length - 1];
      const issuer = compareIssuers(last ? issuerKey(last.parts[0].text) : "", issuerKey(record.rawText));
      const sameNumber = Boolean(last) && record.docketNo !== "UNREAD" && record.docketNo === last.record.docketNo;
      const draftFor = () => ({ record, parts: [{ page: page.pageNumber, text: record.rawText }], confidence: record.confidence, warnings: [...(record.warnings ?? [])], review: record.status === "review" && (record.warnings ?? []).some((w) => /differ|disagree|recovered from alternate/i.test(w)), methods: new Set([record.extractionMethod ?? "local-ocr"]) });
      if (last && sameNumber) {
        if (last.parts.some((part) => normalisedPage(part.text) === normalisedPage(record.rawText))) {
          flag(last, `Page ${page.pageNumber} is identical to an earlier page of docket ${record.docketNo} and was not added again; check it is not a second copy.`);
          last.parts.push({ page: page.pageNumber, text: "" });
          return;
        }
        if (issuer === "different") {
          const other = draftFor();
          const message = `The same docket number ${record.docketNo} appears from a different supplier on page ${page.pageNumber}; kept as a separate docket.`;
          flag(last, message); flag(other, message); drafts.push(other);
          return;
        }
        if (issuer === "same" || hasContinuationMarker(record.rawText)) {
          last.parts.push({ page: page.pageNumber, text: record.rawText });
          last.confidence = Math.min(last.confidence, record.confidence);
          record.warnings?.forEach((w) => { if (!last.warnings.includes(w)) last.warnings.push(w); });
          if (record.status === "review" && (record.warnings ?? []).some((w) => /differ|disagree|recovered from alternate/i.test(w))) last.review = true;
          last.methods.add(record.extractionMethod ?? "local-ocr");
          return;
        }
        const other = draftFor();
        const message = `The same docket number ${record.docketNo} appears on pages ${last.parts[last.parts.length - 1].page} and ${page.pageNumber} with nothing to show they belong together; not combined. Check whether this is one docket or a duplicate.`;
        flag(last, message); flag(other, message); drafts.push(other);
        return;
      }
      const continues = Boolean(last) && index === 0 && page.pageNumber > 1 && record.docketNo === "UNREAD" && isContinuation(record.rawText) && issuer !== "different";
      if (last && continues) {
        last.parts.push({ page: page.pageNumber, text: record.rawText });
        last.confidence = Math.min(last.confidence, record.confidence);
        record.warnings?.forEach((w) => { if (!last.warnings.includes(w) && !/^Check .* against the original\.$/.test(w)) last.warnings.push(w); });
        if (record.status === "review" && (record.warnings ?? []).some((w) => /differ|disagree|recovered from alternate/i.test(w))) last.review = true;
        last.methods.add(record.extractionMethod ?? "local-ocr");
        return;
      }
      drafts.push(draftFor());
    });
  }
  return drafts.map((draft) => {
    const used = [...new Set(draft.parts.map((part) => part.page))];
    const warnings = [...draft.warnings];
    if (used.length < 2 && draft.parts.length < 2) {
      const record = draft.record;
      if (!draft.review || record.status === "review") return { ...record, warnings: unique(warnings), notes: appendWarnings(record.notes, warnings, record.warnings ?? []) };
      return { ...record, status: "review" as const, warnings: unique(warnings), notes: appendWarnings(record.notes, warnings, record.warnings ?? []) };
    }
    // Merge: pages are joined under page markers, resource rows already read on an earlier page are not added again.
    const seenRows = new Set<string>();
    let repeated = 0;
    const joined = draft.parts.filter((part) => part.text).map((part) => {
      const kept = part.text.split("\n").filter((line) => {
        if (!isResourceRowLine(line)) return true;
        const key = line.replace(/\s+/g, " ").trim().toLowerCase();
        if (seenRows.has(key)) { repeated += 1; return false; }
        seenRows.add(key);
        return true;
      });
      return `${pageMarker(part.page)}\n${kept.join("\n")}`;
    }).join("\n");
    if (repeated) { warnings.push(`${repeated} resource row(s) already read on an earlier page were not added again; check the rows are not genuinely repeated.`); draft.review = true; }
    const first = used[0];
    const merged = parseDocket(joined, fileName, draft.confidence, { pageNumber: first, pageCount: pages[0]?.pageCount });
    const allWarnings = unique([...warnings, ...(merged.warnings ?? [])]);
    const status = draft.review || merged.status === "review" ? "review" as const : merged.status;
    const methods = [...draft.methods];
    return {
      ...merged,
      status,
      sourcePage: first,
      sourceCrop: used.length > 1 ? `pages-${used.join("+")}` : merged.sourceCrop,
      pages: used,
      extractionMethod: methods.find((m) => m.endsWith(":run")) ?? methods.find((m) => m === "local-ocr") ?? methods[0],
      warnings: allWarnings,
      notes: appendWarnings(merged.notes.replace(/Source: [^.]*\.\s*/, "") + ` Source: pages ${used.join(", ")} of ${pages[0]?.pageCount ?? used.length}.`, allWarnings, merged.warnings ?? []),
    };
  });
}

const unique = (values: string[]) => [...new Set(values)];
// Warnings that the record's own notes do not already say are appended, so nothing assembly learned is lost.
const appendWarnings = (notes: string, all: string[], own: string[]) => {
  const extra = all.filter((warning) => !notes.includes(warning) && !own.includes(warning));
  return extra.length ? `${notes} ${extra.join(" ")}`.trim() : notes;
};
