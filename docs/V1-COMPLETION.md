# Infrastruct V1 completion status

Branch `claude/infrastruct-v1-completion-03x6v8` (PR #8, base `hostinger-migration` @ `bde45de`).

The states used below:

- **COMPLETE**: built, tested by a suite that runs, and exercised in the browser where it has a UI.
- **COMPLETE — external credential required to activate**: code, gates and tests are done. It stays safely off until the named variables are set.
- **PARTIAL**: works, with the stated gap.
- **NOT BUILT**: not built.

The test suites referred to:

| Suite | What it covers |
|---|---|
| **logic** | `scripts/test-v1-logic.cjs` (in `npm test`) |
| **legacy** | The SQLite suites in `npm test` |
| **journey** | `npm run test:v1`: production server, MySQL 8, real sessions, scenarios A–H and R |
| **mysql** | `npm run test:mysql` |
| **backfill** | `npm run test:backfill` |
| **dry-run** | `scripts/test-upgrade-dryrun.mjs` (baseline → branch, manual) |
| **browser** | The UI-driven Playwright QA recorded in the PR |

## Schema

Two migrations, both append-only.

- **`0003_v1_platform`**: 28 new typed tables, plus typed columns on `estimates`, `jobs`, `opportunities` and `tender_requirements`.
- **`0004_v1_resources_retention`**: 10 new typed tables:
  - `worker_competencies`, `shift_assignments`, `data_migration_issues`, `client_requests`, `app_backfills`;
  - `ai_usage_ledger`, `ai_suggestions`;
  - `billing_customers`, `billing_subscriptions`, `billing_events`.

  It also adds typed columns to 7 existing tables: `workers`, `plant`, `shifts`, `jobs`, `progress_claims`, `organisation_profiles` and `organisation_invitations`. Every new table has `organisation_id` and an index on it.

This supersedes the earlier "24 new typed tables" statement: 0003 created 28.

## Status

| Area | State | Implementation | Evidence |
|---|---|---|---|
| Platform: auth, capability matrix, entitlements, audit, state machines | COMPLETE | `lib/platform/*` | logic, journey |
| Nine-role model | COMPLETE | Roles: admin, office, estimator, scheduler, project manager, supervisor, field, accounts, read-only. `roleAllows` gates role and module; money is stripped for roles without `commercial.view` | logic matrix, journey R, browser nav check |
| Invitations | COMPLETE (email must be enabled to send) | Invite, resend (new token), cancel, duplicate guard, audit. Role change, deactivate and reactivate are handled in Team, with last-admin protection | journey R. The send path is covered by test:mysql SMTP fixture |
| Onboarding and ABN checksum | COMPLETE | | journey A, browser |
| ABN register lookup | COMPLETE — external credential required to activate (`ABR_GUID`) | Official ABR JSON service. Flow: checksum → lookup on request → admin confirms → profile saves entity, status, GST date, source and time. Changing the ABN clears the confirmation | logic, journey H (fixture), browser ("not configured") |
| Company Library and documents | COMPLETE | Supersede is limited to the uploader or a document approver, and only the current version in the same context | journey B, R |
| Pipeline, tender, estimating, award | COMPLETE | Award blockers are shown before the attempt. A unique `(org, source_estimate_id)` stops duplicate direct awards | journey B/C, legacy |
| Projects, readiness, closeout | COMPLETE | Visible blocker links. Closed projects refuse legacy job edits | journey, legacy, browser |
| IMS / SWMS / ITP / HSEQ | COMPLETE | SWMS approval gaps are shown and review/approve are disabled until they're resolved. Branded, paginated SWMS PDF | journey C/D |
| Typed resources | COMPLETE | Workers with competencies (revoke, never delete) and app-user link. Plant with compliance. Legacy IDs kept; typed columns are the source of truth, with the legacy metadata mirrored | browser, journey R |
| Legacy resource backfill | COMPLETE | Deterministic shared mapping. Rerunnable, append-only, verified per organisation in one transaction. Issues are flagged, never guessed | backfill, dry-run (41 workers / 12 plant / 25 shifts, 19 issues, legacy rows byte-identical) |
| Scheduling conflict engine | COMPLETE | Checks double-booking (overnight-aware, drafts tentative), inactive/unavailable resources, missing/expired required competency, expired plant compliance. Blocks Planned/Ready/In Progress; drafts always save | logic, legacy (planning), browser (planner form) |
| Field Today (mobile) | COMPLETE | Price-free, 375px | journey D, browser |
| Offline field capture | COMPLETE | IndexedDB queue, cached Today and SWMS, drafts, service worker shell, banner, retry/discard, idempotent sync | logic, journey D sync, browser (offline refresh + resync) |
| Field sync conflict rules | COMPLETE | Rules for replay, duplicate docket, shift changed / rescheduled / cancelled, and SWMS superseded while offline | journey D |
| Dockets and docket → cost seam | COMPLETE | Approval is now available in the dashboard UI for authorised roles. Claimed dockets are locked | journey E, browser (dashboard approval) |
| Commercial: variations, claims, invoices | COMPLETE | Single money store: legacy `/api/commercial` and `commercial_records` writes return 410 | journey E, legacy, mysql |
| Retention | COMPLETE | Enable flag, percentage and cap. Withheld, released and held. Certified retention and net. Invoice raised on certified net + GST. Releases go on new claims, so history is never rewritten | logic, journey (retention), browser |
| Tax invoice PDF | COMPLETE | | journey |
| AI orchestration and features | COMPLETE — external credential required to activate (`AI_ENABLED`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, plus the `ai` entitlement and the organisation admin switch) | Five gates and an idempotent ledger. Suggestions only, source-linked. Features: tender requirements, non-price responses, SWMS assist, IMS drafting. The legacy tender analysis no longer runs on a key alone | logic, journey H (fixture provider) |
| AI tender features end-to-end with real documents | PARTIAL | Guard paths and the orchestration are tested. The requirement and response features are not driven end-to-end with uploaded tender documents in the journey | journey H (guards) |
| Billing foundation | COMPLETE — external credential required to activate (`BILLING_PROVIDER`, `BILLING_WEBHOOK_SECRET`, plus a provider adapter emitting the normalised signed events) | Signature check, idempotent events, plan → entitlements, payment grace period, cancellation → read-only, operator-only manual path. No prices in code | logic, journey H |
| Reports, search, home | COMPLETE | | journey |
| Accessibility | PARTIAL | Contrast tokens raised to WCAG AA, labels added. axe shows no serious/critical findings on the scanned office pages. Screen-reader walkthroughs were not done | browser (axe) |
| Performance | PARTIAL | Office pages settle in about 0.5 s locally. No load testing | browser timings |
| Lint | COMPLETE | 0 errors, 0 warnings, no rules disabled | CI |
| Deployment and rollback | COMPLETE | Migrations and backfill run automatically under the lock. See `docs/RUNBOOK.md` | test:fresh, dry-run |

## Known limitations

- Supervisors use the office shell (read access plus field capture), not the dedicated field shell.
- Every role sees an Admin area (company profile / library views); admin-only actions stay refused on the server.
- Legacy `claims` and `claim_items` rows remain readable and are honoured by V1 claims. No migration of old legacy claims into `progress_claims` was attempted.
- No billing provider adapter (for example Stripe) is included. Providers must post the normalised signed event format.
- The claims panel's "held" retention figure includes a draft claim's retention; project control counts only claims sent to the client.
