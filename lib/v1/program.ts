export type Activity={id:string;name:string;start_date:string;duration_days:number;predecessor_id:string|null;status:string};
export const addDays=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
/** Finish-to-start dependencies, calendar days. Never silently edits baseline inputs. */
export function projectProgram<T extends Activity>(activities:T[]){
 const byId=new Map(activities.map(a=>[a.id,a])),visiting=new Set<string>();
 const calculated=new Map<string,{start:string;finish:string;delayDays:number}>();
 function visit(id:string):{start:string;finish:string;delayDays:number}{
  const saved=calculated.get(id);if(saved)return saved;
  const a=byId.get(id);if(!a)throw new Error('Predecessor must belong to this project.');
  if(visiting.has(id))throw new Error('Dependencies cannot form a cycle.');
  visiting.add(id);let start=a.start_date;
  if(a.predecessor_id){const dependency=visit(a.predecessor_id);const next=addDays(dependency.finish,1);if(next>start)start=next;}
  const value={start,finish:addDays(start,Number(a.duration_days)-1),delayDays:Math.round((Date.parse(start)-Date.parse(a.start_date))/86400000)};
  visiting.delete(id);calculated.set(id,value);return value;
 }
 return activities.map(a=>({...a,...visit(a.id)}));
}

/** Moves one activity up (-1) or down (+1) in the user's order. Returns the full new id order. */
export function moveActivity(ids:readonly string[],id:string,delta:number){
 const from=ids.indexOf(id);if(from<0)return [...ids];
 const to=Math.max(0,Math.min(ids.length-1,from+delta)),out=[...ids];
 out.splice(to,0,...out.splice(from,1));return out;
}
/** Display order: explicit sequence first, then planned start, then name. */
export function orderActivities<T extends {sequence?:number|null;start_date:string;name:string}>(rows:T[]){
 return [...rows].sort((a,b)=>(a.sequence??Number.MAX_SAFE_INTEGER)-(b.sequence??Number.MAX_SAFE_INTEGER)||a.start_date.localeCompare(b.start_date)||a.name.localeCompare(b.name));
}
