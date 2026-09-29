// Where a search result opens: the work context the record belongs to, falling back to the
// global register only when that context is unknown. Returns navigate() arguments.
export type SearchResult={id:string;type:string;area:string;projectId:string|null;tenderId?:string|null;clientId?:string|null;name?:string};
export type Target=[area:string,sub?:string,id?:string,tab?:string];

export function searchTarget(r:SearchResult,role:string):Target{
 const project=(tab?:string):Target=>['Projects',undefined,r.projectId!,tab];
 switch(r.type){
  case 'Tender':return ['Pipeline','Tenders',r.id];
  case 'Estimate':return r.tenderId?['Pipeline','Tenders',r.tenderId,'estimate']:['Pipeline','Estimates',r.id];
  case 'Project':return ['Projects',undefined,r.id];
  case 'Variation':case 'Claim':case 'Invoice':if(r.projectId)return project('commercial');break;
  case 'SWMS':if(r.projectId)return project('quality');break;
  case 'Document':if(r.projectId)return project('documents');break;
  case 'Docket':if(r.projectId)return project('delivery');break;
  case 'Shift':if(r.projectId&&role!=='field')return ['Operations','Schedule',r.projectId];break;
  // Registers without a detail page open filtered to the record (the route id carries the search text).
  // Clients, contacts and sites open the client in CRM (by id).
  case 'Client':return ['CRM','Clients',r.id];
  case 'Contact':case 'Site':if(r.clientId)return ['CRM','Clients',r.clientId];break;
  case 'Opportunity':return ['Win Work','Opportunities',r.name];
  case 'Library item':return ['Prepare Work','Company Library',r.name];
  case 'Plant':return ['Resource Work','Resources',r.name,'plant'];
  case 'Worker':return ['Resource Work','Resources',r.name,'workers'];
 }
 const [a,s]=r.area.split('/');return [a,s];
}
