# Project-control quantity diagnosis — 2026-10-05

Base: `54f8ecd421fabe2516518b52e6d40772d515bb78`.
Local branch: `codex/project-control-production-reconciliation`.

## Confirmed unit defect and correction

The real `estimateVsActual()` aggregation, executed with disposable in-memory
SQLite fixtures, reported 12 items plus 80 square metres as **92 t**. The new
regression failed against the base with `92 !== null`, then passed after the fix.
The SQL double only translates MySQL's `JSON_UNQUOTE(JSON_EXTRACT(...))` for SQLite;
it executes the aggregation SQL rather than supplying precomputed totals.

Only docket quantities explicitly marked `t`, `tonne` or `tonnes` now contribute
to the tonne comparison (case-insensitive, surrounding spaces ignored). Other
units, including blank/unknown, area, items and kg, are excluded. This is a unit
filter, not a new conversion policy; ambiguous `ton` is not assumed metric.
Submitted field `tonnes`, all approved docket labour hours and docket counts,
existing zero-to-null behavior, financial calculations and route guards remain
unchanged. No data or schema migration is needed.

## Unresolved overlap rule

The fixtures also reproduce the suspected double counting:

| Same-shift submitted field | Approved docket | Reported result |
| --- | --- | --- |
| 100 t / 8 h | 100 t / 8 h | 200 t / 16 h |
| 100 t / 8 h | 40 t / 3 h | 140 t / 11 h |

For the first fixture `projectFinancials().forecast.accrued` is already zero,
because its existing cost rule excludes a whole shift after any approved docket.
That financial rule was not changed or adopted for production quantities.

`field_records` stores one current record per shift. `submitFieldDocket()` accepts
independent quantities, units, hours and line items and stores `links.shiftId`.
Neither that input nor the stored link identifies the field revision, resources,
loads or production portions covered by a docket. An approved docket may describe
a partial resource/load, unrelated item work, or the same production as a field
record. Matching a shift alone cannot distinguish these cases.

Dropping the whole field record would lose legitimate uncovered work. Taking the
maximum or subtracting quantities would assume that one source is a subset of the
other. No such production rule was found, so reconciliation was deliberately not
guessed. The diagnostic fixture outputs are not assertions that additive overlap
is correct. A follow-up needs an explicit source-precedence/coverage contract,
including partial coverage and multiple dockets, before changing these totals.

## Validation and scope

Passed locally:

- `node scripts/test-project-control.cjs`: units/aliases, non-tonne-only null,
  submitted field production, approved/included-claim/invoiced statuses,
  project/tenant exclusions, unchanged financial totals, labour/count preservation,
  actual route denial for field/read-only/scheduler and disabled commercial module.
- `node scripts/test-field.cjs`.
- `node scripts/test-commercial.cjs` (including commercial-output/billing-boundary
  tests and the new project-control regression, now included in `npm test`).
- `node scripts/test-v1-logic.cjs`.
- `node scripts/test-modularity.cjs`.
- `npm run typecheck`.
- `npm run lint`: exit 0, no errors, 25 warnings in untouched files.

Node was v24.19.0; the repository targets Node 22. Dependencies were reused through
a local node_modules junction to the existing planning checkout, whose committed
package-lock SHA-256 matches this base
(`B2C01AE1C5016804DA08ACD40689215B77768FDF735234C9093B74884B25C0BF`).
No dependency installation or lockfile edits were made.

Not run: the entire `npm test` chain, production build, MySQL HTTP suites, database
migrations, browser journeys or external integrations. These focused SQL/route
tests do not verify native MySQL execution, real sessions or a full release gate.
No existing local preview or database was used.

Repository instructions inspected: `CLAUDE.md` and the tracked run-app skill at
`.claude/skills/run-civil-pavements-operations/SKILL.md`. No tracked `AGENTS.md` or
`.agents/skills` files exist at the candidate. The run-app skill's database/browser
workflow was not needed for this focused aggregation regression.

The checkout is an independent clone. Read-only remote inspection identified PR68
at `87210a9e747e55128127b029e814b226cd39c7c8` and PR69 at the base above. Neither
branch was changed. No push, PR, merge, deployment, credential change, paid service,
production/live-tenant access or outside-agent invocation occurred.
