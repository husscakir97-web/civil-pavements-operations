// Isomorphic capability matrix. The server is the authority (requireCapability);
// clients use the same table only to hide actions the server would refuse.
// Every role below can be assigned by an organisation admin.
export const ROLES=['admin','office','estimator','scheduler','project_manager','project_engineer','site_engineer','supervisor','field','accounts','read_only'] as const;
export type Role=typeof ROLES[number];
export type AnyRole=Role;
export const ROLE_LABELS:Record<Role,string>={admin:'Admin',office:'Office (all operations & commercial)',estimator:'Estimator / Commercial',scheduler:'Operations / Scheduler',project_manager:'Project Manager',project_engineer:'Project Engineer',site_engineer:'Site Engineer',supervisor:'Supervisor',field:'Field Worker',accounts:'Accounts',read_only:'Read only'};
export const ROLE_DESCRIPTIONS:Record<Role,string>={
 admin:'Full access, team management, entitlements, settings and rate libraries.',
 office:'All operational and commercial records, pricing and approvals. No team or admin settings.',
 estimator:'Opportunities, tenders, estimates, Company Library and variations. Can submit tenders; cannot approve estimates.',
 scheduler:'Schedule, shifts and resources (workers, competencies, plant). No rates or commercial data.',
 project_manager:'Project setup, delivery, HSEQ, SWMS approval, docket approval, variations and claims. Cannot approve estimates or claims.',
 project_engineer:'Project delivery: programme, setup, documents, risks, ITPs/QA, NCRs, HSEQ, schedule visibility and site records. No rates, commercial figures, approvals or administration.',
 site_engineer:'Site delivery: today\'s work, programme, job documents, ITPs and hold points, incidents, NCRs, site records and progress. No pricing, commercial reporting or administration.',
 supervisor:'Field capture plus read access to projects, schedule and HSEQ; can raise HSEQ records. No rates or commercial data.',
 field:'Assigned shifts, SWMS acknowledgement, incidents, quantities and site evidence. No financial data.',
 accounts:'Claims, invoices, payments and docket approval, with commercial reporting.',
 read_only:'View projects, pipeline, schedule, HSEQ and reports. No commercial figures and no changes.',
};
export const CAPABILITIES=[
 'org.admin','team.admin','entitlements.manage','rates.edit','audit.view',
 'commercial.view','pipeline.view','pipeline.edit','tender.approve','tender.submit','tender.award',
 'workshop.view','workshop.edit','workshop.verify',
 // Administrator-only correction of a plant item's service plan (mandatory reason, immutable history). Never a completed service.
 'workshop.plan.correct',
 // Report a plant/asset defect into Workshop (e.g. from a Form). Grants no repair, verify or asset admin.
 'workshop.defect.report',
 'estimate.edit','estimate.approve',
 'project.view','project.all.view','project.edit','programme.edit','project.baseline','project.close',
 'communication.view','communication.send','external.share',
 // document.approve stays reserved for controlled release. Managed documents: edit identity metadata and links;
 // manage_versions uploads new immutable revisions. Neither is implied by document.upload (field evidence).
 'document.upload','document.approve','document.edit','document.manage_versions',
 'hseq.view','hseq.edit','hseq.report','swms.approve','swms.acknowledge','itp.complete',
 // Independent verification of corrective actions and final NCR closure. Server rule on top:
 // the person who completed an action can never verify that completion.
 'hseq.verify',
 // Forms engine: view published forms and submissions in scope; submit; manage drafts; publish
 // (a controlled record definition); amend submitted evidence with a reason.
 'forms.view','forms.submit','forms.manage','forms.publish','forms.amend',
 'schedule.view','schedule.edit','resources.edit',
 'field.capture','docket.submit','docket.approve',
 'variation.edit','variation.approve','claim.edit','claim.approve','invoice.manage',
 'reports.view','library.edit','knowledge.view','knowledge.edit',
 // Core client master: create (quick create client/site/contact in a workflow), edit existing
 // master records, manage (import, merge, legacy linking, bulk status/owner). Viewing clients
 // follows pipeline/project/schedule access; commercial client fields still need commercial.view.
 'crm.create','crm.edit','crm.manage',
] as const;
export type Capability=typeof CAPABILITIES[number];

const FIELD:Capability[]=['swms.acknowledge','itp.complete','hseq.report','field.capture','docket.submit','document.upload','communication.view','communication.send','forms.view','forms.submit','workshop.defect.report'];
const ADMIN_ONLY:Capability[]=['org.admin','team.admin','entitlements.manage','rates.edit','workshop.plan.correct'];
const OFFICE:Capability[]=CAPABILITIES.filter(c=>!ADMIN_ONLY.includes(c));
const READ:Capability[]=['pipeline.view','project.view','project.all.view','hseq.view','schedule.view','reports.view','commercial.view','knowledge.view','communication.view','forms.view'];

export const ROLE_CAPABILITIES:Record<Role,readonly Capability[]>={
 admin:CAPABILITIES,
 office:OFFICE,
 estimator:[...READ,'crm.create','pipeline.edit','estimate.edit','tender.submit','library.edit','document.upload','document.edit','document.manage_versions','audit.view','variation.edit','communication.send'],
 scheduler:['crm.create','workshop.view','project.view','project.all.view','schedule.view','schedule.edit','resources.edit','hseq.view','reports.view','knowledge.view','document.upload','communication.view','communication.send','external.share','forms.view','forms.submit','workshop.defect.report'],
 project_manager:[...READ,'crm.create','project.edit','programme.edit','project.baseline','project.close','schedule.edit','resources.edit','hseq.edit','hseq.report','swms.approve','document.approve','docket.approve','variation.edit','claim.edit','document.upload','itp.complete','audit.view','communication.send','external.share','hseq.verify','forms.submit','forms.manage','forms.publish','forms.amend','workshop.defect.report','document.edit','document.manage_versions'],
 // No 'project.all.view': these roles work only in projects where they are an active project
 // member (lib/platform/project-access.ts), and never see money or approvals.
 project_engineer:[...FIELD,'project.view','project.edit','programme.edit','schedule.view','hseq.view','hseq.edit','hseq.verify','reports.view','knowledge.view','workshop.view','forms.amend','document.edit','document.manage_versions'],
 site_engineer:[...FIELD,'project.view','programme.edit','schedule.view','hseq.view','hseq.edit','knowledge.view','forms.amend'],
 supervisor:[...FIELD,'project.view','project.all.view','schedule.view','hseq.view','hseq.edit','knowledge.view','forms.amend'],
 field:[...FIELD,'knowledge.view'],
 accounts:['commercial.view','project.view','project.all.view','reports.view','knowledge.view','communication.view','communication.send','claim.edit','claim.approve','invoice.manage','docket.approve'],
 read_only:['workshop.view',...READ.filter(c=>c!=='commercial.view')],
};

export function can(role:string|undefined,capability:Capability){
 return Boolean(role&&(ROLE_CAPABILITIES as Record<string,readonly Capability[]>)[role]?.includes(capability));
}
export function capabilitiesFor(role:string){return [...((ROLE_CAPABILITIES as Record<string,readonly Capability[]>)[role]||[])];}
export const isKnownRole=(role:string):role is Role=>(ROLES as readonly string[]).includes(role);
export const roleLabel=(role:string)=>isKnownRole(role)?ROLE_LABELS[role]:role;

// Route-level gate used by withActor/requireActor. Capability checks inside the
// handler remain the authority for each action; this only stops a role reaching
// a module it has no business in. admin/office/field keep their original V1 rules.
export type PermissionLevel='read'|'write'|'approve'|'admin'|'field'|'field-read';
type Mod='core'|'pipeline'|'estimating'|'projects'|'ims'|'operations'|'field'|'dockets'|'commercial'|'reports'|'ai'|'workshop';
const MODULE_ACCESS:Record<Mod,{read:Capability[];write:Capability[];approve:Capability[]}>={
 workshop:{read:['workshop.view'],write:['workshop.edit'],approve:['workshop.verify']},
 core:{read:[],write:[],approve:[]},
 pipeline:{read:['pipeline.view'],write:['pipeline.edit','tender.submit'],approve:['tender.approve','tender.award']},
 estimating:{read:['pipeline.view','estimate.edit'],write:['estimate.edit'],approve:['estimate.approve']},
 projects:{read:['project.view'],write:['project.edit','project.baseline','project.close'],approve:['project.close']},
 ims:{read:['hseq.view'],write:['hseq.edit','hseq.report','swms.approve','itp.complete'],approve:['swms.approve']},
 operations:{read:['schedule.view'],write:['schedule.edit','resources.edit'],approve:['schedule.edit']},
 field:{read:['field.capture','schedule.view'],write:['field.capture','docket.submit'],approve:[]},
 dockets:{read:['docket.approve','commercial.view'],write:['docket.approve'],approve:['docket.approve']},
 commercial:{read:['commercial.view'],write:['variation.edit','claim.edit','invoice.manage'],approve:['claim.approve','variation.approve']},
 reports:{read:['reports.view'],write:[],approve:[]},
 ai:{read:['pipeline.edit','estimate.edit','hseq.edit'],write:['pipeline.edit','estimate.edit','hseq.edit'],approve:[]},
};
const writes=(role:string)=>capabilitiesFor(role).some(c=>!c.endsWith('.view'));
export function roleAllows(role:string,permission:PermissionLevel,module:string='core'){
 if(!isKnownRole(role))return false;
 if(role==='admin')return true;
 if(role==='office')return permission!=='admin';
 if(role==='field')return permission==='field'||permission==='field-read';
 if(permission==='admin')return false;
 if(permission==='field-read')return true;
 if(permission==='field')return writes(role);
 const access=MODULE_ACCESS[(module in MODULE_ACCESS?module:'core') as Mod];
 const any=(caps:Capability[])=>caps.some(c=>can(role,c));
 if(permission==='read')return access.read.length?any(access.read):true;
 if(permission==='write')return access.write.length?any(access.write):writes(role);
 return access.approve.length?any(access.approve):false;
}
