// Task actions: one presentation-only table of "what do you want to do?" entry points, reused by
// Home and the Project overview (and, later, a command layer). It decides what is SHOWN. It is not a
// permission model: server routes and services remain the authority for every action.
// Each action is filtered by capability, module entitlement, whether its target is openable
// (canOpen) and an optional availability condition, so nothing appears that cannot be used.
import type {Capability} from '@/lib/platform/permissions';
import {canOpen,type NavAccess} from './app-nav';
import {MACHINES} from '@/lib/platform/workflow';

export type TaskContextType='home'|'project';
export type TaskTarget={area:string;sub?:string;tab?:string;/** Carry the current context record id into the route (project id). */withContext?:boolean};
export type ProjectTaskContext={id:string;stage:string};
export type TaskAction={
 key:string;label:string;description:string;icon:string;
 context:TaskContextType;
 capability?:Capability;anyOf?:Capability[];module?:string;
 target:TaskTarget;
 /** Lower sorts first within a context (roles may reorder on Home). */
 priority:number;
 /** Project lifecycle stages (lib/platform/workflow.ts) in which a project task is offered. Omitted = any stage. */
 stages?:readonly string[];
};

// Project stages come from the authoritative lifecycle (setup → ready → active → practical_completion → closeout → closed).
export const PROJECT_STAGES:readonly string[]=Object.keys(MACHINES.project.states);
const stage=(...names:string[])=>{const bad=names.filter(n=>!PROJECT_STAGES.includes(n));if(bad.length)throw new Error('Unknown project stage in task action: '+bad.join(', '));return names;};
const NOT_CLOSED=PROJECT_STAGES.filter(n=>n!=='closed');

export const TASK_ACTIONS:TaskAction[]=[
 // ---- Home: start something
 {key:'create-estimate',label:'Create estimate',description:'Price a piece of work',icon:'calculator',context:'home',anyOf:['estimate.edit'],module:'estimating',target:{area:'Pipeline',sub:'Estimates'},priority:10},
 {key:'review-tenders',label:'Review tenders',description:'Bids in progress and awards',icon:'file-text',context:'home',capability:'pipeline.view',module:'pipeline',target:{area:'Pipeline',sub:'Tenders'},priority:20},
 {key:'review-opportunities',label:'Review opportunities',description:'Potential work to qualify',icon:'target',context:'home',capability:'pipeline.view',module:'pipeline',target:{area:'Pipeline',sub:'Opportunities'},priority:30},
 {key:'open-projects',label:'Open my projects',description:'Jump into a project',icon:'clipboard',context:'home',capability:'project.view',module:'projects',target:{area:'Projects',sub:'Projects'},priority:40},
 {key:'plan-work',label:'Plan work',description:'Activities, dependencies and lookahead',icon:'list-checks',context:'home',capability:'programme.edit',module:'projects',target:{area:'Projects',sub:'Programme'},priority:50},
 {key:'update-programme',label:'Update programme',description:'Keep the plan current',icon:'list-checks',context:'home',capability:'programme.edit',module:'projects',target:{area:'Projects',sub:'Programme'},priority:51},
 {key:'schedule-work',label:'Schedule work',description:'Crews, plant and shifts',icon:'calendar',context:'home',capability:'schedule.edit',module:'operations',target:{area:'Schedule',sub:'Schedule'},priority:60},
 {key:'review-upcoming-work',label:'Review upcoming work',description:'What is scheduled next',icon:'calendar',context:'home',capability:'schedule.view',module:'operations',target:{area:'Schedule',sub:'Schedule'},priority:61},
 {key:'find-resource',label:'Find resource',description:'People, plant and crews',icon:'users',context:'home',capability:'schedule.view',module:'operations',target:{area:'Resources',sub:'People'},priority:70},
 {key:'today',label:'Today',description:'Your work on site today',icon:'calendar-check',context:'home',capability:'field.capture',target:{area:'Today'},priority:5},
 {key:'review-work-records',label:'Review work records',description:'Completed work waiting for the office',icon:'clipboard-check',context:'home',capability:'docket.approve',module:'dockets',target:{area:'Commercial',sub:'Dockets'},priority:80},
 {key:'review-commercial',label:'Review commercial position',description:'Contract, cost, forecast and billing',icon:'dollar',context:'home',capability:'commercial.view',module:'commercial',target:{area:'Commercial',sub:'Commercial'},priority:90},
 {key:'review-hseq',label:'Review HSEQ',description:'Safety, quality and environment',icon:'shield',context:'home',capability:'hseq.view',module:'ims',target:{area:'IMS & HSEQ'},priority:100},
 {key:'find-document',label:'Find a document',description:'Search every file you can see',icon:'folder',context:'home',anyOf:['project.view','pipeline.view','hseq.view','commercial.view','schedule.view'],target:{area:'Documents'},priority:110},
 {key:'review-reports',label:'Review reports',description:'Derived from your records',icon:'chart',context:'home',capability:'reports.view',module:'reports',target:{area:'Reports',sub:'Reports'},priority:120},

 // ---- Project: what do you need to do? Every route keeps this project's id.
 {key:'project-setup',label:'Complete project setup',description:'Baseline, team and readiness',icon:'wrench',context:'project',capability:'project.edit',target:{area:'Projects',sub:'Projects',tab:'setup',withContext:true},priority:5,stages:stage('setup','ready')},
 {key:'project-plan-work',label:'Plan work',description:'Programme for this project',icon:'list-checks',context:'project',capability:'programme.edit',module:'projects',target:{area:'Projects',sub:'Projects',tab:'programme',withContext:true},priority:10,stages:NOT_CLOSED},
 {key:'project-schedule-work',label:'Schedule work',description:'Crews, plant and shifts for this project',icon:'calendar',context:'project',capability:'schedule.edit',module:'operations',target:{area:'Schedule',sub:'Schedule',withContext:true},priority:20,stages:stage('ready','active')},
 {key:'project-review-work-records',label:'Review work records',description:'Completed work and dockets',icon:'clipboard-check',context:'project',capability:'docket.approve',module:'dockets',target:{area:'Projects',sub:'Projects',tab:'delivery',withContext:true},priority:30},
 {key:'project-raise-variation',label:'Raise variation',description:'Record a change to the contract',icon:'file-diff',context:'project',capability:'variation.edit',module:'commercial',target:{area:'Projects',sub:'Projects',tab:'commercial',withContext:true},priority:40,stages:NOT_CLOSED},
 {key:'project-review-commercial',label:'Review commercial',description:'Variations, claims and billing',icon:'dollar',context:'project',capability:'commercial.view',module:'commercial',target:{area:'Projects',sub:'Projects',tab:'commercial',withContext:true},priority:50},
 {key:'project-add-document',label:'Add document',description:'Drawings, records and files',icon:'file-plus',context:'project',anyOf:['document.upload','document.edit'],target:{area:'Projects',sub:'Projects',tab:'documents',withContext:true},priority:60,stages:NOT_CLOSED},
 {key:'project-review-hseq',label:'Review HSEQ',description:'SWMS, incidents, risks and NCRs',icon:'shield',context:'project',capability:'hseq.view',module:'ims',target:{area:'Projects',sub:'Projects',tab:'quality',withContext:true},priority:70},
 {key:'project-report-issue',label:'Report issue',description:'Incident, hazard or defect',icon:'siren',context:'project',anyOf:['hseq.report','hseq.edit'],module:'ims',target:{area:'Projects',sub:'Projects',tab:'quality',withContext:true},priority:80,stages:NOT_CLOSED},
 {key:'project-close-out',label:'Close out project',description:'Closeout checklist',icon:'flag',context:'project',capability:'project.close',target:{area:'Projects',sub:'Projects',tab:'closeout',withContext:true},priority:90,stages:stage('practical_completion','closeout')},
];

/** Role order for Home. Each role gets its own work; unlisted roles fall back to DEFAULT_HOME. */
const HOME_ORDER:Record<string,string[]>={
 estimator:['create-estimate','review-tenders','review-opportunities','find-document'],
 scheduler:['schedule-work','find-resource','review-upcoming-work','find-document'],
 project_manager:['open-projects','plan-work','review-commercial','review-hseq','find-document'],
 project_engineer:['open-projects','update-programme','review-hseq','find-document'],
 site_engineer:['today','open-projects','review-hseq','find-document'],
 accounts:['review-commercial','review-work-records','review-reports'],
 read_only:['open-projects','review-reports'],
};
const DEFAULT_HOME=['create-estimate','review-tenders','open-projects','schedule-work','review-commercial','review-hseq','find-document'];
export const MAX_HOME_TASKS=6;

const ruleOk=(t:TaskAction,a:NavAccess)=>(!t.module||a.module(t.module))&&(!t.capability||a.can(t.capability))&&(!t.anyOf?.length||t.anyOf.some(c=>a.can(c)));
/** Presentation check only: capability + entitlement + the target really opens for this user + availability. */
export const taskAvailable=(t:TaskAction,a:NavAccess,ctx:ProjectTaskContext|null=null)=>ruleOk(t,a)&&canOpen(a,t.target.area,t.target.sub)&&(!t.stages||Boolean(ctx&&t.stages.includes(ctx.stage)));

export type TaskRoute={area:string;sub?:string;id?:string;tab?:string};
export const taskRoute=(t:TaskAction,ctx:ProjectTaskContext|null=null):TaskRoute=>({area:t.target.area,sub:t.target.sub,id:t.target.withContext&&ctx?ctx.id:undefined,tab:t.target.tab});

/** "Start something": verbs for this role, only what the user can actually open. */
export function homeTasks(role:string,a:NavAccess):TaskAction[]{
 const order=HOME_ORDER[role]||DEFAULT_HOME;
 const home=new Map(TASK_ACTIONS.filter(t=>t.context==='home').map(t=>[t.key,t]));
 const list=order.map(k=>home.get(k)).filter((t):t is TaskAction=>Boolean(t)&&taskAvailable(t!,a));
 return list.slice(0,MAX_HOME_TASKS);
}

/** Next-action panel for one project. The project supplies its own id; nothing is asked again. */
export function projectTasks(ctx:ProjectTaskContext,a:NavAccess):TaskAction[]{
 return TASK_ACTIONS.filter(t=>t.context==='project'&&taskAvailable(t,a,ctx)).sort((x,y)=>x.priority-y.priority);
}
