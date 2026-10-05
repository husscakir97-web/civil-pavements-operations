// Bounded maintenance mode: the freeze that makes a database fingerprint, a reviewed plan and an import meaningful. It is a REQUEST BLOCK, not a
// database lock: while MAINTENANCE_UNTIL is a future time, proxy.ts refuses every request to this app (page, API, auth, webhook) with a 503 except
// GET /api/health, and every outbound integration (email, object storage, AI, ABN lookup, address provider) refuses to run even if some code path
// reached it. It ends by itself at that time, or immediately when the variable is removed and the app restarted. There is no background writer in
// this application (no timers or schedulers; its timeouts are per request), so with requests blocked nothing else writes to the database.
// Inert when MAINTENANCE_UNTIL is unset, empty, unparseable or already past. scripts/ use the plain-JS twin lib/platform/maintenance-policy.mjs;
// scripts/test-maintenance.cjs asserts the two agree.
export const MAX_WINDOW_HOURS=12;
export type MaintenanceState={active:boolean;until:string|null;remainingMs:number;problem:string|null};
export function maintenanceState(env:Record<string,string|undefined>=process.env,now:number=Date.now()):MaintenanceState{
 const raw=String(env.MAINTENANCE_UNTIL||'').trim();
 if(!raw)return {active:false,until:null,remainingMs:0,problem:null};
 const t=Date.parse(raw);
 if(!Number.isFinite(t))return {active:false,until:null,remainingMs:0,problem:'MAINTENANCE_UNTIL is not a valid date-time'};
 if(t<=now)return {active:false,until:new Date(t).toISOString(),remainingMs:0,problem:'maintenance has ended (MAINTENANCE_UNTIL is in the past)'};
 return {active:true,until:new Date(t).toISOString(),remainingMs:t-now,problem:null};
}
/** Throws while maintenance is active: every outbound integration calls this first. */
export function assertNotMaintenance(what:string,env:Record<string,string|undefined>=process.env,now:number=Date.now()):void{
 if(maintenanceState(env,now).active)throw new Error(`Maintenance mode: ${what} is disabled until maintenance ends.`);
}
