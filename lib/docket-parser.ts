export type DocketStatus = "uploaded" | "processing" | "review" | "matched" | "approved" | "included_claim" | "invoiced" | "rejected" | "ready" | "duplicate";

export type DocketRecord = {
  id: string;
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

function dateFromFilename(fileName: string) {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const compact = base.match(/(?:^|\D)(\d{2})(\d{2})(20\d{2})(?:\d{6})?(?:\D|$)/);
  if (compact) return makeIsoDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  return parseDateValue(base.replaceAll("_", "-").replaceAll(" ", "-"));
}

function findWorkDate(text: string, fileName: string) {
  const labelled = field(text, [
    /(?:^|\n)\s*(?:work date|date of work|service date|docket date|delivery date|shift date|date)\s*[:#=-]?\s*([^\n]+)/im,
  ]);
  const labelledDate = parseDateValue(labelled);
  if (labelledDate) return { value: labelledDate, found: true };
  const anywhere = parseDateValue(text);
  const fromFilename = dateFromFilename(fileName);
  return {
    value: anywhere || fromFilename || new Date().toISOString().slice(0, 10),
    found: Boolean(anywhere),
  };
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
  if (/traffic control|traffic controller|tct\b|ptcd|vms\b|tma\b|awv\b/.test(lower)) return "Traffic control";
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
  return reference && /\d/.test(reference) ? reference.replaceAll("_", "-").toUpperCase() : '';
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

export function splitDocketText(rawText: string) {
  const text = tidyText(rawText);
  if (!text) return [];

  const anchors = Array.from(text.matchAll(
    /(?:^|\n)[ \t]*[^:\n]{0,45}?\b(?:delivery[ \t]+docket|works?[ \t]+docket|job[ \t]+docket|docket|dkt|ticket|delivery[ \t]+note)[ \t]*(?:(?:no\.?|number|num|id|#)[ \t]*){0,2}[:#=-]?/gim,
  )).map((match) => match.index ?? 0);
  if (anchors.length < 2) return [text];

  const usable = anchors.filter((anchor, index) => index === 0 || anchor - anchors[index - 1] > 40);
  if (usable.length < 2) return [text];
  const commonHeader = text.slice(0, usable[0]).trim();
  return usable.map((start, index) => {
    const segment = text.slice(start, usable[index + 1] ?? text.length).trim();
    return commonHeader && commonHeader.length < 700 ? `${commonHeader}\n${segment}` : segment;
  }).filter((segment) => segment.length > 60);
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
  const docketNo = (isTfnswPlantSheet ? tfnswFormReference(text) : '') || referenceField(text, [
    /(?:^|\n)[ \t]*[^:\n]{0,45}?\b(?:delivery[ \t]+docket|works?[ \t]+docket|job[ \t]+docket|docket|dkt|ticket|delivery[ \t]+note)[ \t]*(?:(?:no\.?|number|num|id|#)[ \t]*){0,2}(?:[:#=-][ \t]*|[ \t]+)([a-z0-9][a-z0-9\-/.]{2,})/im,
    /(?:^|\n)\s*(?:run sheet|document|reference|ref)\s*(?:no\.?|number|num|id|#)?\s*[:#=-]?\s*([a-z0-9][a-z0-9\-/.]{2,})/im,
  ]) || (isTfnswPlantSheet ? tfnswFormReference(text) : "") || filenameReference(fileName);
  const date = findWorkDate(text, fileName);
  const extractedClient = readableField(text, [
    /(?:^|\n)\s*(?:client name|customer name|account name|ordered by|sold to|client|customer|principal|hirer)\s*[:#=-]?\s*([^\n]+)/im,
  ]);
  const client = isTfnswPlantSheet ? "Transport for NSW" : extractedClient;
  const project = readableField(text, [
    /(?:^|\n)\s*(?:project name|job location|job site|job name|work location|delivery address|site address|project|site|location|works)\s*[:#=-]?\s*([^\n]+)/im,
  ]);
  const crew = readableField(text, [
    /(?:^|\n)\s*(?:crew name|crew|employee name|employee|operator|driver|team|supervisor|leading hand)\s*[:#=-]?\s*([^\n]+)/im,
  ]);
  const vehicle = referenceField(text, [
    /(?:^|\n)\s*(?:vehicle\s*\/?\s*rego|vehicle\s*registration|truck\s*rego|rego(?:\s*\/\s*tfnsw item)?|registration|vehicle|fleet|plant no|unit no|machine no)\s*(?:no\.?|number|id)?\s*[:#=-]?\s*([a-z0-9][a-z0-9 /-]{1,30})/im,
  ]);
  const poNumber = referenceField(text, [
    /(?:^|\n)\s*(?:purchase order|p\.?o\.?|work order|wol|order|contract)\s*(?:no\.?|number|#)?\s*[:#=-]?\s*([a-z0-9][a-z0-9\-/.]{2,})/im,
  ]);
  const startTime = parseTime(text, "start|from|commence|time in|arrival|on site");
  const finishTime = parseTime(text, "finish|to|end|time out|departure|off site");

  const breakValue = field(text, [
    /(?:^|\n)\s*(?:unpaid break|meal break|break|lunch)\s*[:#=-]?\s*([\d.]+\s*(?:minutes?|mins?|hours?|hrs?|hr)?)/im,
  ]);
  let breakHours = parseNumber(breakValue);
  if (/min/i.test(breakValue)) breakHours /= 60;

  const explicitHours = numberField(text, [
    /(?:^|\n)\s*(?:total labour hours|labour hours|crew hours|worked hours|total hours|hours worked|machine hours|engine hours)\s*[:#=-]?\s*([\d,.]+)/im,
  ]);
  const crewCount = numberField(text, [
    /(?:^|\n)\s*(?:crew size|number of workers|no\.? of workers|persons?|people)\s*[:#=-]?\s*(\d{1,2})/im,
    /\b(\d{1,2})\s*(?:person|people|worker|controller)s?\b/i,
  ]);
  const shiftHours = hoursBetween(startTime, finishTime, breakHours);
  const labourHours = explicitHours || (shiftHours * Math.max(1, crewCount || 1));
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
    !date.found ? 'Work date is a filing placeholder only; confirm the actual date from the original.' : '',
  ].filter(Boolean).join(" ");
  const fieldConfidence: Record<string, number> = {
    docketNo: docketNo ? Math.min(99, ocrScore + 8) : 12,
    workDate: date.found ? Math.min(99, ocrScore + 5) : 15,
    client: client ? Math.min(98, ocrScore) : 18,
    project: project ? Math.min(98, ocrScore - 2) : 18,
    vehicle: vehicle ? Math.min(98, ocrScore - 3) : 25,
    poNumber: poNumber ? Math.min(97, ocrScore - 1) : 20,
    quantity: quantity ? Math.min(98, ocrScore) : 18,
    amount: amount ? Math.min(97, ocrScore - 2) : 30,
  };
  const lineItems = quantity > 0 ? [{ description: profile, quantity, unit, rate: amount && quantity ? Math.round(amount / quantity * 100) / 100 : 0, amount, valueSource: amount ? "document" : "pending-rate-match" }] : [];
  // Mandatory-field presence always overrides the aggregate OCR score.
  const ready = confidence >= 78 && missing.length === 0;

  return {
    id: crypto.randomUUID(),
    docketNo: docketNo || "UNREAD",
    workDate: date.value,
    client,
    project,
    crew,
    vehicle,
    startTime,
    finishTime,
    breakHours: Math.round(breakHours * 100) / 100,
    labourHours: Math.round(labourHours * 100) / 100,
    quantity,
    quantityUnit: unit,
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
    links: {},
    extractionMethod: "local-ocr",
    profileId: profile,
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
    if(evidence.length){result.notes=primary.notes+' '+evidence.join('. ');result.confidence=Math.min(result.confidence,75);}
    return result;
  });
}
