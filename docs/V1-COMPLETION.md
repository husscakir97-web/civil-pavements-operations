# Infrastruct V1 completion checklist

Working checklist for the V1 completion run (branch `claude/infrastruct-v1-completion-03x6v8`,
based on `hostinger-migration` @ `bde45de`). An item is ticked only when it works **and** is
covered by a test that runs. "Tests" names the suite:

- **journey**: `npm run test:v1`. Production server, real Better Auth sessions, MySQL 8, S3 fixture (scenarios A–G).
- **logic**: `scripts/test-v1-logic.cjs`, part of `npm test`.
- **legacy**: the existing SQLite suites in `npm test`.
- **mysql**: `npm run test:mysql`.
- **browser**: the authenticated Playwright walkthrough recorded in the PR description.

Baseline before this run: lint 0 errors / 18 warnings, typecheck clean, 9 suites pass, build passes,
test:fresh, db:migrate and test:mysql pass.

## 1. Platform
- [x] Typed schema for V1 entities (migration `0003_v1_platform.sql`, append-only). *journey*
- [x] Capability matrix (admin/office/field active; estimator, scheduler, PM, supervisor, accounts, read-only defined), enforced on the server. *logic, journey F*
- [x] Central entitlement service: route (disabled → 404, read-only → writes 403), navigation (areas hidden), seams (fire only when every participating module is entitled), data (downgrade never deletes). *journey*
- [x] Beta signups provisioned with a full-access trial. Older organisations are provisioned lazily. *journey A*
- [x] Typed audit log (`audit_log`) with actor, entity, before/after and project. Admin/project activity views. *journey*
- [x] Lifecycle state machines with server-side transition validation for opportunity, tender, estimate, project, SWMS, docket, variation, claim, invoice and HSEQ registers. *logic*
- [x] `DEFAULT_ORGANISATION_ID` removed. It was already an alias for the session organisation and is renamed `currentOrganisationId`.
- [x] Module-boundary ESLint rule for `lib/modules/*`. *lint*

## 2. Organisation onboarding
- [x] Progressive, skippable onboarding covering the requested profile fields. *journey A, browser*
- [x] ABN format and ATO checksum validation, plus a lookup adapter that is deliberately unconfigured (no fake registry data). *logic, journey A*
- [x] Organisation display name comes from the profile. No Roadworx defaults for new organisations. *journey A*

## 3. Company Library
- [x] Typed library items (category, title, description, content, file, expiry, owner, status, version). *journey B*
- [x] Central private document service on R2 with authenticated downloads, type/size limits, versioning and field visibility. *journey B, G*
- [x] Tender returnables link to library items.
- [x] Existing preparation responses, templates and plans remain available under Company Library.

## 4. Pipeline / Tender
- [x] Opportunities (typed columns on the existing table), owner, value, probability, closing date, conversion to tender with lineage, won/lost. *journey B, browser*
- [x] One authoritative Tender Workspace (Intake, Requirements, Bid review, Estimate, Returnables, Internal approval, Submission, Clarifications, Award), with a persistent header, completion % and a derived next action. *journey B, browser*
- [x] Existing multi-file tender intake (upload, remove/restore, extraction, retry) preserved inside Intake. *legacy*
- [x] Requirements register with source, category, mandatory flag, owner, due date, response, evidence and risk flag. Suggestions from extraction stay `suggested` until a person confirms them. *journey B, logic*
- [x] Bid/no-bid review. The decision is a permissioned human action. *journey B*
- [x] Submission gate (approved estimate, mandatory requirements and returnables complete, internal approval), with an audited override for approvers. *journey B*
- [x] Clarifications. A price change after estimate approval blocks award until a new revision is approved.

## 5. Estimating
- [x] Existing engine extended with discipline-neutral work items (section, cost code, category, quantity, productivity, hours, rate). The paving engine is optional; legacy estimates keep it. *logic, browser*
- [x] Approval workflow draft → review → approved → superseded. Approved revisions are immutable and freeze the rate library. Edits create a new draft. *legacy, journey B*
- [x] Rate libraries per organisation (Admin → Rates, admin only), with rate changes audited.

## 6. Award
- [x] Award → Project seam from the **approved** revision, never the working draft: baseline, cost codes, readiness items, IMS pack, tender requirements and clarifications, full lineage. Idempotent. *legacy, journey B/C*
- [x] Projects not entitled: the award is recorded and a CSV export is offered.

## 7. Projects
- [x] One Project Workspace (Overview, Setup, Delivery, Quality & HSEQ, Commercial, Documents, Closeout), with a persistent header and next action. *browser*
- [x] Setup: contract details, key dates, team and contacts, cost codes, scope/assumptions/exclusions, immutable baseline (manual baseline for non-tender projects). *journey C*
- [x] Readiness calculated from checklist evidence, an approved SWMS, the risk register, the IMS pack and scheduled-worker competencies. Blockers shown. *journey C*

## 8. IMS & HSEQ
- [x] Risk register with deterministic 5×5 rating (organisation thresholds) and human-approved controls. *journey C, logic*
- [x] ITPs and inspection points (hold, witness, review). Field can complete non-hold points; hold points need an authorised release.
- [x] Incidents (field can report), NCRs (verification before close), corrective actions. *journey D*
- [x] Company IMS documents (existing workspace) preserved. Pack items can be marked not applicable with a recorded reason.

## 9. SWMS
- [x] Questionnaire → deterministic draft → review → approve → issue → revise (new version) → supersede. Approved/issued revisions immutable. Worker acknowledgement (idempotent). PDF export. *journey C/D, browser*

## 10. Operations
- [x] Existing scheduler retained (worker/plant clashes, overnight overlap, expired competency, occupancy, readiness gate). Closed projects refuse new shifts. *legacy, journey*

## 11. Resources
- [x] People and plant registers (existing) under Admin → People/Plant and Operations → Resources. Rates hidden from field. *mysql*

## 12. Field
- [x] Mobile-first Today view: assigned shifts, location, supervisor, activity, instructions, SWMS to acknowledge, incidents, quality records, price-free docket submission. Existing shift record retained. *journey D, browser (375/430px)*

## 13. Dockets
- [x] Existing engine preserved. Approval requires `docket.approve`. Claimed dockets are locked. Approved dockets cannot be deleted. *journey E*
- [x] Docket → Cost seam: idempotent (unique source key), reversal on unapprove, closed-project guard. *journey E, logic*

## 14. Commercial
- [x] One money spine (`lib/platform/finance.ts`): original/current contract, original/current budget, actual/committed/accrued, cost to complete, forecast final cost/revenue/profit/margin, earned revenue, unbilled. *logic, journey E*
- [x] Variations draft → submitted → approved/rejected. Approval changes the current contract, never the original. *journey E*

## 15. Claims / Invoices
- [x] Claims from contract, approved variations, approved dockets and other lines. No double claiming (unique key). Line limits enforced. Internal approval → submit → certify (variance) → invoice (GST) → paid. *journey E, logic*

## 16. Reports
- [x] Pipeline, projects, commercial, operations, dockets, HSEQ and Learn (estimate vs actual), all derived from records and hidden without permission or entitlement. *journey E, G*

## 17. Search
- [x] Organisation-, permission- and entitlement-aware. Field search excludes commercial records. No raw metadata returned. *journey F/G, legacy*

## 18. Closeout
- [x] Practical completion → closeout (default checklist) → closed (gated). Closed projects refuse operational records. Reopening requires a reason. *journey*

## 19. Mobile
- [x] Field flow verified at 375px and 430px. Office project workspace verified at 768px and 375px without horizontal overflow. *browser*

## 20. Security
- [x] Session auth only (no `oai-*` headers), membership resolved on the server, fail-closed organisation scoping, CSRF origin check, IDOR checks by known IDs, private R2 with authenticated downloads, upload type/size limits, field commercial projections. *mysql, journey F/G*

## 21. Testing
- [x] Scenarios A–G automated (`npm run test:v1`). Logic suite in `npm test`. Existing suites updated only where V1 intentionally changed behaviour (award requires an approved revision; field search is allowed but filtered).

## 22. Deployment
- [x] Migration 0003 is applied automatically on start by the existing locked, checksummed runner. No new environment variables.
- [x] CI runs lint, typecheck, test, build, test:fresh, db:migrate, test:mysql and test:v1.

## Known limitations (V1)
- Workers, plant, shifts and legacy variations/claims remain JSON-backed entities (existing, working). They were not promoted in this run.
- The old commercial/pipeline/job-hub components remain in the repository but are no longer in the navigation.
- ABN registry lookup, subscription billing and AI drafting are architected but not connected (require an ABR GUID, a billing provider and the product owner's AI activation decision).
- The docket dashboard's own approval screen was not driven by browser QA; approval was exercised through its API (journey E and browser QA).
