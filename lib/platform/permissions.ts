// Isomorphic capability matrix. The server is the authority (requireCapability);
// clients use the same table only to hide actions the server would refuse.
export const ROLES=['admin','office','field'] as const;
export type Role=typeof ROLES[number];
// Future roles are declared so permission checks can grow without rewrites.
// Team administration currently assigns only the three V1 roles above.
export const FUTURE_ROLES=['estimator','scheduler','project_manager','supervisor','accounts','read_only'] as const;
export type AnyRole=Role|typeof FUTURE_ROLES[number];

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

export const ROLE_CAPABILITIES:Record<AnyRole,readonly Capability[]>={
 admin:CAPABILITIES,
 office:OFFICE,
 field:FIELD,
 estimator:[...READ,'pipeline.edit','estimate.edit','tender.submit','library.edit','document.upload','audit.view'],
 scheduler:['project.view','schedule.view','schedule.edit','resources.edit','hseq.view','reports.view','document.upload'],
 project_manager:[...READ,'project.edit','project.baseline','schedule.edit','hseq.edit','swms.approve','document.approve','docket.approve','variation.edit','claim.edit','document.upload','itp.complete','audit.view'],
 supervisor:[...FIELD,'project.view','schedule.view','hseq.view','hseq.edit'],
 accounts:['commercial.view','project.view','reports.view','claim.edit','invoice.manage','docket.approve'],
 read_only:READ.filter(c=>c!=='commercial.view'),
};

export function can(role:string|undefined,capability:Capability){
 return Boolean(role&&(ROLE_CAPABILITIES as Record<string,readonly Capability[]>)[role]?.includes(capability));
}
export function capabilitiesFor(role:string){return [...((ROLE_CAPABILITIES as Record<string,readonly Capability[]>)[role]||[])];}
export const isKnownRole=(role:string)=>role in ROLE_CAPABILITIES;
