export type Meta = Record<string, unknown>;
export type DeliveryRecord = { id: string; name: string; status: string; metadata: Meta; createdAt?: string };
export type Assignment = { resourceId: string; category: string; name: string; role: string; hours: number; rate: number; payload: number; trips: number };
export const SHIFT_STATUSES = ['Draft', 'Planned', 'Ready', 'In Progress', 'Completed', 'Cancelled', 'Stand-down'];
export const CHECKS = ['Crew briefed', 'Plant pre-start complete', 'Traffic setup reviewed', 'Permits verified', 'Materials confirmed', 'Site access confirmed'];
export const protectedKeys = ['approvedBudget', 'estimateSnapshot', 'sourceEstimateId', 'sourceRevisionId', 'awardedAt'];
export function mergeJob(previous: Meta, patch: Meta): Meta {
  const next = { ...previous, ...patch };
  for (const key of protectedKeys) { if (key in previous) next[key] = previous[key]; else delete next[key]; }
  return next;
}
export function jobDetails(job: DeliveryRecord): Meta {
  const s = (job.metadata.estimateSnapshot || {}) as Meta;
  const b = (job.metadata.approvedBudget || {}) as Meta;
  return { client: s.clientName || '', site: s.site || '', workType: s.workType || '', specification: s.specification || '', scope: s.specification || '', contractValue: b.sellRate || '', ...job.metadata };
}
export function assignments(s: DeliveryRecord): Assignment[] { return Array.isArray(s.metadata.assignments) ? s.metadata.assignments as Assignment[] : []; }
export function interval(m: Meta): [number, number] {
  const start = Date.parse(`${m.date}T${m.start || '00:00'}:00Z`);
  let finish = Date.parse(`${m.date}T${m.finish || '00:00'}:00Z`);
  if (finish <= start) finish += 86400000;
  return [start, finish];
}
export function plannedCost(s: DeliveryRecord) { return assignments(s).reduce((sum, a) => sum + Number(a.hours || 0) * Number(a.rate || 0), 0) + Number(s.metadata.materialCost || 0) + Number(s.metadata.otherCost || 0); }
export function shiftWarnings(shift: DeliveryRecord, jobs: DeliveryRecord[], shifts: DeliveryRecord[], resources: DeliveryRecord[]): string[] {
  if (['Cancelled', 'Stand-down'].includes(shift.status)) return [];
  const m = shift.metadata; const job = jobs.find(j => j.id === m.jobId); const j = job ? jobDetails(job) : {};
  const warnings: string[] = []; const list = assignments(shift); const [start, end] = interval(m);
  if (!job) warnings.push('Select a job.');
  if (!Number.isFinite(start) || !Number.isFinite(end)) warnings.push('Enter a date, start and finish.');
  for (const [key, label] of [['po', 'purchase order'], ['siteContact', 'site contact'], ['permit', 'permit'], ['tmp', 'TMP'], ['tgs', 'TGS']]) {
    if (!String(m[key] || j[key] || '').trim()) warnings.push(`Missing ${label}.`);
  }
  for (const a of list) {
    const resource = resources.find(r => r.id === a.resourceId);
    if (!resource) { warnings.push(`${a.name}: resource no longer available.`); continue; }
    if (['maintenance', 'inactive', 'out of service', 'unavailable', 'leave'].includes(resource.status.toLowerCase())) warnings.push(`${a.name}: ${resource.status}.`);
    if (a.category === 'workers') {
      const expiry = String(resource.metadata.competencyExpiry || '');
      if (!expiry) warnings.push(`${a.name}: competency expiry not recorded.`);
      else if (expiry < String(m.date)) warnings.push(`${a.name}: competency expired ${expiry}.`);
    }
    for (const other of shifts) {
      if (other.id === shift.id || ['Cancelled', 'Stand-down'].includes(other.status)) continue;
      const [os, oe] = interval(other.metadata);
      if (start < oe && end > os && assignments(other).some(b => b.resourceId === a.resourceId)) warnings.push(`${a.name}: overlaps ${other.name}.`);
    }
  }
  const occupancyStart = String(j.occupancyStart || ''); const occupancyFinish = String(j.occupancyFinish || '');
  if (occupancyStart && occupancyFinish && Number.isFinite(start)) {
    const [ws, we] = interval({ date: m.date, start: occupancyStart, finish: occupancyFinish });
    if (![[ws, we], [ws - 86400000, we - 86400000]].some(([a,b]) => start >= a && end <= b)) warnings.push('Shift is outside approved job occupancy hours.');
  } else warnings.push('Approved occupancy hours not recorded on job.');
  if (m.occupancyStart && m.occupancyFinish) {
    const [a,b] = interval({ date:m.date, start:m.occupancyStart, finish:m.occupancyFinish });
    if (start < a || end > b) warnings.push('Work is outside shift occupancy hours.');
  }
  if (!list.length) warnings.push('No resources assigned.');
  const budget = j.approvedBudget as Meta | undefined;
  const related = [...shifts.filter(s => s.id !== shift.id && s.metadata.jobId === m.jobId && !['Cancelled','Stand-down'].includes(s.status)), shift];
  if (budget) {
    if (related.reduce((sum,s) => sum + plannedCost(s),0) > Number(budget.directCost || 0)) warnings.push('Planned job costs exceed approved direct-cost budget.');
    if (related.reduce((sum,s) => sum + Number(s.metadata.tonnes || 0),0) > Number(budget.totalTonnes || 0)) warnings.push('Planned tonnes exceed approved estimate.');
    if (related.length > Number(budget.estimatedShifts || 0)) warnings.push('Planned shifts exceed approved estimate.');
    const snapshot = (j.estimateSnapshot || {}) as Meta;
    for (const [category,key,quantity] of [['workers','labour','headcount'],['plant','plant','units'],['crews','traffic','units']]) {
      const allowance = ((snapshot[key] || []) as Meta[]).reduce((n,row) => n + Number(row[quantity] || 0) * Number(row.hoursPerShift || 0) * Number(budget.estimatedShifts || 1),0);
      const hours = related.reduce((n,s) => n + assignments(s).filter(a=>a.category===category).reduce((v,a)=>v+Number(a.hours||0),0),0);
      if (hours > allowance && category !== 'crews') warnings.push(`Planned ${category} hours exceed estimate allowance.`);
    }
  } else warnings.push('Job has no approved estimate baseline.');
  return [...new Set(warnings)];
}
