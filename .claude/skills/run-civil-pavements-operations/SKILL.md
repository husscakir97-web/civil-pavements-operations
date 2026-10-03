---
name: run-civil-pavements-operations
description: Build, run, start, launch, drive and screenshot the Civil & Pavements Operations (Infrastruct) Next.js app headlessly with MariaDB and Playwright. Use when asked to run the app, take screenshots, or confirm a UI/API change works in the real app.
---

Next.js 16 app (production build) backed by MySQL, Better Auth sessions. It is a single-page workspace at `/`: sections (CRM, Pipeline, Projects…) are sidebar buttons, **not** routes. Driven by `driver.mjs` (playwright-core + the preinstalled Chromium). Paths below are relative to the repo root.

## Prerequisites (once per container)

```bash
npm ci
npm i --no-save playwright-core        # driver dependency; not in package.json
apt-get update && apt-get install -y mariadb-server   # mysql image in CI is 8.0; MariaDB 10.11 works too
```

Without `apt-get update` the install fails with 404s on stale package URLs.

## Database + build

```bash
mkdir -p /run/mysqld && chown mysql /run/mysqld
(nohup mysqld_safe --user=mysql >/tmp/mysqld.log 2>&1 &); sleep 8
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS run_test CHARACTER SET utf8mb4; CREATE USER IF NOT EXISTS 'app'@'127.0.0.1' IDENTIFIED BY 'app-pw'; GRANT ALL ON run_test.* TO 'app'@'127.0.0.1';"
export MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=run_test MYSQL_USER=app MYSQL_PASSWORD=app-pw \
  BETTER_AUTH_SECRET=local-run-secret-with-at-least-32-characters BETTER_AUTH_URL=http://localhost:3100 EMAIL_ENABLED=false
npm run db:migrate     # ~25 migrations
npm run build          # ~80s; also re-runs migrations via prebuild
```

`EMAIL_ENABLED=false` skips SMTP and email verification, so sign-up returns a live session immediately. Keep the same env vars in any shell that starts the server.

## Run (agent path)

```bash
(nohup node_modules/.bin/next start -p 3100 --hostname 127.0.0.1 >/tmp/next.log 2>&1 &); sleep 6
curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/login        # 200
node .claude/skills/run-civil-pavements-operations/driver.mjs [baseUrl] [outDir]
```

The driver signs up a fresh throwaway user via `/api/auth/sign-up/email` from the page context, clicks "Skip setup and go to the workspace" (onboarding wizard), visits every sidebar section, prints the first text of each, and writes PNGs to `/tmp/run-shots` (default). Expect `page errors: none`. Edit the section list or add steps to the driver for your change.

API-only: `curl -X POST localhost:3100/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3100' -d '{"name":"x","email":"x@example.invalid","password":"Very-strong-test-password-42"}'` returns a session cookie (`better-auth.session_token`); mutating requests need the matching `origin` header (CSRF check).

Stop: `fuser -k 3100/tcp; mysqladmin -uroot shutdown` (not `pkill -f "next start"` — that pattern matches your own shell and kills it, exit 144).

## Run (human path)

`npm run dev` / `npm start` (the latter runs migrations then `next start` on `0.0.0.0`). Needs the same env vars; useless headless.

## Tests

`npm test` (SQLite suites, no DB needed). `npm run test:mysql` / `test:v1` need an **empty database whose name ends in `_test`**, so reuse `run_test` only on a fresh DB; `test:v1` needs `npm run build` first. I did not run these while writing this skill.

## Gotchas

- `/pipeline`, `/projects`, `/dockets` return 404 — navigation is client-side from `/`. Use sidebar clicks.
- Fresh account always lands on the onboarding wizard; skip it before looking for the sidebar.
- Chromium must be launched with `executablePath: '/opt/pw-browsers/chromium'` and `--no-sandbox` (running as root). Don't `playwright install`.
- `lib/modules/*` may not import each other (ESLint-enforced) — relevant when editing code to test.

## Troubleshooting

- `E: Failed to fetch ... 404` on apt → run `apt-get update` first.
- `mysqld_safe` prints nothing and mysql can't connect → `/run/mysqld` missing or not owned by `mysql`; see `/tmp/mysqld.log`.
- `Set MYSQL_HOST in the environment` → env vars not exported in this shell.
