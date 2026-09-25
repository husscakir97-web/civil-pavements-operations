// Isomorphic capability matrix. The server is the authority (requireCapability);
// clients use the same table only to hide actions the server would refuse.
// Every role below can be assigned by an organisation admin.
export const ROLES=['admin','office','estimator','scheduler','project_manager','supervisor','field','accounts','read_only'] as const;
export type Role=typeof ROLES[number];
export type AnyRole=Role;
export const ROLE_LABELS:Record<Role,string>={admin:'Admin',office:'Office (all operations & commercial)',estimator:'Estimator / Commercial',scheduler:'Operations / Scheduler',project_manager:'Project Manager',supervisor:'Supervisor',field:'Field Worker',accounts:'Accounts',read_only:'Read only'};
export const ROLE_DESCRIPTIONS:Record<Role,string>={
 admin:'Full access, team management, entitlements, settings and rate libraries.',
 office:'All operational and commercial records, pricing and approvals. No team or admin settings.',
 estimator:'Opportunities, tenders, estimates, Company Library and variations. Can submit tenders; cannot approve estimates.',
 scheduler:'Schedule, shifts and resources (workers, competencies, plant). No rates or commercial data.',
 project_manager:'Project setup, delivery, HSEQ, SWMS approval, docket approval, variations and claims. Cannot approve estimates or claims.',
 supervisor:'Field capture plus read access to projects, schedule and HSEQ; can raise HSEQ records. No rates or commercial data.',
 field:'Assigned shifts, SWMS acknowledgement, incidents, quantities and site evidence. No financial data.',
 accounts:'Claims, invoices, payments and docket approval, with commercial reporting.',
 read_only:'View projects, pipeline, schedule, HSEQ and reports. No commercial figures and no changes.',
};
export const CAPABILITIES=[
 'org.admin','team.admin','entitlements.manage','rates.edit','audit.view',
 'commercial.view','pipeline.view','pipeline.edit','tender.approve','tender.submit','tender.award',
 'estimate.edit','estimate.approve',
 'project.view','project.edit','project.baseline','project.close',
 'document.upload','document.approve',
 'hseq.view','hseq.edit','hseq.report','swms.approve','swms.acknowledge','itp.complete',
 'schedule.view','schedule.edit','resources.edit',
 'field.capture','docket.submit','docket.approve',
 'variation.edit','variation.approve','claim.edit','claim.approve','invoice.manage',
 'reports.view','library.edit',
] as const;
export type Capability=typeof CAPABILITIES[number];

const FIELD:Capability[]=['swms.acknowledge','itp.complete','hseq.report','field.capture','docket.submit','document.upload'];
const ADMIN_ONLY:Capability[]=['org.admin','team.admin','entitlements.manage','rates.edit'];
const OFFICE:Capability[]=CAPABILITIES.filter(c=>!ADMIN_ONLY.includes(c));
const READ:Capability[]=['pipeline.view','project.view','hseq.view','schedule.view','reports.view','commercial.view'];

export const ROLE_CAPABILITIES:Record<Role,readonly Capability[]>={
 admin:CAPABILITIES,
 office:OFFICE,
 estimator:[...READ,'pipeline.edit','estimate.edit','tender.submit','library.edit','document.upload','audit.view','variation.edit'],
 scheduler:['project.view','schedule.view','schedule.edit','resources.edit','hseq.view','reports.view','document.upload'],
 project_manager:[...READ,'project.edit','project.baseline','project.close','schedule.edit','resources.edit','hseq.edit','hseq.report','swms.approve','document.approve','docket.approve','variation.edit','claim.edit','document.upload','itp.complete','audit.view'],
 supervisor:[...FIELD,'project.view','schedule.view','hseq.view','hseq.edit'],
 field:FIELD,
 accounts:['commercial.view','project.view','reports.view','claim.edit','claim.approve','invoice.manage','docket.approve'],
 read_only:READ.filter(c=>c!=='commercial.view'),
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
type Mod='core'|'pipeline'|'estimating'|'projects'|'ims'|'operations'|'field'|'dockets'|'commercial'|'reports'|'ai';
const MODULE_ACCESS:Record<Mod,{read:Capability[];write:Capability[];approve:Capability[]}>={
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
