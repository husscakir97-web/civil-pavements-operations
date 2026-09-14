import { index, integer, uniqueIndex, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dockets = sqliteTable(
  "dockets",
  {
    id: text("id").primaryKey(),
    docketNo: text("docket_no").notNull(),
    workDate: text("work_date").notNull(),
    client: text("client").notNull().default(""),
    project: text("project").notNull().default(""),
    crew: text("crew").notNull().default(""),
    vehicle: text("vehicle").notNull().default(""),
    startTime: text("start_time").notNull().default(""),
    finishTime: text("finish_time").notNull().default(""),
    breakHours: real("break_hours").notNull().default(0),
    labourHours: real("labour_hours").notNull().default(0),
    quantity: real("quantity").notNull().default(0),
    quantityUnit: text("quantity_unit").notNull().default("t"),
    amount: real("amount").notNull().default(0),
    poNumber: text("po_number").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("review"),
    confidence: real("confidence").notNull().default(0),
    sourceName: text("source_name").notNull().default(""),
    sourceKey: text("source_key").notNull().default(""),
    rawText: text("raw_text").notNull().default(""),
    sourcePage: real("source_page"),
    sourceCrop: text("source_crop").notNull().default("full-page"),
    fieldConfidence: text("field_confidence").notNull().default("{}"),
    lineItems: text("line_items").notNull().default("[]"),
    links: text("links").notNull().default("{}"),
    extractionMethod: text("extraction_method").notNull().default("local-ocr"),
    profileId: text("profile_id").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_dockets_work_date").on(table.workDate),
    index("idx_dockets_docket_no").on(table.docketNo),
  ],
);

// Pavement Operations OS organisation-aware foundation. Existing dockets remain intact.
export const organisations = sqliteTable("organisations", { id: text("id").primaryKey(), name: text("name").notNull(), createdAt: text("created_at").notNull() });
export const users = sqliteTable("users", { id: text("id").primaryKey(), organisationId: text("organisation_id").notNull(), email: text("email").notNull(), name: text("name").notNull(), role: text("role").notNull(), createdAt: text("created_at").notNull() }, t => [index("idx_users_org").on(t.organisationId)]);
export const clients = sqliteTable("clients", { id: text("id").primaryKey(), organisationId: text("organisation_id").notNull(), name: text("name").notNull(), contactName: text("contact_name").notNull().default(""), email: text("email").notNull().default(""), phone: text("phone").notNull().default("") }, t => [index("idx_clients_org").on(t.organisationId)]);
const orgEntity = (name: string) => sqliteTable(name, { id: text("id").primaryKey(), organisationId: text("organisation_id").notNull(), name: text("name").notNull(), status: text("status").notNull().default("active"), metadata: text("metadata").notNull().default("{}"), createdAt: text("created_at").notNull() }, t => [index(`idx_${name}_org`).on(t.organisationId)]);
export const opportunities = orgEntity("opportunities");
export const jobs = orgEntity("jobs");
export const workPackages = orgEntity("work_packages");
export const estimates = orgEntity("estimates");
export const quoteRevisions = orgEntity("quote_revisions");
export const costCodes = orgEntity("cost_codes");
export const rateLibraries = orgEntity("rate_libraries");
export const shifts = orgEntity("shifts");
export const workers = orgEntity("workers");
export const crews = orgEntity("crews");
export const plant = orgEntity("plant");
export const suppliers = orgEntity("suppliers");
export const subcontractors = orgEntity("subcontractors");
export const variations = orgEntity("variations");
export const qaSafetyRecords = orgEntity("qa_safety_records");
export const attachments = orgEntity("attachments");
export const commercialRecords = orgEntity("commercial_records");
export const auditEvents = orgEntity("audit_events");

export const fieldRecords = sqliteTable('field_records', {
 shiftId:text('shift_id').primaryKey(), organisationId:text('organisation_id').notNull(), revision:integer('revision').notNull(), status:text('status').notNull(), data:text('data').notNull(), plan:text('plan').notNull(), job:text('job').notNull(), updatedAt:text('updated_at').notNull()
}, t=>[index('idx_field_org').on(t.organisationId)]);
export const fieldHistory = sqliteTable('field_history', {
 id:text('id').primaryKey(), shiftId:text('shift_id').notNull(), organisationId:text('organisation_id').notNull(), revision:integer('revision').notNull(), action:text('action').notNull(), reason:text('reason').notNull(), actor:text('actor').notNull(), snapshot:text('snapshot').notNull(), createdAt:text('created_at').notNull()
}, t=>[index('idx_field_history').on(t.organisationId,t.shiftId),uniqueIndex('idx_field_revision').on(t.shiftId,t.revision)]);

// Immutable preparation revisions. References always name an exact revision.
export const preparationRevisions = sqliteTable('preparation_revisions', {
 id:text('id').notNull(), organisationId:text('organisation_id').notNull(), revision:integer('revision').notNull(),
 kind:text('kind').notNull(), title:text('title').notNull(), status:text('status').notNull(),
 jobId:text('job_id'), opportunityId:text('opportunity_id'), data:text('data').notNull(),
 actorId:text('actor_id').notNull(), reason:text('reason').notNull(), createdAt:text('created_at').notNull()
}, t=>[uniqueIndex('idx_preparation_revision').on(t.organisationId,t.id,t.revision),index('idx_preparation_job').on(t.organisationId,t.jobId),index('idx_preparation_opportunity').on(t.organisationId,t.opportunityId)]);
