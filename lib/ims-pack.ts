export const CORE_PACK: Array<[string, string]> = [
  ['Project management plan', 'Project management plan'], ['Quality plan', 'Quality plan'], ['ITP', 'ITP'],
  ['Project risk register', 'Risk register'], ['SWMS', 'SWMS'], ['Site-specific risk assessment', 'Risk assessment'],
  ['Environmental plan', 'Environmental plan'], ['Traffic-management documents', 'Traffic management'],
  ['Permits and approvals', 'Permit'], ['Emergency arrangements', 'Emergency arrangements'],
  ['Worker competencies and inductions', 'Competency'], ['Plant inspections and registrations', 'Plant compliance'],
  ['Subcontractor documentation', 'Subcontractor compliance'], ['Client approvals', 'Client approval'],
  ['Pre-start and toolbox records', 'Pre-start'],
];
export function packStatements(db:D1Database,organisationId:string,jobId:string,now:string){
 return CORE_PACK.map(([title,type])=>db.prepare('INSERT OR IGNORE INTO job_ims_items (id,organisation_id,job_id,title,document_type,mandatory,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),organisationId,jobId,title,type,1,'Missing',now,now));
}
