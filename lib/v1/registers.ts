// Isomorphic register definitions. The same definition drives server validation
// (lib/v1/register-server.ts) and the client form/list (components/v1/register-view.tsx).
// Only typed columns are listed — no free-form metadata blobs.
import type {Capability} from '@/lib/platform/permissions';
import type {MachineKey} from '@/lib/platform/workflow';
import type {ModuleKey} from '@/lib/platform/modules';

export type FieldType='text'|'textarea'|'number'|'money'|'date'|'datetime'|'select'|'boolean'|'user'|'rating'|'document'|'relation';
export type FieldDef={
 key:string;label:string;type:FieldType;column?:string;
 options?:readonly string[];required?:boolean;max?:number;min?:number;help?:string;
 /** Hidden from field users and from payloads sent to them. */
 commercial?:boolean;
 /** Shown as a column in list views. */
 list?:boolean;
 /** Server-derived; never accepted from the browser. */
 derived?:boolean;
 relation?:string;
 /** Field users may set this field (only on registers they can write). */
 fieldWritable?:boolean;
};
export type Scope='org'|'project'|'tender'|'itp'|'optional-project';
export type RegisterDef={
 key:string;table:string;label:string;singular:string;module:ModuleKey;scope:Scope;
 titleField:string;machine?:MachineKey;stateColumn?:string;
 view:Capability;edit:Capability;create?:Capability;
 /** Field role may list these records (operational, non-commercial registers only). */
 fieldView?:boolean;
 reference?:{prefix:string};
 fixed?:Record<string,string>;
 fields:FieldDef[];
 empty:string;createLabel:string;
 /** Records in these states are immutable. */
 lockedStates?:string[];
};

const text=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'text',max:255,...o});
const area=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'textarea',max:20000,...o});
const date=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'date',...o});
const select=(key:string,label:string,options:readonly string[],o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'select',options,...o});
const user=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'user',...o});
const doc=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'document',...o});
const bool=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'boolean',...o});
const money=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'money',commercial:true,...o});
const rating=(key:string,label:string,o:Partial<FieldDef>={}):FieldDef=>({key,label,type:'rating',min:1,max:5,...o});

export const LIBRARY_CATEGORIES=['Policy','Procedure','Certification','Licence','Insurance','Capability statement','Company profile','Standard tender response','Personnel CV','Project example','Plant details','Safety statistics','Environmental information','Quality information'] as const;
export const REQUIREMENT_CATEGORIES=['returnable','commercial','technical','programme','HSEQ','insurance','licence','personnel','plant','methodology','contract','clarification'] as const;
export const RETURNABLE_CATEGORIES=['schedule','methodology','programme','capability statement','project team','CV','HSEQ document','insurance','licence','departure','clarification','pricing schedule','other'] as const;
export const COST_CATEGORIES=['labour','plant','material','subcontract','other'] as const;
export const RISK_CATEGORIES=['safety','environmental','quality','commercial','programme','contract','stakeholder','technical'] as const;

export const REGISTERS={
 opportunities:{key:'opportunities',table:'opportunities',label:'Opportunities',singular:'Opportunity',module:'pipeline',scope:'org',titleField:'name',machine:'opportunity',stateColumn:'stage',view:'pipeline.view',edit:'pipeline.edit',
  empty:'No opportunities are in your pipeline yet. Record the work you are chasing so it can be qualified and tendered.',createLabel:'New opportunity',
  fields:[text('name','Opportunity',{required:true,list:true}),text('client_name','Client',{list:true}),user('owner_user_id','Owner',{list:true}),money('estimated_value','Estimated value',{list:true}),{key:'probability',label:'Probability %',type:'number',min:0,max:100,list:true},date('closing_date','Closing date',{list:true}),text('location','Location'),area('notes','Notes'),area('lost_reason','Lost reason')]},
 library:{key:'library',table:'library_items',label:'Company Library',singular:'Library item',module:'core',scope:'org',titleField:'title',machine:'library',view:'project.view',edit:'library.edit',
  empty:'The Company Library is empty. Add policies, insurances, licences, CVs and standard tender responses once so tenders and projects can reuse them.',createLabel:'Add library item',
  fields:[select('category','Category',LIBRARY_CATEGORIES,{required:true,list:true}),text('title','Title',{required:true,list:true}),area('description','Description'),area('content','Standard content / response text',{max:200000}),doc('document_id','File'),date('expiry_date','Expiry date',{list:true}),text('owner_name','Owner',{list:true}),{key:'version',label:'Version',type:'number',derived:true,list:true}]},
 requirements:{key:'requirements',table:'tender_requirements',label:'Requirements',singular:'Requirement',module:'pipeline',scope:'tender',titleField:'title',machine:'requirement',view:'pipeline.view',edit:'pipeline.edit',
  empty:'No requirements have been recorded for this tender. Add them from the tender documents; mandatory items gate submission.',createLabel:'Add requirement',
  fields:[area('title','Requirement',{required:true,list:true,max:5000}),select('category','Category',REQUIREMENT_CATEGORIES,{list:true}),bool('mandatory','Mandatory',{list:true}),text('source_document','Source document'),text('source_page','Page / clause'),user('owner_user_id','Responsible',{list:true}),date('due_date','Due',{list:true}),area('response','Response'),doc('evidence_document_id','Evidence'),bool('risk_flag','Risk / issue',{list:true}),{key:'origin',label:'Origin',type:'text',derived:true},{key:'confidence',label:'Confidence',type:'number',derived:true}]},
 returnables:{key:'returnables',table:'tender_returnables',label:'Returnables',singular:'Returnable',module:'pipeline',scope:'tender',titleField:'title',machine:'returnable',view:'pipeline.view',edit:'pipeline.edit',
  empty:'No returnables yet. List every schedule and document the client requires, then assign an owner.',createLabel:'Add returnable',
  fields:[text('title','Returnable',{required:true,list:true}),select('category','Category',RETURNABLE_CATEGORIES,{list:true}),bool('mandatory','Mandatory',{list:true}),{key:'requirement_id',label:'Linked requirement',type:'relation',relation:'requirements'},user('assignee_user_id','Assigned to',{list:true}),date('due_date','Due',{list:true}),{key:'library_item_id',label:'Reuse from Company Library',type:'relation',relation:'library'},doc('document_id','Completed document'),area('notes','Notes')]},
 clarifications:{key:'clarifications',table:'tender_clarifications',label:'Clarifications',singular:'Clarification',module:'pipeline',scope:'tender',titleField:'question',machine:'clarification',view:'pipeline.view',edit:'pipeline.edit',reference:{prefix:'CLR'},
  empty:'No clarifications recorded. Log each client question after submission with its due date.',createLabel:'Log clarification',
  fields:[{key:'reference',label:'Ref',type:'text',derived:true,list:true},area('question','Question',{required:true,list:true}),date('received_date','Received',{list:true}),date('due_date','Due',{list:true}),text('source','Source'),user('owner_user_id','Owner'),area('response','Response'),date('submitted_date','Response submitted'),area('scope_impact','Impact on scope'),money('price_impact','Impact on price',{help:'A price change after approval requires a new estimate revision and approval.'}),doc('document_id','Attachment')]},
 risks:{key:'risks',table:'risks',label:'Risk register',singular:'Risk',module:'ims',scope:'optional-project',titleField:'title',machine:'risk',view:'hseq.view',edit:'hseq.edit',reference:{prefix:'RSK'},
  empty:'No risks have been recorded. Identify hazards, rate them and record controls before mobilisation.',createLabel:'Add risk',
  fields:[{key:'reference',label:'Ref',type:'text',derived:true,list:true},text('title','Risk',{required:true,list:true}),select('category','Category',RISK_CATEGORIES,{list:true}),area('cause','Cause'),area('consequence_text','Consequence'),rating('initial_likelihood','Initial likelihood (1–5)'),rating('initial_consequence','Initial consequence (1–5)'),{key:'initial_rating',label:'Initial rating',type:'text',derived:true,list:true},area('controls','Controls'),rating('residual_likelihood','Residual likelihood (1–5)'),rating('residual_consequence','Residual consequence (1–5)'),{key:'residual_rating',label:'Residual rating',type:'text',derived:true,list:true},text('owner_name','Owner',{list:true}),date('review_date','Review date',{list:true})]},
 itps:{key:'itps',table:'itps',label:'Inspection & test plans',singular:'ITP',module:'ims',scope:'project',titleField:'title',machine:'itp',view:'hseq.view',edit:'hseq.edit',reference:{prefix:'ITP'},fieldView:true,
  empty:'No ITPs have been created for this project. Create an ITP for each controlled activity.',createLabel:'Create ITP',
  fields:[{key:'reference',label:'Ref',type:'text',derived:true,list:true},text('title','Title',{required:true,list:true}),text('activity','Activity',{list:true}),text('specification','Specification')]},
 itp_items:{key:'itp_items',table:'itp_items',label:'Inspection points',singular:'Inspection point',module:'ims',scope:'itp',titleField:'inspection',machine:'itpItem',view:'hseq.view',edit:'hseq.edit',fieldView:true,
  empty:'No inspection points yet. Add each inspection or test with its acceptance criteria.',createLabel:'Add inspection point',
  fields:[{key:'sequence',label:'#',type:'number',min:1,max:9999,list:true},area('inspection','Inspection / test',{required:true,list:true}),area('acceptance_criteria','Acceptance criteria'),text('reference','Reference / specification'),text('responsibility','Responsibility',{list:true}),select('point_type','Point type',['none','review','witness','hold'],{list:true}),user('assigned_user_id','Assigned to'),area('result','Result',{fieldWritable:true}),area('comments','Comments',{fieldWritable:true}),doc('evidence_document_id','Evidence',{fieldWritable:true})]},
 incidents:{key:'incidents',table:'hseq_incidents',label:'Incidents',singular:'Incident',module:'ims',scope:'optional-project',titleField:'description',machine:'incident',view:'hseq.view',edit:'hseq.edit',create:'hseq.report',reference:{prefix:'INC'},fieldView:true,
  empty:'No incidents have been reported.',createLabel:'Report incident',
  fields:[{key:'reference',label:'Ref',type:'text',derived:true,list:true},select('incident_type','Type',['injury','near miss','environmental','property damage','vehicle','security','other'],{required:true,list:true,fieldWritable:true}),select('severity','Severity',['minor','moderate','serious','critical'],{list:true,fieldWritable:true}),{key:'occurred_at',label:'Date & time',type:'datetime',required:true,list:true,fieldWritable:true},area('description','What happened',{required:true,list:true,fieldWritable:true}),area('immediate_action','Immediate action',{fieldWritable:true}),area('persons_involved','Persons involved',{fieldWritable:true}),doc('evidence_document_id','Evidence',{fieldWritable:true})]},
 ncrs:{key:'ncrs',table:'hseq_ncrs',label:'Non-conformances',singular:'NCR',module:'ims',scope:'optional-project',titleField:'issue',machine:'ncr',view:'hseq.view',edit:'hseq.edit',reference:{prefix:'NCR'},
  empty:'No non-conformances are open.',createLabel:'Raise NCR',
  fields:[{key:'reference',label:'Ref',type:'text',derived:true,list:true},area('issue','Issue',{required:true,list:true}),area('requirement','Requirement not met'),area('cause','Cause'),area('corrective_action','Corrective action'),text('owner_name','Owner',{list:true}),date('due_date','Due',{list:true}),area('verification','Verification')]},
 actions:{key:'actions',table:'hseq_actions',label:'Corrective actions',singular:'Corrective action',module:'ims',scope:'optional-project',titleField:'action',machine:'action',view:'hseq.view',edit:'hseq.edit',
  empty:'No corrective actions are open.',createLabel:'Add corrective action',
  fields:[select('source_type','Source',['incident','ncr','inspection','audit','risk','other'],{list:true}),text('source_id','Source reference'),area('action','Action',{required:true,list:true}),text('owner_name','Owner',{list:true}),date('due_date','Due',{list:true}),area('completion_notes','Completion notes'),doc('completion_document_id','Completion evidence')]},
 cost_codes:{key:'cost_codes',table:'project_cost_codes',label:'Cost codes',singular:'Cost code',module:'projects',scope:'project',titleField:'code',view:'project.view',edit:'project.edit',
  empty:'No cost codes have been set up. Cost codes group budgets and actual costs.',createLabel:'Add cost code',
  fields:[text('code','Code',{required:true,list:true,max:40}),text('description','Description',{required:true,list:true}),select('category','Category',COST_CATEGORIES,{list:true}),money('budget_amount','Budget',{list:true})]},
 contacts:{key:'contacts',table:'project_contacts',label:'Project team & contacts',singular:'Contact',module:'projects',scope:'project',titleField:'name',view:'project.view',edit:'project.edit',
  empty:'No project team or client contacts have been recorded.',createLabel:'Add contact',
  fields:[select('contact_type','Type',['team','client','subcontractor','authority','other'],{list:true}),text('name','Name',{required:true,list:true}),text('role','Role',{list:true}),text('organisation_name','Organisation'),text('email','Email',{list:true}),text('phone','Phone')]},
 readiness:{key:'readiness',table:'project_checklist_items',label:'Readiness requirements',singular:'Readiness item',module:'projects',scope:'project',titleField:'title',machine:'checklist',view:'project.view',edit:'project.edit',fixed:{phase:'readiness'},
  empty:'No readiness requirements yet.',createLabel:'Add requirement',
  fields:[select('category','Category',['contract','project plans','HSEQ','SWMS','workforce','competencies','plant','subcontractors','procurement','permits','site setup','client requirements'],{required:true,list:true}),text('title','Requirement',{required:true,list:true}),bool('mandatory','Mandatory',{list:true}),user('owner_user_id','Owner'),date('due_date','Due',{list:true}),doc('evidence_document_id','Evidence'),area('notes','Notes')]},
 closeout:{key:'closeout',table:'project_checklist_items',label:'Closeout checklist',singular:'Closeout item',module:'projects',scope:'project',titleField:'title',machine:'checklist',view:'project.view',edit:'project.edit',fixed:{phase:'closeout'},
  empty:'No closeout items yet.',createLabel:'Add closeout item',
  fields:[select('category','Category',['outstanding works','defects','final QA','final HSEQ','as-builts','client documents','variations','final claim','invoices','lessons learned'],{required:true,list:true}),text('title','Item',{required:true,list:true}),bool('mandatory','Mandatory',{list:true}),user('owner_user_id','Owner'),date('due_date','Due',{list:true}),doc('evidence_document_id','Evidence'),area('notes','Notes / lessons learned')]},
 variations:{key:'variations',table:'project_variations',label:'Variations',singular:'Variation',module:'commercial',scope:'project',titleField:'title',machine:'variation',view:'commercial.view',edit:'variation.edit',lockedStates:['approved','rejected'],
  empty:'No variations have been raised for this project.',createLabel:'Raise variation',
  fields:[{key:'reference',label:'No.',type:'text',derived:true,list:true},text('title','Title',{required:true,list:true}),area('description','Description'),select('cause','Cause',['client instruction','latent condition','design change','delay','scope change','other'],{list:true}),area('instruction_source','Instruction / source'),text('client_reference','Client reference'),date('notice_date','Notice date',{list:true}),date('submitted_date','Submitted',{list:true}),money('value','Value (revenue)',{list:true}),money('cost','Estimated cost'),{key:'approved_value',label:'Approved value',type:'money',commercial:true,derived:true,list:true}]},
} satisfies Record<string,RegisterDef>;
export type RegisterKey=keyof typeof REGISTERS;
export const registerDef=(key:string):RegisterDef|undefined=>(REGISTERS as Record<string,RegisterDef>)[key];

/** Deterministic 5×5 risk rating (organisation matrix may override thresholds). */
export type RiskMatrix={low:number;medium:number;high:number};
export const DEFAULT_RISK_MATRIX:RiskMatrix={low:4,medium:9,high:16};
export function riskRating(likelihood:unknown,consequence:unknown,matrix:RiskMatrix=DEFAULT_RISK_MATRIX){
 const l=Number(likelihood),c=Number(consequence);
 if(!Number.isInteger(l)||!Number.isInteger(c)||l<1||l>5||c<1||c>5)return null;
 const score=l*c;
 return score<=matrix.low?'Low':score<=matrix.medium?'Medium':score<=matrix.high?'High':'Extreme';
}
