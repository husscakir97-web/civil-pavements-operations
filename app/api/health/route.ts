import {maintenanceState} from '@/lib/platform/maintenance';
import {importFence,importInFlight} from '@/lib/platform/maintenance-fence';
import {getPool} from '@/lib/platform/database';
// Liveness only. Exempt from the maintenance gate so the host (and the owner) can still see the app is up. It touches the database ONLY to report an
// existing-tenant import's lock when an apply is configured; otherwise no database, no session.
export const dynamic='force-dynamic';
export async function GET(){
 const m=maintenanceState(),f=importFence();
 const inFlight=f.configured?await importInFlight(f.lockName,(sql,params)=>getPool().query(sql,params as never)):null;
 return Response.json({ok:true,maintenance:{active:m.active,until:m.until},import:{configured:f.configured,inFlight}},{headers:{'Cache-Control':'no-store'}});
}
