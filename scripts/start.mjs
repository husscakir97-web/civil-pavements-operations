// Never serve requests against an old schema. Hostinger runs this with npm start.
import './migrate.mjs';
// Staging demonstration only (inert unless STAGING_DEMO_MODE=true and STAGING_DEMO_LOAD is set): load/verify the demo in the background so
// the server starts at once and the host's health check is not blocked. Output goes to the runtime log.
if(String(process.env.STAGING_DEMO_MODE||'').toLowerCase()==='true'&&process.env.STAGING_DEMO_LOAD){
 const {spawn}=await import('node:child_process');
 spawn(process.execPath,[new URL('./staging-load.mjs',import.meta.url).pathname],{env:process.env,stdio:'inherit',detached:false}).on('error',e=>console.log('[staging-load] could not start:',e.message));
}
// Existing-tenant demonstration loading (docs/EXISTING-TENANT-DEMO-IMPORT.md): inert unless EXISTING_TENANT_LOAD is set; never together with staging mode.
if(process.env.EXISTING_TENANT_LOAD){
 const {spawn}=await import('node:child_process');
 spawn(process.execPath,[new URL('./existing-tenant-load.mjs',import.meta.url).pathname],{env:process.env,stdio:'inherit',detached:false}).on('error',e=>console.log('[existing-tenant-load] could not start:',e.message));
}
// Keep Next in this process so hosting shutdown signals reach it directly.
process.argv=[process.execPath,'next','start','--hostname','0.0.0.0',...process.argv.slice(2)];
await import('next/dist/bin/next');
