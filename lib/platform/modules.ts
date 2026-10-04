import type {Capability} from './permissions';
// Stable entitlement keys are a compatibility contract, including the legacy Field surface.
export const MODULES=['core','pipeline','estimating','projects','ims','operations','field','dockets','commercial','reports','ai','workshop'] as const;
export type ModuleKey=typeof MODULES[number];
export type EntitlementStatus='active'|'read_only'|'disabled';
export type Entitlements=Record<ModuleKey,EntitlementStatus>;

export const MODULE_LABELS:Record<ModuleKey,string>={
 workshop:'Workshop & fleet',core:'Core platform',pipeline:'Pipeline & tendering',estimating:'Estimating',projects:'Projects',
 ims:'IMS & HSEQ',operations:'Operations & scheduling',field:'Field',dockets:'Dockets',
 commercial:'Commercial',reports:'Reports',ai:'AI assistance',
};

// Beta signups receive a full-access trial. Paid plans replace this set via
// setEntitlement(...) — never by deleting data.
export const TRIAL_PLAN='beta-trial';
export const FULL_ACCESS:Entitlements=Object.fromEntries(MODULES.map(m=>[m,'active'])) as Entitlements;

export const isModuleKey=(m:string):m is ModuleKey=>(MODULES as readonly string[]).includes(m);
export const usable=(e:Partial<Entitlements>|null|undefined,m:string)=>m==='core'||(isModuleKey(m)&&(e?.[m]==='active'||e?.[m]==='read_only'));
export const writable=(e:Partial<Entitlements>|null|undefined,m:string)=>m==='core'||(isModuleKey(m)&&e?.[m]==='active');

export type ModuleContract={
 key:ModuleKey; name:string; entitlement:ModuleKey; status:'available'; kind:'core'|'module'|'surface'|'addon';
 bundles:readonly string[]; coreDependencies:readonly string[]; ownedEntities:readonly string[];
 workspace:{area:string;sub?:string}; capabilities:readonly Capability[];
 publishedEvents:readonly string[]; subscribedEvents:readonly string[]; optionalSeams:readonly string[];
 reporting:readonly string[]; fieldCapabilities:readonly string[]; externalCapabilities:readonly string[];
};
const contract=(key:ModuleKey,ownedEntities:string[],workspace:ModuleContract['workspace'],capabilities:Capability[],extra:Partial<ModuleContract>={}):ModuleContract=>({
 key,name:MODULE_LABELS[key],entitlement:key,status:'available',kind:'module',bundles:['full-suite'],
 coreDependencies:['tenancy','authentication','permissions','entitlements','audit'],ownedEntities,workspace,capabilities,
 publishedEvents:[],subscribedEvents:[],optionalSeams:[],reporting:[],fieldCapabilities:[],externalCapabilities:[],...extra,
});
/** Implemented modules only. Future products must not be provisioned or advertised as usable. */
export const MODULE_REGISTRY:Record<ModuleKey,ModuleContract>={
 workshop:contract('workshop',['workshop_orders','workshop_entries','asset_service_events'],{area:'Resource Work',sub:'Workshop'},['workshop.view','workshop.edit','workshop.verify','workshop.plan.correct'],{publishedEvents:['workshop.defect.created','workshop.defect.reported','workshop.repair.recorded','workshop.verified','workshop.service.recorded','workshop.plan.set','workshop.plan.corrected'],optionalSeams:['form.defect']}),
 core:contract('core',['organisations','users','documents','knowledge_packs','audit_log','domain_events','communication_threads','communication_messages','communication_receipts','notifications','notification_preferences','external_access_tokens','external_responses'],{area:'Home'},['org.admin','knowledge.view','communication.view','communication.send'],{kind:'core',coreDependencies:[]}),
 pipeline:contract('pipeline',['opportunities','tenders','tender_requirements'],{area:'Win Work',sub:'Tenders'},['pipeline.view','pipeline.edit','tender.award'],{optionalSeams:['award.project'],reporting:['pipeline']}),
 estimating:contract('estimating',['estimates','estimate_revisions','planning_plans','planning_scenarios'],{area:'Win Work',sub:'Estimates'},['estimate.edit','estimate.approve'],{optionalSeams:['award.project']}),
 projects:contract('projects',['jobs','project_baselines','project_checklist_items','cost_transactions'],{area:'Prepare Work',sub:'Projects'},['project.view','project.edit'],{publishedEvents:['project.awarded'],optionalSeams:['award.project','docket.cost','project.ims'],reporting:['projects']}),
 ims:contract('ims',['swms','itp_items','hseq_incidents','hseq_ncrs','hseq_actions'],{area:'Prepare Work',sub:'IMS & HSEQ'},['hseq.view','hseq.edit','hseq.report'],{optionalSeams:['project.ims','form.defect'],reporting:['hseq'],fieldCapabilities:['swms.acknowledge','itp.complete','hseq.report']}),
 operations:contract('operations',['shifts','shift_assignments','workers','worker_competencies','plant'],{area:'Resource Work',sub:'Schedule'},['schedule.view','schedule.edit','resources.edit'],{reporting:['operations']}),
 field:contract('field',['field_records'],{area:'Field'},['field.capture'],{kind:'surface',fieldCapabilities:['field.capture','offline.sync']}),
 dockets:contract('dockets',['dockets'],{area:'Deliver Work',sub:'Dockets'},['docket.submit','docket.approve'],{publishedEvents:['docket.approved'],optionalSeams:['docket.cost'],reporting:['dockets'],fieldCapabilities:['docket.submit']}),
 commercial:contract('commercial',['project_variations','progress_claims','client_invoices'],{area:'Control Money',sub:'Commercial'},['commercial.view','claim.edit','invoice.manage'],{reporting:['commercial']}),
 reports:contract('reports',[],{area:'Learn',sub:'Reports'},['reports.view']),
 ai:contract('ai',['ai_suggestions','ai_usage_ledger'],{area:'Admin',sub:'Integrations'},['org.admin'],{kind:'addon'}),
};

export const MODULE_SEAMS={
 'award.project':{modules:['estimating','projects'],capability:'tender.award'},
 'project.ims':{modules:['projects','ims'],capability:'tender.award'},
 'docket.cost':{modules:['dockets','projects'],capability:'docket.approve'},
 // Prestart/inspection evidence raises a Workshop defect (critical → safety hold). Forms stay immutable.
 'form.defect':{modules:['ims','workshop'],capability:'workshop.defect.report'},
} as const satisfies Record<string,{modules:readonly ModuleKey[];capability:Capability}>;
export type SeamKey=keyof typeof MODULE_SEAMS;
