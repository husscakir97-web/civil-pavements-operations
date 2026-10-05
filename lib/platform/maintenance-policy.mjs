// Plain-JS twin of lib/platform/maintenance.ts for scripts (see that file). Adds the window rules the hosted loader enforces.
export const MAX_WINDOW_HOURS=12;
export const MIN_REMAINING_MINUTES=5;
export function maintenanceState(env=process.env,now=Date.now()){
 const raw=String(env.MAINTENANCE_UNTIL||'').trim();
 if(!raw)return {active:false,until:null,remainingMs:0,problem:null};
 const t=Date.parse(raw);
 if(!Number.isFinite(t))return {active:false,until:null,remainingMs:0,problem:'MAINTENANCE_UNTIL is not a valid date-time'};
 if(t<=now)return {active:false,until:new Date(t).toISOString(),remainingMs:0,problem:'maintenance has ended (MAINTENANCE_UNTIL is in the past)'};
 return {active:true,until:new Date(t).toISOString(),remainingMs:t-now,problem:null};
}
/** What is wrong with the maintenance window for a fingerprint / plan / apply. Empty = the freeze is in force and long enough. */
export function maintenanceWindowProblems(env=process.env,now=Date.now()){
 const m=maintenanceState(env,now);
 if(!m.active)return [m.problem||'MAINTENANCE_UNTIL is not set: put the app into maintenance (a future time within '+MAX_WINDOW_HOURS+' hours) and restart it before fingerprint, plan or apply'];
 const p=[];
 if(m.remainingMs<MIN_REMAINING_MINUTES*60_000)p.push(`less than ${MIN_REMAINING_MINUTES} minutes of maintenance remain: extend MAINTENANCE_UNTIL and restart`);
 if(m.remainingMs>MAX_WINDOW_HOURS*3600_000)p.push(`MAINTENANCE_UNTIL is more than ${MAX_WINDOW_HOURS} hours away: choose a bounded window`);
 return p;
}
