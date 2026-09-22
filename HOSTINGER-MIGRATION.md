# Hostinger migration and cutover

This branch uses **npm**, a committed `package-lock.json`, `packageManager:
"npm@10.9.2"`, and Node 22. There is no pnpm/Corepack install step. The checked-out
source had pnpm 11.19.0 (the failed deployment reported 12.5.1); both are removed
from this deployment path.

## 1. Export the live D1 data and inventory R2

1. Keep the old Site available until the new deployment is verified. For the final
   export, ask staff to stop writes/uploads on the old Site and keep them stopped
   through cutover. Cloudflare's SQL export briefly makes D1 unavailable.
2. Check out `hostinger-migration` on a computer with Node 22, then run `npm ci`.
3. Copy `.env.example` to `.env`. Fill in `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`
   and `CLOUDFLARE_API_TOKEN` from the account owning the live D1 database. The API
   token needs D1 export access (Cloudflare D1 Edit permission). These are NOT the
   Sites project ID or the `DB` binding name.
4. In R2, create an API credential restricted to the existing bucket. Set
   `R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`. Export requires
   list/read access; the running app needs object read/write access.
5. Run:

   ```sh
   npm run data:export -- --out exports/live-before-hostinger --expected-dockets 64
   ```

6. Check the completion message: **64 dockets**. Open `manifest.json` for every
   table count and `r2-files.csv` for every object key, size and ETag. Keep the
   export folder private and back it up. The script follows all R2 listing pages.
   A mismatch stops completion; investigate it rather than changing the expected
   count merely to pass. If live data legitimately increased, record the new
   count and rerun with that expected count.
7. The folder contains `all-tables.sql`, one SQL and CSV per table, JSON lossless
   import copies, checksums, and R2 inventory. CSV is for review; don't round-trip
   through Excel. The importer uses JSON to preserve nulls, numbers and JSON text.
   No R2 objects are copied, renamed or deleted.

If ChatGPT Sites owns the Cloudflare account and you cannot obtain D1/R2 access,
you must obtain the database export and bucket API credentials from the account
administrator/Sites support. GitHub source does not contain live data. An
administrator-provided full SQL dump can be processed with:

```sh
npm run data:export -- --sql /path/to/live.sql --out exports/live-before-hostinger --expected-dockets 64
```

This still needs R2 credentials to create the inventory. Unknown live tables or
columns are preserved in the export and cause import to stop until their MySQL
schema is reviewed; nothing is silently discarded.

## 2. Prepare and import MySQL

1. In Hostinger, create/select database **u840559204_infrastruct** and user
   **u840559204_infra_app** and grant that user access. Use an EMPTY application
   database. Do not point these commands at an existing populated application.
2. Put the actual database host from hPanel in `MYSQL_HOST`; don't assume
   localhost for a command running on your computer. Set `MYSQL_PORT` (usually
   `3306`), `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` in `.env`.
   If accessing remotely, enable Hostinger Remote MySQL for your IP, or run the
   commands through Hostinger SSH where that database endpoint is accessible.
   If TLS is required, set `MYSQL_SSL_CA` to the provider's PEM CA certificate.
3. Apply the new schema and import before anyone signs up:

   ```sh
   npm run db:migrate
   npm run data:import -- exports/live-before-hostinger
   npm run data:import -- exports/live-before-hostinger --verify-only
   ```

4. Check `mysql-verification.json` inside the export folder: every application
   table must show equal source/destination counts and `match: true`; dockets must
   show `64` on both sides. Verification also compares hashes of every field,
   including historical rate snapshots and immutable revisions. Import is one
   transaction and rolls back on a mismatch. It refuses to overwrite nonempty
   destination tables. D1's own migration/control tables remain in the backup
   and are not applied as application tables.
5. MySQL schema migrations use `migrations/mysql/`; never run the old SQLite SQL
   in `drizzle/` on Hostinger. MySQL DDL is not transactional. If a first migration
   fails part-way, fix the cause and use a fresh empty destination; don't mark it
   applied or run an unreviewed destructive reset. Subsequent runs verify applied
   migration checksums.

## 3. Exact Hostinger deployment settings

In hPanel: **Websites → Add Website → Node.js Web App → Import Git repository**.
Connect GitHub and select `husscakir97-web/civil-pavements-operations`.

| Setting | Value |
|---|---|
| Branch | `hostinger-migration` |
| Application/root directory | repository root (`.`) |
| Framework preset | `Next.js` |
| Package manager | `npm` |
| Install command, if editable | `npm ci` |
| Build command | `npm run build` |
| Output directory | `.next` |
| Start command | `npm start` |
| Underlying start command | `next start --hostname 0.0.0.0` |
| Node version | `22.x` (tested with `22.22.0`) |

Keep development dependencies available during the build (`next`, TypeScript,
Tailwind and build tooling must be installed). Do not set `NPM_CONFIG_OMIT=dev`.
The output is a server app, not a static export. The Next.js preset must retain
the runtime dependencies and public assets; don't upload only `.next/static`.
Hostinger supplies the listening port through `PORT`; don't hardcode a different
port. If the UI only shows framework defaults, select Next.js and use these
commands wherever the settings are editable.

Add these **runtime** environment variables in hPanel before starting the app:

| Name | Value to enter |
|---|---|
| `NODE_ENV` | `production` |
| `BETTER_AUTH_URL` | Your exact HTTPS app origin, e.g. `https://app.example.com` |
| `BETTER_AUTH_SECRET` | A persistent randomly generated secret of at least 32 characters |
| `MYSQL_HOST` | Hostinger database hostname from hPanel |
| `MYSQL_PORT` | `3306`, unless Hostinger specifies another port |
| `MYSQL_DATABASE` | `u840559204_infrastruct` |
| `MYSQL_USER` | `u840559204_infra_app` |
| `MYSQL_PASSWORD` | Your database user's password |
| `MYSQL_SSL_CA` | Optional provider PEM certificate for database TLS; omit otherwise |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | Existing bucket's S3 API access key ID |
| `R2_SECRET_ACCESS_KEY` | Matching S3 secret |
| `R2_BUCKET_NAME` | Existing bucket name, unchanged |
| `SMTP_HOST` | Your outbound email provider's SMTP hostname |
| `SMTP_PORT` | `465` for implicit TLS, or provider-specified port |
| `SMTP_SECURE` | `true` for port 465; `false` for STARTTLS on port 587 |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password/app password |
| `MAIL_FROM` | An authorised sender, e.g. `Operations <noreply@example.com>` |
| `OPENAI_API_KEY` | Optional; needed only for existing paid AI scans |
| `OPENAI_DOCUMENT_MODEL` | Optional existing model override; leave unset to use app default |
| `PORT` | Leave to Hostinger unless its setup explicitly asks you to supply it |

Generate the auth secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not put export credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`D1_DATABASE_ID`) or account-attachment variables on the hosted app. No credentials
belong in GitHub source, build logs or client-side `NEXT_PUBLIC_*` variables.

## 4. Attach your existing organisation to your new admin account

1. After importing and deploying, open `/login`, create your email/password
   account and verify the email. Signup creates a separate new organisation.
2. Sign in, open **Account & team**, and copy your **Account ID**. Confirm it is
   your account. Find the existing organisation ID in exported
   `organisations.csv` (the original workspace is normally `roadworx-sydney`).
3. In your LOCAL `.env`, set `MIGRATION_ADMIN_USER_ID` to that account ID and
   `MIGRATION_ORGANISATION_ID` to the exact imported organisation ID. Run:

   ```sh
   npm run data:attach-admin
   ```

4. Refresh the app. Your verified account now has the `admin` role on the imported
   organisation. This operation is recorded in the audit log and can happen only
   once per organisation. It does not reprice, re-ID, or rewrite historical data.
   Old Sites user records remain as historical references and cannot authenticate
   without a Better Auth account. Invite colleagues to establish new memberships.
5. Remove the two `MIGRATION_*` values from your local environment. The temporary
   empty signup organisation remains as a record; no customer data is deleted.
6. Admins can use **Account & team → Invite a colleague** to email an admin,
   office or field invitation. The recipient registers/verifies the invited
   address, opens the email link, then accepts it. Invitations expire in 72 hours,
   are bound to the email and are single-use. Accepting switches active membership;
   records in a previous organisation stay there.

## 5. Cutover checks and rollback

- Verify the 64 imported dockets, date filters, source-file downloads and one new
  upload; check invoices, tender documents, estimates, saved revisions, rates,
  field records, planning, claims, IMS, preparation exports and reporting.
- Check a second organisation cannot access the first organisation's records or
  files, and a field user cannot change rates, branding, claims or membership.
- Confirm email delivery and invites on the real domain. Update `BETTER_AUTH_URL`
  if changing from a temporary Hostinger domain, then redeploy/restart.
- Only redirect users to Hostinger after these checks. Keep the original D1 and
  SQL backup intact. There is no automated reverse sync from MySQL to D1: after
  new writes start on Hostinger, rolling back requires reconciling those writes.
- Keep R2 keys unchanged and retain the bucket. Removing Sites must not delete
  its D1/R2 resources. Confirm bucket ownership and retention before cancellation.

The branch can be deployed directly; merging to `main` is a separate user action.
This work does not change `main` or export/modify your live Cloudflare data.

## Reference documentation

- [Hostinger Node.js GitHub deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Hostinger build/start settings](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/)
- [Cloudflare D1 SQL export](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)
- [R2 S3 credentials](https://developers.cloudflare.com/r2/api/s3/tokens/)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
