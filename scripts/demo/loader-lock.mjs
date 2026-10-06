import {createHash} from 'node:crypto';
import {importLockName} from '../../lib/platform/maintenance-policy.mjs';

// Quiescence covers the entire database, so this mutex must too. It is acquired
// non-blockingly BEFORE any KILL, fingerprint, or child launch, across hosts/PIDs.
// Keep the owning connection alive until the child AND final quiescence finish.
export const loaderLockName=database=>'demo_loader_'+createHash('sha256').update(String(database)).digest('hex').slice(0,40);
export async function acquireLoaderLock(db,database,org){
 const [[row]]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[loaderLockName(database)]);
 if(Number(row.acquired)!==1)return false;
 // A previous loader may have died while its importer still owns its fence.
 // Never kill a live import just because a new runtime instance has started.
 const [[importer]]=await db.query('SELECT IS_USED_LOCK(?) AS owner',[importLockName(database,org)]);
 if(importer.owner!==null)return false;
 return true;
}
