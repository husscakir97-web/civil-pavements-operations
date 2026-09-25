// The single entitlement service. Route, navigation, seam and data checks all
// resolve through getEntitlements(); components never read flags directly.
// Uses the Database compat layer so legacy SQLite regression doubles work too.
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from './context';
import {database} from './database';
import {MODULES,TRIAL_PLAN,usable,writable,type Entitlements,type EntitlementStatus,type ModuleKey} from './modules';
export {usable,writable};
const now=()=>new Date().toISOString();
const INSERT="INSERT INTO organisation_entitlements (id,organisation_id,module,status,source,plan_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id";

/** Signup provisioning (inside the organisation transaction). */
export async function provisionTrial(organisationId:string,conn?:PoolConnection){
 const t=now();
 for(const moduleKey of MODULES){const values=[crypto.randomUUID(),organisationId,moduleKey,'active','trial',TRIAL_PLAN,t,t];if(conn)await conn.execute(INSERT,values);else await database.prepare(INSERT).bind(...values).run();}
}

export async function getEntitlements(organisationId:string):Promise<Entitlements>{
 const actor=actorContext.getStore();
 if(actor?.organisationId===organisationId&&actor.entitlements)return actor.entitlements;
 let rows=(await database.prepare('SELECT module,status,valid_until FROM organisation_entitlements WHERE organisation_id=?').bind(organisationId).all<{module:string;status:EntitlementStatus;valid_until:string|null}>()).results;
 if(!rows.length){
  // Organisations created before the entitlement service keep full beta-trial
  // access. This is the only implicit grant; it is persisted, so it is visible.
  await provisionTrial(organisationId);
  rows=MODULES.map(module=>({module,status:'active' as const,valid_until:null}));
 }
 const today=now();
 const out=Object.fromEntries(MODULES.map(m=>[m,'disabled'])) as Entitlements;
 for(const r of rows)if((MODULES as readonly string[]).includes(r.module))out[r.module as ModuleKey]=r.valid_until&&r.valid_until<today&&r.status==='active'?'read_only':r.status;
 out.core='active';
 if(actor?.organisationId===organisationId)actor.entitlements=out;
 return out;
}

/** Downgrades never delete data. Records created while entitled stay readable/exportable. */
export async function setEntitlement(organisationId:string,module:ModuleKey,status:EntitlementStatus,source='manual'){
 if(module==='core')throw Object.assign(new Error('Core cannot be changed.'),{status:400});
 const before=(await getEntitlements(organisationId))[module];
 const t=now(),actor=actorContext.getStore();
 await database.batch([
  database.prepare('INSERT INTO organisation_entitlements (id,organisation_id,module,status,source,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),source=VALUES(source),updated_at=VALUES(updated_at),updated_by=VALUES(updated_by)').bind(crypto.randomUUID(),organisationId,module,status,source,t,t,actor?.userId??null),
  database.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,summary,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),organisationId,actor?.userId??null,actor?.email??null,'entitlement.changed','entitlement',module,`${module}: ${before} → ${status}`,JSON.stringify({status:before}),JSON.stringify({status,source}),t),
 ]);
 if(actor)delete actor.entitlements;
 return {module,before,status};
}

export class ModuleUnavailable extends Error{constructor(readonly status:number,message:string){super(message);}}
export async function requireModule(module:ModuleKey,write=false){
 const actor=actorContext.getStore();if(!actor)throw new ModuleUnavailable(401,'Sign in required.');
 const e=await getEntitlements(actor.organisationId);
 if(!usable(e,module))throw new ModuleUnavailable(404,'Not found.');
 if(write&&!writable(e,module))throw new ModuleUnavailable(403,'This module is read-only for your organisation. Existing records remain available to view and export.');
 return e;
}
/** A seam fires only when every participating module is fully entitled. */
export async function seamEnabled(organisationId:string,...modules:ModuleKey[]){const e=await getEntitlements(organisationId);return modules.every(m=>writable(e,m));}
