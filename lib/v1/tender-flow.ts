// Tender lifecycle presentation: which step is done, current, blocked or still to do,
// and which step the next action lives on. Pure derivation from the tender's existing
// stage and stats (the server's nextAction wording is unchanged); no business rules here.

export type TenderStepKey='intake'|'requirements'|'bid'|'estimate'|'returnables'|'approval'|'submission'|'clarifications'|'award';
export type StepState='done'|'current'|'attention'|'todo'|'closed';
export type TenderFlowInput={stage:string;approvalStatus:string;submittedAt:string|null;estimateId:string|null;projectId:string|null;
 checks:Array<{key:string;ok:boolean}>;
 stats:{documents:number;requirements:number;suggested:number;mandatoryOpen:number;returnables:number;returnablesMandatoryOpen:number;clarificationsOpen:number;estimateState:string|null;bidDecision:string;approvedRevisionNumber:number|null}};

export const TENDER_STEPS:Array<[TenderStepKey,string]>=[['intake','Intake'],['requirements','Requirements'],['bid','Bid review'],['estimate','Estimate'],['returnables','Returnables'],['approval','Approval'],['submission','Submission'],['clarifications','Clarifications'],['award','Award']];
const ORDER=['draft','reviewing','pricing','approval','submitted','clarification','awarded','lost'];
const at=(stage:string,min:string)=>ORDER.indexOf(stage)>=ORDER.indexOf(min);

/** The step the next action is performed on ('project' once awarded with a project). */
export function nextStep(t:TenderFlowInput):TenderStepKey|'project'|null{
 const s=t.stats;
 switch(t.stage){
  case 'draft':return s.documents||s.requirements?'bid':'intake';
  case 'reviewing':return 'bid';
  case 'pricing':
   if(s.suggested)return 'requirements';
   if(!t.estimateId||s.estimateState==='review'||!s.approvedRevisionNumber)return 'estimate';
   if(s.mandatoryOpen)return 'requirements';
   if(s.returnablesMandatoryOpen)return 'returnables';
   return 'approval';
  case 'approval':{
   if(t.approvalStatus==='requested')return 'approval';
   const failing=t.checks.find(c=>!c.ok)?.key;
   return failing==='estimate'?'estimate':failing==='requirements'?'requirements':failing==='returnables'?'returnables':failing==='approval'?'approval':'submission';
  }
  case 'submitted':case 'clarification':return s.clarificationsOpen?'clarifications':'award';
  case 'awarded':return t.projectId?'project':'award';
  default:return null;
 }
}

export function tenderSteps(t:TenderFlowInput):Array<{key:TenderStepKey;label:string;state:StepState;count?:number}>{
 const s=t.stats,lost=t.stage==='lost',next=nextStep(t);
 const state=(key:TenderStepKey,done:boolean,attention=0):StepState=>{
  if(done&&!attention)return 'done';
  if(lost)return 'closed';
  if(attention)return 'attention';
  return next===key?'current':'todo';
 };
 const priced=at(t.stage,'pricing');
 return TENDER_STEPS.map(([key,label])=>{
  switch(key){
   case 'intake':return {key,label,state:state(key,s.documents>0||s.requirements>0)};
   case 'requirements':{const open=s.mandatoryOpen+s.suggested;return {key,label,state:state(key,s.requirements>0&&open===0,priced?open:0),count:open||undefined};}
   case 'bid':return {key,label,state:state(key,s.bidDecision!=='pending')};
   case 'estimate':return {key,label,state:state(key,Boolean(s.approvedRevisionNumber)&&s.estimateState!=='review',s.estimateState==='review'?1:0)};
   case 'returnables':return {key,label,state:state(key,s.returnables>0&&s.returnablesMandatoryOpen===0,priced?s.returnablesMandatoryOpen:0),count:s.returnablesMandatoryOpen||undefined};
   case 'approval':return {key,label,state:state(key,t.approvalStatus==='approved',t.approvalStatus==='requested'?1:0)};
   case 'submission':return {key,label,state:state(key,Boolean(t.submittedAt))};
   case 'clarifications':return {key,label,state:state(key,Boolean(t.submittedAt)&&s.clarificationsOpen===0,s.clarificationsOpen),count:s.clarificationsOpen||undefined};
   case 'award':return {key,label,state:t.stage==='awarded'?'done':state(key,false)};
  }
 });
}

/** Tender register grouping, in lifecycle order. */
export const TENDER_PHASES:Array<{key:string;label:string;stages:string[]}>=[
 {key:'preparing',label:'Preparing',stages:['draft','reviewing']},
 {key:'pricing',label:'Pricing',stages:['pricing']},
 {key:'approval',label:'Awaiting approval',stages:['approval']},
 {key:'submitted',label:'Submitted',stages:['submitted','clarification']},
 {key:'decided',label:'Won / lost',stages:['awarded','lost']},
];
