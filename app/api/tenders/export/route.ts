import {api} from '@/lib/platform/http';
import {exportTender} from '@/lib/modules/pipeline/tenders';
export const dynamic='force-dynamic';
// Export stays available even when the pipeline module is read-only.
export const GET=api({permission:'read',module:'pipeline',capability:'pipeline.view'},async({params})=>exportTender(String(params.get('id')||'')));
