# Workflow and mobile review — 12 September 2026

Status: implementation and local regression checks completed for the changes
below. Publication held pending authenticated browser QA. This is a source and
local integration review, not a claim that every screen has passed phone testing.

## Changes

- Navigation: phone quick links, accessible modal menu with focus management,
  scrolling navigation, sticky header, hash navigation for reload/back support.
- Opportunities: select the tender opportunity explicitly; never silently attach
  the assistant to the first record. Show the register before the form on phones;
  New and Edit scroll to the form. Remove automatic keyboard opening.
- Estimating: rate entry rows stack on narrow screens; rate dialog uses dynamic
  viewport height. Existing estimate and award behaviour retained.
- Planning: single-day default instead of the seven-day board; wrapping actions.
- Dockets: phone cards expose number, date, client, project, hours, amount,
  quantity, confidence and review/delete actions. Desktop table retained.
- Invoices: editable fields precede the original on phones; shorter source viewer;
  duplicate confirmation disabled in UI as well as rejected by the API.
- Commercial: financial export named accurately and CSV values quoted. Removed
  accrued-cost card that duplicated actual cost. Contract remainder no longer
  labelled completed work. Quantities identified as planned; provisional margin
  explained. Invoice confirmation does not silently claim to post job costs.
- Reports and shared controls: wrapping headers, touch-sized controls, 16px phone
  inputs, bounded dialogs, safe-area space for bottom navigation.

## Module handoff findings

| Area | Finding / remaining work |
| --- | --- |
| Opportunities and tenders | Explicit opportunity selection fixed. Tender extraction and draft creation remain review steps; provider/billing is not activated. |
| Estimates and jobs | Award baseline and repeated-award protection passed local tests. Manually created jobs have no approved estimate baseline. |
| Planning and resources | Assignment, overnight overlap, expiry, occupancy and readiness gates passed local tests. Resource records must exist before assignment. |
| Field | Progressive save, reload, submission, immutable history and authorised amendment passed local tests. Browser camera/upload and phone keyboard flows remain unverified. |
| Dockets | Parsing/mixed-batch regressions pass; those are text parsing tests, not evidence of handwriting recognition accuracy. |
| Invoices | Upload/save/review/duplicate tests pass. Confirmed invoice records are not yet reconciled into the job-cost ledger. |
| Commercial | Field costs and docket costs may overlap. Forecast does not model remaining work completely. Do not treat indicative figures as reconciled final margin. |
| QA and safety | Register exists; the requested complete ITP/hold-point/sign-off workflow needs further functional validation. |
| Reports | Aggregates depend on recorded data; missing dates are not proof of readiness. Browser report navigation and responsive layouts remain unverified. |
| Settings / SaaS | Configurable branding is implemented. Subscription billing and full organisation onboarding/isolation are incomplete; retain the fail-closed organisation restriction. |

## Release checks

Passed locally: docket parser fixtures, mixed docket batches, invoice persistence
and validation, branding permissions, paid-AI safeguards, estimate-to-planning
handoff, field completion and amendment integration tests.

Authenticated browser testing was blocked by preview sign-in in the preceding
turn. That blocker remains unresolved. Before publication, test all modules at
320, 390, 768 and desktop widths: navigation, no unintended page overflow,
dialog keyboard/focus, file upload, unsaved edits, save/reload and error recovery.
Test original scanned documents separately from saved OCR text.


## Continuation checkpoint — 12 September 2026

Not published. New IMS API and tables are draft implementation, not a completed production stage.

Verified in isolated SQLite fixtures: docket parser/mixed batches; invoice uploads and duplicate protection; branding and disabled paid AI; planning and field baselines; missing IMS pack blocks readiness even with checked checklist; current approved evidence permits readiness; IMS denies unauthenticated users, reader mutations, unsupported statuses, approval without evidence and create-status approval bypass. Repeated job pack initialization retains one pack.

Production build passed. Full lint remains failed (60 errors); prior exclusions of commercial source and test scripts were removed. Build alone is not a release gate pass. Live database/file inventory and authenticated mobile acceptance remain unverified.

Outstanding: automatic award-to-IMS requirement transfer, complete document revision/edit/upload experience, central Job Hub, organisation membership and per-module role enforcement across legacy routes, full end-to-end claim flow and live file preservation checks. The IMS UI currently lacks job/opportunity selection and must not be presented as finished. No production migration has been applied.


## Current review build — subsequent fixes

Implemented Job Hub, project/opportunity selectors in Compliance, evidence uploads, document approval/rejection/submission/acceptance, replacement revisions, automatic award-to-IMS pack generation and source requirement copies. Original estimate budgets remain protected. Commercial code no longer suppresses TypeScript checks; refresh effects corrected. Commercial route authenticates direct reads and writes. CommonJS lint configuration applies only to CommonJS test scripts; application lint is enabled.

Passed: TypeScript, lint (zero errors), production build; docket parsing/mixed batches; invoice extraction/upload/duplicate checks; IMS evidence rejection/permissions/idempotent pack creation; estimate award/planning/readiness/immutable baseline; field progressive saving/submission/amendment; commercial claims and duplicate exclusion; Job Hub API; reporting with empty databases, fixture file retention and foreign records excluded.

Publication remains blocked by requested live/browser acceptance: supervised preview returns the ChatGPT reconnect screen, including after its sign-in link and a fresh verification tab. Authenticated mobile flows could not be observed. A read-only attempt to reach the deployed reports API returned HTTP 403; live record/file inventory has not been verified. No production deployment or database migration was executed.

This is a private-review candidate, not certified as a full multi-tenant subscription product. Legacy organisation configuration remains fail-closed. No claim is made that every production requirement or role-specific workflow is complete.
