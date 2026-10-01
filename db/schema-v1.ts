// V1 typed business entities (migration 0003).
// Rules: every table carries organisation_id with an index; mutable entities
// carry revision/status/created_at/updated_at; approved revisions are append-only.
// Money is DECIMAL(15,2). Timestamps are ISO-8601 strings (matching legacy tables).
import {mysqlTable,varchar,char,longtext,text,int,double,decimal,bigint,index,uniqueIndex} from 'drizzle-orm/mysql-core';

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
// Divisions (migration 0023): a reporting/filtering dimension inside ONE organisation. Clients, people and
// plant stay organisation-level and shared; a division never grants access.
export const businessUnits=mysqlTable('business_units',{
 id:id(),organisationId:org(),
 name:varchar('name',{length:120}).notNull(),
 nameKey:varchar('name_key',{length:120}).notNull(),
 code:varchar('code',{length:20}).notNull(),
 description:text('description'),
 status:varchar('status',{length:20}).notNull().default('active'),
 isDefault:int('is_default').notNull().default(0),
 sortOrder:int('sort_order').notNull().default(0),
 archivedAt:stamp('archived_at'),
 ...lifecycle(),
},t=>[index('idx_business_units_org').on(t.organisationId,t.status),uniqueIndex('uq_business_units_code').on(t.organisationId,t.code),uniqueIndex('uq_business_units_name').on(t.organisationId,t.nameKey)]);
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
 registeredLocationId:ref('registered_location_id'),
 operatingLocationId:ref('operating_location_id'),
 businessActivities:text('business_activities'),
 disciplines:text('disciplines'),
 operatingRegions:text('operating_regions'),
 timezone:varchar('timezone',{length:80}),
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

// ---------------------------------------------------------------- document engine (migration 0022)
// Managed document (durable business record) → immutable versions → physical file in `documents`.
// `documents` rows stay the storage/integrity layer and keep every raw id; their legacy
// version/status/supersedes_id columns are compatibility mirrors written by the managed service.
export const managedDocuments=mysqlTable('managed_documents',{
 id:id(),organisationId:org(),title:varchar('title',{length:255}).notNull(),description:text('description'),
 documentNumber:varchar('document_number',{length:80}),documentType:varchar('document_type',{length:80}),discipline:varchar('discipline',{length:80}),tags:text('tags'),
 status:varchar('status',{length:20}).notNull().default('active'),currentVersionId:ref('current_version_id'),
 // The single authoritative access context (same vocabulary as documents.context_type). Links never widen it.
 contextType:varchar('context_type',{length:40}).notNull(),contextId:ref('context_id'),projectId:ref('project_id'),
 source:varchar('source',{length:40}).notNull().default('upload'),
 ...lifecycle(),
},t=>[index('idx_managed_documents_org').on(t.organisationId,t.status,t.updatedAt),index('idx_managed_documents_context').on(t.organisationId,t.contextType,t.contextId),index('idx_managed_documents_project').on(t.organisationId,t.projectId),index('idx_managed_documents_number').on(t.organisationId,t.documentNumber)]);
export const documentVersions=mysqlTable('document_versions',{
 id:id(),organisationId:org(),managedDocumentId:ref('managed_document_id').notNull(),versionNumber:int('version_number').notNull(),
 revisionLabel:varchar('revision_label',{length:40}),fileDocumentId:ref('file_document_id').notNull(),sha256:varchar('sha256',{length:64}).notNull(),
 issueDate:day('issue_date'),author:varchar('author',{length:120}),company:varchar('company',{length:120}),changeNote:text('change_note'),
 createdBy:ref('created_by'),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_document_versions_seq').on(t.organisationId,t.managedDocumentId,t.versionNumber),uniqueIndex('idx_document_versions_file').on(t.organisationId,t.fileDocumentId),index('idx_document_versions_org').on(t.organisationId)]);
export const documentLinks=mysqlTable('document_links',{
 id:id(),organisationId:org(),managedDocumentId:ref('managed_document_id').notNull(),targetType:varchar('target_type',{length:40}).notNull(),targetId:ref('target_id').notNull(),
 relationship:varchar('relationship',{length:40}).notNull().default('reference'),projectId:ref('project_id'),createdBy:ref('created_by'),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_document_links_unique').on(t.organisationId,t.managedDocumentId,t.targetType,t.targetId),index('idx_document_links_target').on(t.organisationId,t.targetType,t.targetId),index('idx_document_links_project').on(t.organisationId,t.projectId)]);

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

// ---------------------------------------------------------------- core locations (0017)
// One structured location model for every business address (client sites, projects, shift
// work points, depots, company addresses, incidents). An address identifies the general site;
// the pin identifies exactly where the work is: the provider's geocoded point is kept next to
// the operational pin the user chose. owner_type/owner_id record which record a location
// belongs to, so access is always decided through that owner (there is no global lookup).
const coord=(name:string)=>decimal(name,{precision:10,scale:7});
export const locations=mysqlTable('locations',{
 id:id(),organisationId:org(),
 ownerType:varchar('owner_type',{length:30}).notNull(),
 ownerId:ref('owner_id').notNull(),
 locationType:varchar('location_type',{length:30}).notNull().default('site'),
 label:varchar('label',{length:255}),
 formattedAddress:varchar('formatted_address',{length:500}),
 addressLine1:varchar('address_line1',{length:255}),
 addressLine2:varchar('address_line2',{length:255}),
 locality:varchar('locality',{length:120}),
 state:varchar('state',{length:60}),
 postcode:varchar('postcode',{length:20}),
 country:varchar('country',{length:2}),
 provider:varchar('provider',{length:20}),
 providerPlaceId:varchar('provider_place_id',{length:255}),
 precision:varchar('precision',{length:30}),
 geocodedLat:coord('geocoded_lat'),geocodedLng:coord('geocoded_lng'),
 pinLat:coord('pin_lat'),pinLng:coord('pin_lng'),
 pinAdjusted:int('pin_adjusted').notNull().default(0),
 pinAddress:varchar('pin_address',{length:500}),
 source:varchar('source',{length:20}).notNull().default('manual'),
 geocodedAt:stamp('geocoded_at'),
 reverseGeocodedAt:stamp('reverse_geocoded_at'),
 ...lifecycle(),
},t=>[index('idx_locations_org').on(t.organisationId),index('idx_locations_org_owner').on(t.organisationId,t.ownerType,t.ownerId)]);

// Depots and yards: operational bases (future proximity, travel and mobilisation).
export const depots=mysqlTable('depots',{
 id:id(),organisationId:org(),name:varchar('name',{length:160}).notNull(),
 locationId:ref('location_id'),notes:text('notes'),
 status:varchar('status',{length:20}).notNull().default('active'),
 ...lifecycle(),
},t=>[index('idx_depots_org').on(t.organisationId)]);

// ---------------------------------------------------------------- core clients & sites (0006)
// Client lives in the legacy `clients` table (db/schema.ts) with typed columns.
// A site belongs to a client when known; opportunities, tenders and projects
// reference both and keep a text snapshot (client_name, location/site_address).
export const clientSites=mysqlTable('client_sites',{
 id:id(),organisationId:org(),
 clientId:ref('client_id'),
 name:varchar('name',{length:255}).notNull(),
 address:varchar('address',{length:500}),
 suburb:varchar('suburb',{length:120}),
 state:varchar('state',{length:20}),
 postcode:varchar('postcode',{length:10}),
 siteContact:varchar('site_contact',{length:160}),
 accessNotes:text('access_notes'),
 locationId:ref('location_id'),
 status:varchar('status',{length:20}).notNull().default('active'),
 ...lifecycle(),
},t=>[index('idx_client_sites_org').on(t.organisationId),index('idx_client_sites_org_client').on(t.organisationId,t.clientId)]);

// Contacts belong to a client (0007). The client's legacy contact_name/email/phone stay as
// its quick primary contact; this table holds everyone else.
export const clientContacts=mysqlTable('client_contacts',{
 id:id(),organisationId:org(),
 clientId:ref('client_id').notNull(),
 name:varchar('name',{length:160}).notNull(),
 firstName:varchar('first_name',{length:80}),
 lastName:varchar('last_name',{length:80}),
 department:varchar('department',{length:120}),
 role:varchar('role',{length:120}),
 email:varchar('email',{length:254}),
 phone:varchar('phone',{length:60}),
 mobile:varchar('mobile',{length:60}),
 isPrimary:int('is_primary').notNull().default(0),
 notes:text('notes'),
 status:varchar('status',{length:20}).notNull().default('active'),
 ...lifecycle(),
},t=>[index('idx_client_contacts_org').on(t.organisationId),index('idx_client_contacts_org_client').on(t.organisationId,t.clientId)]);

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
 // 0023: owning division; flows to the estimate and, on award, the project.
 businessUnitId:ref('business_unit_id'),
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
 clientId:ref('client_id'),siteId:ref('site_id'),contactId:ref('contact_id'),
 ...lifecycle(),
},t=>[index('idx_tenders_business_unit').on(t.organisationId,t.businessUnitId),uniqueIndex('idx_tenders_org_opportunity').on(t.organisationId,t.opportunityId),index('idx_tenders_org_stage').on(t.organisationId,t.stage),index('idx_tenders_org_client').on(t.organisationId,t.clientId)]);

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

// Project team: which users work on which project, and in what project role. The
// application role (users.role) says what someone may do; membership says where.
export const projectMembers=mysqlTable('project_members',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),userId:ref('user_id').notNull(),
 projectRole:varchar('project_role',{length:30}).notNull(),
 active:int('active').notNull().default(1),
 ...lifecycle(),
},t=>[index('idx_project_members_org').on(t.organisationId),uniqueIndex('idx_project_members_unique').on(t.organisationId,t.projectId,t.userId),index('idx_project_members_org_user').on(t.organisationId,t.userId,t.active)]);

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
 locationId:ref('location_id'),
 locationDescription:varchar('location_description',{length:500}),
 closureRationale:text('closure_rationale'),closedBy:ref('closed_by'),closedAt:stamp('closed_at'),
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
 verifiedBy:ref('verified_by'),verifiedAt:stamp('verified_at'),verificationNote:text('verification_note'),verificationDocumentId:ref('verification_document_id'),
 ...lifecycle(),
},t=>[index('idx_actions_org_project').on(t.organisationId,t.projectId,t.status),index('idx_actions_org_source').on(t.organisationId,t.sourceType,t.sourceId),index('idx_actions_org_owner').on(t.organisationId,t.ownerUserId,t.status)]);

// Investigation of an HSEQ source (incident/NCR today; form submissions, ITP items, risks later).
export const hseqInvestigations=mysqlTable('hseq_investigations',{
 id:id(),organisationId:org(),projectId:ref('project_id'),sourceType:varchar('source_type',{length:30}).notNull(),sourceId:ref('source_id').notNull(),
 status:varchar('status',{length:20}).notNull().default('investigating'),summary:text('summary'),facts:text('facts'),finding:text('finding'),
 rootCause:text('root_cause'),rootCauseNotEstablished:int('root_cause_not_established').notNull().default(0),contributingFactors:text('contributing_factors'),
 method:varchar('method',{length:80}),investigatorUserId:ref('investigator_user_id'),completedBy:ref('completed_by'),completedAt:stamp('completed_at'),...lifecycle(),
},t=>[uniqueIndex('idx_hseq_investigations_source').on(t.organisationId,t.sourceType,t.sourceId),index('idx_hseq_investigations_project').on(t.organisationId,t.projectId,t.status)]);
// Append-only verification decisions; each keeps a snapshot of the completion it judged.
export const hseqActionReviews=mysqlTable('hseq_action_reviews',{
 id:id(),organisationId:org(),actionId:ref('action_id').notNull(),outcome:varchar('outcome',{length:20}).notNull(),note:text('note').notNull(),documentId:ref('document_id'),
 reviewerUserId:ref('reviewer_user_id').notNull(),completedBy:ref('completed_by'),completedAt:stamp('completed_at'),completionNotes:text('completion_notes'),completionDocumentId:ref('completion_document_id'),createdAt:stamp('created_at').notNull(),
},t=>[index('idx_hseq_action_reviews_action').on(t.organisationId,t.actionId,t.createdAt)]);

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


// ---------------------------------------------------------------- civil knowledge engine (0005)
export const knowledgePacks=mysqlTable('knowledge_packs',{
 id:id(),organisationId:org(),
 packKey:varchar('pack_key',{length:120}).notNull(),
 name:varchar('name',{length:255}).notNull(),
 description:text('description'),
 discipline:varchar('discipline',{length:80}),
 jurisdiction:varchar('jurisdiction',{length:80}),
 contextType:varchar('context_type',{length:30}).notNull().default('organisation'),
 contextId:ref('context_id'),
 versionLabel:varchar('version_label',{length:60}),
 status:varchar('status',{length:20}).notNull().default('draft'),
 locked:int('locked').notNull().default(0),
 ...lifecycle(),
},t=>[uniqueIndex('idx_knowledge_packs_org_key').on(t.organisationId,t.packKey),index('idx_knowledge_packs_org_status').on(t.organisationId,t.status),index('idx_knowledge_packs_org_context').on(t.organisationId,t.contextType,t.contextId)]);

export const knowledgeSources=mysqlTable('knowledge_sources',{
 id:id(),organisationId:org(),
 packId:ref('pack_id').notNull(),
 title:varchar('title',{length:255}).notNull(),
 authority:varchar('authority',{length:180}),
 sourceType:varchar('source_type',{length:30}).notNull().default('organisation'),
 referenceCode:varchar('reference_code',{length:120}),
 revisionLabel:varchar('revision_label',{length:80}),
 jurisdiction:varchar('jurisdiction',{length:80}),
 effectiveFrom:day('effective_from'),
 effectiveTo:day('effective_to'),
 sourceUrl:varchar('source_url',{length:512}),
 documentId:ref('document_id'),
 licenceNote:text('licence_note'),
 status:varchar('status',{length:20}).notNull().default('draft'),
 verifiedBy:ref('verified_by'),verifiedAt:stamp('verified_at'),
 ...lifecycle(),
},t=>[index('idx_knowledge_sources_org_pack').on(t.organisationId,t.packId,t.status),index('idx_knowledge_sources_org_reference').on(t.organisationId,t.referenceCode)]);

export const knowledgeRules=mysqlTable('knowledge_rules',{
 id:id(),organisationId:org(),
 packId:ref('pack_id').notNull(),
 sourceId:ref('source_id').notNull(),
 ruleCode:varchar('rule_code',{length:120}).notNull(),
 title:varchar('title',{length:255}).notNull(),
 discipline:varchar('discipline',{length:80}),
 topic:varchar('topic',{length:120}).notNull(),
 ruleType:varchar('rule_type',{length:30}).notNull().default('requirement'),
 appliesWhen:longtext('applies_when').notNull(),
 assertion:longtext('assertion'),
 severity:varchar('severity',{length:20}).notNull().default('warning'),
 message:text('message').notNull(),
 sourceClause:varchar('source_clause',{length:120}),
 sourcePage:varchar('source_page',{length:60}),
 effectiveFrom:day('effective_from'),
 effectiveTo:day('effective_to'),
 status:varchar('status',{length:20}).notNull().default('draft'),
 ...lifecycle(),
},t=>[uniqueIndex('idx_knowledge_rules_org_code').on(t.organisationId,t.packId,t.ruleCode),index('idx_knowledge_rules_org_topic').on(t.organisationId,t.topic,t.status),index('idx_knowledge_rules_org_pack').on(t.organisationId,t.packId,t.status)]);

// Append-only source events, committed atomically with the source transaction.
export const domainEvents=mysqlTable('domain_events',{
 id:id(),organisationId:org(),eventType:varchar('event_type',{length:80}).notNull(),
 eventVersion:int('event_version').notNull().default(1),module:varchar('module',{length:40}).notNull(),
 entityType:varchar('entity_type',{length:40}).notNull(),entityId:ref('entity_id').notNull(),
 occurrenceId:ref('occurrence_id').notNull(),actorUserId:ref('actor_user_id').notNull(),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_domain_event_occurrence').on(t.organisationId,t.eventType,t.occurrenceId),index('idx_domain_events_org_time').on(t.organisationId,t.createdAt,t.id)]);

// Core communications: contextual discussion, receipts/acknowledgements, inbox and
// revocable external access. Business entities remain owned by their source modules.
export const communicationThreads=mysqlTable('communication_threads',{
 id:id(),organisationId:org(),contextType:varchar('context_type',{length:40}).notNull(),contextId:ref('context_id').notNull(),
 projectId:ref('project_id'),title:varchar('title',{length:255}).notNull(),status:varchar('status',{length:20}).notNull().default('open'),
 createdBy:ref('created_by').notNull(),createdAt:stamp('created_at').notNull(),updatedAt:stamp('updated_at').notNull(),
},t=>[uniqueIndex('idx_communication_threads_context').on(t.organisationId,t.contextType,t.contextId),index('idx_communication_threads_project').on(t.organisationId,t.projectId,t.updatedAt)]);
export const communicationMessages=mysqlTable('communication_messages',{
 id:id(),organisationId:org(),threadId:ref('thread_id').notNull(),authorUserId:ref('author_user_id').notNull(),
 parentMessageId:ref('parent_message_id'),body:text('body').notNull(),requiresAck:int('requires_ack').notNull().default(0),createdAt:stamp('created_at').notNull(),
},t=>[index('idx_communication_messages_thread').on(t.organisationId,t.threadId,t.createdAt)]);
export const communicationReceipts=mysqlTable('communication_receipts',{
 id:id(),organisationId:org(),messageId:ref('message_id').notNull(),userId:ref('user_id').notNull(),mentioned:int('mentioned').notNull().default(0),
 readAt:stamp('read_at'),acknowledgedAt:stamp('acknowledged_at'),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_communication_receipts_user_message').on(t.organisationId,t.messageId,t.userId),index('idx_communication_receipts_user').on(t.organisationId,t.userId,t.readAt,t.acknowledgedAt)]);
export const notifications=mysqlTable('notifications',{
 id:id(),organisationId:org(),userId:ref('user_id').notNull(),kind:varchar('kind',{length:40}).notNull(),title:varchar('title',{length:255}).notNull(),
 body:varchar('body',{length:1000}).notNull(),contextType:varchar('context_type',{length:40}),contextId:ref('context_id'),projectId:ref('project_id'),
 targetArea:varchar('target_area',{length:60}),targetSub:varchar('target_sub',{length:60}),targetId:ref('target_id'),targetTab:varchar('target_tab',{length:60}),
 readAt:stamp('read_at'),createdAt:stamp('created_at').notNull(),
},t=>[index('idx_notifications_user_unread').on(t.organisationId,t.userId,t.readAt,t.createdAt)]);
export const notificationPreferences=mysqlTable('notification_preferences',{
 id:id(),organisationId:org(),userId:ref('user_id').notNull(),inApp:int('in_app').notNull().default(1),email:int('email').notNull().default(0),sms:int('sms').notNull().default(0),
 quietStart:varchar('quiet_start',{length:5}),quietEnd:varchar('quiet_end',{length:5}),timezone:varchar('timezone',{length:80}).notNull().default('Australia/Sydney'),updatedAt:stamp('updated_at').notNull(),
},t=>[uniqueIndex('idx_notification_preferences_user').on(t.organisationId,t.userId)]);
export const externalAccessTokens=mysqlTable('external_access_tokens',{
 id:id(),organisationId:org(),tokenHash:char('token_hash',{length:64}).notNull(),contextType:varchar('context_type',{length:40}).notNull(),contextId:ref('context_id').notNull(),projectId:ref('project_id'),
 recipientName:varchar('recipient_name',{length:180}),recipientEmail:varchar('recipient_email',{length:254}),recipientPhone:varchar('recipient_phone',{length:60}),scopes:varchar('scopes',{length:500}).notNull().default('view,acknowledge,respond,upload'),
 expiresAt:stamp('expires_at').notNull(),revokedAt:stamp('revoked_at'),lastAccessedAt:stamp('last_accessed_at'),createdBy:ref('created_by').notNull(),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_external_access_tokens_hash').on(t.tokenHash),index('idx_external_access_tokens_context').on(t.organisationId,t.contextType,t.contextId,t.expiresAt)]);
export const externalResponses=mysqlTable('external_responses',{
 id:id(),organisationId:org(),tokenId:ref('token_id').notNull(),kind:varchar('kind',{length:30}).notNull(),payload:longtext('payload'),createdAt:stamp('created_at').notNull(),
},t=>[index('idx_external_responses_token').on(t.organisationId,t.tokenId,t.createdAt)]);

// Workshop is asset-scoped and does not require Operations.
export const workshopOrders=mysqlTable('workshop_orders',{
 id:id(),organisationId:org(),assetId:ref('asset_id').notNull(),title:varchar('title',{length:180}).notNull(),
 severity:varchar('severity',{length:20}).notNull(),status:varchar('status',{length:30}).notNull().default('open'),
 dueDate:day('due_date'),repairerId:ref('repairer_id'),verifiedBy:ref('verified_by'),
 // Evidence that raised the defect (e.g. a prestart form submission and the answer's field id).
 sourceType:varchar('source_type',{length:30}),sourceId:ref('source_id'),sourceField:varchar('source_field',{length:64}),
 // Exact evidence state when raised: the effective Forms amendment sequence (0 = original), and the authoritative context.
 sourceAmendmentSequence:int('source_amendment_sequence'),sourceContextType:varchar('source_context_type',{length:40}),sourceContextId:ref('source_context_id'),sourceProjectId:ref('source_project_id'),...lifecycle(),
},t=>[index('workshop_orders_org_idx').on(t.organisationId),index('workshop_orders_asset_idx').on(t.organisationId,t.assetId),index('idx_workshop_orders_source').on(t.organisationId,t.sourceType,t.sourceId,t.sourceField)]);
export const workshopEntries=mysqlTable('workshop_entries',{
 id:id(),organisationId:org(),orderId:ref('order_id').notNull(),kind:varchar('kind',{length:30}).notNull(),
 note:text('note').notNull(),labourHours:decimal('labour_hours',{precision:10,scale:2}),parts:text('parts'),
 actorId:ref('actor_id').notNull(),createdAt:stamp('created_at').notNull(),
},t=>[index('workshop_entries_org_idx').on(t.organisationId),index('workshop_entries_order_idx').on(t.organisationId,t.orderId)]);

export const programActivities=mysqlTable('program_activities',{
 id:id(),organisationId:org(),projectId:ref('project_id').notNull(),name:varchar('name',{length:180}).notNull(),
 startDate:day('start_date').notNull(),durationDays:int('duration_days').notNull(),predecessorId:ref('predecessor_id'),
 responsible:varchar('responsible',{length:180}),workPackage:varchar('work_package',{length:180}),
 resourceRequirement:text('resource_requirement'),plannedQuantity:decimal('planned_quantity',{precision:15,scale:2}),
 quantityUnit:varchar('quantity_unit',{length:40}),productionPerDay:decimal('production_per_day',{precision:15,scale:2}),
 status:varchar('status',{length:30}).notNull().default('planned'),
 // 0012: user-controlled order (quick reorder); dates still come from start/duration/dependencies.
 sequence:int('sequence'),...lifecycle(),
},t=>[index('program_activities_org_idx').on(t.organisationId),index('program_activities_project_idx').on(t.organisationId,t.projectId)]);

export const shiftRequirements=mysqlTable('shift_requirements',{
 id:id(),organisationId:org(),shiftId:ref('shift_id').notNull(),category:varchar('category',{length:40}).notNull(),
 role:varchar('role',{length:100}).notNull(),quantity:int('quantity').notNull(),status:varchar('status',{length:20}).notNull().default('active'),...lifecycle(),
},t=>[index('shift_requirements_org_idx').on(t.organisationId),index('shift_requirements_shift_idx').on(t.organisationId,t.shiftId)]);

// Immutable service-plan history for plant (migration 0024). 'completed' = a service was performed; 'plan_set' = initial plan on an asset
// with none; 'plan_corrected' = administrator correction (mandatory reason). Rows are only ever inserted.
export const assetServiceEvents=mysqlTable('asset_service_events',{
 id:id(),organisationId:org(),assetId:ref('asset_id').notNull(),kind:varchar('kind',{length:20}).notNull(),
 actorId:ref('actor_id').notNull(),performedOn:day('performed_on'),recordedAt:stamp('recorded_at').notNull(),
 meterType:varchar('meter_type',{length:20}),meterReading:decimal('meter_reading',{precision:15,scale:2}),
 previousNextServiceMeter:decimal('previous_next_service_meter',{precision:15,scale:2}),previousNextServiceDate:day('previous_next_service_date'),
 newNextServiceMeter:decimal('new_next_service_meter',{precision:15,scale:2}),newNextServiceDate:day('new_next_service_date'),
 note:text('note'),reason:text('reason'),assetRevision:int('asset_revision').notNull(),
},t=>[index('asset_service_events_org_idx').on(t.organisationId),index('asset_service_events_asset_idx').on(t.organisationId,t.assetId,t.recordedAt)]);

export const assetMeterReadings=mysqlTable('asset_meter_readings',{
 id:id(),organisationId:org(),assetId:ref('asset_id').notNull(),meterType:varchar('meter_type',{length:20}).notNull(),
 reading:decimal('reading',{precision:15,scale:2}).notNull(),nextService:decimal('next_service',{precision:15,scale:2}),
 note:text('note').notNull(),actorId:ref('actor_id').notNull(),createdAt:stamp('created_at').notNull(),
},t=>[index('asset_meter_readings_org_idx').on(t.organisationId),index('asset_meter_readings_asset_idx').on(t.organisationId,t.assetId)]);

// ---------------------------------------------------------------- forms engine (migration 0019)
// Published versions and submissions are immutable; corrections are linked amendments.
export const formTemplates=mysqlTable('form_templates',{
 id:id(),organisationId:org(),module:varchar('module',{length:40}).notNull().default('ims'),name:varchar('name',{length:180}).notNull(),
 description:text('description'),category:varchar('category',{length:60}).notNull().default('General'),status:varchar('status',{length:20}).notNull().default('active'),
 currentVersionId:ref('current_version_id'),...lifecycle(),
},t=>[index('idx_form_templates_org').on(t.organisationId,t.module,t.status)]);
export const formTemplateVersions=mysqlTable('form_template_versions',{
 id:id(),organisationId:org(),templateId:ref('template_id').notNull(),versionNumber:int('version_number').notNull(),
 status:varchar('status',{length:20}).notNull().default('draft'),schemaJson:longtext('schema_json').notNull(),changeReason:varchar('change_reason',{length:500}),
 publishedBy:ref('published_by'),publishedAt:stamp('published_at'),...lifecycle(),
},t=>[uniqueIndex('idx_form_template_versions_number').on(t.organisationId,t.templateId,t.versionNumber),index('idx_form_template_versions_org').on(t.organisationId,t.templateId,t.status)]);
export const formSubmissions=mysqlTable('form_submissions',{
 id:id(),organisationId:org(),templateId:ref('template_id').notNull(),templateVersionId:ref('template_version_id').notNull(),
 contextType:varchar('context_type',{length:40}).notNull(),contextId:ref('context_id').notNull(),projectId:ref('project_id'),
 responsesJson:longtext('responses_json').notNull(),provenanceJson:longtext('provenance_json'),submittedBy:ref('submitted_by').notNull(),submittedAt:stamp('submitted_at').notNull(),createdAt:stamp('created_at').notNull(),
},t=>[index('idx_form_submissions_org').on(t.organisationId,t.submittedAt),index('idx_form_submissions_context').on(t.organisationId,t.contextType,t.contextId),index('idx_form_submissions_project').on(t.organisationId,t.projectId),index('idx_form_submissions_template').on(t.organisationId,t.templateId)]);
export const formSubmissionAmendments=mysqlTable('form_submission_amendments',{
 id:id(),organisationId:org(),submissionId:ref('submission_id').notNull(),sequence:int('sequence').notNull(),responsesJson:longtext('responses_json').notNull(),
 changedFields:text('changed_fields'),reason:varchar('reason',{length:1000}).notNull(),amendedBy:ref('amended_by').notNull(),amendedAt:stamp('amended_at').notNull(),createdAt:stamp('created_at').notNull(),
},t=>[uniqueIndex('idx_form_submission_amendments_seq').on(t.organisationId,t.submissionId,t.sequence),index('idx_form_submission_amendments_org').on(t.organisationId)]);
