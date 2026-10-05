# Phone-accessible demonstration (staging path) — prepared, NOT activated

Goal: the full synthetic demo company (`scripts/demo/*`, the dataset in `docs/DEMO-COMPANY.md`) on a URL you can open on a phone, completely separate from the live site, its database and your newly entered records. Nothing here has been run against any hosted system, and no hosting fact below has been verified from the hosting account in this step.

## Protected live targets (refused regardless of any suffix)
* Databases: `u840559204_infra_test` (the database you verified as the live one) and `u840559204_infrastruct` (the name still recorded in `.env.example` and `HOSTINGER-MIGRATION.md`). Both are refused by name, case-insensitively, and an operator can add more with `STAGING_REFUSE_DATABASES`. The repo cannot tell which is currently live; this document does not claim the live target has changed.
* App URLs: `darkgray-buffalo-804670.hostingersite.com` (recorded in `docs/DEMO-COMPANY.md`) and any host starting `darkgray-` or `navajowhite-` (`docs/LOCATIONS.md` records both prefixes), plus anything in `STAGING_REFUSE_URLS`.
* A name ending in `_test` proves nothing in either direction: the staging target must be named **exactly, twice** (`STAGING_DEMO_DATABASE`, `STAGING_DEMO_URL`) and must equal the real `MYSQL_DATABASE` / `BETTER_AUTH_URL`.

## Where the restrictions run (before any write)
One policy (`lib/platform/staging-policy.mjs` for scripts, its TypeScript twin `lib/platform/staging.ts` for the app, asserted identical over 40+ environments) is evaluated **before a connection is opened** in every place that connects: the app pool (`lib/platform/database.ts`), every script through `scripts/mysql-config.mjs` — which includes `scripts/migrate.mjs`, therefore **`npm run build` (prebuild → `migrate-on-build.mjs`) and `npm start` (`start.mjs`)** — and `import-platform-knowledge.mjs`. With `STAGING_DEMO_MODE=true` a wrong environment stops the build/start with a clear message, before any migration, bootstrap write or import mutation. With the flag off nothing changes (the live app is unaffected). Proven on disposable local fixtures (`npm run test:staging-path`, 88 checks), including an empty and a migrated, populated fixture that merely *carries* the live database's name: every entry point refuses and every row of every table is unchanged.

Also enforced while in staging mode: `EMAIL_ENABLED=false`; `LOCATION_PROVIDER` = `fake`/`none`; SMTP, billing, ABR, AI, Google Maps, R2/object storage and operator-email variables must be **unset**; sign-up is closed except the one allow-listed administrator, once; noindex header.

## The importer's allow-list mode (the only way it may touch a non-local / non-`_test` database)
`--staging-allowlist allow.json` replaces only the `_test`/local-host checks. A reviewed file names exact `host/port/database/user/appUrl/adminEmail`; the SHA-256 of that file must be typed in as `STAGING_DEMO_CONFIRM_SHA256`; the environment must equal the file; protected databases/URLs, wildcards and files writable by others are refused (dry run too, before connecting). The database must hold **exactly one organisation, the allow-listed administrator, at most the dataset's own five team members, and exactly one login** — so a first run, an interrupted run, a repeat and a verification are all legitimate, while any other tenant, user or login is refused. The importer's own app is bound to the same database and has email/AI off and fake locations. `npm run staging:verify` (read-only) re-checks all of this and the demonstration records at any time.

## How demo loading will run on Hostinger (verified vs assumed)
Hostinger's managed Node.js hosting installs, builds and starts the app itself. Hostinger's published guidance (as summarised from its support pages; the primary pages could not be fetched from this environment, so re-read them in hPanel) says that **npm commands run automatically at deploy and cannot be run through SSH, and that manual edits made over File Manager/FTP/SSH do not persist across a redeploy** — see [How to add a Node.js web app in Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [Hostinger Node.js docs](https://docs.hostinger.com/node.js/creating-an-app) and the [redeploy guide](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/). **This plan therefore does not assume a shell, `npm` or `node` over SSH, and does not depend on one.**

Instead the load runs **from the application's own start command**. `npm start` → `scripts/start.mjs` migrates, starts the server immediately (so the host's health check is never blocked) and, only if `STAGING_DEMO_MODE=true` **and** `STAGING_DEMO_LOAD` is set, starts `scripts/staging-load.mjs` in the background. It is driven only by environment variables you set in hPanel, writes its output to the app's runtime log, and runs the same importer and verifier with the same allow-list and guards (it builds the allow-list file from `STAGING_DEMO_ALLOWLIST_JSON`; nothing is bypassed):

| `STAGING_DEMO_LOAD` | What happens | Extra variables |
|---|---|---|
| `plan` | read-only dry run; the plan and its hash are printed to the log | — |
| `apply` | the reviewed import, then the log says how to switch it off | `STAGING_DEMO_PLAN_HASH` (hash from the plan run), `DEMO_SEED_PASSWORD` (the administrator's, **only for this run**) |
| `verify` | read-only verification | — |

Tested locally with `scripts/start.mjs` as the entry point (no shell, no npm) in `npm run test:staging-path` (88 checks): plan prints a hash and writes nothing while the app serves; an unreviewed hash and a missing password are refused with nothing changed; the reviewed apply loads the full company (20 areas, 27 links, 17 shifts, six users, one login); verify passes; a restart with the apply setting left on is harmless; the default importer still refuses `NODE_ENV=production` (only the allow-list path accepts it, because a managed host always runs production mode).

**Not verifiable from here (assumptions to confirm on the actual host):** (a) that `npm start` runs from the app's root directory so `scripts/…` paths resolve (it does locally); (b) that the runtime log is readable in hPanel; (c) that the host's memory limit tolerates the app plus the importer's own temporary app (two Next processes) — if the load is killed, retry once, or ask for a larger plan; (d) that `~/.staging-demo-state` (the resume baseline) survives a redeploy — if not, an interrupted import is **not resumable** and the correct recovery is to recreate the empty staging database and start again; (e) that hPanel accepts a ~400-character JSON value for `STAGING_DEMO_ALLOWLIST_JSON`.

## Exact hosting steps (each needs you in hPanel; nothing is done yet)
1. Create a **new empty MySQL database and a new user** assigned only to it (never the live database or user). Create a **second Node.js web app** on a new subdomain from the approved branch (Next.js preset, `npm run build`, `npm start`, Node 22; `HOSTINGER-MIGRATION.md` §5).
2. Set environment variables (values you choose; never paste them in chat): `NODE_ENV=production`, `BETTER_AUTH_URL=https://<new host>`, `BETTER_AUTH_SECRET=<new 64 hex>`, `MYSQL_HOST=localhost`, `MYSQL_PORT=3306`, `MYSQL_DATABASE/USER/PASSWORD` of the **new** database, `EMAIL_ENABLED=false`, `LOCATION_PROVIDER=fake`, `STAGING_DEMO_MODE=true`, `STAGING_DEMO_DATABASE=<same database>`, `STAGING_DEMO_URL=<same URL>`, `STAGING_DEMO_ADMIN_EMAIL=<your email>`. Leave SMTP, R2, AI, ABR, billing and Google variables **unset**. Deploy: build and start refuse (visibly, before touching the database) if anything is wrong; otherwise migrations 0000–0028 apply to the new database only.
3. Open `/login` on the new URL and register once with `STAGING_DEMO_ADMIN_EMAIL`; complete first-run setup. Any other sign-up is refused.
4. Prepare the allow-list: one-line JSON `{"environment":"staging-demo","host":"localhost","port":3306,"database":"<new db>","user":"<new user>","appUrl":"https://<new host>","adminEmail":"<your email>"}`; compute its SHA-256 on your own machine (`printf '%s' '<json>' | sha256sum`). Set `STAGING_DEMO_ALLOWLIST_JSON=<that exact JSON>`, `STAGING_DEMO_CONFIRM_SHA256=<the hash>`, `STAGING_DEMO_LOAD=plan`; redeploy/restart; read the plan and `planHash` in the runtime log and review it.
5. Set `STAGING_DEMO_LOAD=apply`, `STAGING_DEMO_PLAN_HASH=<the hash>`, `DEMO_SEED_PASSWORD=<the administrator password>`; restart; wait for `apply finished with exit code 0` in the log.
6. **Immediately** set `STAGING_DEMO_LOAD` empty and **delete `DEMO_SEED_PASSWORD`** (and `STAGING_DEMO_PLAN_HASH`); restart. Optionally run `STAGING_DEMO_LOAD=verify` once, then empty it again.
7. Open the URL on your phone and sign in (walkthrough: `docs/CONNECTED-WALKTHROUGH.md`).

**No Remote MySQL and no SSH are needed.** If a step (a)–(e) above fails on the host, stop and report; the fallbacks are a larger plan, a fresh database, or (last resort, separately approved) one-sitting Remote MySQL for a single IP with the cleanup described in the earlier revision of this document (remove the IP, rotate the database password, delete local plan/baseline/allow-list files).

## hPanel facts or access genuinely needed
1. Whether the plan allows a **second Node.js web app** and a **second MySQL database**, and any extra cost (the repo cannot tell).
2. The new subdomain/URL and the new database and user **names** (never passwords).
3. The administrator email to allow-list.
4. Confirmation of assumptions (a)–(e) on the real host (they can only be confirmed by trying steps 4–6).

## What it still cannot do
No aerial imagery; address search uses the deterministic fake provider (fixture addresses: "dover road rose bay", "24 york road ingleburn", "100 smith street parramatta"); no file upload/download (R2 refused in staging); demo dates are relative to the import day; hosted apply against a real customer tenant remains refused.
