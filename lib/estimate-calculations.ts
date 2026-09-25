export type EstimateStatus =
  | "Draft"
  | "Internal Review"
  | "Submitted"
  | "Revised"
  | "Awarded"
  | "Lost"
  | "Cancelled";

export const ESTIMATE_STATUSES: EstimateStatus[] = [
  "Draft",
  "Internal Review",
  "Submitted",
  "Revised",
  "Awarded",
  "Lost",
  "Cancelled",
];

export type LabourLine = {
  id: string;
  name: string;
  headcount: number;
  hoursPerShift: number;
  hourlyRate: number;
};

export type PlantLine = {
  id: string;
  name: string;
  units: number;
  hoursPerShift: number;
  hourlyRate: number;
};

export type TrafficLine = {
  id: string;
  name: string;
  units: number;
  days: number;
  ratePerDay: number;
};

export type SubcontractorLine = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitRate: number;
};

/** Generic work-section line (any discipline): quantity × rate, or hours × rate where
 * hours derive from quantity ÷ productivity (units per hour). */
export type CostCategory = "labour" | "plant" | "material" | "subcontract" | "other";
export const COST_CATEGORIES: CostCategory[] = ["labour", "plant", "material", "subcontract", "other"];
export type EstimateItem = {
  id: string;
  section: string;
  costCode: string;
  category: CostCategory;
  description: string;
  quantity: number;
  unit: string;
  productivity: number;
  rateBasis: "unit" | "hour";
  rate: number;
};

export type RateItem = {
  id: string;
  name: string;
  unit: string;
  rate: number;
  notes?: string;
};

export type RateLibrary = {
  id?: string;
  name: string;
  targetMarginPct: number;
  gstPct: number;
  materials: RateItem[];
  labour: RateItem[];
  plant: RateItem[];
  traffic: RateItem[];
  subcontractors: RateItem[];
  allowances: RateItem[];
};

export type EstimateData = {
  name: string;
  clientId: string;
  clientName: string;
  opportunityId: string;
  opportunityName: string;
  projectName: string;
  site: string;
  workType: string;
  specification: string;
  areaM2: number;
  lengthM: number;
  widthM: number;
  compactedDepthMm: number;
  materialDensityTPerM3: number;
  wastePct: number;
  asphaltMix: string;
  supplierName: string;
  supplierRatePerT: number;
  tackCoatRatePerM2: number;
  profilingRatePerM2: number;
  profilingAreaM2: number;
  profilingIncluded: boolean;
  cartageRatePerTrip: number;
  truckPayloadT: number;
  shiftType: string;
  shiftDurationHours: number;
  productionTonnesPerShift: number;
  shiftsOverride: number;
  labour: LabourLine[];
  plant: PlantLine[];
  traffic: TrafficLine[];
  mobilisations: number;
  mobilisationRate: number;
  floatMovements: number;
  floatRate: number;
  accommodationNights: number;
  accommodationPersons: number;
  accommodationRate: number;
  travelPersons: number;
  travelDays: number;
  travelAllowanceRate: number;
  subcontractors: SubcontractorLine[];
  overheadsPct: number;
  contingencyPct: number;
  marginType: "margin" | "markup";
  marginValue: number;
  targetMarginPct: number;
  gstPct: number;
  notes: string;
  exclusions: string;
  assumptions: string;
  /** Asphalt/paving quantity engine. Legacy estimates default to true. */
  includePaving: boolean;
  items: EstimateItem[];
};

export type EstimateTotals = {
  effectiveAreaM2: number;
  rawTonnes: number;
  totalTonnes: number;
  estimatedShifts: number;
  requiredTrips: number;
  materialCost: number;
  tackCoatCost: number;
  profilingCost: number;
  cartageCost: number;
  labourCost: number;
  plantCost: number;
  trafficCost: number;
  mobilisationCost: number;
  allowancesCost: number;
  subcontractorCost: number;
  itemsCost: number;
  itemsByCategory: Record<CostCategory, number>;
  directCost: number;
  overheadCost: number;
  contingencyCost: number;
  totalCost: number;
  costPerTonne: number;
  costPerM2: number;
  sellRate: number;
  sellRatePerTonne: number;
  sellRatePerM2: number;
  grossProfit: number;
  grossMargin: number;
  gstAmount: number;
  totalQuoteValue: number;
};

export type ValidationResult = {
  errors: string[];
  warnings: string[];
  isValid: boolean;
};

export const DEFAULT_RATE_LIBRARY: RateLibrary = {
  id: "rate-roadworx-fy27",
  name: "Example rate library — review before quoting",
  targetMarginPct: 6,
  gstPct: 10,
  materials: [
    { id: "ac10", name: "AC10", unit: "t", rate: 185 },
    { id: "ac14", name: "AC14", unit: "t", rate: 185 },
    { id: "ac20", name: "AC20", unit: "t", rate: 185 },
    { id: "sma", name: "SMA", unit: "t", rate: 230 },
    { id: "tack-coat", name: "Tack coat", unit: "m²", rate: 1.35 },
    { id: "profiling", name: "Profiling", unit: "m²", rate: 12 },
    { id: "cartage", name: "Cartage / truck trip", unit: "trip", rate: 650 },
  ],
  labour: [
    { id: "supervisor", name: "Supervisor", unit: "hour", rate: 95 },
    { id: "paver-operator", name: "Paver operator", unit: "hour", rate: 78 },
    { id: "roller-operator", name: "Roller operator", unit: "hour", rate: 70 },
    { id: "general-hand", name: "General hand", unit: "hour", rate: 62 },
  ],
  plant: [
    { id: "paver", name: "Asphalt paver", unit: "hour", rate: 300 },
    { id: "roller", name: "Roller", unit: "hour", rate: 180 },
    { id: "broom", name: "Mechanical broom", unit: "hour", rate: 120 },
  ],
  traffic: [
    { id: "tc-vehicle", name: "Traffic control vehicle", unit: "day", rate: 150 },
    { id: "vms", name: "VMS board", unit: "day", rate: 150 },
    { id: "ptcd", name: "PTCD", unit: "day", rate: 38.5 },
    { id: "delivery", name: "Traffic equipment delivery", unit: "event", rate: 148.5 },
  ],
  subcontractors: [],
  allowances: [
    { id: "accommodation", name: "Accommodation", unit: "night / person", rate: 180 },
    { id: "travel", name: "Travel allowance", unit: "day / person", rate: 50 },
  ],
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function lineId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function normaliseLabour(value: unknown): LabourLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((line, index) => {
    const raw = (line ?? {}) as Record<string, unknown>;
    return {
      id: textValue(raw.id, lineId("labour", index)),
      name: textValue(raw.name, "Labour"),
      headcount: Math.max(0, numberValue(raw.headcount)),
      hoursPerShift: Math.max(0, numberValue(raw.hoursPerShift)),
      hourlyRate: Math.max(0, numberValue(raw.hourlyRate)),
    };
  });
}

function normalisePlant(value: unknown): PlantLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((line, index) => {
    const raw = (line ?? {}) as Record<string, unknown>;
    return {
      id: textValue(raw.id, lineId("plant", index)),
      name: textValue(raw.name, "Plant"),
      units: Math.max(0, numberValue(raw.units)),
      hoursPerShift: Math.max(0, numberValue(raw.hoursPerShift)),
      hourlyRate: Math.max(0, numberValue(raw.hourlyRate)),
    };
  });
}

function normaliseTraffic(value: unknown): TrafficLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((line, index) => {
    const raw = (line ?? {}) as Record<string, unknown>;
    return {
      id: textValue(raw.id, lineId("traffic", index)),
      name: textValue(raw.name, "Traffic resource"),
      units: Math.max(0, numberValue(raw.units)),
      days: Math.max(0, numberValue(raw.days)),
      ratePerDay: Math.max(0, numberValue(raw.ratePerDay)),
    };
  });
}

function normaliseSubcontractors(value: unknown): SubcontractorLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((line, index) => {
    const raw = (line ?? {}) as Record<string, unknown>;
    return {
      id: textValue(raw.id, lineId("subcontractor", index)),
      name: textValue(raw.name, "Subcontractor"),
      quantity: Math.max(0, numberValue(raw.quantity)),
      unit: textValue(raw.unit, "item"),
      unitRate: Math.max(0, numberValue(raw.unitRate)),
    };
  });
}

export function itemHours(item: EstimateItem) {
  return item.productivity > 0 ? item.quantity / item.productivity : 0;
}
export function itemAmount(item: EstimateItem) {
  return item.rateBasis === "hour" ? itemHours(item) * item.rate : item.quantity * item.rate;
}

function normaliseItems(value: unknown): EstimateItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((line, index) => {
    const raw = (line ?? {}) as Record<string, unknown>;
    const category = COST_CATEGORIES.includes(raw.category as CostCategory) ? raw.category as CostCategory : "other";
    return {
      id: textValue(raw.id, lineId("item", index)),
      section: textValue(raw.section, "General"),
      costCode: textValue(raw.costCode),
      category,
      description: textValue(raw.description, "Item"),
      quantity: Math.max(0, numberValue(raw.quantity)),
      unit: textValue(raw.unit, "item"),
      productivity: Math.max(0, numberValue(raw.productivity)),
      rateBasis: raw.rateBasis === "hour" ? "hour" : "unit",
      rate: Math.max(0, numberValue(raw.rate)),
    };
  });
}

export function makeDefaultEstimate(library: RateLibrary = DEFAULT_RATE_LIBRARY): EstimateData {
  const rate = (category: keyof RateLibrary, id: string, fallback: number) => {
    const list = library[category];
    if (!Array.isArray(list)) return fallback;
    return (list as RateItem[]).find((item) => item.id === id)?.rate ?? fallback;
  };
  return {
    name: "",
    clientId: "",
    clientName: "",
    opportunityId: "",
    opportunityName: "",
    projectName: "",
    site: "",
    workType: "Asphalt resurfacing",
    specification: "AC14 asphalt, compacted and finished to specification",
    areaM2: 1000,
    lengthM: 0,
    widthM: 0,
    compactedDepthMm: 50,
    materialDensityTPerM3: 2.4,
    wastePct: 3,
    asphaltMix: "AC14",
    supplierName: "",
    supplierRatePerT: rate("materials", "ac14", 185),
    tackCoatRatePerM2: rate("materials", "tack-coat", 1.35),
    profilingRatePerM2: rate("materials", "profiling", 12),
    profilingAreaM2: 0,
    profilingIncluded: false,
    cartageRatePerTrip: rate("materials", "cartage", 650),
    truckPayloadT: 28,
    shiftType: "Day shift",
    shiftDurationHours: 10,
    productionTonnesPerShift: 250,
    shiftsOverride: 0,
    labour: [
      { id: "supervisor", name: "Supervisor", headcount: 1, hoursPerShift: 10, hourlyRate: rate("labour", "supervisor", 95) },
      { id: "paver-operator", name: "Paver operator", headcount: 1, hoursPerShift: 10, hourlyRate: rate("labour", "paver-operator", 78) },
      { id: "roller-operator", name: "Roller operator", headcount: 1, hoursPerShift: 10, hourlyRate: rate("labour", "roller-operator", 70) },
      { id: "general-hand", name: "General hand", headcount: 3, hoursPerShift: 10, hourlyRate: rate("labour", "general-hand", 62) },
    ],
    plant: [
      { id: "paver", name: "Asphalt paver", units: 1, hoursPerShift: 10, hourlyRate: rate("plant", "paver", 300) },
      { id: "roller", name: "Roller", units: 2, hoursPerShift: 10, hourlyRate: rate("plant", "roller", 180) },
      { id: "broom", name: "Mechanical broom", units: 1, hoursPerShift: 4, hourlyRate: rate("plant", "broom", 120) },
    ],
    traffic: [
      { id: "tc-vehicle", name: "Traffic control vehicle", units: 2, days: 1, ratePerDay: rate("traffic", "tc-vehicle", 150) },
      { id: "vms", name: "VMS board", units: 2, days: 1, ratePerDay: rate("traffic", "vms", 150) },
      { id: "ptcd", name: "PTCD", units: 4, days: 1, ratePerDay: rate("traffic", "ptcd", 38.5) },
    ],
    mobilisations: 1,
    mobilisationRate: 1200,
    floatMovements: 0,
    floatRate: 1200,
    accommodationNights: 0,
    accommodationPersons: 0,
    accommodationRate: rate("allowances", "accommodation", 180),
    travelPersons: 0,
    travelDays: 0,
    travelAllowanceRate: rate("allowances", "travel", 50),
    subcontractors: [],
    overheadsPct: 5,
    contingencyPct: 2,
    marginType: "margin",
    marginValue: library.targetMarginPct || 6,
    targetMarginPct: library.targetMarginPct || 6,
    gstPct: library.gstPct || 10,
    notes: "",
    exclusions: "Permit fees, major pavement failures and out-of-hours approvals unless stated.",
    assumptions: "Access, traffic staging, supplier availability and production rates remain as priced.",
    includePaving: true,
    items: [],
  };
}

/** A discipline-neutral starting point: no paving quantities, crew or plant assumptions. */
export function makeGeneralEstimate(library: RateLibrary = DEFAULT_RATE_LIBRARY): EstimateData {
  return {
    ...makeDefaultEstimate(library),
    workType: "General works",
    specification: "",
    includePaving: false,
    areaM2: 0,
    labour: [],
    plant: [],
    traffic: [],
    mobilisations: 0,
    exclusions: "",
    assumptions: "",
  };
}

export function normaliseEstimateData(input: unknown, library: RateLibrary = DEFAULT_RATE_LIBRARY): EstimateData {
  const raw = (input ?? {}) as Record<string, unknown>;
  const defaults = makeDefaultEstimate(library);
  const marginType = raw.marginType === "markup" ? "markup" : "margin";
  return {
    ...defaults,
    ...raw,
    name: textValue(raw.name),
    clientId: textValue(raw.clientId),
    clientName: textValue(raw.clientName),
    opportunityId: textValue(raw.opportunityId),
    opportunityName: textValue(raw.opportunityName),
    projectName: textValue(raw.projectName),
    site: textValue(raw.site),
    workType: textValue(raw.workType, defaults.workType),
    specification: textValue(raw.specification),
    areaM2: Math.max(0, numberValue(raw.areaM2, defaults.areaM2)),
    lengthM: Math.max(0, numberValue(raw.lengthM)),
    widthM: Math.max(0, numberValue(raw.widthM)),
    compactedDepthMm: Math.max(0, numberValue(raw.compactedDepthMm, defaults.compactedDepthMm)),
    materialDensityTPerM3: Math.max(0, numberValue(raw.materialDensityTPerM3, defaults.materialDensityTPerM3)),
    wastePct: Math.max(0, numberValue(raw.wastePct, defaults.wastePct)),
    asphaltMix: textValue(raw.asphaltMix, defaults.asphaltMix),
    supplierName: textValue(raw.supplierName, defaults.supplierName),
    supplierRatePerT: Math.max(0, numberValue(raw.supplierRatePerT, defaults.supplierRatePerT)),
    tackCoatRatePerM2: Math.max(0, numberValue(raw.tackCoatRatePerM2, defaults.tackCoatRatePerM2)),
    profilingRatePerM2: Math.max(0, numberValue(raw.profilingRatePerM2, defaults.profilingRatePerM2)),
    profilingAreaM2: Math.max(0, numberValue(raw.profilingAreaM2)),
    profilingIncluded: raw.profilingIncluded === true || numberValue(raw.profilingAreaM2) > 0,
    cartageRatePerTrip: Math.max(0, numberValue(raw.cartageRatePerTrip, defaults.cartageRatePerTrip)),
    truckPayloadT: Math.max(0, numberValue(raw.truckPayloadT, defaults.truckPayloadT)),
    shiftType: textValue(raw.shiftType, defaults.shiftType),
    shiftDurationHours: Math.max(0, numberValue(raw.shiftDurationHours, defaults.shiftDurationHours)),
    productionTonnesPerShift: Math.max(0, numberValue(raw.productionTonnesPerShift, defaults.productionTonnesPerShift)),
    shiftsOverride: Math.max(0, numberValue(raw.shiftsOverride)),
    labour: normaliseLabour(raw.labour),
    plant: normalisePlant(raw.plant),
    traffic: normaliseTraffic(raw.traffic),
    mobilisations: Math.max(0, numberValue(raw.mobilisations, defaults.mobilisations)),
    mobilisationRate: Math.max(0, numberValue(raw.mobilisationRate, defaults.mobilisationRate)),
    floatMovements: Math.max(0, numberValue(raw.floatMovements)),
    floatRate: Math.max(0, numberValue(raw.floatRate, defaults.floatRate)),
    accommodationNights: Math.max(0, numberValue(raw.accommodationNights)),
    accommodationPersons: Math.max(0, numberValue(raw.accommodationPersons)),
    accommodationRate: Math.max(0, numberValue(raw.accommodationRate, defaults.accommodationRate)),
    travelPersons: Math.max(0, numberValue(raw.travelPersons)),
    travelDays: Math.max(0, numberValue(raw.travelDays)),
    travelAllowanceRate: Math.max(0, numberValue(raw.travelAllowanceRate, defaults.travelAllowanceRate)),
    subcontractors: normaliseSubcontractors(raw.subcontractors),
    overheadsPct: Math.max(0, numberValue(raw.overheadsPct, defaults.overheadsPct)),
    contingencyPct: Math.max(0, numberValue(raw.contingencyPct, defaults.contingencyPct)),
    marginType,
    marginValue: Math.max(0, numberValue(raw.marginValue, defaults.marginValue)),
    targetMarginPct: Math.max(0, numberValue(raw.targetMarginPct, defaults.targetMarginPct)),
    gstPct: Math.max(0, numberValue(raw.gstPct, defaults.gstPct)),
    notes: textValue(raw.notes, defaults.notes),
    exclusions: textValue(raw.exclusions, defaults.exclusions),
    assumptions: textValue(raw.assumptions, defaults.assumptions),
    includePaving: raw.includePaving !== false,
    items: normaliseItems(raw.items),
  };
}

const roundMoney = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const roundQuantity = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;

export function calculateEstimate(input: EstimateData): EstimateTotals {
  const paving = input.includePaving !== false;
  const data = paving ? input : { ...input, areaM2: 0, lengthM: 0, widthM: 0, profilingIncluded: false, productionTonnesPerShift: 0 };
  const items = Array.isArray(input.items) ? input.items : [];
  const itemsByCategory = Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>;
  for (const item of items) itemsByCategory[item.category] += itemAmount(item);
  const itemsCost = Object.values(itemsByCategory).reduce((a, b) => a + b, 0);
  const effectiveAreaM2 = data.areaM2 > 0 ? data.areaM2 : data.lengthM * data.widthM;
  const rawTonnes = effectiveAreaM2 * (data.compactedDepthMm / 1000) * data.materialDensityTPerM3;
  const totalTonnes = rawTonnes * (1 + data.wastePct / 100);
  const estimatedShifts = data.shiftsOverride > 0
    ? Math.ceil(data.shiftsOverride)
    : paving && data.productionTonnesPerShift > 0
      ? Math.max(1, Math.ceil(totalTonnes / data.productionTonnesPerShift))
      : 0;
  const requiredTrips = data.truckPayloadT > 0 ? Math.ceil(totalTonnes / data.truckPayloadT) : 0;
  const profilingArea = data.profilingIncluded ? data.profilingAreaM2 : 0;
  const labourCost = data.labour.reduce((sum, line) => sum + line.headcount * line.hoursPerShift * estimatedShifts * line.hourlyRate, 0);
  const plantCost = data.plant.reduce((sum, line) => sum + line.units * line.hoursPerShift * estimatedShifts * line.hourlyRate, 0);
  const trafficCost = data.traffic.reduce((sum, line) => sum + line.units * line.days * estimatedShifts * line.ratePerDay, 0);
  const subcontractorCost = data.subcontractors.reduce((sum, line) => sum + line.quantity * line.unitRate, 0);
  const materialCost = totalTonnes * data.supplierRatePerT;
  const tackCoatCost = effectiveAreaM2 * data.tackCoatRatePerM2;
  const profilingCost = profilingArea * data.profilingRatePerM2;
  const cartageCost = requiredTrips * data.cartageRatePerTrip;
  const mobilisationCost = data.mobilisations * data.mobilisationRate + data.floatMovements * data.floatRate;
  const allowancesCost = data.accommodationNights * data.accommodationPersons * data.accommodationRate
    + data.travelPersons * data.travelDays * data.travelAllowanceRate;
  const directCost = materialCost + tackCoatCost + profilingCost + cartageCost + labourCost + plantCost
    + trafficCost + mobilisationCost + allowancesCost + subcontractorCost + itemsCost;
  const overheadCost = directCost * data.overheadsPct / 100;
  const contingencyCost = (directCost + overheadCost) * data.contingencyPct / 100;
  const totalCost = directCost + overheadCost + contingencyCost;
  const marginFactor = data.marginType === "margin" ? 1 - data.marginValue / 100 : 1;
  const sellRate = data.marginType === "margin" && marginFactor > 0
    ? totalCost / marginFactor
    : totalCost * (1 + data.marginValue / 100);
  const grossProfit = sellRate - totalCost;
  const grossMargin = sellRate > 0 ? grossProfit / sellRate * 100 : 0;
  const gstAmount = sellRate * data.gstPct / 100;
  return {
    effectiveAreaM2: roundQuantity(effectiveAreaM2),
    rawTonnes: roundQuantity(rawTonnes),
    totalTonnes: roundQuantity(totalTonnes),
    estimatedShifts,
    requiredTrips,
    materialCost: roundMoney(materialCost),
    tackCoatCost: roundMoney(tackCoatCost),
    profilingCost: roundMoney(profilingCost),
    cartageCost: roundMoney(cartageCost),
    labourCost: roundMoney(labourCost),
    plantCost: roundMoney(plantCost),
    trafficCost: roundMoney(trafficCost),
    mobilisationCost: roundMoney(mobilisationCost),
    allowancesCost: roundMoney(allowancesCost),
    subcontractorCost: roundMoney(subcontractorCost),
    itemsCost: roundMoney(itemsCost),
    itemsByCategory: Object.fromEntries(COST_CATEGORIES.map((c) => [c, roundMoney(itemsByCategory[c])])) as Record<CostCategory, number>,
    directCost: roundMoney(directCost),
    overheadCost: roundMoney(overheadCost),
    contingencyCost: roundMoney(contingencyCost),
    totalCost: roundMoney(totalCost),
    costPerTonne: totalTonnes > 0 ? roundMoney(totalCost / totalTonnes) : 0,
    costPerM2: effectiveAreaM2 > 0 ? roundMoney(totalCost / effectiveAreaM2) : 0,
    sellRate: roundMoney(sellRate),
    sellRatePerTonne: totalTonnes > 0 ? roundMoney(sellRate / totalTonnes) : 0,
    sellRatePerM2: effectiveAreaM2 > 0 ? roundMoney(sellRate / effectiveAreaM2) : 0,
    grossProfit: roundMoney(grossProfit),
    grossMargin: roundMoney(grossMargin),
    gstAmount: roundMoney(gstAmount),
    totalQuoteValue: roundMoney(sellRate + gstAmount),
  };
}

export function validateEstimate(data: EstimateData, totals: EstimateTotals): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!data.clientName) errors.push("Select or enter a client.");
  if (!data.projectName) errors.push("Enter a project name.");
  if (!data.site) warnings.push("Site has not been entered.");
  if (!data.workType) errors.push("Select a work type.");
  if (data.includePaving === false) {
    if (totals.directCost <= 0) errors.push("Add at least one priced item.");
    const perShift = [...data.labour, ...data.plant, ...data.traffic].some((line) => ("headcount" in line ? line.headcount : line.units) > 0);
    if (perShift && totals.estimatedShifts <= 0) errors.push("Enter the number of shifts for crew, plant and traffic lines.");
    (data.items || []).forEach((item, index) => {
      if (item.quantity > 0 && item.rate <= 0) errors.push(`Item ${index + 1} (${item.description}) has no rate.`);
      if (item.rateBasis === "hour" && item.quantity > 0 && item.productivity <= 0) errors.push(`Item ${index + 1} (${item.description}) needs a productivity to calculate hours.`);
    });
    if (data.marginType === "margin" && data.marginValue >= 99.9) errors.push("Margin must be below 99.9%.");
    if (totals.grossMargin + 0.0001 < data.targetMarginPct) warnings.push(`Gross margin is ${totals.grossMargin.toFixed(1)}%, below the ${data.targetMarginPct.toFixed(1)}% target.`);
    return { errors, warnings, isValid: errors.length === 0 };
  }
  if (totals.effectiveAreaM2 <= 0) errors.push("Area must be greater than zero.");
  if (data.compactedDepthMm <= 0) errors.push("Compacted depth must be greater than zero.");
  if (data.compactedDepthMm > 300) errors.push("Compacted depth looks unrealistic (maximum 300 mm).");
  if (data.compactedDepthMm > 0 && data.compactedDepthMm < 10) warnings.push("Compacted depth is unusually shallow; confirm the specification.");
  if (data.materialDensityTPerM3 <= 0) errors.push("Material density must be greater than zero.");
  if (data.materialDensityTPerM3 > 0 && (data.materialDensityTPerM3 < 1.5 || data.materialDensityTPerM3 > 2.8)) {
    errors.push("Material density looks unrealistic; use a value between 1.5 and 2.8 t/m³.");
  }
  if (data.wastePct > 20) warnings.push("Waste is above 20%; confirm the allowance with the estimator.");
  if (totals.totalTonnes > 0 && data.supplierRatePerT <= 0) errors.push("Supplier asphalt rate is missing.");
  if (totals.totalTonnes > 0 && data.truckPayloadT <= 0) errors.push("Truck payload is required to calculate trips.");
  if (totals.requiredTrips > 0 && data.cartageRatePerTrip <= 0) errors.push("Cartage rate is missing for the required truck trips.");
  if (totals.estimatedShifts <= 0) errors.push("Production rate or shift override is required to calculate shifts.");
  if (data.marginType === "margin" && data.marginValue >= 99.9) errors.push("Margin must be below 99.9%.");
  const rateLineErrors = [
    ...data.labour.filter((line) => line.headcount > 0 && line.hoursPerShift > 0 && line.hourlyRate <= 0).map((line) => `${line.name || "Labour"} rate is missing.`),
    ...data.plant.filter((line) => line.units > 0 && line.hoursPerShift > 0 && line.hourlyRate <= 0).map((line) => `${line.name || "Plant"} rate is missing.`),
    ...data.traffic.filter((line) => line.units > 0 && line.days > 0 && line.ratePerDay <= 0).map((line) => `${line.name || "Traffic resource"} rate is missing.`),
    ...data.subcontractors.filter((line) => line.quantity > 0 && line.unitRate <= 0).map((line) => `${line.name || "Subcontractor"} rate is missing.`),
  ];
  errors.push(...rateLineErrors);
  (data.items || []).forEach((item, index) => {
    if (item.quantity > 0 && item.rate <= 0) errors.push(`Item ${index + 1} (${item.description}) has no rate.`);
    if (item.rateBasis === "hour" && item.quantity > 0 && item.productivity <= 0) errors.push(`Item ${index + 1} (${item.description}) needs a productivity to calculate hours.`);
  });
  if (data.areaM2 > 0 && data.lengthM > 0 && data.widthM > 0) {
    const dimensionalArea = data.lengthM * data.widthM;
    if (Math.abs(dimensionalArea - data.areaM2) / data.areaM2 > 0.05) {
      warnings.push("Area does not match length × width by more than 5%; confirm the quantity.");
    }
  }
  if (totals.grossMargin + 0.0001 < data.targetMarginPct) {
    warnings.push(`Gross margin is ${totals.grossMargin.toFixed(1)}%, below the ${data.targetMarginPct.toFixed(1)}% target.`);
  }
  return { errors, warnings, isValid: errors.length === 0 };
}

/** Cost breakdown by the platform's five cost categories (used for baselines and estimate-vs-actual). */
export function costBreakdown(totals: EstimateTotals) {
  const items = totals.itemsByCategory ?? { labour: 0, plant: 0, material: 0, subcontract: 0, other: 0 };
  const breakdown = {
    labour: roundMoney(totals.labourCost + items.labour),
    plant: roundMoney(totals.plantCost + items.plant),
    material: roundMoney(totals.materialCost + totals.tackCoatCost + items.material),
    subcontract: roundMoney(totals.subcontractorCost + totals.trafficCost + totals.profilingCost + items.subcontract),
    other: roundMoney(totals.cartageCost + totals.mobilisationCost + totals.allowancesCost + items.other),
    indirect: roundMoney(totals.overheadCost),
    contingency: roundMoney(totals.contingencyCost),
  };
  return { ...breakdown, total: roundMoney(totals.totalCost) };
}
