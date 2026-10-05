// Classification only. Never use this to infer availability, entitlements or pay.
export const EMPLOYEE_CLASSIFICATIONS = ['full_time', 'part_time', 'casual'] as const;
export type EmployeeClassification = (typeof EMPLOYEE_CLASSIFICATIONS)[number];
export const EMPLOYMENT_TYPES = [...EMPLOYEE_CLASSIFICATIONS, 'employee', 'contractor', 'labour hire'] as const;

const aliases: Record<string, string> = {
  'full time': 'full_time', fulltime: 'full_time',
  'part time': 'part_time', parttime: 'part_time', casual: 'casual',
  employee: 'employee', permanent: 'employee',
  contractor: 'contractor', subcontractor: 'contractor',
  'labour hire': 'labour hire', 'labor hire': 'labour hire',
};
export function normaliseEmploymentType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const key = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return Object.hasOwn(aliases, key) ? aliases[key] : text;
}
export function knownEmploymentType(value: unknown): boolean {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(normaliseEmploymentType(value) || '');
}
export function employmentLabel(value: unknown): string {
  const type = normaliseEmploymentType(value);
  const labels: Record<string, string> = {full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', employee: 'Employee (type unspecified)', contractor: 'Contractor', 'labour hire': 'Labour hire'};
  if (!type) return 'Employment type not recorded';
  return Object.hasOwn(labels, type) ? labels[type] : `Review employment type: ${type}`;
}
export function employeeAssumption(value: unknown): EmployeeClassification | undefined {
  const type = normaliseEmploymentType(value);
  return (EMPLOYEE_CLASSIFICATIONS as readonly string[]).includes(type || '') ? type as EmployeeClassification : undefined;
}
/** Typed values, including NULL, beat stale metadata once the worker has been synced. */
export function workerEmployment(row: {employment_type?: unknown; legacy_synced_at?: unknown}, metadata: Record<string, unknown>): string | null {
  return normaliseEmploymentType(row.legacy_synced_at || row.employment_type != null ? row.employment_type : metadata.employmentType);
}
