// Project setup presentation: turns the existing readiness categories into a guided
// checklist, says where each gap is fixed, and maps the project's next action to the
// workspace tab it belongs to. Pure mapping over data the server already returns.

export type ReadinessItemLike={id?:string;category:string;title:string;mandatory:boolean;ok:boolean;source:'checklist'|'derived';detail?:string|null};
export type SetupTarget={kind:'tab';tab:'setup'|'delivery'|'quality'|'commercial'|'closeout'}|{kind:'area';area:string;sub?:string;withProject?:boolean}|{kind:'anchor';anchor:'setup-contract'|'setup-baseline'}|{kind:'checklist';category:string};
export type SetupArea={key:string;label:string;status:'complete'|'attention'|'not_started';done:number;total:number;action:string;target:SetupTarget;gaps:string[]};

const LABELS:Record<string,string>={contract:'Contract',swms:'SWMS',hseq:'Risk & HSEQ','client requirements':'Client requirements',competencies:'Competencies',permits:'Permits & approvals',plant:'Plant','project plans':'Project plans & IMS',procurement:'Procurement','site setup':'Site setup',subcontractors:'Subcontractors',workforce:'Workforce'};
export const categoryLabel=(c:string)=>LABELS[c.toLowerCase()]||c.charAt(0).toUpperCase()+c.slice(1);

/** Where a single readiness gap is fixed, with the verb shown on its button. */
export function fixFor(item:ReadinessItemLike):{action:string;target:SetupTarget}{
 if(item.source==='derived'){
  const t=item.title.toLowerCase();
  if(t.includes('baseline'))return {action:'Record baseline',target:{kind:'anchor',anchor:'setup-baseline'}};
  if(t.includes('swms'))return {action:'Open SWMS',target:{kind:'tab',tab:'quality'}};
  if(t.includes('risk'))return {action:'Open risk register',target:{kind:'tab',tab:'quality'}};
  if(t.includes('ims'))return {action:'Review IMS pack',target:{kind:'area',area:'IMS & HSEQ'}};
  if(t.includes('competenc'))return {action:'Check crew',target:{kind:'area',area:'Operations',sub:'Resources'}};
 }
 return {action:'Update checklist',target:{kind:'checklist',category:item.category}};
}

export function setupAreas(categories:Array<{category:string;items:ReadinessItemLike[]}>,contract:{complete:boolean;missing:string[]}):SetupArea[]{
 const areas:SetupArea[]=[{key:'contract-details',label:'Contract details',status:contract.complete?'complete':contract.missing.length<4?'attention':'not_started',done:contract.complete?1:0,total:1,action:'Edit details',target:{kind:'anchor',anchor:'setup-contract'},gaps:contract.missing.map(m=>`${m} not recorded`)}];
 for(const c of categories){
  const required=c.items.filter(i=>i.mandatory),counted=required.length?required:c.items;
  const done=counted.filter(i=>i.ok).length,open=counted.filter(i=>!i.ok);
  const first=open[0]||counted[0];
  const fix=first?fixFor(first):{action:'Open',target:{kind:'checklist',category:c.category} as SetupTarget};
  areas.push({key:c.category,label:categoryLabel(c.category),status:!open.length?'complete':done>0?'attention':'not_started',done,total:counted.length,action:open.length?fix.action:'Review',target:fix.target,gaps:open.map(i=>i.detail?`${i.title}: ${i.detail}`:i.title)});
 }
 return areas;
}

/** The workspace tab where the project's next action is done. */
export function nextActionTarget(stage:string,nextAction:string|null):SetupTarget|null{
 if(!nextAction)return null;
 const text=nextAction.toLowerCase();
 // When the next action is the header's own transition (Mark ready, Start delivery) there is no
 // separate place to go: the header button is the action.
 if(stage==='setup')return text.includes('swms')?{kind:'tab',tab:'quality'}:text.startsWith('mark the project ready')?null:{kind:'tab',tab:'setup'};
 if(stage==='ready')return null;
 if(stage==='active')return text.includes('variation')?{kind:'tab',tab:'commercial'}:{kind:'tab',tab:'delivery'};
 if(['practical_completion','closeout'].includes(stage))return {kind:'tab',tab:'closeout'};
 return null;
}
