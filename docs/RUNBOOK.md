# Infrastruct production runbook: backup, deploy, verify, roll back

Applies to deploying the V1 branch (migrations `0003_v1_platform` and `0004_v1_resources_retention`)
over the currently deployed `hostinger-migration` baseline (`0000`–`0002`).

## 1. What the deploy changes

- **Schema is additive only.** 0003 and 0004 create new tables and add nullable or defaulted columns
  to existing tables. They do not drop, rename or rewrite any existing column, and they contain no
  `UPDATE` or `DELETE` against customer data.
- **One data backfill** runs after the migrations, under the same migration lock
  (`scripts/backfill-resources.mjs`). It reads legacy `workers`, `plant` and `shifts` metadata, fills
  the new typed columns, and creates `worker_competencies`, `shift_assignments` and
  `data_migration_issues` rows. It never edits the legacy `name`, `status` or `metadata` columns.
  It runs per organisation in one transaction, verifies its counts before commit, and rolls back if
  they don't reconcile. It is rerunnable: only rows with `legacy_synced_at IS NULL` are processed.
- **One new unique index**, `jobs (organisation_id, source_estimate_id)`. The baseline never writes
  `source_estimate_id` (the column is new in 0003), so existing rows cannot conflict.

Evidence: `BASELINE_DIR=<baseline checkout> MYSQL_DATABASE=<name>_test node scripts/test-upgrade-dryrun.mjs`
builds the baseline schema with the baseline's own runner and seeds legacy data (including
malformed values). It then upgrades and proves every legacy row is byte-identical afterwards.

## 2. Before deploying

1. **Back up the database.** In hPanel → Databases → phpMyAdmin → select the database →
   *Export* → *Custom* → all tables, *Structure and data*, then download. From a shell with
   access, you can use this instead:
   ```
   mysqldump --single-transaction --routines --triggers -h "$MYSQL_HOST" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" > infrastruct-$(date +%F-%H%M).sql
   ```
   Keep the file somewhere other than the hosting account.
2. **Record the running commit** (Hostinger deployment history) so you can redeploy it.
3. **R2**: no action. The deploy never deletes objects. Versioning in the bucket is recommended.
4. **Environment variables.** None are required for this deploy. New optional variables are listed
   in section 6. Leave them unset to keep those features safely off.

## 3. Deploy

1. Merge the PR (human decision), then deploy from Hostinger as usual.
2. `npm start` (or the build hook) runs `scripts/migrate.mjs`. Expect log lines like:
   ```
   Applied 0003_v1_platform.sql
   Applied 0004_v1_resources_retention.sql
   Resource backfill <organisation-id>: {"workers":N,"plant":N,"shifts":N,"competencies":N,"assignments":N,"issues":N}
   Database migrations ready
   ```
   The server does not accept requests until this completes.
3. If a migration is interrupted, the runner resumes it on the next start. Resumable steps are
   CREATE TABLE, CREATE INDEX, ADD CONSTRAINT and ADD COLUMN; 0003 and 0004 contain only these. A checksum mismatch or an untracked object
   stops startup without changing data.

## 4. Verify (about 10 minutes)

1. Sign in as an admin. Home loads, and Admin → Integrations shows which services are connected.
2. **Operations → Resources → Migration issues.** Review each flagged legacy value (invalid dates,
   non-numeric rates, assignments pointing at deleted records). Correct the worker, plant item or
   shift, then *Mark resolved*. Legacy values are kept on the record.
3. Operations → Schedule: open an existing shift and save it without changes. It should save, or
   show scheduling conflicts. Drafts always save.
4. Open a project → Commercial: existing claims and invoices are listed. New claims show gross,
   retention, net and GST.
5. Field user on a phone: Today loads. Turn on flight mode, capture a docket, turn signal back on,
   and the docket syncs.

## 5. Roll back

**Application rollback (preferred, no data loss).** Redeploy the previously recorded commit. The
baseline code works against the upgraded schema, because every new column is nullable or has a
default and it never reads the new tables. Records created in V1-only tables (tenders, claims,
SWMS, and so on) stay in the database but are not visible to the old app until V1 is redeployed.
Legacy rows the old app writes during the rollback window are picked up by the backfill on the
next V1 start (their `legacy_synced_at` is NULL).

**Full restore (last resort; loses changes since the backup).**
1. Stop the application (Hostinger → Node.js app → Stop).
2. In phpMyAdmin, drop all tables in the database, then *Import* the backup file.
3. Redeploy the recorded commit and start the application.
4. Tell users that work entered after the backup must be re-entered. Anything still queued in a
   field device's offline queue will resend automatically; replays are idempotent.

Never edit an applied migration file, and never delete rows from `app_migrations` or
`app_migration_steps` to "re-run" a migration.

## 6. Activating external services (all optional, all off by default)

| Feature | Variables | Also required | Without it |
|---|---|---|---|
| ABN register confirmation | `ABR_GUID` (free from abr.business.gov.au), optional `ABR_BASE_URL` | An admin confirms each lookup | Checksum validation only; lookup says "not configured" |
| AI assistance | `AI_ENABLED=true`, `AI_PROVIDER` (`anthropic`/`openai`), `AI_API_KEY`, `AI_MODEL`, optional `AI_BASE_URL` | `ai` module entitlement, organisation admin switch (with acknowledgement), role capability | AI panels explain why AI is off; every workflow works manually |
| Billing webhooks | `BILLING_PROVIDER`, `BILLING_WEBHOOK_SECRET` | A provider adapter that posts the normalised, signed event format (`lib/platform/billing.ts`) to `/api/billing/webhook` | Beta full-access trial; nothing is charged |
| Manual subscriptions | `PLATFORM_OPERATOR_EMAILS` | The operator signs in with that email | Only entitlement settings in Admin |
| Email | `EMAIL_ENABLED=true` + SMTP variables | – | Invitations and password reset are unavailable, with clear messaging |

`OPENAI_API_KEY` no longer enables anything by itself.

## 7. Routine operations

- **Backups:** daily database export (Hostinger automatic backups plus a weekly off-site export).
- **Migration issues:** check Operations → Resources → Migration issues after the first deploy.
  Nothing new is added unless legacy rows are written by an old client.
- **AI usage:** Admin → Integrations → AI assistance → Usage ledger, one row per request, with token counts.
- **Billing events:** Admin → Integrations → Billing lists the last 20 provider events.
- **Offline field data:** queued work stays on the device until the server accepts it or the user
  discards it. Ask users to open the app with signal before signing out.
