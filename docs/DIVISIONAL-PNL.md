# Divisional management P&L — first increment

Available under **Learn → Reports → Divisional P&L** and read-only
`GET /api/reports/divisional-pnl?start=YYYY-MM-DD&end=YYYY-MM-DD&divisionId=...`.
Omit divisionId for the consolidated authorized scope. Dates are inclusive,
with a maximum span of 366 calendar days. The UI supplies month, previous month,
calendar YTD and custom dates. All figures use the application's existing AUD convention.

## What is implemented

- Tenant-configured divisions, including archived divisions and visible unallocated values.
- Provisional billed revenue: issued, part-paid and paid client invoice amounts
  excluding GST, grouped by invoice date. Claims and quotes are never added.
- Recorded direct costs: active docket-derived cost transactions by work date,
  once per source type / source ID / source line. Reversed costs are excluded.
- Gross profit and gross margin are unavailable (`null`): invoice revenue is
  ex GST but the recorded cost GST basis is unknown. The report never subtracts
  these non-comparable sums or assumes a tax adjustment. Source totals remain
  separately visible with explicit tax-basis labels, including job-cost detail.
- Overheads and net result are explicitly unavailable, not zero. Accounting
  actuals are null and reconciliation status is always `not_reconciled`.
- Source drill-down includes amounts, dates, cost categories/codes, project and
  source IDs, source lines and exclusion reasons. Approved dockets without an
  active posting appear as excluded evidence, including unallocated dockets.
  Empty, whitespace and malformed legacy links are safely treated as unallocated
  and flagged in the description. Restricted users cannot see these unallocated
  records; the guarded project expression is also used in the scope predicate.
- Job learning shows original whole-job baseline and its estimate lineage,
  costs through period end and period costs. It does not compare a whole-job
  budget with one month's cost and call the difference a period variance.

The existing schema has no general ledger, accounting chart, payroll journal,
reconciliation register or posted overhead source. `cost_transactions.status =
'actual'` is an operational state, not evidence of accounting reconciliation.
Only the existing idempotent docket seam is currently a verified cost producer.
Other transaction source types are visible but excluded until their overlap /
replacement rules are established. Raw field, plant, supplier invoice and payroll
records are never added on top of docket costs.

## Access and module boundaries

The route uses the existing reports module guard and both `reports.view` and
`commercial.view`. Every source query is scoped to the session organisation;
project membership narrows queries before totals or drill-down are returned.
Company means all authorized divisions/projects, never all tenants or an
unrestricted company total for a restricted user. Guessed foreign division IDs
return 404. Archived projects remain in historical reporting.

Commercial disabled: revenue/gross profit unavailable and no invoice query.
Projects disabled: costs/baselines unavailable and no cost query. Dockets disabled:
no raw unposted-docket query; project-owned posted costs remain project records.
Read-only entitlements continue to permit report reads. Reports works without
requiring purchase of another module; missing sections explain the source gap.

No new tables, migrations, dependencies, paid services or integrations. Aggregation
lives in a seam; deterministic arithmetic lives in the platform. No module imports
another module. No source record is mutated by generating this report.
The existing entitlement service can provision trial rows for an organisation
with no entitlement records; the report adds no new write behavior.

## Decisions before accounting actuals can be offered

1. Identify the authoritative accounting source and agree tenant-specific account
   mapping to revenue, direct costs and overheads. Existing project cost codes
   remain source labels; no Roadworx chart or account numbers are hard-coded.
   A mapping editor/import format is deliberately deferred until that source is known.
2. Agree accrual/recognition rules, retention treatment, tax treatment of docket
   costs, period cut-off/locking, and reconciliation evidence. Paid invoice status
   alone is not bank or ledger reconciliation.
3. Establish source replacement keys before supplier AP, payroll or fleet journals
   replace overlapping operational docket costs. Unmatched values must remain visible.
4. Supply posted shared overhead pools and an approved, versioned allocation
   basis using productive hours or project duration, with the denominator, period,
   evidence and rounding residual recorded. This increment allocates nothing and
   never applies an annual overhead percentage to revenue.
5. Add internal-charge counterparties and matched debit/credit identifiers before
   elimination. This report applies no eliminations and says so; its provisional
   consolidated figures must not be represented as accounting consolidation.
6. Confirm historical division attribution. Current project division is used and
   legacy blank assignments use the current tenant default, matching existing
   application semantics. Reassignments can restate earlier reports; immutable
   posting-time division attribution needs an accounting source/revision policy.

## Roadworx reference and future connections

The requested private `DIV_08.xls` could not be materialized successfully in this
Windows executor: the prescribed Library helper requires file metadata operations
unavailable here. No readable workbook was established, no workbook figures were
used, and no claim of workbook layout/account mapping parity is made. The workbook
and transfer metadata are outside the repository. Tests contain synthetic values only.

Roadworx is the first client, not a hard-coded tenant. Existing division names,
codes and project cost-code labels are retained. The clean future estimating seam
is baseline/estimate revision → project → reconciled cost source → division, with
comparable labour/plant/material quantities and completed-job scope added later.
Fleet maintenance, fuel, ownership cost and depreciation need authoritative,
non-overlapping postings; a plant docket category is not full fleet cost coverage.
No estimating, workshop or programme workflow is changed here.

## Local verification

`npm run test:pnl` exercises source sums, unknown-tax profitability suppression,
safe malformed-JSON handling, source exclusions/duplication, cents,
period validation, original baseline lineage, unallocated evidence, foreign-tenant
records with overlapping project IDs, restricted and empty project scope,
capabilities, entitlement degradation and the route contract. Its service tests
execute the real SQL against an in-memory SQLite adapter with synthetic fixtures;
they are not a substitute for production MySQL/HTTP acceptance.

`node scripts/test-divisional-pnl.cjs --demo` also writes a synthetic API response
to ignored `outputs/divisional-pnl-synthetic.json` and a static component preview
in `outputs/divisional-pnl-synthetic.html` (simplified test styling, inactive controls).
The fixture produces $150 billed revenue (ex GST), $30 recorded direct cost (GST
basis unknown), unavailable gross profit/margin/overheads/net result, and an
excluded $20 unallocated docket. Earlier synthetic screenshots showing a computed
gross profit are superseded; these previews are not authenticated browser QA.

This is a partial management report, not complete accounting software or a
statutory financial statement.

Local verification on 2026-10-01: typecheck, P&L tests (including component render
and unauthorized-view suppression), V1 logic, reporting, modularity and commercial
suites passed. Lint passed with eight pre-existing navigation warnings outside this
change. The full `npm test` stopped in the existing security-audit test because its
CLI fixture needs Linux process/filesystem behavior (`/proc/self/mountinfo`, ENOENT).
Production build and MySQL/HTTP journeys were not run: the local machine has under
200 MB free disk and no test MySQL stack was provisioned. Validation used Node
24.19.0 and the existing dependency install (lockfile contents match apart from
line endings); Node 22 / production acceptance is still required before release.
