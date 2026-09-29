// Project-team roles (where someone works), distinct from application roles (what they may do).
export const PROJECT_ROLES=['project_manager','project_engineer','site_engineer','supervisor','commercial','hseq','other'] as const;
export type ProjectRole=typeof PROJECT_ROLES[number];
export const PROJECT_ROLE_LABELS:Record<ProjectRole,string>={project_manager:'Project Manager',project_engineer:'Project Engineer',site_engineer:'Site Engineer',supervisor:'Supervisor',commercial:'Commercial',hseq:'HSEQ',other:'Other'};
