// Complete legacy schema, including tables previously present only in SQL migrations.
import {sql} from 'drizzle-orm';
import {mysqlTable,varchar,longtext,text,int,double,decimal,index,uniqueIndex} from 'drizzle-orm/mysql-core';

export const attachments=mysqlTable('attachments',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_attachments_org').on(t.organisationId)]);

export const auditEvents=mysqlTable('audit_events',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_audit_events_org').on(t.organisationId)]);

export const claimItems=mysqlTable('claim_items',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 claimId:longtext('claim_id').notNull(),
 docketId:varchar('docket_id',{length:191}).notNull(),
 lineItem:longtext('line_item').notNull().default(sql`('')`),
 amount:double('amount').notNull().default(sql`(0)`),
 createdAt:longtext('created_at').notNull(),
},t=>[uniqueIndex('idx_claim_items_unique').on(t.organisationId,t.docketId)]);

export const claims=mysqlTable('claims',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 jobId:varchar('job_id',{length:191}).notNull(),
 claimPeriod:varchar('claim_period',{length:191}).notNull(),
 status:longtext('status').notNull().default(sql`('Draft')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_claims_org_job_period').on(t.organisationId,t.jobId,t.claimPeriod)]);

export const clients=mysqlTable('clients',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 contactName:longtext('contact_name').notNull().default(sql`('')`),
 email:longtext('email').notNull().default(sql`('')`),
 phone:longtext('phone').notNull().default(sql`('')`),
},t=>[index('idx_clients_org').on(t.organisationId)]);

export const commercialRecords=mysqlTable('commercial_records',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_commercial_records_org').on(t.organisationId)]);

export const costCodes=mysqlTable('cost_codes',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_cost_codes_org').on(t.organisationId)]);

export const crews=mysqlTable('crews',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_crews_org').on(t.organisationId)]);

export const dockets=mysqlTable('dockets',{
 id:varchar('id',{length:191}).primaryKey().notNull(),
 docketNo:varchar('docket_no',{length:191}).notNull(),
 workDate:varchar('work_date',{length:191}).notNull(),
 client:longtext('client').notNull().default(sql`('')`),
 project:longtext('project').notNull().default(sql`('')`),
 crew:longtext('crew').notNull().default(sql`('')`),
 vehicle:longtext('vehicle').notNull().default(sql`('')`),
 startTime:longtext('start_time').notNull().default(sql`('')`),
 finishTime:longtext('finish_time').notNull().default(sql`('')`),
 breakHours:double('break_hours').notNull().default(sql`(0)`),
 labourHours:double('labour_hours').notNull().default(sql`(0)`),
 quantity:double('quantity').notNull().default(sql`(0)`),
 quantityUnit:longtext('quantity_unit').notNull().default(sql`('t')`),
 amount:double('amount').notNull().default(sql`(0)`),
 poNumber:longtext('po_number').notNull().default(sql`('')`),
 notes:longtext('notes').notNull().default(sql`('')`),
 status:longtext('status').notNull().default(sql`('review')`),
 confidence:double('confidence').notNull().default(sql`(0)`),
 sourceName:longtext('source_name').notNull().default(sql`('')`),
 sourceKey:longtext('source_key').notNull().default(sql`('')`),
 rawText:longtext('raw_text').notNull().default(sql`('')`),
 createdAt:longtext('created_at').notNull(),
 updatedAt:longtext('updated_at').notNull(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 sourcePage:double('source_page'),
 sourceCrop:longtext('source_crop').notNull().default(sql`('full-page')`),
 fieldConfidence:longtext('field_confidence').notNull().default(sql`('{}')`),
 lineItems:longtext('line_items').notNull().default(sql`('[]')`),
 links:longtext('links').notNull().default(sql`('{}')`),
 extractionMethod:longtext('extraction_method').notNull().default(sql`('local-ocr')`),
 profileId:longtext('profile_id').notNull().default(sql`('')`),
},t=>[index('idx_dockets_organisation').on(t.organisationId),index('idx_dockets_docket_no').on(t.docketNo),index('idx_dockets_work_date').on(t.workDate)]);

export const estimates=mysqlTable('estimates',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),

 // V1 typed columns (0003). Legacy metadata is retained and read as a fallback.
 workflowState:varchar('workflow_state',{length:20}),
 approvedRevisionId:varchar('approved_revision_id',{length:191}),
 tenderId:varchar('tender_id',{length:191}),
 updatedAt:varchar('updated_at',{length:40}),
},t=>[index('idx_estimates_org').on(t.organisationId),index('idx_estimates_org_tender').on(t.organisationId,t.tenderId)]);

export const extractionProfiles=mysqlTable('extraction_profiles',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 supplier:longtext('supplier').notNull().default(sql`('')`),
 client:longtext('client').notNull().default(sql`('')`),
 docketType:longtext('docket_type').notNull().default(sql`('')`),
 rules:longtext('rules').notNull().default(sql`('{}')`),
 sampleCount:int('sample_count').notNull().default(sql`(0)`),
 createdAt:longtext('created_at').notNull(),
 updatedAt:longtext('updated_at').notNull(),
},t=>[index('idx_extraction_profiles_org').on(t.organisationId)]);

export const fieldHistory=mysqlTable('field_history',{
 id:varchar('id',{length:191}).primaryKey(),
 shiftId:varchar('shift_id',{length:191}).notNull(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 revision:int('revision').notNull(),
 action:longtext('action').notNull(),
 reason:longtext('reason').notNull(),
 actor:longtext('actor').notNull(),
 snapshot:longtext('snapshot').notNull(),
 createdAt:longtext('created_at').notNull(),
},t=>[uniqueIndex('idx_field_revision').on(t.shiftId,t.revision),index('idx_field_history').on(t.organisationId,t.shiftId)]);

export const fieldRecords=mysqlTable('field_records',{
 shiftId:varchar('shift_id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 revision:int('revision').notNull(),
 status:longtext('status').notNull(),
 data:longtext('data').notNull(),
 plan:longtext('plan').notNull(),
 job:longtext('job').notNull(),
 updatedAt:longtext('updated_at').notNull(),
},t=>[index('idx_field_org').on(t.organisationId)]);

export const imsDocumentRevisions=mysqlTable('ims_document_revisions',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 documentId:varchar('document_id',{length:191}).notNull(),
 revision:int('revision').notNull(),
 status:longtext('status').notNull(),
 snapshot:longtext('snapshot').notNull(),
 changedByUserId:longtext('changed_by_user_id').notNull(),
 changeReason:longtext('change_reason').notNull().default(sql`('')`),
 createdAt:longtext('created_at').notNull(),
},t=>[uniqueIndex('idx_ims_document_revisions_unique').on(t.organisationId,t.documentId,t.revision)]);

export const imsDocuments=mysqlTable('ims_documents',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 scope:varchar('scope',{length:191}).notNull().default(sql`('organisation')`),
 jobId:varchar('job_id',{length:191}),
 title:longtext('title').notNull(),
 documentType:longtext('document_type').notNull(),
 revision:int('revision').notNull().default(sql`(1)`),
 ownerUserId:longtext('owner_user_id'),
 approverUserId:longtext('approver_user_id'),
 status:varchar('status',{length:191}).notNull().default(sql`('Draft')`),
 effectiveDate:longtext('effective_date'),
 reviewDate:longtext('review_date'),
 expiryDate:longtext('expiry_date'),
 sourceRequirementId:longtext('source_requirement_id'),
 storageAttachmentId:longtext('storage_attachment_id'),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
 updatedAt:longtext('updated_at').notNull(),
},t=>[index('idx_ims_documents_org_job').on(t.organisationId,t.jobId),index('idx_ims_documents_org_scope').on(t.organisationId,t.scope,t.status)]);

export const jobImsItems=mysqlTable('job_ims_items',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 jobId:varchar('job_id',{length:191}).notNull(),
 title:varchar('title',{length:191}).notNull(),
 documentType:varchar('document_type',{length:191}).notNull(),
 mandatory:int('mandatory').notNull().default(sql`(1)`),
 status:longtext('status').notNull().default(sql`('Missing')`),
 sourceRequirementId:longtext('source_requirement_id'),
 linkedDocumentId:longtext('linked_document_id'),
 dueDate:longtext('due_date'),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
 updatedAt:longtext('updated_at').notNull(),
},t=>[uniqueIndex('idx_job_ims_items_unique').on(t.organisationId,t.jobId,t.documentType,t.title)]);

export const jobs=mysqlTable('jobs',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),

 // V1 typed columns (0003). Legacy metadata is retained and read as a fallback.
 projectNumber:varchar('project_number',{length:40}),
 clientName:varchar('client_name',{length:255}),
 stage:varchar('stage',{length:30}),
 projectManagerUserId:varchar('project_manager_user_id',{length:191}),
 projectManagerName:varchar('project_manager_name',{length:160}),
 contractValue:decimal('contract_value',{precision:15,scale:2}),
 originalBudget:decimal('original_budget',{precision:15,scale:2}),
 startDate:varchar('start_date',{length:10}),
 practicalCompletionDate:varchar('practical_completion_date',{length:10}),
 finishDate:varchar('finish_date',{length:10}),
 siteAddress:text('site_address'),
 contractNumber:varchar('contract_number',{length:80}),
 contractType:varchar('contract_type',{length:80}),
 retentionPct:double('retention_pct'),
 paymentTermsDays:int('payment_terms_days'),
 defectsMonths:int('defects_months'),
 scope:text('scope'),
 assumptions:text('assumptions'),
 exclusions:text('exclusions'),
 clientRequirements:text('client_requirements'),
 mobilisationNotes:text('mobilisation_notes'),
 sourceTenderId:varchar('source_tender_id',{length:191}),
 sourceEstimateId:varchar('source_estimate_id',{length:191}),
 sourceEstimateRevisionId:varchar('source_estimate_revision_id',{length:191}),
 closedAt:varchar('closed_at',{length:40}),
 closedBy:varchar('closed_by',{length:191}),
 revision:int('revision').notNull().default(1),
 updatedAt:varchar('updated_at',{length:40}),
},t=>[index('idx_jobs_org').on(t.organisationId),index('idx_jobs_org_stage').on(t.organisationId,t.stage),uniqueIndex('idx_jobs_source_tender').on(t.organisationId,t.sourceTenderId)]);

export const opportunities=mysqlTable('opportunities',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),

 // V1 typed columns (0003). Legacy metadata is retained and read as a fallback.
 clientName:varchar('client_name',{length:255}),
 ownerUserId:varchar('owner_user_id',{length:191}),
 estimatedValue:decimal('estimated_value',{precision:15,scale:2}),
 probability:int('probability'),
 closingDate:varchar('closing_date',{length:10}),
 stage:varchar('stage',{length:30}),
 location:varchar('location',{length:255}),
 notes:text('notes'),
 lostReason:text('lost_reason'),
 tenderId:varchar('tender_id',{length:191}),
 revision:int('revision').notNull().default(1),
 createdBy:varchar('created_by',{length:191}),
 updatedAt:varchar('updated_at',{length:40}),
},t=>[index('idx_opportunities_org').on(t.organisationId),index('idx_opportunities_org_stage').on(t.organisationId,t.stage)]);

export const organisations=mysqlTable('organisations',{
 id:varchar('id',{length:191}).primaryKey(),
 name:longtext('name').notNull(),
 createdAt:longtext('created_at').notNull(),
},t=>[]);

export const plant=mysqlTable('plant',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_plant_org').on(t.organisationId)]);

export const preparationRevisions=mysqlTable('preparation_revisions',{
 id:varchar('id',{length:191}).notNull(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 revision:int('revision').notNull(),
 kind:longtext('kind').notNull(),
 title:longtext('title').notNull(),
 status:longtext('status').notNull(),
 jobId:varchar('job_id',{length:191}),
 opportunityId:varchar('opportunity_id',{length:191}),
 data:longtext('data').notNull(),
 actorId:longtext('actor_id').notNull(),
 reason:longtext('reason').notNull(),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_preparation_opportunity').on(t.organisationId,t.opportunityId),index('idx_preparation_job').on(t.organisationId,t.jobId),uniqueIndex('idx_preparation_revision').on(t.organisationId,t.id,t.revision)]);

export const qaSafetyRecords=mysqlTable('qa_safety_records',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_qa_safety_records_org').on(t.organisationId)]);

export const quoteRevisions=mysqlTable('quote_revisions',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_quote_revisions_org').on(t.organisationId)]);

export const rateLibraries=mysqlTable('rate_libraries',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_rate_libraries_org').on(t.organisationId)]);

export const shifts=mysqlTable('shifts',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_shifts_org').on(t.organisationId)]);

export const subcontractors=mysqlTable('subcontractors',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_subcontractors_org').on(t.organisationId)]);

export const suppliers=mysqlTable('suppliers',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_suppliers_org').on(t.organisationId)]);

export const tenderRequirements=mysqlTable('tender_requirements',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 opportunityId:varchar('opportunity_id',{length:191}).notNull(),
 title:longtext('title').notNull(),
 requirementType:longtext('requirement_type').notNull().default(sql`('Project-specific')`),
 sourceDocument:longtext('source_document').notNull().default(sql`('')`),
 sourcePage:longtext('source_page').notNull().default(sql`('')`),
 ownerUserId:longtext('owner_user_id'),
 dueDate:longtext('due_date'),
 status:varchar('status',{length:191}).notNull().default(sql`('Missing')`),
 mandatory:int('mandatory').notNull().default(sql`(1)`),
 clarification:longtext('clarification').notNull().default(sql`('')`),
 linkedDocumentId:longtext('linked_document_id'),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
 updatedAt:longtext('updated_at').notNull(),

 // V1 typed columns (0003). Legacy metadata is retained and read as a fallback.
 tenderId:varchar('tender_id',{length:191}),
 category:varchar('category',{length:40}),
 response:text('response'),
 riskFlag:int('risk_flag').notNull().default(0),
 origin:varchar('origin',{length:20}).notNull().default('manual'),
 confidence:double('confidence'),
 confirmedBy:varchar('confirmed_by',{length:191}),
 confirmedAt:varchar('confirmed_at',{length:40}),
 evidenceDocumentId:varchar('evidence_document_id',{length:191}),
 revision:int('revision').notNull().default(1),
},t=>[index('idx_tender_requirements_org_opp').on(t.organisationId,t.opportunityId,t.status),index('idx_tender_requirements_org_tender').on(t.organisationId,t.tenderId)]);

export const users=mysqlTable('users',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 email:longtext('email').notNull(),
 name:longtext('name').notNull(),
 role:longtext('role').notNull(),
 active:int('active').notNull().default(1),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_users_org').on(t.organisationId)]);

export const variations=mysqlTable('variations',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_variations_org').on(t.organisationId)]);

export const workPackages=mysqlTable('work_packages',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_work_packages_org').on(t.organisationId)]);

export const workers=mysqlTable('workers',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 name:longtext('name').notNull(),
 status:longtext('status').notNull().default(sql`('active')`),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
},t=>[index('idx_workers_org').on(t.organisationId)]);

export const workflowTasks=mysqlTable('workflow_tasks',{
 id:varchar('id',{length:191}).primaryKey(),
 organisationId:varchar('organisation_id',{length:191}).notNull(),
 title:longtext('title').notNull(),
 status:varchar('status',{length:191}).notNull().default(sql`('Open')`),
 ownerUserId:longtext('owner_user_id'),
 dueDate:varchar('due_date',{length:191}),
 entityType:longtext('entity_type').notNull(),
 entityId:longtext('entity_id').notNull(),
 metadata:longtext('metadata').notNull().default(sql`('{}')`),
 createdAt:longtext('created_at').notNull(),
 updatedAt:longtext('updated_at').notNull(),
},t=>[index('idx_workflow_tasks_org_status').on(t.organisationId,t.status,t.dueDate)]);
