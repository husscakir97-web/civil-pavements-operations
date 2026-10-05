// Maintenance gate (lib/platform/maintenance.ts). A no-op unless MAINTENANCE_UNTIL is a future time; then every request except GET /api/health
// is refused with 503 before any route, auth handler or webhook can run, so nothing can write to the database while a backup, fingerprint,
// plan or import is in progress. Recovery: it ends at MAINTENANCE_UNTIL, or remove the variable in hosting and restart.
import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';
import {maintenanceState} from '@/lib/platform/maintenance';

export function proxy(request:NextRequest){
 const m=maintenanceState();
 if(!m.active)return NextResponse.next();
 if(request.method==='GET'&&request.nextUrl.pathname==='/api/health')return NextResponse.next();
 const retry=String(Math.max(30,Math.ceil(m.remainingMs/1000)));
 const headers={'Retry-After':retry,'Cache-Control':'no-store','X-Robots-Tag':'noindex'};
 if(request.nextUrl.pathname.startsWith('/api/'))return NextResponse.json({error:'maintenance',message:'The system is in scheduled maintenance. Try again after '+m.until+'.',until:m.until},{status:503,headers});
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scheduled maintenance</title><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5"><h1>Scheduled maintenance</h1><p>The system is temporarily unavailable while the data is backed up and updated. Nothing is lost. It will be available again after <strong>${m.until}</strong>.</p><p style="color:#555;font-size:.9rem">Administrator: this ends automatically at that time. To end it earlier, remove <code>MAINTENANCE_UNTIL</code> from the hosting environment variables and restart the app.</p></body></html>`;
 return new NextResponse(html,{status:503,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}
export const config={matcher:'/:path*'};
