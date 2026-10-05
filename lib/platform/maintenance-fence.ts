// Import fence (server-only: proxy.ts and /api/health). Kept apart from maintenance.ts so that file stays free of Node-only imports (it is reachable from browser bundles).
import {createHash} from 'node:crypto';
export const IMPORT_FENCE_TTL_MS=1000;
// ---- import fence --------------------------------------------------------------------------------------------------------------------------------
// The window ending is NOT allowed to reopen the app while an apply can still mutate data. While EXISTING_TENANT_LOAD=apply is configured, the app stays
// closed (503) for as long as the importer's advisory lock is held, even after MAINTENANCE_UNTIL, and reopens within a second of the importer's database
// session ending. The check fails closed: if it cannot be made, the app stays closed. Only consulted when an apply is configured.
export const importLockName=(database:string,org:string)=>'demo_import_'+createHash('sha256').update(String(database)+'|'+org).digest('hex').slice(0,40);
export function importFence(env:Record<string,string|undefined>=process.env):{configured:boolean;lockName:string|null}{
 if(String(env.EXISTING_TENANT_LOAD||'').trim().toLowerCase()!=='apply'||!env.MYSQL_DATABASE)return {configured:false,lockName:null};
 try{const org=JSON.parse(String(env.EXISTING_TENANT_ALLOWLIST_JSON||'')).organisationId;if(typeof org==='string'&&org)return {configured:true,lockName:importLockName(env.MYSQL_DATABASE,org)};}catch{/* unparseable */}
 return {configured:true,lockName:null};   // configured but we cannot name the lock: stay closed (fail closed)
}
let fenceCache:{at:number;value:boolean}|null=null;
export async function importInFlight(lockName:string|null,query:(sql:string,params:unknown[])=>Promise<unknown>,now:number=Date.now()):Promise<boolean>{
 if(!lockName)return true;
 if(fenceCache&&now-fenceCache.at<IMPORT_FENCE_TTL_MS)return fenceCache.value;
 let value=true;
 try{const r=await query('SELECT IS_USED_LOCK(?) AS u',[lockName]) as [Array<{u:number|null}>];value=r[0]?.[0]?.u!==null&&r[0]?.[0]?.u!==undefined;}catch{value=true;}
 fenceCache={at:now,value};return value;
}
export const resetImportFenceCache=()=>{fenceCache=null;};
