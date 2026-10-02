# Connected-job release candidate

One integration branch combining three open PRs so the connected job can be reviewed and released together.

## Included work (do not merge these PRs separately afterwards)

| Source | Head included | Content |
|---|---|---|
| PR 59 | `ed547a2` | Docket parsing: identity-based splitting, supplier-aware grouping, Run OCR, mandatory human review of uncertain OCR |
| PR 60 | `d2e16fd` | Docket-linked claims need a separately entered, confirmed client charge; client-review PDF |
| PR 61 | `74bc959` | Persisted programme activity costing assumptions, migration 0025 |
| skill | `claude/skill-generator-0tr8n8` | `.claude/skills/run-civil-pavements-operations` (two files only) |

Plus: a MariaDB-tolerant assertion in the 0025 migration test, the driver `scripts/connected-job-workflow.mjs` (`npm run test:connected-workflow`) and this note.
Merging this PR makes PRs 59, 60 and 61 redundant: close them once it merges. Programme availability stays paused.

## Connected workflow (driven through the existing UI, synthetic data)

Estimate → submitted and approved → tender approval/submission (API-driven; tabs exist) → award creates project → programme activity with saved costing assumptions (preview, save, cancel, reload, stale edit) → two synthetic PDFs uploaded and reviewed → supplier docket allocated and approved → actual cost posted → internal cost corrected (adjustment, no duplicate) → unpriced works docket posts nothing → claim created with a separately agreed client charge → approved and submitted → client-review PDF. Changing internal cost leaves the agreed charge unchanged; a claimed docket is locked.

Boundaries checked by the driver: tenant isolation (read/write), field/site/scheduler/read-only roles, financial redaction, approved-estimate revision immutability, stale edits, uncertain OCR stays in review, no page errors, 390px layout of the drawer and docket review, migration 0025 columns.

## Acceptance checklist
- [ ] `npm run lint`, `typecheck`, `npm test`, `npm run build`
- [ ] `test:fresh`, `test:migration-recovery`, `db:migrate` twice, `test:mysql`, `test:v1`
- [ ] `npm run test:connected-workflow` (empty `*_test` database; set `PDFJS_DIR`/`TESSERACT_ROOT` where CDNs are unreachable)
- [ ] Exact-head CI green

## Release readiness
- Backup the production MySQL database first.
- Migration 0025 only adds nullable/defaulted columns to `program_activities` (forward-only). The previous app build ignores them, so an app rollback to the prior commit is safe without a DB restore. Restore from backup only as a last resort.
- `main` deploys automatically: merge only with owner approval; confirm email, AI, ABR and billing adapters remain off.
- After deploy: sign in, open a project programme, open an activity drawer, open Work Records.

## Gaps and smallest proposed change
- Proforma "preparation" is the claim client-review PDF; there is no separate proforma/invoice document or client-facing approval. Smallest change: none for this release; label the PDF as review copy (already done).
- Tender approval/submission is exercised by API, not tab-by-tab UI.
- Editing an approved estimate creates a new working revision and returns the estimate to draft (approved revision stays immutable); there is no explicit "locked" refusal. Intended, but worth a UI hint.
- Dockets outside the selected reconciliation month are not shown in the register by default; use the month picker.
- Programme availability and resource allocation are not part of this release.
