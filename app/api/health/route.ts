import {maintenanceState} from '@/lib/platform/maintenance';
// Liveness only: no database, no session. Exempt from the maintenance gate so the host (and the owner) can still see the app is up.
export const dynamic='force-dynamic';
export function GET(){const m=maintenanceState();return Response.json({ok:true,maintenance:{active:m.active,until:m.until}},{headers:{'Cache-Control':'no-store'}});}
