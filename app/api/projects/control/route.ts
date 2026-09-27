import {api} from '@/lib/platform/http';
import {projectFinancials,estimateVsActual} from '@/lib/seams/project-control';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'commercial',capability:'commercial.view'},async({params})=>{const id=String(params.get('id')||'');return {financials:await projectFinancials(id),estimateVsActual:await estimateVsActual(id)};});
