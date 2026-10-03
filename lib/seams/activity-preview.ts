import {itemAmount, itemHours, type EstimateItem} from '../estimate-calculations';

/** A what-if contract, never an approved estimate or an allocation. All hours are
 * productive activity hours, not elapsed clock time or multiplied crew hours. */
export type ActivityPreviewInput = {
  quantity: number | null;
  unit: string;
  productionPerDay: number | null;
  productiveHoursPerDay: number | null;
  rate: number | null;
  rateBasis: 'unit' | 'hour';
};

export function previewNumber(value: string | number | null | undefined): number | null {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function activityPreview(input: ActivityPreviewInput) {
  const missing: string[] = [];
  const quantity = previewNumber(input.quantity);
  const production = previewNumber(input.productionPerDay);
  const hours = previewNumber(input.productiveHoursPerDay);
  const rate = previewNumber(input.rate);
  if (quantity === null) missing.push('Enter a non-negative quantity.');
  if (!input.unit.trim()) missing.push('Enter the quantity unit.');
  if (production === null || production <= 0) missing.push('Enter production per working day greater than zero.');
  if (hours === null || hours <= 0 || hours > 24) missing.push('Enter productive hours per working day (greater than zero, up to 24).');
  if (rate === null) missing.push('Enter a non-negative direct cost rate.');
  const workingDays = quantity !== null && production !== null && production > 0 && input.unit.trim()
    ? quantity / production : null;
  const canHours = workingDays !== null && hours !== null && hours > 0 && hours <= 24;
  const item: EstimateItem = {id:'preview', section:'Programme', costCode:'', category:'other', description:'Activity preview',
    quantity:quantity ?? 0, unit:input.unit, productivity:canHours ? production! / hours! : 0,
    rateBasis:input.rateBasis, rate:rate ?? 0};
  const productiveHours = canHours ? itemHours(item) : null;
  const directCost = quantity !== null && input.unit.trim() && rate !== null && (input.rateBasis === 'unit' || canHours)
    ? itemAmount(item) : null;
  return {workingDays, productiveHours, directCost, missing,
    // Existing programme storage requires at least one calendar day, including zero work.
    minimumCalendarDays:workingDays === null ? null : Math.max(1, Math.ceil(workingDays))};
}
