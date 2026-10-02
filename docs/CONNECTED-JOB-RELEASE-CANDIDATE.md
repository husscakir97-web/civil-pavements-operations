# Connected-job release candidate

One integration branch combining three open PRs so the connected job can be reviewed and released together.

## Included work (do not merge these PRs separately afterwards)

| Source | Head included | Content |
|---|---|---|
| PR 59 | `ed547a2` | Docket parsing: identity-based splitting, supplier-aware grouping, Run OCR, mandatory human review of uncertain OCR |
| PR 60 | `d2e16fd` | Docket-linked claims need a separately entered, confirmed client charge; client-review PDF |
| PR 61 | `74bc959` | Persisted programme activity costing assumptions, migration 0025 |
| skill | `claude/skill-generator-0tr8n8` | `.claude/skills/run-civil-pavements-operations` (two files only) |

Plus: a MariaDB-tolerant assertion in the 0025 migration test, the driver `scripts/connected-job-workflow.mjs` (`npm run test:connected-workflow`), the rollback containment tool `scripts/programme-costing-containment.mjs` with its real-database test and the manual rehearsal `scripts/rollback-exposure-check.mjs`, and this note.
Merging this PR makes PRs 59, 60 and 61 redundant: close them once it merges. Programme availability stays paused.

## Connected workflow (driven through the existing UI, synthetic data)

Estimate → submitted and approved → tender approval/submission (API-driven; tabs exist) → award creates project → programme activity with saved costing assumptions (preview, save, cancel, reload, stale edit) → two synthetic PDFs uploaded and reviewed → supplier docket allocated and approved → actual cost posted → internal cost corrected (adjustment, no duplicate) → unpriced works docket posts nothing → claim created with a separately agreed client charge → approved and submitted → client-review PDF. Changing internal cost leaves the agreed charge unchanged; a claimed docket is locked.

Boundaries checked by the driver: tenant isolation (read/write), field/site/scheduler/read-only roles, financial redaction, approved-estimate revision immutability, stale edits, uncertain OCR stays in review, no page errors, 390px layout of the drawer and docket review, migration 0025 columns.

## Acceptance checklist
- [ ] `npm run lint`, `typecheck`, `npm test`, `npm run build`
- [ ] `test:fresh`, `test:migration-recovery` (includes the containment procedure), `db:migrate` twice, `test:mysql`, `test:v1`
- [ ] `npm run test:connected-workflow` (empty `*_test` database; set `PDFJS_DIR`/`TESSERACT_ROOT` where CDNs are unreachable)
- [ ] Exact-head CI green

## Release readiness
- Backup the production MySQL database first.
- Migration 0025 only adds nullable/defaulted columns to `program_activities` and changes no existing data, so it needs no database restore. **That does not make an app rollback safe.** Previous main (`b8a75ae`) runs `SELECT * FROM program_activities` and spreads each row into the programme API response with no financial redaction: once any costing assumption is saved, that build returns `direct_cost_rate` (and the `source_estimate_*` references) to project readers who may not see money. Rehearsed on a build of `b8a75ae` against a 0025 database: a site engineer received `direct_cost_rate: 95`.
- Prefer rolling **forward** (fix and redeploy this candidate). If the old build must serve traffic after costing data exists, use the maintenance procedure below **before** it starts; do not rely on the old build ignoring the new columns.
  1. Take the database backup (the cleared values are recoverable only from it).
  2. `node scripts/programme-costing-containment.mjs status` (read-only: how many rows hold costing values).
  3. `node scripts/programme-costing-containment.mjs contain --state <secure path> --confirm`: records each organisation's `projects` entitlement, disables it (programme routes answer 404), clears `direct_cost_rate` and the estimate-item references, then verifies zero values remain and zero organisations can open Projects. It exits non-zero if it cannot verify; in that case keep access blocked.
  4. Deploy the old build. Confirm as a site engineer that the programme is refused and that no financial value is in the database. Only then run `release --state <path> --confirm`, which restores exactly the entitlements it changed (not rates). Re-enter or restore the costing assumptions from the backup only after rolling forward to a build with redaction.
  Restoring the whole database is a last resort and discards everything saved since the backup. Nothing in this procedure is run by the deployment: it is an operator action.
- `main` deploys automatically: merge only with owner approval; confirm email, AI, ABR and billing adapters remain off.
- After deploy: sign in, open a project programme, open an activity drawer, open Work Records.

## Gaps and smallest proposed change
- Proforma "preparation" is the claim client-review PDF; there is no separate proforma/invoice document or client-facing approval. Smallest change: none for this release; label the PDF as review copy (already done).
- Tender approval/submission is exercised by API, not tab-by-tab UI.
- Editing an approved estimate creates a new working revision and returns the estimate to draft (approved revision stays immutable); there is no explicit "locked" refusal. Intended, but worth a UI hint.
- Dockets outside the selected reconciliation month are not shown in the register by default; use the month picker.
- Programme availability and resource allocation are not part of this release.

## Evidence for the corrections
- Rollback hazard reproduced and contained (`scripts/rollback-exposure-check.mjs`, built `b8a75ae`, real MySQL-compatible database): before containment the site engineer received `direct_cost_rate` 95 (200); after `contain` the same request returned 404 and no financial value remained; after `release` the old build served the programme (200) with no rate. Not part of CI (it needs a built copy of the previous main).
- `scripts/test-programme-costing-containment.mjs` runs in `test:migration-recovery`: a dry run changes nothing, contain blocks every organisation and clears the values, an existing state file is never overwritten, release restores only what was changed (an already-disabled organisation stays disabled) and does not restore rates.
- Mobile checks (390px) in `scripts/connected-job-workflow.mjs` previously swallowed a failed open and measured the page underneath. They now fail with the reason if the record does not open and require the dialog to be visible and to fit. Making them strict exposed three test defects, all fixed: the desktop programme drawer was still open (the click never reached its button), the register was still on September (Q-7781 is October; the month is now restored), and the mobile register uses a **Review docket** button instead of the desktop *Edit entry* icon. Rerun on the corrected script: 47 passed, 0 failed; `04-programme-drawer-mobile` and `07-docket-editor-mobile` were inspected and show the real drawer and the real docket review. No application code changed.

## Remaining limitations
- No redaction-preserving build of previous main exists; the fallback is the containment procedure (rates are cleared and Projects is blocked until verified). Rolling forward is the intended recovery.
- The rollback rehearsal and containment are operator actions on the database and are not run in CI.
- Standalone proforma gap unchanged: there is no separate proforma/invoice document or client-facing approval; the client-review PDF of the submitted claim is the nearest output.
