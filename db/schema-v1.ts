// V1 typed business entities (migration 0003).
// Rules: every table carries organisation_id with an index; mutable entities
// carry revision/status/created_at/updated_at; approved revisions are append-only.
// Money is DECIMAL(15,2). Timestamps are ISO-8601 strings (matching legacy tables).
import {mysqlTable,varchar,longtext,text,int,double,decimal,bigint,index,uniqueIndex} from 'drizzle-orm/mysql-core';

const id=()=>varchar('id',{length:191}).primaryKey();
const org=()=>varchar('organisation_id',{length:191}).notNull();
const ref=(name:string)=>varchar(name,{length:191});
const money=(name:string)=>decimal(name,{precision:15,scale:2});
const stamp=(name:string)=>varchar(name,{length:40});
const day=(name:string)=>varchar(name,{length:10});
const lifecycle=()=>({
 revision:int('revision').notNull().default(1),
 createdBy:ref('created_by'),
 createdAt:stamp('created_at').notNull(),
 updatedAt:stamp('updated_at').notNull(),
});

// ---------------------------------------------------------------- platform
export const organisationEntitlements=mysqlTable('organisation_entitlements',{
 id:id(),organisationId:org(),
 module:varchar('module',{length:40}).notNull(),
 status:varchar('status',{length:20}).notNull(),
 source:varchar('source',{length:40}).notNull(),
 planCode:varchar('plan_code',{length:60}),
 validUntil:stamp('valid_until'),
 updatedBy:ref('updated_by'),
 createdAt:stamp('created_at').notNull(),updatedAt:stamp('updated_at').notNull(),
},t=>[uniqueIndex('idx_entitlements_org_module').on(t.organisationId,t.module)]);

export const auditLog=mysqlTable('audit_log',{
 id:id(),organisationId:org(),
 actorUserId:ref('actor_user_id'),
 actorEmail:varchar('actor_email',{length:254}),
 eventType:varchar('event_type',{length:120}).notNull(),
 entityType:varchar('entity_type',{length:60}).notNull(),
 entityId:ref('entity_id').notNull(),
 projectId:ref('project_id'),
 summary:varchar('summary',{length:500}).notNull().default(''),
 beforeState:longtext('before_state'),
 afterState:longtext('after_state'),
 createdAt:stamp('created_at').notNull(),
},t=>[index('idx_audit_log_org_created').on(t.organisationId,t.createdAt),index('idx_audit_log_org_entity').on(t.organisationId,t.entityType,t.entityId),index('idx_audit_log_org_project').on(t.organisationId,t.projectId,t.createdAt)]);

export const organisationProfiles=mysqlTable('organisation_profiles',{
 organisationId:varchar('organisation_id',{length:191}).primaryKey(),
 legalName:varchar('legal_name',{length:255}),
 tradingName:varchar('trading_name',{length:255}),
 abn:varchar('abn',{length:20}),
 abnVerification:varchar('abn_verification',{length:40}).notNull().default('format-checked'),
 registeredAddress:text('registered_address'),
 operatingAddress:text('operating_address'),
 businessActivities:text('business_activities'),
 disciplines:text('disciplines'),
 operatingRegions:text('operating_regions'),
 workforceSize:varchar('workforce_size',{length:40}),
 typicalProjectSize:varchar('typical_project_size',{length:60}),
 plantSummary:text('plant_summary'),
 keyClients:text('key_clients'),
 certifications:text('certifications'),
 tenderingActivity:varchar('tendering_activity',{length:60}),
 hseqMaturity:varchar('hseq_maturity',{length:60}),
 estimatingApproach:varchar('estimating_approach',{length:60}),
 riskMatrix:text('risk_matrix'),
 // 0004: official ABN lookup provenance and the organisation-level AI switch.
 abnLookupSource:varchar('abn_lookup_source',{length:40}),
 abnLookupAt:stamp('abn_lookup_at'),
 abnEntityName:varchar('abn_entity_name',{length:255}),
 abnEntityType:varchar('abn_entity_type',{length:120}),
 abnStatus:varchar('abn_status',{length:40}),
 gstRegisteredFrom:day('gst_registered_from'),
 aiEnabled:int('ai_enabled').notNull().default(0),
 aiEnabledBy:ref('ai_enabled_by'),
 aiEnabledAt:stamp('ai_enabled_at'),
 onboardingStep:int('onboarding_step').notNull().default(0),
 onboardingCompletedAt:stamp('onboarding_completed_at'),
 updatedBy:ref('updated_by'),
 ...lifecycle(),
});

export const documents=mysqlTable('documents',{
 id:id(),organisationId:org(),
 contextType:varchar('context_type',{length:40}).notNull(),
 contextId:ref('context_id'),
 projectId:ref('project_id'),
 category:varchar('category',{length:60}).notNull().default('General'),
 title:varchar('title',{length:255}).notNull(),
 fileName:varchar('file_name',{length:255}).notNull(),
 contentType:varchar('content_type',{length:120}).notNull(),
 sizeBytes:bigint('size_bytes',{mode:'number'}).notNull(),
 storageKey:varchar('storage_key',{length:512}).notNull(),
 sha256:varchar('sha256',{length:64}).notNull(),
 version:int('version').notNull().default(1),
 status:varchar('status',{length:20}).notNull().default('current'),
 visibility:varchar('visibility',{length:20}).notNull().default('office'),
 source:varchar('source',{length:40}).notNull().default('upload'),
 supersedesId:ref('supersedes_id'),
 uploadedBy:ref('uploaded_by'),
 createdAt:stamp('created_at').notNull(),updatedAt:stamp('updated_at').notNull(),
},t=>[index('idx_documents_org_context').on(t.organisationId,t.contextType,t.contextId),index('idx_documents_org_project').on(t.organisationId,t.projectId)]);

export const libraryItems=mysqlTable('library_items',{
 id:id(),organisationId:org(),
 category:varchar('category',{length:60}).notNull(),
 title:varchar('title',{length:255}).notNull(),
 description:text('description'),
 content:longtext('content'),
 documentId:ref('document_id'),
 expiryDate:day('expiry_date'),
 ownerUserId:ref('owner_user_id'),
 ownerName:varchar('owner_name',{length:160}),
 status:varchar('status',{length:20}).notNull().default('draft'),
 version:int('version').notNull().default(1),
 ...lifecycle(),
},t=>[index('idx_library_org_category').on(t.organisationId,t.category)]);

// ---------------------------------------------------------------- pipeline
export const tenders=mysqlTable('tenders',{
 id:id(),organisationId:org(),
 opportunityId:ref('opportunity_id').notNull(),
 reference:varchar('reference',{length:80}),
 title:varchar('title',{length:255}).notNull(),
 clientName:varchar('client_name',{length:255}),
 ownerUserId:ref('owner_user_id'),
 stage:varchar('stage',{length:30}).notNull().default('draft'),
 dueDate:varchar('due_date',{length:16}),
 estimatedValue:money('estimated_value'),
 location:varchar('location',{length:255}),
 scopeSummary:text('scope_summary'),
 estimateId:ref('estimate_id'),
 approvedEstimateRevisionId:ref('approved_estimate_revision_id'),
 approvalStatus:varchar('approval_status',{length:20}).notNull().default('not_requested'),
 approvalRequestedBy:ref('approval_requested_by'),
 approvalRequestedAt:stamp('approval_requested_at'),
 approvedBy:ref('approved_by'),
 approvedAt:stamp('approved_at'),
 approvalNotes:text('approval_notes'),
 submittedAt:stamp('submitted_at'),
 submittedBy:ref('submitted_by'),
 submissionMethod:varchar('submission_method',{length:60}),
 submissionVersion:varchar('submission_version',{length:40}),
 submissionNotes:text('submission_notes'),
 submissionDocumentId:ref('submission_document_id'),
 submissionOverrideReason:text('submission_override_reason'),
 outcomeAt:stamp('outcome_at'),
 outcomeReason:text('outcome_reason'),
 projectId:ref('project_id'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_tenders_org_opportunity').on(t.organisationId,t.opportunityId),index('idx_tenders_org_stage').on(t.organisationId,t.stage)]);

export const tenderBidReviews=mysqlTable('tender_bid_reviews',{
 id:id(),organisationId:org(),
 tenderId:ref('tender_id').notNull(),
 strategicFit:text('strategic_fit'),capacity:text('capacity'),capability:text('capability'),
 clientAssessment:text('client_assessment'),locationAssessment:text('location_assessment'),
 contractRisks:text('contract_risks'),programme:text('programme'),resources:text('resources'),
 commercialRisks:text('commercial_risks'),hseqRisks:text('hseq_risks'),competition:text('competition'),
 recommendation:varchar('recommendation',{length:20}),
 recommendationReason:text('recommendation_reason'),
 decision:varchar('decision',{length:20}).notNull().default('pending'),
 decidedBy:ref('decided_by'),decidedAt:stamp('decided_at'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_bid_reviews_org_tender').on(t.organisationId,t.tenderId)]);

export const tenderReturnables=mysqlTable('tender_returnables',{
 id:id(),organisationId:org(),
 tenderId:ref('tender_id').notNull(),
 requirementId:ref('requirement_id'),
 title:varchar('title',{length:255}).notNull(),
 category:varchar('category',{length:40}).notNull().default('schedule'),
 mandatory:int('mandatory').notNull().default(1),
 assigneeUserId:ref('assignee_user_id'),
 dueDate:day('due_date'),
 status:varchar('status',{length:20}).notNull().default('not_started'),
 documentId:ref('document_id'),
 libraryItemId:ref('library_item_id'),
 notes:text('notes'),
 completedBy:ref('completed_by'),completedAt:stamp('completed_at'),
 ...lifecycle(),
},t=>[index('idx_returnables_org_tender').on(t.organisationId,t.tenderId)]);

export const tenderClarifications=mysqlTable('tender_clarifications',{
 id:id(),organisationId:org(),
 tenderId:ref('tender_id').notNull(),
 reference:varchar('reference',{length:60}),
 receivedDate:day('received_date'),dueDate:day('due_date'),
 source:varchar('source',{length:160}),
 question:text('question').notNull(),
 ownerUserId:ref('owner_user_id'),
 response:text('response'),
 submittedDate:day('submitted_date'),
 documentId:ref('document_id'),
 scopeImpact:text('scope_impact'),
 priceImpact:money('price_impact'),
 status:varchar('status',{length:20}).notNull().default('open'),
 ...lifecycle(),
},t=>[index('idx_clarifications_org_tender').on(t.organisationId,t.tenderId)]);

// ---------------------------------------------------------------- estimating
export const estimateRevisions=mysqlTable('estimate_revisions',{
 id:id(),organisationId:org(),
 estimateId:ref('estimate_id').notNull(),
 revisionNumber:int('revision_number').notNull(),
 status:varchar('status',{length:20}).notNull(),
 snapshot:longtext('snapshot').notNull(),
 totals:longtext('totals').notNull(),
 directCost:money('direct_cost').notNull(),
 indirectCost:money('indirect_cost').notNull(),
 contingency:money('contingency').notNull(),
 grossProfit:money('gross_profit').notNull(),
 sellPrice:money('sell_price').notNull(),
 grossMarginPct:double('gross_margin_pct').notNull(),
 labourCost:money('labour_cost').notNull(),
 plantCost:money('plant_cost').notNull(),
 materialCost:money('material_cost').notNull(),
 subcontractCost:money('subcontract_cost').notNull(),
 otherCost:money('other_cost').notNull(),
 assumptions:text('assumptions'),
 exclusions:text('exclusions'),
 submittedBy:ref('submitted_by'),submittedAt:stamp('submitted_at'),
 approvedBy:ref('approved_by'),approvedAt:stamp('approved_at'),
 decisionNotes:text('decision_notes'),
 supersededAt:stamp('superseded_at'),
 createdAt:stamp('created_at').notNull(),updatedAt:stamp('updated_at').notNull(),
},t=>[uniqueIndex('idx_estimate_revisions_unique').on(t.organisationId,t.estimateId,t.revisionNumber),index('idx_estimate_revisions_status').on(t.organisationId,t.estimateId,t.status)]);

// ---------------------------------------------------------------- projects
export const projectBaselines=mysqlTable('project_baselines',{
 id:id(),organisationId:org(),
 projectId:ref('project_id').notNull(),
 revision:int('revision').notNull(),
 reason:varchar('reason',{length:255}).notNull(),
 sourceType:varchar('source_type',{length:30}).notNull(),
 tenderId:ref('tender_id'),estimateId:ref('estimate_id'),estimateRevisionId:ref('estimate_revision_id'),variationId:ref('variation_id'),
 contractValue:money('contract_value').notNull(),
 budgetLabour:money('budget_labour').notNull(),budgetPlant:money('budget_plant').notNull(),
 budgetMaterial:money('budget_material').notNull(),budgetSubcontract:money('budget_subcontract').notNull(),
 budgetOther:money('budget_other').notNull(),budgetIndirect:money('budget_indirect').notNull(),
 budgetTotal:money('budget_total').notNull(),
 scope:text('scope'),assumptions:text('assumptions'),exclusions:text('exclusions'),
 clarifications:longtext('clarifications'),
 snapshot:longtext('snapshot'),
 createdBy:ref('created_by'),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_baselines_unique').on(t.organisationId,t.projectId,t.revision)]);

export const projectCostCodes=mysqlTable('project_cost_codes',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 code:varchar('code',{length:40}).notNull(),
 description:varchar('description',{length:255}).notNull(),
 category:varchar('category',{length:20}).notNull().default('other'),
 budgetAmount:money('budget_amount').notNull().default('0'),
 status:varchar('status',{length:20}).notNull().default('active'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_cost_codes_unique').on(t.organisationId,t.projectId,t.code)]);

export const projectContacts=mysqlTable('project_contacts',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 contactType:varchar('contact_type',{length:20}).notNull().default('team'),
 name:varchar('name',{length:160}).notNull(),
 role:varchar('role',{length:120}),
 organisationName:varchar('organisation_name',{length:160}),
 email:varchar('email',{length:254}),phone:varchar('phone',{length:60}),
 userId:ref('user_id'),
 status:varchar('status',{length:20}).notNull().default('active'),
 ...lifecycle(),
},t=>[index('idx_contacts_org_project').on(t.organisationId,t.projectId)]);

export const projectChecklistItems=mysqlTable('project_checklist_items',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 phase:varchar('phase',{length:20}).notNull(),
 category:varchar('category',{length:40}).notNull(),
 title:varchar('title',{length:255}).notNull(),
 mandatory:int('mandatory').notNull().default(1),
 status:varchar('status',{length:20}).notNull().default('open'),
 source:varchar('source',{length:30}).notNull().default('manual'),
 sourceRef:ref('source_ref'),
 ownerUserId:ref('owner_user_id'),dueDate:day('due_date'),
 evidenceDocumentId:ref('evidence_document_id'),
 notes:text('notes'),
 completedBy:ref('completed_by'),completedAt:stamp('completed_at'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_checklist_unique').on(t.organisationId,t.projectId,t.phase,t.title)]);

// ---------------------------------------------------------------- IMS / HSEQ
export const risks=mysqlTable('risks',{
 id:id(),organisationId:org(),projectId:ref('project_id'),
 reference:varchar('reference',{length:40}),
 title:varchar('title',{length:255}).notNull(),
 category:varchar('category',{length:40}).notNull().default('safety'),
 cause:text('cause'),consequenceText:text('consequence_text'),
 initialLikelihood:int('initial_likelihood'),initialConsequence:int('initial_consequence'),initialRating:varchar('initial_rating',{length:20}),
 controls:text('controls'),
 residualLikelihood:int('residual_likelihood'),residualConsequence:int('residual_consequence'),residualRating:varchar('residual_rating',{length:20}),
 ownerUserId:ref('owner_user_id'),ownerName:varchar('owner_name',{length:160}),
 reviewDate:day('review_date'),
 status:varchar('status',{length:20}).notNull().default('open'),
 origin:varchar('origin',{length:20}).notNull().default('manual'),
 controlsApprovedBy:ref('controls_approved_by'),controlsApprovedAt:stamp('controls_approved_at'),
 ...lifecycle(),
},t=>[index('idx_risks_org_project').on(t.organisationId,t.projectId)]);

export const swms=mysqlTable('swms',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 reference:varchar('reference',{length:40}),
 title:varchar('title',{length:255}).notNull(),
 activity:varchar('activity',{length:255}).notNull(),
 status:varchar('status',{length:20}).notNull().default('draft'),
 currentRevisionId:ref('current_revision_id'),
 currentRevisionNumber:int('current_revision_number').notNull().default(1),
 issuedRevisionId:ref('issued_revision_id'),
 ...lifecycle(),
},t=>[index('idx_swms_org_project').on(t.organisationId,t.projectId)]);

export const swmsRevisions=mysqlTable('swms_revisions',{
 id:id(),organisationId:org(),swmsId:ref('swms_id').notNull(),
 revisionNumber:int('revision_number').notNull(),
 status:varchar('status',{length:20}).notNull(),
 content:longtext('content').notNull(),
 origin:varchar('origin',{length:20}).notNull().default('manual'),
 changeReason:varchar('change_reason',{length:500}),
 submittedBy:ref('submitted_by'),submittedAt:stamp('submitted_at'),
 approvedBy:ref('approved_by'),approvedAt:stamp('approved_at'),
 issuedBy:ref('issued_by'),issuedAt:stamp('issued_at'),
 supersededAt:stamp('superseded_at'),
 createdBy:ref('created_by'),createdAt:stamp('created_at').notNull(),updatedAt:stamp('updated_at').notNull(),
},t=>[uniqueIndex('idx_swms_revisions_unique').on(t.organisationId,t.swmsId,t.revisionNumber)]);

export const swmsAcknowledgements=mysqlTable('swms_acknowledgements',{
 id:id(),organisationId:org(),
 swmsId:ref('swms_id').notNull(),swmsRevisionId:ref('swms_revision_id').notNull(),
 userId:ref('user_id').notNull(),workerName:varchar('worker_name',{length:160}).notNull(),
 shiftId:ref('shift_id'),
 acknowledgedAt:stamp('acknowledged_at').notNull(),
},t=>[uniqueIndex('idx_swms_ack_unique').on(t.organisationId,t.swmsRevisionId,t.userId)]);

export const itps=mysqlTable('itps',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 reference:varchar('reference',{length:40}),
 title:varchar('title',{length:255}).notNull(),
 activity:varchar('activity',{length:255}),
 specification:varchar('specification',{length:255}),
 status:varchar('status',{length:20}).notNull().default('draft'),
 ...lifecycle(),
},t=>[index('idx_itps_org_project').on(t.organisationId,t.projectId)]);

export const itpItems=mysqlTable('itp_items',{
 id:id(),organisationId:org(),itpId:ref('itp_id').notNull(),projectId:ref('project_id').notNull(),
 sequence:int('sequence').notNull().default(1),
 inspection:text('inspection').notNull(),
 acceptanceCriteria:text('acceptance_criteria'),
 reference:varchar('reference',{length:160}),
 responsibility:varchar('responsibility',{length:160}),
 pointType:varchar('point_type',{length:10}).notNull().default('none'),
 assignedUserId:ref('assigned_user_id'),
 status:varchar('status',{length:20}).notNull().default('open'),
 result:text('result'),comments:text('comments'),
 evidenceDocumentId:ref('evidence_document_id'),
 completedBy:ref('completed_by'),completedAt:stamp('completed_at'),
 releasedBy:ref('released_by'),releasedAt:stamp('released_at'),
 ...lifecycle(),
},t=>[index('idx_itp_items_org_itp').on(t.organisationId,t.itpId),index('idx_itp_items_org_assignee').on(t.organisationId,t.assignedUserId)]);

export const hseqIncidents=mysqlTable('hseq_incidents',{
 id:id(),organisationId:org(),projectId:ref('project_id'),
 reference:varchar('reference',{length:40}),
 incidentType:varchar('incident_type',{length:40}).notNull(),
 severity:varchar('severity',{length:20}).notNull().default('minor'),
 occurredAt:varchar('occurred_at',{length:16}).notNull(),
 description:text('description').notNull(),
 immediateAction:text('immediate_action'),
 personsInvolved:text('persons_involved'),
 evidenceDocumentId:ref('evidence_document_id'),
 status:varchar('status',{length:20}).notNull().default('reported'),
 reportedBy:ref('reported_by'),
 ...lifecycle(),
},t=>[index('idx_incidents_org_project').on(t.organisationId,t.projectId)]);

export const hseqNcrs=mysqlTable('hseq_ncrs',{
 id:id(),organisationId:org(),projectId:ref('project_id'),
 reference:varchar('reference',{length:40}),
 issue:text('issue').notNull(),
 requirement:text('requirement'),cause:text('cause'),
 correctiveAction:text('corrective_action'),
 ownerUserId:ref('owner_user_id'),ownerName:varchar('owner_name',{length:160}),
 dueDate:day('due_date'),
 verification:text('verification'),
 status:varchar('status',{length:20}).notNull().default('open'),
 closedBy:ref('closed_by'),closedAt:stamp('closed_at'),
 ...lifecycle(),
},t=>[index('idx_ncrs_org_project').on(t.organisationId,t.projectId)]);

export const hseqActions=mysqlTable('hseq_actions',{
 id:id(),organisationId:org(),projectId:ref('project_id'),
 sourceType:varchar('source_type',{length:20}).notNull().default('other'),
 sourceId:ref('source_id'),
 action:text('action').notNull(),
 ownerUserId:ref('owner_user_id'),ownerName:varchar('owner_name',{length:160}),
 dueDate:day('due_date'),
 status:varchar('status',{length:20}).notNull().default('open'),
 completionNotes:text('completion_notes'),
 completionDocumentId:ref('completion_document_id'),
 completedBy:ref('completed_by'),completedAt:stamp('completed_at'),
 ...lifecycle(),
},t=>[index('idx_actions_org_project').on(t.organisationId,t.projectId,t.status)]);

// ---------------------------------------------------------------- money
export const costTransactions=mysqlTable('cost_transactions',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 costCode:varchar('cost_code',{length:40}),
 category:varchar('category',{length:20}).notNull(),
 sourceType:varchar('source_type',{length:20}).notNull(),
 sourceId:ref('source_id').notNull(),
 sourceLine:varchar('source_line',{length:60}).notNull(),
 description:varchar('description',{length:500}).notNull(),
 quantity:double('quantity').notNull().default(0),
 unit:varchar('unit',{length:20}),
 rate:money('rate'),
 amount:money('amount').notNull(),
 transactionDate:day('transaction_date').notNull(),
 status:varchar('status',{length:20}).notNull().default('actual'),
 createdBy:ref('created_by'),createdAt:stamp('created_at').notNull(),updatedAt:stamp('updated_at').notNull(),
},t=>[uniqueIndex('idx_cost_source_unique').on(t.organisationId,t.sourceType,t.sourceId,t.sourceLine),index('idx_cost_org_project').on(t.organisationId,t.projectId,t.status)]);

export const projectVariations=mysqlTable('project_variations',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 number:int('number').notNull(),
 reference:varchar('reference',{length:40}).notNull(),
 title:varchar('title',{length:255}).notNull(),
 description:text('description'),
 cause:varchar('cause',{length:60}),
 instructionSource:text('instruction_source'),
 clientReference:varchar('client_reference',{length:120}),
 noticeDate:day('notice_date'),submittedDate:day('submitted_date'),
 value:money('value').notNull().default('0'),
 cost:money('cost').notNull().default('0'),
 approvedValue:money('approved_value'),
 status:varchar('status',{length:20}).notNull().default('draft'),
 approvedBy:ref('approved_by'),approvedAt:stamp('approved_at'),
 decisionReason:text('decision_reason'),
 linkedDocketIds:text('linked_docket_ids'),
 origin:varchar('origin',{length:20}).notNull().default('manual'),
 originRef:ref('origin_ref'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_variations_unique').on(t.organisationId,t.projectId,t.number),uniqueIndex('idx_variations_origin').on(t.organisationId,t.origin,t.originRef)]);

export const progressClaims=mysqlTable('progress_claims',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 number:int('number').notNull(),
 period:varchar('period',{length:7}).notNull(),
 claimDate:day('claim_date'),
 status:varchar('status',{length:30}).notNull().default('draft'),
 grossAmount:money('gross_amount').notNull().default('0'),
 certifiedAmount:money('certified_amount'),
 // 0004 retention: amounts are ex-GST. Net = gross - retention withheld + retention released.
 retentionWithheld:money('retention_withheld').notNull().default('0'),
 retentionReleased:money('retention_released').notNull().default('0'),
 retentionReleaseReason:text('retention_release_reason'),
 netAmount:money('net_amount'),
 certifiedRetention:money('certified_retention'),
 certifiedNet:money('certified_net'),
 approvedBy:ref('approved_by'),approvedAt:stamp('approved_at'),
 submittedBy:ref('submitted_by'),submittedAt:stamp('submitted_at'),
 certifiedBy:ref('certified_by'),certifiedAt:stamp('certified_at'),
 notes:text('notes'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_claims_unique').on(t.organisationId,t.projectId,t.number)]);

export const claimLines=mysqlTable('claim_lines',{
 id:id(),organisationId:org(),claimId:ref('claim_id').notNull(),projectId:ref('project_id').notNull(),
 lineType:varchar('line_type',{length:20}).notNull(),
 sourceId:ref('source_id'),
 exclusiveKey:ref('exclusive_key'),
 description:varchar('description',{length:500}).notNull(),
 contractValue:money('contract_value').notNull().default('0'),
 previousClaimed:money('previous_claimed').notNull().default('0'),
 thisClaim:money('this_claim').notNull().default('0'),
 claimedToDate:money('claimed_to_date').notNull().default('0'),
 createdAt:stamp('created_at').notNull(),
},t=>[index('idx_claim_lines_org_claim').on(t.organisationId,t.claimId),uniqueIndex('idx_claim_lines_exclusive').on(t.organisationId,t.exclusiveKey),index('idx_claim_lines_org_source').on(t.organisationId,t.lineType,t.sourceId)]);

export const clientInvoices=mysqlTable('client_invoices',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),
 claimId:ref('claim_id'),
 invoiceNumber:varchar('invoice_number',{length:60}).notNull(),
 invoiceDate:day('invoice_date').notNull(),
 dueDate:day('due_date'),
 amountExGst:money('amount_ex_gst').notNull(),
 gst:money('gst').notNull(),
 total:money('total').notNull(),
 status:varchar('status',{length:20}).notNull().default('draft'),
 paidDate:day('paid_date'),
 paidAmount:money('paid_amount').notNull().default('0'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_invoices_number').on(t.organisationId,t.invoiceNumber),uniqueIndex('idx_invoices_claim').on(t.organisationId,t.claimId),index('idx_invoices_org_project').on(t.organisationId,t.projectId)]);

// ---------------------------------------------------------------- resources (0004)
// Workers, plant and shifts keep their legacy tables and IDs and gain typed
// columns (db/schema.ts). These tables hold the one-to-many parts.
export const workerCompetencies=mysqlTable('worker_competencies',{
 id:id(),organisationId:org(),workerId:ref('worker_id').notNull(),
 competencyType:varchar('competency_type',{length:160}).notNull(),
 reference:varchar('reference',{length:120}),
 issuedDate:day('issued_date'),
 expiryDate:day('expiry_date'),
 documentId:ref('document_id'),
 status:varchar('status',{length:20}).notNull().default('current'),
 source:varchar('source',{length:20}).notNull().default('manual'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_competencies_unique').on(t.organisationId,t.workerId,t.competencyType),index('idx_competencies_org_expiry').on(t.organisationId,t.expiryDate)]);

export const shiftAssignments=mysqlTable('shift_assignments',{
 id:id(),organisationId:org(),shiftId:ref('shift_id').notNull(),
 resourceType:varchar('resource_type',{length:20}).notNull(),
 resourceId:ref('resource_id').notNull(),
 role:varchar('role',{length:80}),
 startTime:varchar('start_time',{length:5}),
 finishTime:varchar('finish_time',{length:5}),
 source:varchar('source',{length:20}).notNull().default('manual'),
 createdBy:ref('created_by'),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_assignments_unique').on(t.organisationId,t.shiftId,t.resourceType,t.resourceId),index('idx_assignments_org_resource').on(t.organisationId,t.resourceType,t.resourceId)]);

// Records a legacy row that could not be migrated cleanly. Never deleted by code.
export const dataMigrationIssues=mysqlTable('data_migration_issues',{
 id:id(),organisationId:org(),
 migration:varchar('migration',{length:60}).notNull(),
 entityType:varchar('entity_type',{length:40}).notNull(),
 entityId:ref('entity_id').notNull(),
 field:varchar('field',{length:80}).notNull(),
 issue:varchar('issue',{length:500}).notNull(),
 legacyValue:text('legacy_value'),
 status:varchar('status',{length:20}).notNull().default('open'),
 resolvedBy:ref('resolved_by'),resolvedAt:stamp('resolved_at'),
 createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_migration_issues_unique').on(t.organisationId,t.migration,t.entityType,t.entityId,t.field),index('idx_migration_issues_org_status').on(t.organisationId,t.status)]);

// Offline/field sync idempotency: one row per client-generated request id.
export const clientRequests=mysqlTable('client_requests',{
 id:id(),organisationId:org(),
 clientRequestId:varchar('client_request_id',{length:80}).notNull(),
 userId:ref('user_id').notNull(),
 kind:varchar('kind',{length:40}).notNull(),
 entityType:varchar('entity_type',{length:40}),
 entityId:ref('entity_id'),
 status:varchar('status',{length:20}).notNull(),
 responseStatus:int('response_status').notNull().default(200),
 response:text('response'),
 createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_client_requests_unique').on(t.organisationId,t.clientRequestId),index('idx_client_requests_org_user').on(t.organisationId,t.userId)]);

// ---------------------------------------------------------------- AI (0004, not activated)
// Idempotent usage ledger: one row per (organisation, idempotency key).
export const aiUsageLedger=mysqlTable('ai_usage_ledger',{
 id:id(),organisationId:org(),
 idempotencyKey:varchar('idempotency_key',{length:120}).notNull(),
 feature:varchar('feature',{length:60}).notNull(),
 provider:varchar('provider',{length:40}).notNull(),
 model:varchar('model',{length:120}),
 status:varchar('status',{length:20}).notNull(),
 inputTokens:int('input_tokens').notNull().default(0),
 outputTokens:int('output_tokens').notNull().default(0),
 error:varchar('error',{length:500}),
 entityType:varchar('entity_type',{length:40}),
 entityId:ref('entity_id'),
 requestedBy:ref('requested_by').notNull(),
 createdAt:stamp('created_at').notNull(),
 completedAt:stamp('completed_at'),
},t=>[uniqueIndex('idx_ai_ledger_key').on(t.organisationId,t.idempotencyKey),index('idx_ai_ledger_org_created').on(t.organisationId,t.createdAt)]);

// AI output is only ever a suggestion, linked to its source and the ledger entry.
export const aiSuggestions=mysqlTable('ai_suggestions',{
 id:id(),organisationId:org(),
 ledgerId:ref('ledger_id').notNull(),
 feature:varchar('feature',{length:60}).notNull(),
 entityType:varchar('entity_type',{length:40}).notNull(),
 entityId:ref('entity_id').notNull(),
 field:varchar('field',{length:80}),
 content:text('content').notNull(),
 sourceDocumentId:ref('source_document_id'),
 sourceLocation:varchar('source_location',{length:120}),
 confidence:double('confidence'),
 extractedAt:stamp('extracted_at').notNull(),
 status:varchar('status',{length:20}).notNull().default('suggested'),
 decidedBy:ref('decided_by'),decidedAt:stamp('decided_at'),
 appliedEntityId:ref('applied_entity_id'),
 createdAt:stamp('created_at').notNull(),
},t=>[index('idx_ai_suggestions_org_entity').on(t.organisationId,t.entityType,t.entityId),index('idx_ai_suggestions_org_status').on(t.organisationId,t.status)]);

// ---------------------------------------------------------------- billing (0004, provider-neutral)
export const billingCustomers=mysqlTable('billing_customers',{
 id:id(),organisationId:org(),
 provider:varchar('provider',{length:40}).notNull(),
 providerCustomerId:varchar('provider_customer_id',{length:191}),
 billingEmail:varchar('billing_email',{length:254}),
 ...lifecycle(),
},t=>[uniqueIndex('idx_billing_customers_org_provider').on(t.organisationId,t.provider),index('idx_billing_customers_provider_id').on(t.provider,t.providerCustomerId)]);

export const billingSubscriptions=mysqlTable('billing_subscriptions',{
 id:id(),organisationId:org(),
 provider:varchar('provider',{length:40}).notNull(),
 providerSubscriptionId:varchar('provider_subscription_id',{length:191}),
 planCode:varchar('plan_code',{length:60}).notNull(),
 status:varchar('status',{length:20}).notNull(),
 modules:text('modules').notNull(),
 trialEndsAt:stamp('trial_ends_at'),
 currentPeriodEnd:stamp('current_period_end'),
 cancelAt:stamp('cancel_at'),
 cancelledAt:stamp('cancelled_at'),
 lastPaymentFailedAt:stamp('last_payment_failed_at'),
 changedBy:ref('changed_by'),
 ...lifecycle(),
},t=>[index('idx_billing_subscriptions_org').on(t.organisationId,t.status),uniqueIndex('idx_billing_subscriptions_provider').on(t.provider,t.providerSubscriptionId)]);

// Every webhook delivery is logged once (unique provider event id) before it is applied.
export const billingEvents=mysqlTable('billing_events',{
 id:id(),organisationId:org(),
 provider:varchar('provider',{length:40}).notNull(),
 eventId:varchar('event_id',{length:191}).notNull(),
 eventType:varchar('event_type',{length:120}).notNull(),
 signatureValid:int('signature_valid').notNull(),
 status:varchar('status',{length:20}).notNull(),
 error:varchar('error',{length:500}),
 payload:text('payload').notNull(),
 receivedAt:stamp('received_at').notNull(),
 processedAt:stamp('processed_at'),
},t=>[uniqueIndex('idx_billing_events_unique').on(t.provider,t.eventId),index('idx_billing_events_org').on(t.organisationId,t.receivedAt)]);

// Records each one-off data backfill run by scripts/migrate.mjs (append-only).
export const appBackfills=mysqlTable('app_backfills',{
 id:id(),organisationId:org(),
 name:varchar('name',{length:80}).notNull(),
 status:varchar('status',{length:20}).notNull(),
 counts:text('counts').notNull(),
 startedAt:stamp('started_at').notNull(),
 completedAt:stamp('completed_at'),
},t=>[index('idx_app_backfills_org_name').on(t.organisationId,t.name)]);
