# Planning v0.1 — architecture decision

Status: accepted for this slice. Scope: an undated methodology canvas with live resource costing, saved scenarios and a relative timeline.

## Dependency
Built on PR 62 (`chatgpt/connected-job-release-candidate` @ `f852c21`). This work is a separate branch and its draft PR targets that integration branch so its diff contains only Planning. If PR 62 merges first, retarget to `main`.

## Module, access and ownership
- Belongs to the existing **Estimating** module (`estimating` entitlement): it works for an estimator with Projects, Commercial, Operations and the rest disabled. No new module key, no cross-module import.
- Routes use `api({permission:'read'|'write', module:'estimating'})`. Writing needs `estimate.edit`. Reading needs `pipeline.view` or `estimate.edit`.
- **Financial access** = `estimate.edit` or `estimate.approve` while Estimating is usable (deliberately NOT `commercial.view`, which would break standalone estimators). Everyone else sees structure, durations and the relative timeline, with every rate, amount and cost redacted **on the server** (JSON, CSV export). Existing project permissions are unchanged.
- Every plan has an explicit `owner_user_id` and `access_scope` (`organisation` or `owner`). `owner` limits the plan to its owner and administrators. Every table carries `organisation_id` with an index; every query is scoped to the session organisation.

## Data model (migration 0026, additive only)
`planning_plans` (container: owner, access, optional `estimate_id`/`tender_id`/`project_id` links, revision) → `planning_scenarios` (named, revisioned; a scenario is the editable proposal) → `planning_activities` (stable client UUIDs; `kind` activity|milestone; optional date) · `planning_dependencies` (finish-to-start, many per activity) · `planning_requirements` (generic labour/plant, editable rate, optional `resource_ref_type/id` pointing at an existing worker or plant record) · `planning_cost_items` (activity-owned setup costs and plan-level shared costs) · `planning_cost_links` (which activities rely on a shared cost) · `planning_canvas_positions` (layout only).
- Links to estimates, tenders, projects and resources are validated for existence in the organisation and are **read-only references**: Planning never writes to estimates, tenders, projects, resources, bookings or the schedule, so a scenario can never publish into approved records.
- Business data and canvas positions are separate tables and separate save actions; moving a box never changes a business revision.

## Calculation (one implementation: `lib/v1/planning.ts`)
- Imported by the browser (live preview) and by the server (authoritative validation and every response). The server recomputes; client numbers are never trusted.
- Quantities are typed (`quantity` + `unit`); productivity is `productivityUnit` per productive hour (same convention as the estimate engine). Units convert only within a dimension (m/km, m2/ha, t/kg…); an incompatible unit is **rejected**, not guessed.
- Duration is an explicit choice per activity: **entered** or **derived** (quantity ÷ productivity ÷ productive hours per day). Milestones have zero duration and no cost.
- **Unknown ≠ zero**: a missing value is `null` and propagates (activity cost, start, finish, plan total become unknown, with the known subtotal and a count of unknowns shown). A known zero stays a known zero. The estimate engine coerces missing values to zero, which is exactly why it is not reused for this.
- Costs: resource = count × rate × (hours/day if hourly) × duration. Setup costs are explicit line items. A **shared cost** is stored once at plan level and *referenced* by activities; the plan total counts it once however many activities reference it, and per-activity totals exclude it.
- Dependencies: finish-to-start, many per activity, validated for unknown ids, duplicates, self-links and **cycles** (rejected with the loop named). Relative timeline: `start = max(predecessor finish)`, so parallel paths join at the latest finish, not the sum.
- Without dates the timeline is labelled **Relative** and makes no availability claim. Optional dates are stored and shown, never calculated.

## Saves and isolation
- `save` carries `expectedRevision`; a stale revision is refused (409) and nothing is written. The whole document is replaced in one transaction and the scenario revision increments; an audit row is written. Scenarios are copied (`create-scenario` from an existing one), so alternatives never overwrite each other.

## Out of scope (interfaces only)
Dated leave, resource reservations/bookings, optimisation, real-time co-editing, tender extraction, standards ingestion, ITP generation, executive dashboards. `resource_ref_*`, the optional links and the pure calculation module are the seams future work can connect to.

## Verification (final code)
- `node scripts/test-planning-v01.cjs` (in `npm test`): unit conversion, derived duration, unknown vs zero, parallel join, cycle/duplicate/self/unknown-id rejection, shared cost once, arithmetic, redaction, determinism.
- `test:migration-recovery`: real runner for 0026 (fresh install, upgrade from 0025, `organisation_id` + index on all eight tables, unknown stays `NULL`, idempotent restart). `test:planning` (`scripts/planning-journey.mjs`, production build, real MySQL-compatible database, 62 checks): server contract, redaction in JSON and CSV, ownership scope, tenant isolation, Estimating-only organisation, the full browser journey (create, add blocks, connect, drawer edits, drag, save, reload in flowchart and timeline, cycle refused, shared cost once, scenarios, stale save, approved estimate untouched) and desktop/390px overflow with screenshots inspected.
- Full gate (security audit, lint, typecheck, `npm test`, pruned build, `test:fresh`, `test:migration-recovery`, `db:migrate` ×2, backfill, `test:mysql`, `test:v1`, connected-job driver) passed on the final code. `scripts/test-v1-logic.cjs` was updated for an intended rule: Planning appears under Pipeline for Estimating.

## Limitations of v0.1
- No UI yet to link a plan to an estimate, tender or project, or to pick an existing worker/plant record (the API and schema accept and validate them).
- Plan access is organisation or owner-only; no per-person sharing. No deletion of plans or scenarios (archive plan only through the API).
- Whole-document save (last 200 activities); no autosave, undo or real-time co-editing. Positions are last-write-wins.
- The browser journey (`test:planning`) needs Playwright and Chromium and is not wired into CI (CI workflow left unchanged); the engine and migration tests do run in CI.
- Relative days only: no calendar, leave, bookings or optimisation. Rates are ex GST and entered by hand; no rate-library lookup.
