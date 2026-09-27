// Presentation order for the planner's existing shift readiness warnings (lib/planning
// shiftWarnings): what stops the crew working comes first, paperwork last. No new rules.
const RANK:Array<[RegExp,number]>=[
 [/Select a job|Enter a date|no longer available|overlaps|expired|: (leave|maintenance|inactive|out of service|unavailable)\.?$/i,0],
 [/competency expiry not recorded|occupancy/i,1],
 [/^Missing /i,2],
];
export function warningRank(w:string){for(const [re,n] of RANK)if(re.test(w))return n;return 1;}
/** Stable sort by urgency; returns the first `limit` plus how many more there are. */
export function prioritiseWarnings(list:string[],limit=2){
 const sorted=list.map((w,i)=>({w,i,r:warningRank(w)})).sort((a,b)=>a.r-b.r||a.i-b.i).map(x=>x.w);
 return {top:sorted.slice(0,limit),rest:sorted.slice(limit),all:sorted};
}
