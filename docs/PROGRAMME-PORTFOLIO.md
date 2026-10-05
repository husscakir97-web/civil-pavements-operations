# Read-only company programme

Local slice based on `54f8ecd421fabe2516518b52e6d40772d515bb78`.
The Programme entry defaults to Company programme; Project programme retains the existing editor.
The company view is a responsive two-week list grouped by project division. Date and division
filters use the existing hash navigation, so browser Back restores them. Project drilldown uses
the existing project Programme tab; conflict details remain read-only in the company view.

## Scope-switch draft preservation

Review identified that the original Company/Project switch unmounted ProjectProgramme, discarding
the selected project and QuickAdd's unsaved name, date, duration and owner. The browser regression
reproduced this before the fix: the project picker was empty instead of `p` after a dirty roundtrip.
The editor now mounts on first use and remains mounted but hidden in Company mode. Returning to
Project mode restores the same selection and draft; no discard confirmation is needed because
the switch discards nothing. Backend behaviour and authorisation are unchanged.

The real-component fixture test now supplies an editable session and project-team fixture and
passes six dirty roundtrips (three each at 390px and 1280px), checking project, name, date, duration,
owner, hidden-editor visibility and page width. All observed API requests remain GET. Existing
filter/race/error/back checks are retained. `SKIP_SCREENSHOTS=1` runs without overwriting the saved
screenshots. This is component fixture evidence, not authenticated backend browser QA.

## Data contract

- GET `/api/projects/program/portfolio`, optional `start`, `divisionId`, `projectId`.
  The server fixes the window at 14 calendar days and defaults to organisationToday.
- Requires Projects read and project.view before projectScope. PE/SE use active membership or
  recorded PM; other authorised readers use existing project.all.view. Division adds no access.
- Operational data additionally requires usable Operations and schedule.view. Accounts receives
  activities only. Read-only entitlements work. Responses, including errors, are private/no-store.
- Every project query is organisation scoped. Child loads are batched against accessible project IDs.
  Shift legacy project IDs are allowed only if consistent with typed IDs. Division comes from the
  project, with NULL inheriting the current stored default; no default is created by this seam.
- Programme dependencies are computed across the entire project before the window is applied.
  Overdue incomplete activities are listed separately. Invalid programmes get a generic review notice.
- No activity/shift association is inferred. Counts describe records/resource identities, never output,
  cost, actuals or completion. Unknown requirements and unavailable shift data remain null, not zero.
- Undated/invalid shifts are queued. Overnight intervals include the previous day and exclude touching
  endpoints. Assignments deduplicate by resource type and ID, independent of regenerated assignment IDs.
- Existing conflict engine and resource loader run server-side across all accessible projects before
  display filtering. Only issue codes/severity are returned, without raw messages, resource identifiers,
  hidden booking flags or unsafe shift links. Limited project coverage is explicit. Draft, service,
  competency and safety-hold semantics remain the existing engine's. No supplier/crew capacity claims.
- Responsible names resolve only from active project members; no contact details or raw metadata leave
  the endpoint. The DTO has an explicit allowlist and no financial fields.

## Verification

- `node scripts/test-programme-portfolio-boundaries.cjs`: **120/120 named cases** pass:
  108 combinations (11 existing roles plus unknown, three Projects entitlement states,
  three Operations states), plus 12 targeted regressions. Runs the real GET wrapper,
  capability/entitlement services, projectScope, seam and conflict engine. SQL executes
  against in-memory SQLite, with mysql2 IN-array expansion and JSON_UNQUOTE adapted.
  Authentication is substituted; this does not verify Better Auth, MySQL dialect behaviour,
  a running Next.js server or production data. Every exercised data read rejects non-SELECT SQL.
  Targeted cases cover private 401/400 responses, inactive/PM scope, restricted-booking and
  foreign-tenant noninterference, filter equivalence, cross-division conflicts, legacy links,
  responsible-team resolution, service warnings/safety holds and expired entitlements.
- `node scripts/test-programme-portfolio.cjs` passes. It exercises the real projectScope and conflict
  engine with scoped SQL fixtures: role/entitlement combinations, inactive membership/recorded PM,
  hidden-booking noninterference, cross-division conflicts, legacy mismatch, defaults, dependencies,
  overnight/endpoints, resource deduplication, null/zero and sanitized failure/DTO behaviour.
- Included in `scripts/test-program-workshop.cjs` and therefore the existing npm test chain.
  The programme/workshop suite passes, including existing persisted-programme and costing regressions.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` passes.
  Incremental checking initially hit ENOSPC writing its cache; no-cache checking succeeded.
- Full ESLint passes with 25 pre-existing warnings and zero errors; changed files pass focused lint.
- `node scripts/test-v1-logic.cjs` passes (nine printed suite summaries), including the existing
  eleven-role gate, scheduling conflict engine and legacy resource mapping assertions.
- `scripts/test-programme-portfolio-browser.cjs` bundles real components with fixture responses and
  existing dependencies. Host-provided Playwright/Chrome may be selected via PLAYWRIGHT_MODULE and
  CHROME_PATH. It passes mobile overflow, review queues, filter race, errors/retry, mode switch,
  project navigation/back checks, and asserts that every observed API request is GET.
- Fixture screenshots: `outputs/programme/mobile.png` and `outputs/programme/desktop.png` (local,
  ignored). These demonstrate the components with fixtures, not a live authenticated deployment.

The full npm test/build/MySQL/authenticated journey gates were not run. No database or authenticated
runtime was provisioned; this Windows host uses Node v24.19.0 rather than the repository's Node 22 target.
No migrations, dependencies, remote writes, PRs, deployments or live-data changes were made.
This slice batch-loads accessible shift rows before evaluating/filtering; large tenants may need a
follow-up bounded candidate query that preserves legacy/invalid queues and accurate conflict coverage.
