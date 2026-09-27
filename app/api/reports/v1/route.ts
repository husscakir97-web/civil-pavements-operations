import {api} from '@/lib/platform/http';
import {reportsV1} from '@/lib/seams/reports';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'reports',capability:'reports.view'},async()=>reportsV1());
