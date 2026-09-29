import {api} from '@/lib/platform/http';
import {reportsV1} from '@/lib/seams/reports';
export const dynamic='force-dynamic';
// Module workspace summaries are Core; full reporting remains a paid module.
// The shared query applies both capability and entitlement gates per section.
export const GET=api({permission:'read',module:'core'},async()=>reportsV1());
