# Adding the integrated build's demo company to the existing darkgray site — runbook (prepared, NOT activated)

Destination: the **existing darkgray site and its existing tenant**. No third website is prepared. Everything already entered there is dummy data, but it is **preserved by default**, together with the owner's login, memberships and company profile. Nothing in this document has been run against any hosted system; no merge, deployment, deletion or hosted import has happened.

## Standalone compatibility candidate (2026-10-06; not activated)

The historical release/`npm start` assumptions below are not evidence that the loader runs on Hostinger's Next.js preset. Its publisher launches the generated standalone `server.js`. The local compatibility candidate uses Next's instrumentation hook only when `NODE_ENV=production`, `NEXT_RUNTIME=nodejs`, `EXISTING_TENANT_RUNTIME_ENABLE=true`, a loader mode is set, and the generated standalone entry is executing. Builds, `next dev`, ordinary startup and the isolated importer app remain inert. The hook spawns the existing loader; it does not import database code, migrate, or quiesce in the Next process.

`next.config.ts` explicitly includes the loader scripts, two JSON manifests, policy modules, and mysql2's dependency closure. The isolated app launches `server.js` on a free loopback port with a fresh environment. It also prevents Next from reloading deployment `.env` files into that environment; the installed `@next/env` behavior is covered by a regression test.

All loader modes acquire a database-wide MySQL advisory mutex before quiescence or child launch and hold it through final quiescence. A concurrent instance exits without quiescing. A surviving importer fence also refuses a restarted loader. Connection loss stops the loader; runtime parent loss stops its child loader, and the existing importer watchdog handles loader death. The existing apply lock, deadline, backup attestation/fingerprint, reviewed plan hash and durable baseline/sidecar checks remain in force. This does not authorize concurrent manual importers or other writers.

**Validation gate:** require green results on the exact candidate head before considering publication/deployment readiness. Local preparation could not build the artifact because C: had roughly 81 MiB free. CI uses Linux Node 22 and disposable loopback MySQL: the normal full suite, then the copied artifact with the source checkout hidden, and the complete existing-tenant suite through that copied artifact with concurrent runtime and lock-owner-loss checks. Interruption fixtures use a test-only database trigger barrier so SIGKILL cannot race with import completion; no production hook or guard is bypassed. `npm run test:standalone-artifact -- .next/standalone` checks normal and opt-in startup and the packaged isolated app. `npm run test:standalone-loader` supplies no-database boundary, concurrent-mutex, expiry, resume-argument and process-fixture tests; these are not end-to-end import proof. Consult the PR's current CI evidence for the actual result.

Do not enable the hook on the host until the candidate and those results are reviewed and publication/deployment are separately approved. Before any later import, confirm maintenance across every public runtime instance, a persistent state directory, a fresh restore-tested frozen backup, and the operator-reviewed plan. Clear `EXISTING_TENANT_RUNTIME_ENABLE` with the other run-only variables after the operation. Keep the existing Next.js hosting preset.

Sources: [Next standalone output/tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [instrumentation lifecycle](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).

## Historical release plan (superseded for standalone startup)
* PR #68 (`claude/integrated-work-map-workflow`) is at `b793be2` and **does not contain** the existing-tenant import work. That work is on the local branch `claude/existing-tenant-import`, which **descends from** PR #68's head (a fast-forward), as one complete candidate: PR #68's content + the existing-tenant import path + the maintenance freeze + the CI additions.
* **Nothing is merged or deployed until the exact candidate has passed verification** (below). Publication means pushing the candidate to PR #68's branch (a normal fast-forward push, so PR #68 *is* the candidate) — that needs your approval.

## Why a separate path (and why staging mode stays off)
`STAGING_DEMO_MODE` exists for a *separate, nearly empty* site and **refuses the darkgray database and URL by design** (`docs/STAGING-DEMO.md`). It must not be switched on for darkgray and none of its checks were relaxed. The existing tenant needs the opposite shape — an *additive* import into a populated company — which the importer already does (conflict detection, reviewed plan hash, provenance baseline, resume). This path adds only the **hosted guards around that importer**:

| Guard | How it is enforced |
|---|---|
| Exact target | A reviewed allow-list names `host, port, database, user, appUrl (https), organisationId, adminEmail`. The environment must equal it; its SHA-256 must be typed in (`EXISTING_TENANT_CONFIRM_SHA256`); mode 600; no wildcards or unknown keys; checked **before any connection**, dry run included. |
| Mutually exclusive with staging | Refused if `STAGING_DEMO_MODE=true` or `--staging-allowlist` is also given. |
| **Write freeze (new)** | `MAINTENANCE_UNTIL` puts **the hosted app itself** into bounded maintenance (below). The loader refuses to fingerprint, plan or apply unless it is in force (≥ 5 min for fingerprint/plan, **≥ 15 min for apply**, and ≤ 12 h remaining). |
| Reviewed plan | Unchanged: apply needs the plan hash of a fresh dry run; conflicts/blockers refuse; a hash from before an interruption is stale and refused. |
| Provenance + preservation | Unchanged: a salted-digest baseline of the **whole database** before the first change; at the end every pre-existing row of every tenant must be identical (0 changed, 0 removed). Login, memberships, company profile, billing and other tenants are never touched. |
| Backup evidence | First apply needs evidence whose **fingerprint equals the database's current state**. With the freeze in force this detects any write that slipped through; resume needs the baseline created under that evidence. |
| One import at a time | An advisory database lock refuses a second concurrent apply. (It does **not** stop ordinary app traffic — that is the freeze's job.) |
| Integrations | See below. |
| No shell needed | Runs from the app's own start command (`scripts/start.mjs` → `scripts/existing-tenant-load.mjs`), driven only by environment variables; output in the runtime log. |

### The freeze: what it is and is not
A matching fingerprint only *detects* a change at the moment it is checked. What *prevents* changes is the **maintenance gate** (`proxy.ts`, `lib/platform/maintenance.ts`, `maintenance-fence.ts`):
* While `MAINTENANCE_UNTIL` is a future time, **every request** — page, API, sign-in, webhook, upload, any method — gets **503** with `Retry-After` before any route or handler runs. Only `GET /api/health` answers. Phones and offline device queues simply retry later.
* It is **bounded**: it ends by itself at that time. An invalid or past value never locks the site.
* This application has **no background writer** (no scheduler, cron, instrumentation hook or interval timer in server code; asserted by `scripts/test-maintenance.cjs`). The only writers are requests, the start-up migrations (a no-op when nothing is pending) and the importer's own temporary app.
* **What it cannot control (you confirm):** another application, a Hostinger cron job, a script or phpMyAdmin session writing to the same database; an older instance still serving during a restart.

### What happens if the window ends during an apply (changed behaviour in this revision)
The first version simply stopped blocking at `MAINTENANCE_UNTIL`, which would have reopened the app for normal writes while the importer could still be mutating data. That boundary is now closed in three independent layers, each tested:
1. **The importer has a deadline.** The loader passes `--deadline-ms` = `MAINTENANCE_UNTIL` minus **90 s**. After it, the importer refuses **every** mutation (API and SQL; reads stay allowed), a watchdog ends the process 10 s later (which also stops its temporary app), and it exits **75** (resumable). The loader additionally SIGTERMs (+20 s) and SIGKILLs (+30 s) the importer's whole process group if it is somehow still alive. An apply therefore needs **≥ 15 minutes** of window (fingerprint/plan: ≥ 5 min); the window may not exceed 12 h.
2. **Quiescence before the freeze may lapse.** After the importer stops, the loader kills any database session of this user that is still executing in this database (an in-flight transaction of a dead importer rolls back), waits until none is active, and logs `database quiescence … 0 still active`. If it cannot confirm that, it logs **NOT QUIET**, exits non-zero, and you must **not** lift maintenance.
3. **The app does not reopen while an import session lives (the fence).** While `EXISTING_TENANT_LOAD=apply` is configured, the app stays closed (503) after `MAINTENANCE_UNTIL` for as long as the importer's advisory database lock is held, and reopens **within about a second of that session ending** — no restart needed. If the check cannot be made (database error) or the lock cannot be named, it **stays closed**. The 503 page says an import is finishing. `GET /api/health` reports `maintenance.active`, `import.configured` and `import.inFlight`.

**Explicit recovery.** (a) Normal case: nothing to do; the app reopens by itself after the import session ends. (b) Import stopped at the deadline (log: `stopped at the deadline`): extend `MAINTENANCE_UNTIL` (≥ 15 min), restart with `EXISTING_TENANT_LOAD=plan`, read the new hash, then `apply` again — it resumes from the saved baseline. (c) Stuck closed after the window (health shows `inFlight:true` for more than ~2 minutes after the log says the importer stopped): check the runtime log for `NOT QUIET`; if the importer is gone, remove `EXISTING_TENANT_LOAD` **and** `MAINTENANCE_UNTIL` in hPanel and restart (the importer cannot mutate after its own deadline, which has passed, so this is safe once the log shows it stopped or the deadline is more than a minute old). (d) To end maintenance early at any time before apply: remove `MAINTENANCE_UNTIL` and restart. (e) Full restore of the step-4 backup (`docs/RUNBOOK.md` §5) remains the last resort.

### Integrations during the import
* **Hosted app:** during maintenance it cannot act at all — every request is refused, and as defence in depth email, object storage, address provider, AI and ABN lookup each refuse to run in-process. Its configured SMTP/R2/AI/etc. can stay set; they are unreachable. Proven with a live-looking hosted app (email enabled, SMTP and storage pointed at capture servers): a **control** run without maintenance sends mail and uses storage; the same app in maintenance, through every fingerprint/plan/apply/interruption/resume, contacts **neither**.
* **Importer's temporary app:** built from a fixed whitelist (email/AI off, fake locations, dummy storage); the loader passes the importer only database settings and the run's own values (no SMTP, AI, billing, ABR, map, storage or operator settings).
* **Staging protections are unchanged** and untouched by this work.

**What a human still attests:** that the backup was actually restored into a scratch database and compared (`restoreVerified` in the evidence). The tool checks the attestation is present, ≤ 24 h old, names this database/organisation and matches the frozen state; it cannot prove a backup is restorable.

## Sequence: publication → verification → approved deployment → backup/freeze → reviewed plan → approved apply
Legend: **YOU** = needs you; **CLAUDE** = I can do it once you approve.

**1. Publication (YOU approve, CLAUDE pushes).** Fast-forward push of the candidate to `claude/integrated-work-map-workflow` so PR #68 is the exact candidate. No merge.

**2. Verification (CLAUDE).** CI must be **green on that exact head** — it now runs, on disposable databases, the existing-tenant suite (78 checks: freeze, integrations, window expiry during an apply, deadline with an in-flight write, refusals, populated owner + other tenant, SIGKILL mid-apply, restart, resume, lost baseline) and the staging suite (92 checks incl. managed kill/restart/resume) as well as the existing audit, lint, typecheck, unit (incl. maintenance), build with dev dependencies pruned, migration, v1 and importer suites. Only then is a merge proposed. (Browser journeys remain local-only evidence.)

**3. Approved deployment (YOU).** After you merge PR #68 and approve deployment: follow `docs/RUNBOOK.md` §2–3 — *before* deploying take the standard backup (phpMyAdmin → Export → Custom → all tables, structure and data; keep it off the hosting account) and record the running commit (Hostinger deployment history). Deploy with the **current, unchanged environment**; migrations 0027–0028 apply on start (additive). Confirm sign-in works and your dummy data is intact. Do **not** set any `STAGING_*` variable. Rollback if needed: `docs/RUNBOOK.md` §5 (redeploy the recorded commit; full restore as last resort).

**4. Freeze, backup, fingerprint (YOU, CLAUDE reads the log with you).**
  a. Set `MAINTENANCE_UNTIL` to a time 2–6 h ahead (ISO, e.g. `2026-10-12T20:00:00Z`; at least 15 minutes must remain when you run the apply, never more than 12 h) and restart. **Confirm the freeze:** open the darkgray URL on your phone — it must show *Scheduled maintenance*; `…/api/health` must say `"maintenance":{"active":true,…}`.
  b. Take the backup exactly as in `docs/RUNBOOK.md` §2 (phpMyAdmin Custom export, all tables). Restore it into a scratch database (the restore procedure of §5, step 2, into a scratch database instead) and compare table row counts with live. Note where you restored it.
  c. Set `EXISTING_TENANT_ALLOWLIST_JSON` to one line `{"environment":"existing-tenant-additive","host":"<db host>","port":3306,"database":"<db name>","user":"<db user>","appUrl":"https://<exact darkgray url>","organisationId":"<org id>","adminEmail":"<login email>"}`, `EXISTING_TENANT_CONFIRM_SHA256` = its SHA-256 (`printf '%s' '<json>' | sha256sum`, on your machine) and `EXISTING_TENANT_LOAD=fingerprint`; restart; the log prints `fingerprint: <64 hex>`.
  d. Set `EXISTING_TENANT_BACKUP_EVIDENCE_JSON` to `{"takenAt":"<ISO time of the backup>","database":"<db name>","organisationId":"<org id>","restoreVerified":true,"restoredInto":"<scratch database name, no credentials>","operator":"<your name>","fingerprint":"<from c>"}`.

**5. Reviewed plan (YOU set, we review together).** `EXISTING_TENANT_LOAD=plan`; restart; read the plan in the log: every group and table count, every CONFLICT/BLOCKER (a record of yours colliding with a demo record makes the plan refuse; nothing is guessed), and `planHash`. Nothing is written. **This is the last point to stop.**

**6. Approved apply (YOU approve explicitly, then set).** `EXISTING_TENANT_LOAD=apply`, `EXISTING_TENANT_PLAN_HASH=<hash>`, `DEMO_SEED_PASSWORD=<your login password, only for this run>`; restart; wait for `apply finished with exit code 0`, `database quiescence … 0 still active` and `Existing rows changed: 0; removed: 0` (exit 75 = stopped at the deadline: see *Explicit recovery*).

**7. Clean up and release the freeze (YOU).** After the log shows the apply finished and quiet, empty `EXISTING_TENANT_LOAD`; delete `DEMO_SEED_PASSWORD`, `EXISTING_TENANT_PLAN_HASH`, `EXISTING_TENANT_BACKUP_EVIDENCE_JSON` (and the allow-list variables if you like); **remove `MAINTENANCE_UNTIL`**; restart. Optional: run `verify` once (needs no freeze). Open the site on your phone.

### If something is interrupted (host restart, crash, timeout)
Proven by SIGKILL-ing the whole app mid-apply (maintenance in force throughout):
* The partial import is additive and every pre-existing row is still byte-identical. The freeze keeps users out meanwhile.
* An automatic restart with the same apply settings is **refused** (the plan changed); nothing is duplicated.
* To finish: `EXISTING_TENANT_LOAD=plan`, read the new hash, then `apply` again with it (backup evidence is not needed again; the saved baseline in `EXISTING_TENANT_STATE_DIR`, default `~/.existing-tenant-state`, stands in). If the window is running out, extend `MAINTENANCE_UNTIL` and restart first.
* If the host discarded that state, or its marker is missing, the resume is **refused** and nothing changes. Recovery is the full restore of the step-4 backup (`docs/RUNBOOK.md` §5), then repeat from step 4.

### Rollback
The import adds records only; it cannot remove them. Undo = the §5 full restore of the step-4 backup (and, if you also want the old code, redeploy the recorded commit). Leaving the demo data in place is harmless to your own records.

## Facts to reconfirm (only what is genuinely needed; names, never passwords)
1. **Target:** the exact database **host, port, name and user** darkgray's app uses now (you verified `u840559204_infra_test`; is `u840559204_infrastruct` unused?) and the exact URL (the repo records `https://darkgray-buffalo-804670.hostingersite.com`).
2. **Tenant:** your organisation id (`SELECT id,name FROM organisations`), your login email, and how many other organisations/users share that database.
3. **Backups:** that the standard phpMyAdmin export (RUNBOOK §2) is still how you take backups and where you keep the file; **where you can restore-test** it (a scratch database or a local MySQL).
4. **Other writers:** that **no other application, Hostinger cron job or script uses this database**, and that after a restart the public URL really shows the maintenance page (so no older instance is still serving).
5. **Window:** the maintenance window you will use.

## Assumptions only the real host can confirm
(a) `npm start` runs from the app root; (b) the runtime log is readable in hPanel; (c) memory allows the app plus the importer's temporary app; (d) the state directory survives a restart (otherwise an interruption is recovered by restore); (e) hPanel accepts ~500-character variables; (f) the host does not probe `/` and restart on a 503 (it can use `/api/health`).

## Persistence probe for the recovery folder (filesystem only)

`scripts/demo/state-probe.mjs` answers one question before any backup is trusted to a folder outside the release
directories: does a harmless marker there survive a restart and a redeployment? It imports no database code, opens no
endpoint and reads no secrets; it is off unless set at runtime and runs only in the standalone production server.

Run it in this order. The runtime variables are set by the operator in Hostinger, never in the repository.

1. **Create once.** Set `EXISTING_TENANT_STATE_PROBE=create` and `EXISTING_TENANT_STATE_PROBE_DIR=<absolute dir>` (parent
   must exist), then start the app once. It creates the folder and one marker, `infrastruct-state-probe.json`, atomically
   and never over an existing file, and logs `[state-probe] OK mode=create created=true id=<uuid> sha256=<hash>` to the
   private app log. Record the `id` and `sha256`. Do not redeploy, and do not start the app again in `create` mode.
2. **Switch to verify with both values pinned, before any further restart or redeployment.** Change the variables to
   `EXISTING_TENANT_STATE_PROBE=verify`, `EXISTING_TENANT_STATE_PROBE_EXPECT_ID=<id>` and
   `EXISTING_TENANT_STATE_PROBE_EXPECT_SHA256=<sha256>`, keeping `EXISTING_TENANT_STATE_PROBE_DIR`. The probe runs only
   at server start, so the next start is the first restart and must already pass this check. `verify` is read-only: it never creates or repairs the marker and logs `[state-probe] FAIL` if the marker
   is missing, unreadable, or its id or content hash differs from the pinned values. (An unpinned `verify` only checks that
   the marker is well-formed, so it is not sufficient evidence.)
3. **Restart once more, then redeploy**, leaving the pinned `verify` settings in place. After each start, the log must show
   `[state-probe] OK mode=verify created=false` with the same `id` and `sha256`. Any `FAIL`, or a changed `id`/`sha256`,
   means the folder is not to be trusted for recovery files.
4. **Unset all `EXISTING_TENANT_STATE_PROBE*` variables** when finished. Leaving `create` set is harmless (an existing marker
   is only validated, never overwritten) but is not evidence of persistence.

Refused up front: relative or un-normalised paths, any `public_html`/`hbuilds`/`node_modules`/`.next`/`.git` segment,
anything inside or containing the running release, a symlinked folder or marker, or a symlinked parent resolving to those
places. A `FAIL` never stops the app from starting.

**Launcher-independent, and what a skip line means.** Hostinger starts the generated standalone `server.js` through its own process manager, so `process.argv[1]` is not `server.js`; neither the probe nor the loader hook relies on it. Each hook is explicit opt-in (`EXISTING_TENANT_STATE_PROBE`, or `EXISTING_TENANT_RUNTIME_ENABLE=true` plus a load mode) and runs only when the process proves to be the generated standalone server: production, not a Next build phase, not a loader child, the standalone config variable **equal to the config literal inside the `server.js` of the current directory** (the variable alone is never accepted), and the standalone output files present. When opted in but declined, one private line is logged, with a reason code and the launcher's file name only (never an environment value or path), for example `[state-probe] skipped: reason=standalone-config-mismatch launcher=lsnode.js` or `[existing-tenant-load] runtime hook skipped: reason=...`. Reasons: `not-production`, `not-node-runtime`, `build-phase`, `unexpected-next-phase`, `loader-child-process`, `standalone-config-missing`, `standalone-files-missing`, `server-js-unrecognised`, `server-js-unreadable`, `not-standalone-output`, `standalone-config-mismatch`. No line at all means the hook was not opted in, or the variable did not reach the process, or the log is not capturing the app's output. A build with every opt-in variable set runs nothing (CI proves it).

**Loader output reaches the Runtime log.** The runtime hook starts the loader as a child process. Hostinger captures the app's own console but not file descriptors a child inherits, so the child's output used to be missing and only `runtime child exit: <code>` showed. The hook now relays the child's stdout and stderr line by line through the app's own console (password, secret and token values redacted, lines capped at 16 KB), then prints `runtime child exit: <code>` last. In `fingerprint` mode expect `database quiescence before fingerprint: …`, `fingerprint: <64 hex>`, the evidence hint, and `runtime child exit: 0`; the generic `<mode> finished with exit code` line is printed by plan, apply, verify, reset-plan and reset only.

A matching id/sha256 before and after a restart and a redeploy proves *observed* persistence on that host at that time,
not a permanent hosting guarantee.

## ONE-OFF: replace this tenant's operational data, then import the full demo (NOT activated; remove after use)

Owner-requested for the Roadworx test workspace only. `EXISTING_TENANT_LOAD=reset-plan` and `reset` (`scripts/demo/one-off-reset-tenant.mjs`) are a one-off tool, not a reusable feature: delete the script and the two loader branches once the demo is loaded.

* **`reset-plan` changes no data but is maintenance-required, not read-only.** Like fingerprint, plan and apply it refuses unless `MAINTENANCE_UNTIL` puts the app into maintenance, takes the database lock, and runs quiescence, which **terminates any ACTIVE database session of this database user** (idle sessions are left alone). Never run it against a live app.
* **Required outcome: only the owner's login and the records genuinely required for its access.** Kept (each with its reason in `preservedRecords` of the plan): the tenant's `organisations` row (everything points to it), the allow-listed admin's `users` membership (resolves role and tenant on every request), `organisation_profiles` (the workspace API reads onboarding state and company details; without it the owner is sent back through onboarding) and `organisation_entitlements` (module access; a module that is not entitled 404s). **Never touched:** shared identities (`auth_user`, `auth_account`, `auth_session`, `auth_verification`) and every other tenant.
* **What it deletes (this tenant only):** every row `WHERE organisation_id = <this tenant>` in 115 reviewed tables: the operational ones (clients, projects, workers, plant, shifts, plans, tenders, dockets, claims, HSEQ, documents, notifications...) plus invitations, notification preferences, audit trail (`audit_log`, `audit_events`), `domain_events`, `app_backfills` and `data_migration_issues`, and **every other `users` membership of the tenant** (the plan lists them, with whether each has a login; their shared login remains but has no membership here). One transaction; a before/after snapshot proves exactly the planned rows were removed, nothing else changed or appeared (no other tenant, no shared identity), and the admin is the only member left, otherwise it rolls back. A ledger of every deleted key is written first (mode 600, state directory). Any table with `organisation_id` that is not classified makes the run refuse. The audit trail of the tenant is deleted too (it is not required for access): the backup is the only copy of that history.
* **Billing and AI-spend rows make the run refuse.** `billing_customers`, `billing_events`, `billing_subscriptions` and `ai_usage_ledger` are financial / external-provider records; if the tenant has any, the plan and the reset stop with a message and nothing is deleted. Billing is meant to be unconnected, so this is expected to be empty.
* **Difference from the requested outcome:** none by design; the plan states it (`requestedOutcomeDifference`, printed as `DIFFERENCE FROM THE REQUESTED OUTCOME: None...`) and lists `preservedRecords` and `deletedMembers` before anything runs.
* **Existing recovery state is never moved.** If `baseline.json` (or other state) already exists in `EXISTING_TENANT_STATE_DIR`, `reset` refuses; the operator decides what to do with it. Object-storage files behind deleted document/attachment rows are not touched.
* **Sequence (each hosted step is separately approved):** freeze (`MAINTENANCE_UNTIL`), backup with a scratch restore, `fingerprint`, `reset-plan` and review the counts, the kept members and the difference, set `EXISTING_TENANT_PLAN_HASH`, `EXISTING_TENANT_RESET_CONFIRM=RESET-OPERATIONAL-DATA <organisationId> <planHash>` and the backup evidence, `reset`, then a new `fingerprint`, a new backup with scratch restore and new evidence, `plan`, approved `apply`, `verify`, cleanup. Recovery is the backup restore (`docs/RUNBOOK.md` §5); the ledger lists what was deleted but cannot restore it.
