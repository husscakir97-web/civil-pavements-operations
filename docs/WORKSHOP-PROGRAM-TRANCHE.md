# Workshop, scheduling and programme tranche

Standalone by design. Connected by default.

Latest origin/main inspected on 28 September 2026: c8a33de7b9ff3fb0c14d0a20f4a7052c2dda46b1.
Continues the modular foundation branch. The detailed uploaded brief and the owner's
request to prioritise Workshop, scheduling, estimating and programming govern scope.

## Impact map

| Foundation | Change | Migration |
| --- | --- | --- |
| Existing plant register | Shared Workshop asset identity, separate safety hold, meter/next-service projection | Add plant columns; preserve legacy metadata |
| Entitlements, capabilities, module registry | Workshop contract, view/edit/verify permissions, standalone navigation | Existing tenants explicitly enable Workshop; no silent grant |
| Audit and domain events | Transactional work-order events; immutable repair/verification and meter history | New typed organisation-scoped tables |
| Scheduling conflict engine | Safety holds remain authoritative; resource shortage checks | Typed requirement projection, retained shift metadata compatibility |
| Shift editor | Filled/required cards and copy-to-date with optional resources | Copies are drafts; evidence/approvals never copied |
| Estimate engine | XLSX costing snapshot, clear JSON label, disabled read-only controls | None |
| Project workspace | Programme list, calendar-day dependencies, lookahead, 14-day timeline | Typed project activities with optimistic concurrency |

## Implemented behaviour

- Workshop uses the same plant IDs as Operations, with no dependency on an Operations
  subscription or a project. Defects create asset work orders. Repair labour/parts
  notes are append-only. A different authorised user verifies or returns for rework.
- Critical defects set an independent safety hold. The scheduling loader honours
  that hold even after an ordinary legacy status edit and even if Workshop is later
  disabled. Closing one defect cannot clear another unresolved critical defect.
- Meter readings and service thresholds retain actor/time/evidence. Meter units cannot
  silently change and readings cannot decrease. Service due is a warning, not an
  assertion that an asset is mechanically safe. Repair verification clears safety holds.
- Resource requirements allocate specific roles before generic capacity and never
  count the same resource twice. Shortages block Planned/Ready/In Progress; Drafts
  may retain shortages. Copying resets status, checks, documents and actuals.
- Programme dependencies are finish-to-start, using calendar days. Computed dates
  show delays without silently altering planned dates. Graph writes lock the project,
  validate tenant ownership/cycles, reject stale revisions and audit changes.
- Excel includes input values, costing totals and formula-based detail sheets.
  Summary totals are explicitly an application snapshot; workbook edits do not
  update approvals or sync to the app. Text is stored as text, never executable formulas.

## Deliberate limits and next increments

This is an operational first Workshop/programme release, not the entire long-term brief.
QR asset links, pre-start fault ingestion, photo attachments to repairs, recurring service
plans, parts inventory and mechanic-specific role administration remain future increments.
The scheduler retains its existing selection allocation UI; drag/drop, formal dispatch
acceptance, reusable templates and automatic crew recommendations are not yet implemented.
Programme planning does not yet have working calendars, resource levelling, multiple
dependency types, GIS, or automatic programme-to-shift creation. Production-per-day is
shown as an assumption, never substituted silently for duration.

All development and integration testing uses disposable local MySQL and synthetic
accounts. Do not merge or deploy production until the release gates and browser review
are complete. The human maintainer merges main.

## Validation

Results are recorded at completion. Earlier foundation browser checks confirmed signup,
standalone estimate saving with Pipeline disabled, server read-only refusal, and JSON
export. Those checks do not substitute for QA of this tranche.

Current tranche: lint, typecheck, full regression suite, production build, MySQL HTTP
integration, resource backfill, fresh-start and expanded V1 journey all PASS.
Coverage includes tenant isolation, independent repair verification, multiple critical
holds, meter history, programme cycles/stale updates, shift shortages and XLSX roundtrip.

Browser QA remains outstanding: automatic approval review rejected starting the local
preview server with "blocked by policy" and supplied no more specific reason.
This branch is a draft review only; neither Hostinger deployment was changed.
