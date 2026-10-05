# Adding the integrated build's demo company to the existing darkgray site — runbook (prepared, NOT activated)

Destination: the **existing darkgray site and its existing tenant**. No third website is prepared. Everything already entered there is dummy data, but it is **preserved by default**, together with the owner's login, memberships and company profile. Nothing in this document has been run against any hosted system; no merge, deployment, deletion or hosted import has happened.

## Release plan (corrected)
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
