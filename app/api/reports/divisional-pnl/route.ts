import {api} from '@/lib/platform/http';
import {divisionalPnl} from '@/lib/seams/divisional-pnl';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'reports',capability:'commercial.view'},async({params})=>divisionalPnl(params.get('start')??'',params.get('end')??'',params.get('divisionId')||null));
