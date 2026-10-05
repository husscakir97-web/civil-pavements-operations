# Adding the integrated build's demo company to the existing darkgray site — runbook (prepared, NOT activated)

Destination: the **existing darkgray site and its existing tenant**. No third website is prepared. Everything already entered there is dummy data, but it is **preserved by default**, together with the owner's login, memberships and company profile. Nothing in this document has been run against any hosted system; no merge, deployment, deletion or hosted import has happened.

## Why a separate path (and why staging mode stays off)
`STAGING_DEMO_MODE` exists for a *separate, nearly empty* site and **refuses the darkgray database and URL by design** (`docs/STAGING-DEMO.md`). It must not be switched on for darkgray, and none of its checks were relaxed. The existing tenant needs the opposite shape — *additive* import into a populated company — which the importer already does locally (conflict detection, reviewed plan hash, provenance baseline, resume). This path only adds the **hosted guards around that importer**:

| Guard | How it is enforced (code) |
|---|---|
| Exact target | A reviewed allow-list names `host, port, database, user, appUrl (https), organisationId, adminEmail`. The process environment must equal it, the SHA-256 of the file must be typed in (`EXISTING_TENANT_CONFIRM_SHA256`), the file must be mode 600, wildcards/unknown keys are refused, dry run included, **before any connection**. The `--organisation-id` must be the allow-listed one. |
| Mutually exclusive with staging | Refused if `STAGING_DEMO_MODE=true` or `--staging-allowlist` is also given. |
| Reviewed plan | Unchanged: apply needs the plan hash of a fresh dry run; conflicts or blockers refuse; a plan hash from before an interruption is stale and refused. |
| Provenance + preservation | Unchanged: a salted-digest baseline of the **whole database** is taken before the first change; at the end every pre-existing row of every tenant must be identical (0 changed, 0 removed). The importer never touches login, memberships, company profile, billing or other tenants. |
| Backup + write freeze | First apply needs backup evidence (below) whose **fingerprint equals the database's current state** — proof that nothing was written after the backup. Resume needs the baseline that was created under that evidence (a marker file next to it); a baseline without it is refused. |
| One import at a time | An advisory database lock; a second concurrent apply is refused (an orphaned run keeps it until it dies). |
| Integrations off | The hosted loader passes the importer **only** database settings and the run's own values — never SMTP, email, SMS, billing, AI, ABR, Google Maps, R2 or operator settings — and the importer's own temporary app is built from a fixed whitelist (email/AI off, fake locations, dummy storage). Your real app keeps its normal configuration. |
| No shell needed | Runs from the app's own start command (`scripts/start.mjs` → `scripts/existing-tenant-load.mjs`), driven only by environment variables, output in the runtime log. Hostinger's managed Node.js hosting cannot be assumed to give a shell or npm (see `docs/STAGING-DEMO.md`). |

**What a human still attests:** that the backup was *actually restored into a scratch database and compared* (`restoreVerified` in the evidence file). The tool checks the attestation is present, recent (≤ 24 h), names this database/organisation and matches the frozen state — it cannot prove a backup is restorable.

## One deployment / import plan
Legend: **YOU** = needs you (hPanel, approvals, your judgement); **CLAUDE** = I can prepare/guide once you approve; nothing below is done yet.

**0. Approvals (YOU, before anything):** merge approval for PR #68 (human merge), deployment approval, a maintenance window, and the target details listed at the end.

**1. Backup #0 (YOU)** — export the darkgray database (hPanel backup / phpMyAdmin export) *before deploying*. The deployment applies migrations 0027–0028 on start; they are additive (new tables only), so the previous app version keeps working if you redeploy it.

**2. Deploy the integrated build (YOU, after merge approval)** to the existing darkgray app with its **current, unchanged environment variables**. Confirm it starts, you can sign in, and your dummy data is intact. Do **not** set any `STAGING_*` variable.

**3. Freeze + Backup #1 (YOU)** — from now until step 8 nobody uses the site (no sign-ins and no edits: either can write and would invalidate the fingerprint). Export the database again (this is the evidence backup, post-migration). **Restore it into a scratch database** (phpMyAdmin/hPanel) and compare table row counts with the live one; note where you restored it.

**4. Fingerprint (YOU set variables, I read the result with you):** set `EXISTING_TENANT_ALLOWLIST_JSON` to one line `{"environment":"existing-tenant-additive","host":"<db host>","port":3306,"database":"<db name>","user":"<db user>","appUrl":"https://<exact darkgray url>","organisationId":"<your org id>","adminEmail":"<your login email>"}`, `EXISTING_TENANT_CONFIRM_SHA256` = its SHA-256 (`printf '%s' '<json>' | sha256sum` on your machine) and `EXISTING_TENANT_LOAD=fingerprint`. Restart. The runtime log prints `fingerprint: <64 hex>`.

**5. Evidence (YOU):** set `EXISTING_TENANT_BACKUP_EVIDENCE_JSON` to `{"takenAt":"<ISO time of backup #1>","database":"<db name>","organisationId":"<org id>","restoreVerified":true,"restoredInto":"<scratch database name, no credentials>","operator":"<your name>","fingerprint":"<from step 4>"}`.

**6. Plan (YOU set, we review together):** `EXISTING_TENANT_LOAD=plan`; restart; read the plan in the log: groups, per-table counts, every CONFLICT/BLOCKER (a record of yours that collides with a demo record makes the plan refuse; nothing is guessed), and `planHash`. Nothing is written.

**7. Apply (YOU):** `EXISTING_TENANT_LOAD=apply`, `EXISTING_TENANT_PLAN_HASH=<hash>`, `DEMO_SEED_PASSWORD=<your login password, only for this run>`; restart; wait for `apply finished with exit code 0` and `Existing rows changed: 0; removed: 0` in the log.

**8. Clean up (YOU):** immediately empty `EXISTING_TENANT_LOAD` and delete `DEMO_SEED_PASSWORD`, `EXISTING_TENANT_PLAN_HASH`, `EXISTING_TENANT_BACKUP_EVIDENCE_JSON` (and the allow-list variables if you like); restart. Optional: `EXISTING_TENANT_LOAD=verify` once, then empty it. Change your password if you prefer. Unfreeze. Open the site on your phone: the demo company sits alongside your existing records.

### If something is interrupted (host restart, crash, timeout)
Proven by SIGKILL-ing the whole app mid-apply in `npm run test:existing-tenant`:
* The partial import is **not harmful**: it is additive and every pre-existing row is still byte-identical.
* An automatic restart with the same apply settings is **refused** (the plan changed); nothing is duplicated.
* To finish: set `EXISTING_TENANT_LOAD=plan`, read the new hash, then `apply` again with the new hash (backup evidence is no longer needed; the saved baseline stands in). The resume baseline lives in `EXISTING_TENANT_STATE_DIR` (default `~/.existing-tenant-state`).
* If the host **discarded** that state, or the marker is missing, resuming is **refused** and nothing is changed. Recovery is then the restore of backup #1 (the import cannot remove what it added), after which you re-run from step 3.

### Rollback
The import adds records only and cannot remove them. Undo = restore backup #1 (or #0 plus redeploying the previous commit). Leaving the demo data in place is harmless to your own records.

## Assumptions that only the real host can confirm
(a) `npm start` runs from the app root; (b) the runtime log is readable in hPanel; (c) memory allows the app plus the importer's own temporary app (two Next processes); (d) the state directory survives a restart (if not, an interruption is recovered by restore, as above); (e) hPanel accepts ~500-character variables (the allow-list, evidence). The load runs in the background so the host's health check is not blocked.

## Details and approvals still needed from you (names only — never passwords)
1. Exact database **host, port, name and user** (you verified `u840559204_infra_test` earlier; please re-confirm it is what darkgray's app uses *now*, and whether `u840559204_infrastruct` is unused), and the exact **darkgray URL** (`https://darkgray-buffalo-804670.hostingersite.com` is the one recorded in the repo).
2. The **organisation id** of your company (`SELECT id,name FROM organisations` in phpMyAdmin) and the number of other tenants/users in that database.
3. The **login email** of the administrator of that organisation (the importer signs in as that account).
4. Whether hPanel can export the database and whether you can **restore into a scratch database** (a second small database, or a local MySQL) for step 3.
5. A **maintenance window** during which no one uses the site.
6. Explicit approvals: merging PR #68, deploying it to darkgray, and the hosted import (steps 1–8). Until then nothing happens.
