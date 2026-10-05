// Maintenance gate (lib/platform/maintenance.ts). A no-op unless MAINTENANCE_UNTIL is a future time, or an existing-tenant APPLY is configured and its
// importer is still running; then every request except GET /api/health is refused with 503 before any route, auth handler or webhook can run, so nothing
// can write to the database while a backup, fingerprint, plan or import is in progress. The window ending never reopens the app while the importer's
// database lock is held (fail closed). Recovery: it ends at MAINTENANCE_UNTIL once no import is running, or remove the variable(s) in hosting and restart.
import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';
import {maintenanceState} from '@/lib/platform/maintenance';
import {importFence,importInFlight} from '@/lib/platform/maintenance-fence';
import {getPool} from '@/lib/platform/database';

export async function proxy(request:NextRequest){
 const m=maintenanceState();
 let reason:'maintenance'|'import'|null=m.active?'maintenance':null;
 if(!reason){const f=importFence();if(f.configured&&await importInFlight(f.lockName,(sql,params)=>getPool().query(sql,params as never)))reason='import';}
 if(!reason)return NextResponse.next();
 if(request.method==='GET'&&request.nextUrl.pathname==='/api/health')return NextResponse.next();
 const retry=String(Math.max(30,Math.ceil(m.remainingMs/1000)||30));
 const headers={'Retry-After':retry,'Cache-Control':'no-store','X-Robots-Tag':'noindex'};
 const until=m.until||'the import has finished';
 if(request.nextUrl.pathname.startsWith('/api/'))return NextResponse.json({error:'maintenance',reason,message:'The system is in scheduled maintenance. Try again after '+until+'.',until:m.until},{status:503,headers});
 const note=reason==='import'?'<p>A data import that started during the maintenance window is still finishing, so the system stays closed until it has stopped. This lifts automatically within seconds of that.</p>':'';
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scheduled maintenance</title><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5"><h1>Scheduled maintenance</h1><p>The system is temporarily unavailable while the data is backed up and updated. Nothing is lost. It will be available again after <strong>${until}</strong>.</p>${note}<p style="color:#555;font-size:.9rem">Administrator: this ends automatically at that time (and once any import has stopped). To end it earlier, remove <code>MAINTENANCE_UNTIL</code> (and <code>EXISTING_TENANT_LOAD</code>) from the hosting environment variables and restart the app.</p></body></html>`;
 return new NextResponse(html,{status:503,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}
export const config={matcher:'/:path*'};
