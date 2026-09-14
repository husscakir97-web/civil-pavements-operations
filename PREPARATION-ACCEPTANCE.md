# Contract preparation checkpoint — 13 September 2026

## Release decision

Not released. Existing owner-private live publication remains v29. Authenticated browser acceptance is blocked: the supervised preview shows “Reconnect your ChatGPT session”; its existing sign-in link produced a blank transition, and a fresh verification tab still displayed sign-in. No browser editor, mobile sign-off, browser upload or refresh-persistence result is claimed. Passing isolated API tests and a build does not satisfy that release gate.

## Before-change implementation audit

The clean local starting commit was ac3f992baae22f2ec17a703ac68165470e684a08. Native Sites metadata reported v29 and its existing private URL. Existing functionality included local tender text/OCR readers, docket processing, estimate calculations, generic IMS registration/review and a Job Hub. Preparation of answers and narrative documents, exact-revision response evidence and submission assembly were absent. Existing IMS document-ID links could follow later revisions.

## Implemented, unpublished

- Contract preparation workspace accessible through the existing Pipeline and Compliance shortcuts; navy/orange shell and previous modules retained.
- Company information, answers, templates, plans, responses, structured risk/ITP/action rows, commencement packs, and draft allowances.
- Immutable preparation revision rows with organisation, project/opportunity, actor and audit references; stale writes rejected.
- Existing PDF/image/DOCX/XLSX/CSV reader reused. Candidate questions link to uploaded original and page/sheet/section. Reprocessing deduplicates known source lines. Interpretation remains explicitly unconfirmed until reviewed. No AI provider is active or charged.
- Reuse of approved answer revisions, stale/expired evidence checks, individual response approval, internal document review, separately recorded client acceptance and justified not-applicable decisions.
- Editable document sections, organisation templates, project-information token population, structured risk rows rated from an approved organisation matrix, structured ITPs with source criteria and release authority.
- DOCX/PDF/XLSX/CSV exports and ZIP response/evidence packs with exact-revision manifests, original-file hashes and completeness review. Export does not send or lodge a submission. Manual issue recording protects the issued response; amendments use a copy.
- Authorised manual tender-to-project handover retains the source revision, copies commencement requirements as drafts and preserves original commitments. Existing estimate baselines are not modified.
- Server commencement evaluation includes new pack blockers and retains existing IMS blockers when legacy items exist. Creating a new pack cannot bypass those legacy controls.
- Reviewed requirements create idempotent draft allowances. Estimator-confirmed quantity/rate can add a linked line to a draft estimate, producing a quote revision; approved/submitted/awarded baselines are rejected.
- Field panel displays approved job documents/ITPs. Inspection evidence names the exact document revision. Hold-point release checks named authority and organisation. Restricted staff need an explicit user assignment on the shift.
- Preparation permissions and organisation module flags are separate. Existing module access defaults enabled. No billing or changes to current customer entitlements.

## Test results

Passed (synthetic, isolated in-memory SQLite/R2 fixtures):

- Questionnaire candidates, source references, repeat-processing deduplication, approved answer reuse and missing/expired evidence.
- Saved draft/review/approval, preservation of earlier content and exact approved evidence, stale-write rejection, issued-content protection and reload through API.
- Standalone project creation, transfer of tender requirements, blocked commencement, required external acceptance, authorised resolution and audit evidence.
- Risk/ITP structured rows, approved risk matrix lookup, saved project-information population, field revision-linked evidence and denied supervisor hold-point release.
- Draft allowance confirmation, priced line persistence and repeated-application exclusion.
- Preparation unauthenticated and role denials, foreign-organisation file ID rejection and IMS-only module fixture.
- ZIP manifest selects exact approved revisions and originals. DOCX XML content/response table, XLSX workbook/manifest and CSV rows inspected. PDF first-page rendering visually inspected.
- Existing planning, field, invoice/IMS/commercial repair, commercial calculation, reporting, docket parser and mixed-batch suites passed before final checkpoint; TypeScript, lint and production build passed.

Blocked: authenticated desktop/mobile browser acceptance; browser OCR on representative real tender/VIPQ files; live D1/R2 before/after inventory and original-file verification; authenticated post-deployment checks.

Not yet verified: full DOCX/XLSX visual rendering in office software; realistic large/tangled questionnaires; concurrent requests against the actual D1 runtime (unit tests exercise stale versions and idempotency); organisation onboarding across the entire legacy application.

## Preservation and migration

No live database mutation, migration, file replacement, access change or deployment was performed in this stage. Existing tables and originals are not removed or rewritten by the new migration. Preservation by live inventory remains unverified because an authenticated application session is unavailable; “no writes performed” is not proof every original exists.

The migration adds only preparation_revisions and three indexes. Existing Drizzle history contains colliding snapshot ancestry and cannot generate globally. The additive SQL was generated independently with drizzle-kit from the new table definition, inspected and exercised alongside all existing migrations in isolated SQLite. Applied historical snapshots were not rewritten. Before production release, reconcile the migration metadata/application boundary and record a read-only live inventory. Recovery: retain the additive table and revert the Worker to the prior release if necessary; never drop new revisions or revert by deleting business data.

## Remaining functional limitations

- This checkpoint does not complete every requested acceptance item and must not be described as production-ready.
- Old IMS register evidence links have not been migrated to the preparation revision model. Existing approved documents must be deliberately brought into the preparation library; historical evidence cannot be inferred safely.
- Handover is an authorised explicit action after award; the existing estimate-award button does not automatically invoke preparation handover. Tender-only users can export independently; IMS-only users can create a project without an estimate.
- Supervisor/worker assignment needs explicit user IDs; legacy name/resource assignments are not sufficient for the new field panel. No silent grant of access is used.
- Add-on flags are enforced by the new preparation routes, not by every legacy module. Current customer entitlements cannot be disabled by this stage. Subscription provisioning and billing are not implemented.
- Candidate extraction is rule-based and intentionally uncertain, not semantic AI tender analysis. Unsupported characters in the standard-font PDF export produce a clear DOCX fallback. Imported document layout is not preserved in newly prepared exports; originals remain separately available.
- The existing legacy application still has single-workspace assumptions. New organisation-scoped queries do not make every older route multi-tenant.

## Walkthrough once authenticated acceptance and release are completed

1. Pipeline → Preparation → Company information / Approved answers: enter verified information, attach evidence and review/approve.
2. Tender / VIPQ responses: save a response, upload a questionnaire, check source-linked questions, assign owners/dates and reuse an approved answer.
3. Templates / Project plans: edit sections, populate saved project information, review and export.
4. Risk registers / ITPs: complete structured rows and evidence; confirm the named release authority.
5. Review responses and completeness; export ZIP and inspect the manifest. Record submission only after the user has actually sent it.
6. Transfer the approved tender to an existing or directly created project. Resolve commencement blockers and obtain the required approval/acceptance.
7. Field: open an explicitly assigned shift, read the approved document revision and record inspection evidence. Check upload, save error recovery and touch controls on a phone.

Next stage: reconcile legacy evidence/award handover/field-user mappings, obtain supported authenticated test access, complete the blocked browser and preservation checks, then privately release this checkpoint.
