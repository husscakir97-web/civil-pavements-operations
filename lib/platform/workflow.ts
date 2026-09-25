// Isomorphic lifecycle definitions. Server routes call assertTransition();
// clients call allowedTransitions() to show only valid actions.
import {can,type Capability} from './permissions';

type Transition={to:string;label:string;capability:Capability;system?:boolean};
type Machine={initial:string;states:Record<string,{label:string;tone:Tone;terminal?:boolean}>;transitions:Record<string,Transition[]>};
export type Tone='neutral'|'info'|'warning'|'success'|'danger';

const m=(initial:string,states:Machine['states'],transitions:Machine['transitions']):Machine=>({initial,states,transitions});

export const MACHINES={
 opportunity:m('lead',{lead:{label:'Lead',tone:'neutral'},qualified:{label:'Qualified',tone:'info'},bidding:{label:'Bidding',tone:'warning'},converted:{label:'Converted to tender',tone:'info'},won:{label:'Won',tone:'success',terminal:true},lost:{label:'Lost',tone:'danger',terminal:true}},{
  lead:[{to:'qualified',label:'Mark qualified',capability:'pipeline.edit'},{to:'lost',label:'Mark lost',capability:'pipeline.edit'}],
  qualified:[{to:'bidding',label:'Start bidding',capability:'pipeline.edit'},{to:'lead',label:'Return to lead',capability:'pipeline.edit'},{to:'lost',label:'Mark lost',capability:'pipeline.edit'}],
  bidding:[{to:'converted',label:'Convert to tender',capability:'pipeline.edit',system:true},{to:'lost',label:'Mark lost',capability:'pipeline.edit'}],
  converted:[{to:'won',label:'Mark won',capability:'tender.award',system:true},{to:'lost',label:'Mark lost',capability:'pipeline.edit',system:true}],
 }),
 tender:m('draft',{draft:{label:'Intake',tone:'neutral'},reviewing:{label:'Bid review',tone:'info'},pricing:{label:'Pricing',tone:'warning'},approval:{label:'Internal approval',tone:'warning'},submitted:{label:'Submitted',tone:'info'},clarification:{label:'Clarification',tone:'warning'},awarded:{label:'Awarded',tone:'success',terminal:true},lost:{label:'Lost / no bid',tone:'danger',terminal:true}},{
  draft:[{to:'reviewing',label:'Start bid review',capability:'pipeline.edit'},{to:'lost',label:'Withdraw',capability:'pipeline.edit'}],
  reviewing:[{to:'pricing',label:'Proceed to pricing',capability:'tender.approve',system:true},{to:'lost',label:'Record no-bid',capability:'tender.approve',system:true},{to:'draft',label:'Return to intake',capability:'pipeline.edit'}],
  pricing:[{to:'approval',label:'Request internal approval',capability:'pipeline.edit',system:true},{to:'lost',label:'Withdraw',capability:'pipeline.edit'}],
  approval:[{to:'pricing',label:'Return to pricing',capability:'tender.approve',system:true},{to:'submitted',label:'Record submission',capability:'tender.submit',system:true},{to:'lost',label:'Withdraw',capability:'pipeline.edit'}],
  submitted:[{to:'clarification',label:'Record clarification',capability:'pipeline.edit'},{to:'awarded',label:'Award',capability:'tender.award',system:true},{to:'lost',label:'Record loss',capability:'pipeline.edit',system:true}],
  clarification:[{to:'submitted',label:'Clarifications answered',capability:'pipeline.edit'},{to:'awarded',label:'Award',capability:'tender.award',system:true},{to:'lost',label:'Record loss',capability:'pipeline.edit',system:true}],
 }),
 estimate:m('draft',{draft:{label:'Draft',tone:'neutral'},review:{label:'In review',tone:'warning'},approved:{label:'Approved',tone:'success'},superseded:{label:'Superseded',tone:'neutral',terminal:true},rejected:{label:'Returned',tone:'danger',terminal:true}},{
  draft:[{to:'review',label:'Submit for review',capability:'estimate.edit'}],
  review:[{to:'approved',label:'Approve revision',capability:'estimate.approve'},{to:'rejected',label:'Return for changes',capability:'estimate.approve'}],
  approved:[{to:'superseded',label:'Supersede',capability:'estimate.approve',system:true}],
 }),
 project:m('setup',{setup:{label:'Setup',tone:'neutral'},ready:{label:'Ready',tone:'info'},active:{label:'Active',tone:'success'},practical_completion:{label:'Practical completion',tone:'info'},closeout:{label:'Closeout',tone:'warning'},closed:{label:'Closed',tone:'neutral',terminal:true}},{
  setup:[{to:'ready',label:'Mark ready',capability:'project.edit',system:true}],
  ready:[{to:'active',label:'Start delivery',capability:'project.edit'},{to:'setup',label:'Return to setup',capability:'project.edit'}],
  active:[{to:'practical_completion',label:'Record practical completion',capability:'project.edit'}],
  practical_completion:[{to:'closeout',label:'Start closeout',capability:'project.edit'},{to:'active',label:'Return to active',capability:'project.edit'}],
  closeout:[{to:'closed',label:'Close project',capability:'project.close',system:true},{to:'active',label:'Return to active',capability:'project.close'}],
  closed:[{to:'closeout',label:'Reopen for closeout',capability:'project.close',system:true}],
 }),
 swms:m('draft',{draft:{label:'Draft',tone:'neutral'},review:{label:'In review',tone:'warning'},approved:{label:'Approved',tone:'success'},issued:{label:'Issued',tone:'success'},superseded:{label:'Superseded',tone:'neutral',terminal:true}},{
  draft:[{to:'review',label:'Submit for review',capability:'hseq.edit'}],
  review:[{to:'approved',label:'Approve',capability:'swms.approve'},{to:'draft',label:'Return to draft',capability:'swms.approve'}],
  approved:[{to:'issued',label:'Issue to site',capability:'swms.approve'},{to:'superseded',label:'Supersede',capability:'swms.approve',system:true}],
  issued:[{to:'superseded',label:'Supersede',capability:'swms.approve',system:true}],
 }),
 docket:m('draft',{draft:{label:'Draft',tone:'neutral'},review:{label:'Review',tone:'warning'},approved:{label:'Approved',tone:'success'},claimed:{label:'Claimed',tone:'info',terminal:true},rejected:{label:'Rejected',tone:'danger'}},{
  draft:[{to:'review',label:'Submit for review',capability:'docket.submit'}],
  review:[{to:'approved',label:'Approve',capability:'docket.approve'},{to:'rejected',label:'Reject',capability:'docket.approve'}],
  approved:[{to:'review',label:'Return to review',capability:'docket.approve'},{to:'claimed',label:'Claim',capability:'claim.edit',system:true}],
  rejected:[{to:'review',label:'Reopen',capability:'docket.approve'}],
 }),
 variation:m('draft',{draft:{label:'Draft',tone:'neutral'},submitted:{label:'Submitted',tone:'warning'},approved:{label:'Approved',tone:'success',terminal:true},rejected:{label:'Rejected',tone:'danger',terminal:true}},{
  draft:[{to:'submitted',label:'Submit to client',capability:'variation.edit'}],
  submitted:[{to:'approved',label:'Record approval',capability:'variation.approve'},{to:'rejected',label:'Record rejection',capability:'variation.approve'},{to:'draft',label:'Withdraw to draft',capability:'variation.edit'}],
 }),
 claim:m('draft',{draft:{label:'Draft',tone:'neutral'},internal_approval:{label:'Internal approval',tone:'warning'},submitted:{label:'Submitted',tone:'info'},certified:{label:'Certified',tone:'success'},invoiced:{label:'Invoiced',tone:'info'},paid:{label:'Paid',tone:'success',terminal:true}},{
  draft:[{to:'internal_approval',label:'Send for internal approval',capability:'claim.edit'}],
  internal_approval:[{to:'submitted',label:'Approve and submit',capability:'claim.approve'},{to:'draft',label:'Return to draft',capability:'claim.approve'}],
  submitted:[{to:'certified',label:'Record certification',capability:'claim.approve',system:true}],
  certified:[{to:'invoiced',label:'Invoice',capability:'invoice.manage',system:true}],
  invoiced:[{to:'paid',label:'Mark paid',capability:'invoice.manage',system:true}],
 }),
 invoice:m('draft',{draft:{label:'Draft',tone:'neutral'},issued:{label:'Issued',tone:'info'},part_paid:{label:'Part paid',tone:'warning'},paid:{label:'Paid',tone:'success',terminal:true},void:{label:'Void',tone:'danger',terminal:true}},{
  draft:[{to:'issued',label:'Issue invoice',capability:'invoice.manage'},{to:'void',label:'Void',capability:'invoice.manage'}],
  issued:[{to:'part_paid',label:'Record part payment',capability:'invoice.manage',system:true},{to:'paid',label:'Record payment',capability:'invoice.manage',system:true},{to:'void',label:'Void',capability:'invoice.manage'}],
  part_paid:[{to:'paid',label:'Record payment',capability:'invoice.manage',system:true}],
 }),
 requirement:m('open',{suggested:{label:'Suggested (AI)',tone:'warning'},open:{label:'Open',tone:'neutral'},in_progress:{label:'In progress',tone:'info'},complete:{label:'Complete',tone:'success'},not_applicable:{label:'Not applicable',tone:'neutral'},rejected:{label:'Rejected suggestion',tone:'danger',terminal:true}},{
  suggested:[{to:'open',label:'Confirm requirement',capability:'pipeline.edit'},{to:'rejected',label:'Reject suggestion',capability:'pipeline.edit'}],
  open:[{to:'in_progress',label:'Start',capability:'pipeline.edit'},{to:'complete',label:'Mark complete',capability:'pipeline.edit'},{to:'not_applicable',label:'Not applicable',capability:'pipeline.edit'}],
  in_progress:[{to:'complete',label:'Mark complete',capability:'pipeline.edit'},{to:'open',label:'Reopen',capability:'pipeline.edit'}],
  complete:[{to:'open',label:'Reopen',capability:'pipeline.edit'}],
  not_applicable:[{to:'open',label:'Reopen',capability:'pipeline.edit'}],
 }),
 returnable:m('not_started',{not_started:{label:'Not started',tone:'neutral'},in_progress:{label:'In progress',tone:'info'},complete:{label:'Complete',tone:'success'},not_applicable:{label:'Not applicable',tone:'neutral'}},{
  not_started:[{to:'in_progress',label:'Start',capability:'pipeline.edit'},{to:'complete',label:'Mark complete',capability:'pipeline.edit'},{to:'not_applicable',label:'Not applicable',capability:'pipeline.edit'}],
  in_progress:[{to:'complete',label:'Mark complete',capability:'pipeline.edit'},{to:'not_started',label:'Reset',capability:'pipeline.edit'}],
  complete:[{to:'in_progress',label:'Reopen',capability:'pipeline.edit'}],
  not_applicable:[{to:'not_started',label:'Reopen',capability:'pipeline.edit'}],
 }),
 clarification:m('open',{open:{label:'Open',tone:'warning'},responded:{label:'Responded',tone:'info'},closed:{label:'Closed',tone:'success',terminal:true}},{
  open:[{to:'responded',label:'Record response',capability:'pipeline.edit'}],
  responded:[{to:'closed',label:'Close',capability:'pipeline.edit'},{to:'open',label:'Reopen',capability:'pipeline.edit'}],
 }),
 library:m('draft',{draft:{label:'Draft',tone:'neutral'},current:{label:'Current',tone:'success'},archived:{label:'Archived',tone:'neutral'}},{
  draft:[{to:'current',label:'Publish',capability:'library.edit'}],
  current:[{to:'archived',label:'Archive',capability:'library.edit'},{to:'draft',label:'Return to draft',capability:'library.edit'}],
  archived:[{to:'current',label:'Restore',capability:'library.edit'}],
 }),
 risk:m('open',{open:{label:'Open',tone:'warning'},controlled:{label:'Controlled',tone:'success'},closed:{label:'Closed',tone:'neutral'}},{
  open:[{to:'controlled',label:'Approve controls',capability:'swms.approve'},{to:'closed',label:'Close',capability:'hseq.edit'}],
  controlled:[{to:'open',label:'Reopen',capability:'hseq.edit'},{to:'closed',label:'Close',capability:'hseq.edit'}],
  closed:[{to:'open',label:'Reopen',capability:'hseq.edit'}],
 }),
 incident:m('reported',{reported:{label:'Reported',tone:'danger'},investigating:{label:'Investigating',tone:'warning'},closed:{label:'Closed',tone:'success'}},{
  reported:[{to:'investigating',label:'Start investigation',capability:'hseq.edit'},{to:'closed',label:'Close',capability:'hseq.edit'}],
  investigating:[{to:'closed',label:'Close',capability:'hseq.edit'}],
  closed:[{to:'investigating',label:'Reopen',capability:'hseq.edit'}],
 }),
 ncr:m('open',{open:{label:'Open',tone:'danger'},action:{label:'Corrective action',tone:'warning'},verification:{label:'Verification',tone:'info'},closed:{label:'Closed',tone:'success'}},{
  open:[{to:'action',label:'Assign corrective action',capability:'hseq.edit'}],
  action:[{to:'verification',label:'Ready for verification',capability:'hseq.edit'}],
  verification:[{to:'closed',label:'Verify and close',capability:'document.approve'},{to:'action',label:'Return to action',capability:'hseq.edit'}],
  closed:[{to:'action',label:'Reopen',capability:'document.approve'}],
 }),
 action:m('open',{open:{label:'Open',tone:'warning'},in_progress:{label:'In progress',tone:'info'},complete:{label:'Complete',tone:'success'},verified:{label:'Verified',tone:'success',terminal:true}},{
  open:[{to:'in_progress',label:'Start',capability:'hseq.edit'},{to:'complete',label:'Complete',capability:'hseq.edit'}],
  in_progress:[{to:'complete',label:'Complete',capability:'hseq.edit'}],
  complete:[{to:'verified',label:'Verify',capability:'document.approve'},{to:'in_progress',label:'Reopen',capability:'hseq.edit'}],
 }),
 itp:m('draft',{draft:{label:'Draft',tone:'neutral'},active:{label:'Active',tone:'info'},closed:{label:'Closed',tone:'success'}},{
  draft:[{to:'active',label:'Activate',capability:'document.approve'}],
  active:[{to:'closed',label:'Close',capability:'document.approve'},{to:'draft',label:'Return to draft',capability:'document.approve'}],
  closed:[{to:'active',label:'Reopen',capability:'document.approve'}],
 }),
 itpItem:m('open',{open:{label:'Open',tone:'warning'},pass:{label:'Pass',tone:'success'},fail:{label:'Fail',tone:'danger'},na:{label:'Not applicable',tone:'neutral'}},{
  open:[{to:'pass',label:'Record pass',capability:'itp.complete'},{to:'fail',label:'Record fail',capability:'itp.complete'},{to:'na',label:'Not applicable',capability:'itp.complete'}],
  pass:[{to:'open',label:'Reopen',capability:'document.approve'}],fail:[{to:'open',label:'Reopen',capability:'document.approve'}],na:[{to:'open',label:'Reopen',capability:'document.approve'}],
 }),
 checklist:m('open',{open:{label:'Open',tone:'warning'},complete:{label:'Complete',tone:'success'},not_applicable:{label:'Not applicable',tone:'neutral'}},{
  open:[{to:'complete',label:'Mark complete',capability:'project.edit'},{to:'not_applicable',label:'Not applicable',capability:'project.edit'}],
  complete:[{to:'open',label:'Reopen',capability:'project.edit'}],
  not_applicable:[{to:'open',label:'Reopen',capability:'project.edit'}],
 }),
} satisfies Record<string,Machine>;
export type MachineKey=keyof typeof MACHINES;

export class TransitionError extends Error{constructor(message:string,readonly status=409){super(message);}}

export function stateLabel(machine:MachineKey,state:string){return (MACHINES[machine].states as Record<string,{label:string}>)[state]?.label??state;}
export function stateTone(machine:MachineKey,state:string):Tone{return (MACHINES[machine].states as Record<string,{tone:Tone}>)[state]?.tone??'neutral';}

/** Transitions a role may request directly from the UI (system transitions run through dedicated actions). */
export function allowedTransitions(machine:MachineKey,state:string,role:string,includeSystem=false){
 return ((MACHINES[machine].transitions as Record<string,Transition[]>)[state]||[]).filter(t=>(includeSystem||!t.system)&&can(role,t.capability));
}

/** Server authority: validates the edge and the capability. System edges require an explicit flag. */
export function assertTransition(machine:MachineKey,from:string,to:string,role:string,opts:{system?:boolean}={}){
 const edge=((MACHINES[machine].transitions as Record<string,Transition[]>)[from]||[]).find(t=>t.to===to);
 if(!edge)throw new TransitionError(`Cannot move from ${stateLabel(machine,from)} to ${stateLabel(machine,to)}.`);
 if(edge.system&&!opts.system)throw new TransitionError(`${edge.label} must be completed through its dedicated action.`);
 if(!can(role,edge.capability))throw new TransitionError('You are not authorised for this action.',403);
 return edge;
}
