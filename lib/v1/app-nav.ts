// Primary navigation: conventional construction-business areas, filtered by
// role capabilities and module entitlements. The six-engine lifecycle model
// (lib/v1/engines.ts, lib/v1/workspaces.ts) stays the internal workflow
// architecture; it is no longer the primary menu. Server routes remain the
// authority for every action — this only decides what is shown.
import type {Capability} from '@/lib/platform/permissions';
import {ADMIN_SUBS} from './navigation';

export type NavAccess={can:(c:Capability)=>boolean;module:(m:string)=>boolean};
type Rule={module?:string;modules?:string[];capability?:Capability;anyOf?:Capability[];when?:(a:NavAccess)=>boolean};
export type NavSub=Rule&{key:string};
export type NavArea=Rule&{key:string;label:string;subs?:NavSub[];defaultSub?:string};

const RESOURCE_MODULES=['operations'];
export const NAV:NavArea[]=[
 {key:'Home',label:'Home'},
 // Field capture from an office-style shell (Site Engineer): same Today screen as the field app.
 {key:'Today',label:'Today',capability:'field.capture',when:a=>!a.can('schedule.edit')&&!a.can('pipeline.view')},
 {key:'CRM',label:'CRM',anyOf:['pipeline.view','project.view'],modules:['pipeline','estimating','projects','operations','commercial'],subs:[{key:'Clients'}]},
 {key:'Pipeline',label:'Pipeline',defaultSub:'Opportunities',subs:[
  {key:'Opportunities',module:'pipeline',capability:'pipeline.view'},
  {key:'Tenders',module:'pipeline',capability:'pipeline.view'},
  {key:'Estimates',module:'estimating',anyOf:['pipeline.view','estimate.edit']},
 ]},
 {key:'Projects',label:'Projects',subs:[
  {key:'Projects',module:'projects',capability:'project.view'},
  {key:'Programme',module:'projects',capability:'project.view'},
 ]},
 {key:'Schedule',label:'Schedule',subs:[{key:'Schedule',modules:RESOURCE_MODULES,capability:'schedule.view'}]},
 {key:'Resources',label:'Resources',subs:[
  {key:'People',modules:RESOURCE_MODULES,capability:'schedule.view'},
  {key:'Plant & Equipment',modules:RESOURCE_MODULES,capability:'schedule.view'},
  {key:'Crews',modules:RESOURCE_MODULES,capability:'schedule.view'},
  {key:'Suppliers & Subcontractors',modules:RESOURCE_MODULES,capability:'schedule.view'},
  {key:'Depots',modules:RESOURCE_MODULES,capability:'schedule.view'},
  {key:'Workshop',module:'workshop',capability:'workshop.view'},
 ]},
 {key:'Commercial',label:'Commercial',subs:[
  {key:'Commercial',module:'commercial',capability:'commercial.view'},
  {key:'Dockets',module:'dockets',capability:'docket.approve'},
 ]},
 {key:'IMS & HSEQ',label:'IMS & HSEQ',subs:[{key:'IMS & HSEQ',module:'ims',capability:'hseq.view'}]},
 {key:'Documents',label:'Documents',subs:[{key:'Company Library',anyOf:['project.view','library.edit','hseq.view']}]},
 {key:'Reports',label:'Reports',subs:[
  {key:'Reports',module:'reports',capability:'reports.view'},
  // The lifecycle (engine) view lives here now: useful context, not the front door.
  {key:'Lifecycle',capability:'reports.view'},
 ]},
 {key:'Admin',label:'Admin',subs:ADMIN_SUBS.map(s=>({key:s.key,anyOf:s.anyOf,module:s.module}))},
];

const allowed=(r:Rule,a:NavAccess)=>(!r.module||a.module(r.module))&&(!r.modules?.length||r.modules.some(m=>a.module(m)))&&(!r.capability||a.can(r.capability))&&(!r.anyOf?.length||r.anyOf.some(c=>a.can(c)))&&(!r.when||r.when(a));

/** Areas (with only their permitted sub-pages) this user may open. An area with sub-pages needs at least one permitted. */
export function navFor(a:NavAccess):NavArea[]{
 return NAV.filter(x=>allowed(x,a)).map(x=>({...x,subs:x.subs?.filter(s=>allowed(s,a))})).filter(x=>!x.subs||x.subs.length>0);
}
export const canOpen=(a:NavAccess,area:string,sub?:string)=>{const x=navFor(a).find(n=>n.key===area);return Boolean(x&&(!sub||!x.subs||x.subs.some(s=>s.key===sub)));};

export type Route={area:string;sub?:string;id?:string;tab?:string};
const ENGINE_MAP:Record<string,Record<string,[string,string?]>>={
 'Win Work':{Clients:['CRM','Clients'],Opportunities:['Pipeline','Opportunities'],Tenders:['Pipeline','Tenders'],Estimates:['Pipeline','Estimates'],'':['Pipeline']},
 'Prepare Work':{Projects:['Projects','Projects'],Programme:['Projects','Programme'],'IMS & HSEQ':['IMS & HSEQ'],'Company Library':['Documents','Company Library'],'':['Projects','Projects']},
 'Resource Work':{Schedule:['Schedule','Schedule'],Resources:['Resources','People'],Workshop:['Resources','Workshop'],'':['Schedule','Schedule']},
 'Deliver Work':{Projects:['Projects','Projects'],Programme:['Projects','Programme'],Dockets:['Commercial','Dockets'],'':['Projects','Projects']},
 'Control Money':{'':['Commercial','Commercial']},
 Learn:{Reports:['Reports','Reports'],'':['Reports','Lifecycle']},
 Operations:{Dockets:['Commercial','Dockets'],Resources:['Resources','People'],Schedule:['Schedule','Schedule'],'':['Schedule','Schedule']},
 Admin:{People:['Resources','People'],Plant:['Resources','Plant & Equipment'],'Company Library':['Documents','Company Library']},
};
/**
 * Translates any older route (engine areas, Operations/…, Admin/People…) to the
 * current area, keeping the record id and tab so bookmarks land in context.
 */
export function resolveRoute(r:Route):Route{
 const map=ENGINE_MAP[r.area];
 if(r.area==='Field')return {area:'Today'};
 if(r.area==='Projects'&&(!r.sub||r.sub==='Projects'))return {...r,sub:'Projects'};
 if(!map)return r;
 const hit=map[r.sub||'']??(r.area==='Admin'?undefined:map['']);
 if(!hit)return r;
 const area=hit[0];let sub=hit[1];
 // Resource links to the plant tab (search results) open Plant & Equipment.
 if(area==='Resources'&&sub==='People'&&r.tab==='plant')sub='Plant & Equipment';
 const tab=area==='Resources'?undefined:r.tab;
 return {area,sub,id:r.id,tab};
}

export type QuickAction={label:string;area:string;sub?:string};
// One table of role priorities for Home shortcuts. Every action is still filtered by
// capability and entitlement (canOpen), so a role never gets a shortcut it cannot use.
const QUICK:Record<string,QuickAction[]>={
 scheduler:[{label:'Schedule',area:'Schedule',sub:'Schedule'},{label:'People',area:'Resources',sub:'People'},{label:'Plant & equipment',area:'Resources',sub:'Plant & Equipment'}],
 project_manager:[{label:'My projects',area:'Projects',sub:'Projects'},{label:'Programme',area:'Projects',sub:'Programme'},{label:'Commercial',area:'Commercial',sub:'Commercial'}],
 project_engineer:[{label:'Projects',area:'Projects',sub:'Projects'},{label:'Programme',area:'Projects',sub:'Programme'},{label:'IMS & HSEQ',area:'IMS & HSEQ'}],
 site_engineer:[{label:'Today',area:'Today'},{label:'Projects',area:'Projects',sub:'Projects'},{label:'IMS & HSEQ',area:'IMS & HSEQ'}],
 estimator:[{label:'Tenders',area:'Pipeline',sub:'Tenders'},{label:'Estimates',area:'Pipeline',sub:'Estimates'},{label:'Opportunities',area:'Pipeline',sub:'Opportunities'}],
 accounts:[{label:'Commercial',area:'Commercial',sub:'Commercial'},{label:'Dockets',area:'Commercial',sub:'Dockets'},{label:'Reports',area:'Reports',sub:'Reports'}],
 office:[{label:'Tenders',area:'Pipeline',sub:'Tenders'},{label:'Projects',area:'Projects',sub:'Projects'},{label:'Schedule',area:'Schedule',sub:'Schedule'}],
 admin:[{label:'Tenders',area:'Pipeline',sub:'Tenders'},{label:'Projects',area:'Projects',sub:'Projects'},{label:'Schedule',area:'Schedule',sub:'Schedule'}],
 read_only:[{label:'Projects',area:'Projects',sub:'Projects'},{label:'Reports',area:'Reports',sub:'Reports'}],
};
/** At most three shortcuts for the role, only where the user can actually open them. HSEQ-heavy users fall back to IMS. */
export function quickActions(role:string,a:NavAccess):QuickAction[]{
 const fallback:QuickAction[]=[{label:'IMS & HSEQ',area:'IMS & HSEQ'},{label:'Projects',area:'Projects',sub:'Projects'},{label:'Schedule',area:'Schedule',sub:'Schedule'},{label:'Tenders',area:'Pipeline',sub:'Tenders'},{label:'Documents',area:'Documents'}];
 const seen=new Set<string>();
 return [...(QUICK[role]||[]),...fallback].filter(q=>canOpen(a,q.area,q.sub)&&!seen.has(q.label)&&seen.add(q.label)).slice(0,3);
}
