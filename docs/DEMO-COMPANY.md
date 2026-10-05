# Demo company — "Kestrel Civil & Pavements (DEMO)"

A fictional multi-division civil contractor (Traffic Control, Asphalt & Pavement Maintenance, Profiling) for demonstrating Infrastruct end to end. **Test databases only.** Nothing here has been run against, or copied from, any live tenant.

Baseline: PR 63 head `b6c16bf820cd3ee9e82789de8e39c25fe0f1a09e` (includes the PR 62 integration work). Isolated branch `chatgpt/demo-company-seed`, local only.

## Run it
```
npm run build && node scripts/migrate.mjs                 # MYSQL_* of a disposable database whose name ends in _test
node node_modules/next/dist/bin/next start -p 3191        # EMAIL_ENABLED=false, no integrations configured
# sign up (or sign in as) an administrator of the organisation to fill, then:
DEMO_SEED_EMAIL=... DEMO_SEED_PASSWORD=... node scripts/seed-demo-company.mjs --base-url http://localhost:3191 [--seed-date YYYY-MM-DD] [--manifest out.json]
```
- `--seed-date` (default `2026-10-05`) is the explicit "today" of the dataset: every date is an offset from it (completed work before, an in-progress shift on it, planned work after). Pass today's date to make calendar views line up with the real clock.
- The seed writes **through the application's HTTP API**, so every state machine, approval, audit row and conflict rule is the real one. SQL is used read-only to find what already exists, plus three marked back-dated conditions (today's shift set to *In Progress*, the demo users, the organisation display name).
- **Idempotent**: each record is found by a natural key (employee number, plant number, `DEMO-T-…`/`DEMO-D-…` references, plan and scenario names) and created only if missing. A second run created nothing and left every table of the organisation unchanged.
- **IDs**: Planning ids and the demo users' ids are deterministic (derived from the organisation); records created by the application (workers, tenders, dockets…) get application-generated ids and are identified by their natural keys, not by fixed ids.

## Safety
The seed refuses (exit 2, nothing changed, no database connection opened for environment refusals) when: the database name does not end in `_test`; `MYSQL_HOST` is not this machine; `--base-url` is not local; `NODE_ENV=production`; `EMAIL_ENABLED`/`AI_ENABLED` is true or any SMTP, billing, ABR, AI, SMS or webhook variable is set; the account is unknown to this database or is not an administrator; or the organisation has a billing relationship. Contact details use `.invalid` addresses; no communication, notification, billing or webhook row is created (verified). Reruns touch only the seeded organisation; a bystander tenant and a second seeded tenant were verified untouched.

## Dataset manifest (counts from the verified run; full list in `docs/DEMO-COMPANY-MANIFEST.json`)
| Area | Seeded |
|---|---|
| Company | profile, 3 divisions (TC, APM, PRF), 6 users (admin + project manager, estimator, scheduler, site engineer, accounts — **no logins**) |
| People | 14 employees (traffic control, paving, profiling), 31 qualifications (current, expiring, expired) |
| Plant & vehicles | 12 items (profilers, paver, rollers, tippers, water cart, VMS/arrow boards, ute), 3 crews, 2 suppliers, 2 subcontractors |
| CRM | 4 clients, 6 sites, 6 contacts |
| Pipeline | 3 leads/qualified opportunities, 8 tenders (awarded ×3, submitted, internal approval, pricing ×2, lost), 7 estimates (draft, in review, approved) |
| Projects | 3 (PRJ-0001 Quarry Road *active*, PRJ-0002 Anzac Parade *closed*, PRJ-0003 Night TC *setup*) with baselines, team, risks, SWMS, ITPs, readiness/closeout, programme (7 activities with saved costing assumptions) |
| Resourcing | 17 shifts, 139 resource allocations (completed, in progress, planned, draft) |
| Work map | 3 synthetic site pins (client sites) and 1 project override, 3 confirmed work points (one deliberately **moved** by 450 m), 20 work areas (asphalt, stabilisation, traffic management — own crew and subcontracted, one archived), 27 shift-to-area links. All names start `DEMO –`; pins are synthetic points in a fictional shire. Operational markup only, not a traffic management plan. |
| Money | 8 dockets, 6 posted actual-cost rows, 4 claims (paid ×2, submitted, internal approval), 2 invoices (retention and GST applied by the platform) |
| Safety & quality | 3 workshop orders (critical defect with safety hold, 2 repairs awaiting independent verification), 3 service events/plans, 2 incidents, 1 NCR, 3 corrective actions |
| Planning | 1 plan linked to the approved estimate and project, 3 scenarios (base, night works, subcontract profiling), 21 activities, 21 dependencies, 6 shared costs |

Relationships verified: every project has tender lineage, an approved estimate revision and a baseline; every shift belongs to a project and every allocation to a worker/plant record of the same organisation; every approved allocated docket has exactly its cost posted once; no relationship crosses an organisation.

## Test cases (all labelled `TEST` in the data)
| Case | Where | Expected |
|---|---|---|
| Resource clash | Schedule: *TEST CLASH — Profiling Quarry Road second crew* / *… carpark enquiry* (Draft) | worker and plant double-booked; moving either to Planned is refused |
| Unavailable plant | *TEST — Unavailable plant*; Resources → Plant: P02 (critical defect, safety hold, Out of service), P12 (registration expired) | blocked on Planned |
| Expired qualification | *TEST — Expired qualification*; Resources → People: Sofia Marchetti (TC expired 30 days before the seed date) | blocked on Planned; 2 more licences expire within 30 days |
| Unpriced work | Estimate DEMO-T-007 (item with no rate), docket DEMO-D-004 (unpriced, in review) | unknown, never zero; posts no cost; needs human review |
| Overdue actions | HSEQ: corrective action due 10 days before the seed date; NCR due 6 days before | overdue on Home and in HSEQ |
| Cost corrected, charge unchanged | docket DEMO-D-006 and progress claim 3 | internal cost $725 (was $600), posted once; separately agreed client charge $1,000 with its reference |
| Service overdue / due soon | Workshop: P07 (overdue), P05 (due in 10 days) | warnings on booking |

## Walkthrough (about 15 minutes)
1. **Home**: attention tiles (draft shifts, plant on safety hold, expired competencies, overdue action) and *My work*.
2. **Pipeline → Tenders / Estimates**: follow DEMO-T-001 (awarded) back to its approved estimate; open DEMO-T-006 (in review) and DEMO-T-007 (draft, unpriced item).
3. **Projects → Quarry Road**: baseline, team, readiness, programme (Programme tab shows saved costing assumptions).
4. **Schedule**: the seed-date shift (In Progress), then try to set a TEST shift to *Planned* and read the refusal.
5. **Resources → People / Plant / Workshop**: expired and expiring qualifications, plant on hold, repairs awaiting independent verification (a second administrator must verify; the seed has only one login).
6. **Commercial → Work Records**: pick the month of each docket; approve and allocate DEMO-D-005 to Quarry Road and watch the project cost rise by $7,392.00.
7. **Commercial → Overview**: claim 3 (internal approval) with the $1,000 agreed charge against the $725 cost; the paid and submitted claims.
8. **Pipeline → Planning**: open *Quarry Road resurfacing — methodology options*, compare the three scenarios (base, night works, pending-quote subcontract = total *unknown*), change a rate, save, reload.

## Validation (final code, disposable databases)
- `node scripts/test-demo-seed.mjs` (21 checks): ten safety refusals each leaving the database unchanged; first run completes with all 50 seed-time verification checks passing; second run creates nothing and leaves every organisation table unchanged; an unrelated tenant and a second seeded tenant unaffected; no deterministic id shared between tenants.
- `node scripts/demo-walkthrough-check.mjs` (44 checks): the key screens on desktop (1440) and mobile (390) with the intended records visible and no horizontal overflow; registers show each docket in the month its work date belongs to; one connected job (docket approved and allocated, cost +$7,392.00); one Planning scenario (discard, change, save, reload, restore). 35 screenshots saved; representative ones inspected (home, schedule, people, plant, projects, work records, Planning on desktop and mobile).
- Lint: no errors in the new scripts. `npm test` and the platform suites are unaffected (no application code changed).

## Limitations and gaps (nothing below was invented)
- **Not supported by the product, so not seeded**: dated leave or availability calendars (only a *Leave* status exists; programme availability is paused), a standalone proforma/invoice document with client approval (the claim's client-review PDF is the nearest output), variations and tender requirements/returnables/clarifications (supported, not requested), uploaded files and forms (storage and OCR are disabled).
- Demo users have no credentials: role-permission demonstrations need real invitations, which send email (disabled). Independent verification of repairs needs a second login.
- Audit timestamps are the real time of seeding; business dates follow `--seed-date`.
- The seed needs a running app and an administrator login; the walkthrough check mutates the seeded data (one docket, one plan rate; the rate is restored), so re-seed a fresh database afterwards.
- Resource references in Planning scenarios point at seeded workers and plant but the Planning UI has no picker for them yet.

## Live replacement is a later step — blockers
Target: the company on `darkgray-buffalo-804670.hostingersite.com`, preserving the owner's login, memberships and settings and leaving other tenants untouched. **Not verified and not attempted:**
- The live tenant cannot be identified from here (no database or admin access; the Hostinger connector in this session is unauthorised). Its organisation id, membership list and settings are unknown, so no replacement inventory exists.
- The live backup is unverified: the hosting dashboard shows "Backups: Daily", but nothing confirms that it covers the application database or that it can be restored. No restore test has been done.
- The seed deliberately refuses a non-test database, a remote host, a non-local app URL and any organisation with billing. A live mode would need, as separate approved work: an explicit organisation id, a read-only inventory of what exists (and what would be removed), a verified backup restored into a scratch database, a maintenance window, and a way to preserve the existing admin and memberships (the seed fills an existing organisation and never edits or deletes users it did not create, but it does rename the organisation and overwrite its company profile, which a live mode must not do).
