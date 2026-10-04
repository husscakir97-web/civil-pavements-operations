# Phone-accessible demonstration (staging path) — prepared, NOT activated

Goal: the full synthetic demo company (`scripts/demo/*`, the same dataset as `docs/DEMO-COMPANY.md`) on a URL you can open on a phone, completely separate from the production site, its database and your newly entered records. Nothing in this document has been run against any hosted system.

## Shortest safe route (uses only what the repository already deploys to)
The repo deploys to **Hostinger Node.js hosting with MySQL** (`HOSTINGER-MIGRATION.md`, `docs/RUNBOOK.md`); there is no Docker/Vercel/Fly/Render configuration. The shortest route is therefore a **second, separate Hostinger Node.js web app** (own subdomain) with its **own new, empty MySQL database and database user**, running this branch in *staging demonstration mode*, then loading the demo company with the importer's allow-listed mode.

| Item | Value |
|---|---|
| Hosting | Hostinger Node.js web app #2 (e.g. `demo.<your-domain>`), Node 22, build `npm run build`, start `npm start`, branch = the merged integration branch (or this branch) |
| Database | A **new** hPanel MySQL database + a **new** user assigned only to it. Never `u840559204_infrastruct`, never a shared user. Its name does not need `_test`; the allow-list, not the name, is the safeguard |
| Access protection | Staging mode (below): public sign-up closed after the one allow-listed administrator registers; strong password (min 12 chars); every external integration must be unconfigured or the app refuses to run authentication; `X-Robots-Tag: noindex`; HTTPS from Hostinger |
| Seed | Same dataset, loaded by `scripts/import-demo-tenant.mjs --staging-allowlist …` from a trusted machine (the importer starts its own local, integration-free app on the remote database; the hosted app is not used as the writer) |
| Cost | No new vendor, no paid service. Whether your current Hostinger plan includes a second Node.js app and a second database is **not knowable from the repo** — check hPanel; if not, the extra plan/add-on cost is Hostinger's published price for it |
| Cloudflare R2 | Not used (staging refuses R2 settings; file upload/download is unavailable in the demo) |

## What was built (all tested locally; branch `claude/staging-demo-path`, not pushed)
* `lib/platform/staging.ts` — `STAGING_DEMO_MODE=true` makes authentication **fail closed** unless: `STAGING_DEMO_DATABASE` = `MYSQL_DATABASE`, `STAGING_DEMO_URL` = `BETTER_AUTH_URL`, the database is not a known production one (`u840559204_infrastruct` plus anything in `STAGING_REFUSE_DATABASES`), `STAGING_DEMO_ADMIN_EMAIL` is set, `EMAIL_ENABLED=false`, `AI_ENABLED` not true, `LOCATION_PROVIDER` is `fake` or `none`, and SMTP, billing, ABR, AI keys, Google Maps keys, R2 and operator-email settings are all unset. Sign-up allows only that administrator email and only while the database has no users. With the flag off, nothing changes.
* `next.config.ts` — noindex header when the flag is on (evaluated at build/start).
* `scripts/demo/staging-allowlist.mjs` + `--staging-allowlist <file>` in the importer — the only way the importer may write to a non-local or non-`_test` database. It **replaces only** the `_test` and local-host checks; the plan hash, baseline, integrations-off, administrator-of-the-named-organisation and own-isolated-app rules all still apply. The allow-list file names exact host/port/database/user/app URL/admin email; the operator supplies its SHA-256 (`STAGING_DEMO_CONFIRM_SHA256`) as typed confirmation; the file must not be writable by others; production database names and wildcards are refused; and the database must contain **exactly one organisation and exactly one user (the administrator)**.
* `scripts/test-staging-path.mjs` (`npm run test:staging-path`, 52 checks) — covers every refusal above and a real end-to-end run on a local stand-in database.

## Steps (all need your action; none has been done)
1. hPanel: create the new empty database + user; add the second Node.js web app on a new subdomain (see `HOSTINGER-MIGRATION.md` §5 for build/start settings).
2. Environment variables on that app (values you choose; never reuse production values): `NODE_ENV=production`, `BETTER_AUTH_URL=https://<demo host>`, `BETTER_AUTH_SECRET=<new 64 hex>` (use `public/secret-generator.html`), `MYSQL_HOST/PORT/DATABASE/USER/PASSWORD` of the **new** database, `EMAIL_ENABLED=false`, `LOCATION_PROVIDER=fake`, `STAGING_DEMO_MODE=true`, `STAGING_DEMO_DATABASE=<same database>`, `STAGING_DEMO_URL=<same URL>`, `STAGING_DEMO_ADMIN_EMAIL=<your email>`. Leave SMTP, R2, AI, ABR, billing and Google variables **unset**.
3. Deploy. `npm start` applies the migrations (0000–0028) to the new database.
4. Open `/login` on the demo URL → create the account with `STAGING_DEMO_ADMIN_EMAIL` (once). Complete the first-run setup. Any other sign-up is refused.
5. hPanel → Databases → **Remote MySQL**: allow the IP of the machine that will run the importer (remove it afterwards). 
6. On that machine: clone the branch, `npm ci`, `npm run build`. Write the allow-list JSON (mode 600), compute its SHA-256, then:
   `MYSQL_HOST=… MYSQL_PORT=… MYSQL_DATABASE=… MYSQL_USER=… MYSQL_PASSWORD=… node scripts/import-demo-tenant.mjs --organisation-id <org id> --staging-allowlist allow.json` (dry run — review the plan), then the same with `--apply --plan-hash <hash> --baseline baseline.json`, `DEMO_SEED_EMAIL/DEMO_SEED_PASSWORD` set to the administrator, and `STAGING_DEMO_CONFIRM_SHA256=<sha>`. Repeat-safe and resumable.
7. Open the demo URL on your phone and sign in. Walkthrough: `docs/CONNECTED-WALKTHROUGH.md`.

## What it still cannot do / open points
* The organisation id comes from the database (`SELECT id FROM organisations`). 
* Remote MySQL access to Hostinger (step 5) is an access grant only you can make; a temporary local tunnel or other host would be a new service and is not assumed.
* Demo dates are relative to the day of import (re-import is additive; to refresh the dates, create a fresh database).
* No aerial imagery; the address search uses the deterministic fake provider (fixture addresses such as "dover road rose bay", "24 york road ingleburn", "100 smith street parramatta").
* Hosted apply of the importer against a *real customer tenant* remains out of scope and still refused.
