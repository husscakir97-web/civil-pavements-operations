# Connected programme calculation pilot

Branch: local/connected-infrastruct-pilot, based on fresh main b8a75ae477102728c5e9b80e85c718a9ca8a7b92. This persisted slice supersedes the initial session-only checkpoint.

## Behaviour

Activity quantity or production edits immediately recalculate working days, productive activity hours and direct cost through the existing `itemHours` / `itemAmount` functions. Assumptions now persist with the activity and survive save/reopen/reload. Closing without saving discards changes.

Synthetic single-rate example: 100 t / 200 t per working day at 8 productive hours/day gives 4 productive hours. At AUD 150 per productive activity hour the direct cost is AUD 600. Quantity 125 t gives 5 hours / AUD 750. This is not the multi-resource AUD 14,000 example: material, multiple workers, trucks and plant aggregation are not implemented here.

Calendar duration changes only by explicit application of rounded-up working days (at least one calendar day), or manual input. The action states the work-every-day assumption. It does not infer weekends, holidays, elapsed overnight shifts, or resource calendars. Hours are productive activity hours, not elapsed time or multiplied crew hours.

Null means unknown; explicit zero remains zero. Zero productivity/hours cannot calculate hourly cost. A per-unit rate can calculate cost without a productivity assumption. Inputs use the existing two-decimal storage precision; the server rejects silent extra-precision rounding. Result values are recomputed from saved inputs rather than stored as competing totals.

## Contract and file ownership

- `lib/seams/activity-preview.ts`: reusable calculation adapter over existing estimate arithmetic.
- `lib/v1/program-costing.ts`: shared validation, omitted-field preservation, approved-item references and financial redaction.
- `components/v1/activity-preview.tsx`, `components/v1/program.tsx`: controlled persisted drawer fields, inline preview, explicit calendar application and approved-item reference selector.
- `app/api/projects/program/route.ts`: reads/writes/duplicates costing fields under existing project access, capability, transaction lock and revision controls. It uses existing `canSeeMoney` policy to hide rates/references and prohibit financial writes without access; non-financial edits preserve hidden fields. Older clients omitting new fields preserve existing values.
- `db/schema-v1.ts`, `migrations/mysql/0025_program_activity_costing.sql`: five additive columns on `program_activities`: `productive_hours_per_day DECIMAL(6,2) NULL`, `direct_cost_rate DECIMAL(15,2) NULL`, `cost_rate_basis VARCHAR(10) NOT NULL DEFAULT 'hour'`, `source_estimate_revision_id VARCHAR(191) NULL`, `source_estimate_item_id VARCHAR(191) NULL`.
- Existing nullable `planned_quantity` and `production_per_day` now accept null through the API; legacy zeroes are not rewritten.
- `scripts/test-activity-preview.cjs`, `scripts/test-program-costing.cjs`, `scripts/test-program-workshop.cjs`: targeted tests, wired into the existing npm test chain.

The reference pair must identify a unique item in this project's immutable awarded estimate snapshot. Linking does not copy or mutate approved values. No resource allocations are invented from requirement text. No commercial files, existing migration files or approved baseline records changed.

`npm run db:generate` succeeded outside the sandbox after its initial Windows user-lookup ENOMEM failure. The checked-in Drizzle journal stops at 0017, so generated output included already shipped 0018–0024 changes. Only the five generated programme ADD statements were retained as migration 0025; unrelated generated changes and snapshot were retained outside the worktree for review. Historical migration metadata was not rewritten. Migration execution is still subject to the MySQL CI gate.

## Verification evidence

Persisted slice targeted checks:

- Typecheck passes; lint on changed source/schema/tests passes.
- Programme/workshop and modularity regressions pass.
- Actual route handlers and SQL tested against synthetic SQLite with adapters for auth/entitlements/MySQL transport: additive migration preserves existing rows; create/read/edit/reload and duplicate; omitted field compatibility; null versus zero; stale revisions; invalid/foreign source references; organisation/project guards; financial redaction and write refusal; read-only and closed-project refusal; baseline metadata unchanged; safe audit fields.
- Headless Chrome used the actual drawer and actual programme handlers through that SQLite adapter. Save/reopen/page reload agree; source link survives; cancellation leaves the saved record intact; null and zero rates survive reload. Desktop 1440x1000 and mobile 390x844 screenshots captured; no horizontal overflow at 390px. Temporary Next.js fixture route and export removed after QA. Test fixture server mode is `node scripts/test-program-costing.cjs --serve`, binds loopback only and uses an in-memory synthetic database.
- Screenshots/evidence are outside the repository in the parent task folder: `persisted-pilot-desktop.png`, `persisted-pilot-mobile.png`, `persisted-browser-check.cjs`. The browser script requires the temporary drawer harness; it is evidence rather than a shipped route.

Initial checkpoint checks (before persistence): production build and full lint passed (10 existing warnings); all 17 non-automation regression commands passed individually. The full test chain stopped at the existing Windows security-audit subprocess/path fixture; the separate automation fixture hit `spawnSync git EPERM`. No Claude automation was launched. MySQL fresh-start refused to run without a disposable `_test` database. Local Node is 24.19.0, while production/CI targets Node 22.

No second heavy local build or installation was run for persistence due to low disk. Full Linux Node 22/MySQL CI must validate the published SHA before release; do not interpret local adapter tests as real MySQL integration results.

## Remaining scope

Direct cost excludes overhead, contingency, margin and GST. Existing overhead percentage arithmetic is untouched. Resource assignment, availability checks, company capacity, multi-resource costing and forecasting are not implemented. The next connection should use actual allocation IDs/rates from existing loaders, existing `plannedCost`, and canonical `evaluateShift` warning/blocking semantics, with explicit ownership to prevent shared-resource double charging.

All other worktrees are preserved. Only this task's generated Next caches were cleaned; disk headroom recovered to about 0.72 GB. User subsequently approved a separate draft PR and existing CI, with no merge/deployment.

Migration discovery regression: scripts/test-program-costing-migration.mjs invokes the actual migration runner against a disposable MySQL database for fresh install, an existing 0024 state with retained data, and repeat restart. It is included in the existing test:migration-recovery CI command. Local syntax/lint pass; real MySQL execution awaits CI.
