import {MODULE_LABELS,type ModuleKey} from '@/lib/platform/modules';
import type {Capability} from '@/lib/platform/permissions';
import {ENGINES,type EngineKey} from './engines';

type Workspace={label:string;description:string;sub:string;capability?:Capability;module?:string};

export const WORKSPACES:Record<EngineKey,Workspace[]>={
 'Win Work':[
  {label:'Opportunities',description:'Qualify work worth chasing and preserve the client/opportunity lineage.',sub:'Opportunities',capability:'pipeline.view',module:'pipeline'},
  {label:'Tenders',description:'Requirements, bid review, returnables, approvals, submission and award in one workspace.',sub:'Tenders',capability:'pipeline.view',module:'pipeline'},
  {label:'Estimates',description:'Build and approve discipline-neutral estimates before they become a project baseline.',sub:'Estimates',capability:'pipeline.view',module:'estimating'},
 ],
 'Prepare Work':[
  {label:'Programme',description:'Plan dependencies, production and the two-week lookahead.',sub:'Programme',capability:'project.view',module:'projects'},
  {label:'Projects',description:'Set up awarded work, resolve readiness blockers and establish the controlled baseline.',sub:'Projects',capability:'project.view',module:'projects'},
  {label:'IMS & HSEQ',description:'Build and control risks, SWMS, ITPs and management-system requirements.',sub:'IMS & HSEQ',capability:'hseq.view',module:'ims'},
  {label:'Company Library',description:'Reuse policies, plans, evidence and standard company knowledge instead of recreating it.',sub:'Company Library',capability:'library.edit'},
 ],
 'Resource Work':[
  {label:'Workshop',description:'Manage asset defects, repairs and verified return to service.',sub:'Workshop',capability:'workshop.view',module:'workshop'},
  {label:'Schedule',description:'Plan shifts against project demand and expose conflicts before work starts.',sub:'Schedule',capability:'schedule.view',module:'operations'},
  {label:'Resources',description:'Workers, competencies, crews, plant, suppliers and availability.',sub:'Resources',capability:'schedule.view',module:'operations'},
 ],
 'Deliver Work':[
  {label:'Projects',description:'Run active projects and keep field context attached to the job.',sub:'Projects',capability:'project.view',module:'projects'},
  {label:'Dockets',description:'Review captured work before it becomes actual cost and claim data.',sub:'Dockets',capability:'docket.approve',module:'dockets'},
 ],
 'Control Money':[
  {label:'Commercial',description:'Control contract value, actual cost, variations, claims, invoices, payments and forecast margin.',sub:'Commercial',capability:'commercial.view',module:'commercial'},
 ],
 'Learn':[
  {label:'Reports',description:'Compare estimate, delivery and commercial actuals so future decisions use real performance.',sub:'Reports',capability:'reports.view',module:'reports'},
 ],
};


export type WorkspaceAccess={module:(m:string)=>boolean;can:(c:Capability)=>boolean};
export const workspacesFor=(engine:EngineKey,access:WorkspaceAccess)=>WORKSPACES[engine].filter(w=>(!w.module||access.module(w.module))&&(!w.capability||access.can(w.capability)));
export const enginesFor=(access:WorkspaceAccess)=>ENGINES.filter(e=>workspacesFor(e.key,access).some(w=>w.module));

export function engineLabelFor(engine:EngineKey,access:WorkspaceAccess){
 if(enginesFor(access).length===6)return engine;
 const modules=[...new Set(workspacesFor(engine,access).map(w=>w.module).filter(Boolean))] as ModuleKey[];
 return modules.length===1?MODULE_LABELS[modules[0]]:engine;
}
