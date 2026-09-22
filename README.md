# Civil & Pavements Operations

Next.js 16 / React 19 on Node.js 22, MySQL (Drizzle + mysql2), Better Auth sessions,
and Cloudflare R2 through its S3-compatible API.

Start with [HOSTINGER-MIGRATION.md](HOSTINGER-MIGRATION.md) for live-data export,
import, account attachment, environment variables, and exact hosting settings.

```sh
npm ci
npm run db:migrate
npm run dev
```

Copy `.env.example` to `.env` and supply credentials locally first. Next.js loads
`.env` automatically; administrative scripts use Node's `--env-file-if-exists`.
Never commit `.env` or `exports/`.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

The eight existing business suites use isolated SQLite fixtures and external
service doubles. `npm run test:mysql` adds production HTTP tests against an empty
MySQL/MariaDB database whose name ends in `_test`; run `npm run db:migrate` first.
It uses real Better Auth, MySQL sessions and SQL, plus local SMTP/S3 fixtures. CI
runs both suites and a production build on Node 22 with MySQL 8.

`drizzle/` is the unmodified historical D1 migration archive used by export tests.
Only `migrations/mysql/` is applied to the new database. `npm run db:generate`
generates MySQL migrations. Business tables retain their IDs and JSON snapshots,
including historical rates, estimate revisions and field/preparation histories.

Every business HTTP handler has an explicit `withActor` guard. The verified
session resolves membership from MySQL and supplies organisation context through
Node AsyncLocalStorage. No client header selects a user, role or organisation.
Admins administer users/rates/branding; office users operate and approve business
work; field users read and capture field evidence, without office/admin writes.
Invitations are emailed, hashed, expiring and single-use. Identity/session tables
are global; business and invitation data are organisation-scoped.
