# Hostinger: fresh setup entirely in your browser

Automatic migrations run before `npm run build` when database variables are configured, and also before `npm start`. Both use the same database lock and checksum journal, so each migration is applied once. The build hook covers Hostinger's Next.js preset starting Next directly. A migration failure stops deployment. Local/CI builds without database variables remain offline builds.

Hostinger installs production dependencies when `NODE_ENV=production`. The Next.js TypeScript and CSS build packages are therefore included in `dependencies`; CI also builds with development packages removed. In hPanel, **Environment variables → Apply changes triggers a deployment**. For initial setup, use **Settings and redeploy**, select `hostinger-migration`, enter all variables, then use **Save and redeploy** together.

Deploy the `hostinger-migration` branch. Leave `main` unchanged. The old 64 dockets are test data: do not export, import, attach an old organisation, or connect the old Sites bucket. This setup creates a new database workspace and uses your own R2 bucket.

## Launch without email (current choice)

Set **EMAIL_ENABLED=false** in hPanel. Skip step 3 and omit all SMTP variables and MAIL_FROM. Signup/sign-in work immediately with an email address and password; no verification message is needed. The first signup still becomes admin and optional demo seeding still works. Invitations and password resets are unavailable, including their server endpoints. Keep your password in a password manager: there is no emailed recovery in this mode. Independent signups create separate organisations, not colleagues in yours.

To enable email later, add the SMTP values below, set EMAIL_ENABLED=true, and restart. New sign-ins must then verify the address; trying to sign in sends the verification message. Existing unverified sessions cannot accept invitations until verification. No accounts, organisations or data are deleted when changing this setting.

## 1. Prepare your empty MySQL database in hPanel

1. Open **Websites → your website → Dashboard → Databases → Management**.
2. Use the empty database `u840559204_infrastruct`, with user `u840559204_infra_app`. Confirm the user is assigned to this database. If the database already contains app tables from an earlier trial, create a separate empty database and use its full name instead; do not delete anything to complete this guide.
3. Copy the full database name and username. Save the database user's password in your password manager. If you do not know it, use hPanel's change-password option for this database user and copy the new value.
4. The host for a database on the same Hostinger hosting account is normally `localhost`, port `3306`. Use the host shown by hPanel if different. Do not use your website URL as the database host.
5. No SQL needs to be pasted into phpMyAdmin. The app creates its own tables when Hostinger starts it. Its database user needs permission to create/alter tables and indexes as well as read/write records; the normal hPanel user assigned to the database supplies this access.

[Hostinger's Node.js/MySQL instructions](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/).

## 2. Create your own R2 bucket and access keys

1. Create/sign into your free account at [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Open **Storage & databases → R2 → Overview**. Complete the R2 subscription checkout/activation if prompted. R2 includes free monthly usage; usage above the free allowance is billed, and activation may request billing details. Choose **Standard** storage for this setup.
3. Select **Create bucket**, enter a name such as `civil-operations-files`, leave the location automatic unless you need a specific region, and create it. Save the exact bucket name.
4. Return to **R2 → Overview → API Tokens → Manage**. Choose **Create Account API token**. Name it `Hostinger civil operations`.
5. Select **Object Read & Write**, then **Apply to specific buckets only**, and select your new bucket. Create the token.
6. Copy **Access Key ID** and **Secret Access Key** from the result into your password manager. The secret is displayed only once. These are the S3 credentials; do not substitute the separate API token string.
7. Copy the **S3 API endpoint** from the confirmation page or R2 overview. It looks like `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`. Use the endpoint exactly as shown, without adding the bucket name.
8. Keep the bucket private. No public `r2.dev` URL, custom domain, Workers binding, or CORS rule is needed: authenticated app routes handle uploads/downloads on the server.

[Cloudflare browser setup and keys](https://developers.cloudflare.com/r2/get-started/s3/) · [R2 activation](https://developers.cloudflare.com/r2/get-started/) · [Free allowance and pricing](https://developers.cloudflare.com/r2/pricing/).

## 3. Prepare Hostinger email

1. In hPanel open **Emails → Manage** beside your domain. Create a mailbox such as `operations@your-domain.com`, or choose an existing mailbox you control.
2. Finish any domain/email DNS setup shown by hPanel, including the recommended SPF/DKIM records. Confirm you can sign into that mailbox's webmail.
3. Open **Connect Apps & Devices / Configuration settings** and find **SMTP (outgoing)**. Copy the outgoing hostname and port. Hostinger Email normally shows `smtp.hostinger.com`, **465**, **SSL**.
4. Copy the full mailbox address for the SMTP username and use that mailbox's password. This is not your hPanel login password. Reset the mailbox password in hPanel if necessary.
5. Use the same mailbox address as the sender (`MAIL_FROM`). The app sends verification, invitation, and password-reset messages through this mailbox. No separate email provider is required.
6. If your mailbox explicitly uses STARTTLS on port 587, set `SMTP_PORT=587` and `SMTP_SECURE=false`. For the standard SSL/465 setup, use `SMTP_SECURE=true`.

[Hostinger email settings](https://www.hostinger.com/support/4305847-set-up-hostinger-email-on-your-applications-and-devices/). Mailbox sending limits still apply.

## 4. Generate the auth secret without a terminal

Open the supplied **Generate-Auth-Secret.html** file in your browser, click **Generate secret**, then **Copy**. If you are reading this on GitHub, open `public/secret-generator.html` on the `hostinger-migration` branch, choose **Download raw file**, and open that downloaded HTML file in your browser.

The page uses the browser's cryptographic random generator to create 64 hexadecimal characters (32 random bytes). It makes no network requests and saves nothing. Paste the result into Hostinger's `BETTER_AUTH_SECRET` field and your password manager. Do not paste it into GitHub or send it in chat. Keep the same secret across redeployments. Generating a new one invalidates existing login sessions.

## 5. Connect GitHub and fill in deployment settings

Open **Websites → your Node.js website → Dashboard → Deployments → Redeploy** (or add a Node.js web app and connect GitHub if it has not been created). Select this repository and branch. Enter these values in the dashboard; these are settings for Hostinger to execute, not commands you must run on a computer.

| Setting | Exact value |
| --- | --- |
| Repository | `husscakir97-web/civil-pavements-operations` |
| Branch | `hostinger-migration` |
| Root directory | Repository root (`.` if a value is required) |
| Framework preset | **Next.js** |
| Package manager | **npm** |
| Install command, if shown | `npm ci` |
| Build command | `npm run build` |
| Output directory | `.next` |
| Start command | `npm start` |
| Node version | **22.x** |

The install fix uses **npm**, with `packageManager: npm@10.9.2` and a committed `package-lock.json`. There is no pnpm 12.5.1 dependency. Keep development dependencies enabled during the build; do not set `NPM_CONFIG_PRODUCTION=true` or omit dev dependencies.

**Keep the start command as `npm start`.** It applies migrations first and then runs Next.js. A direct `next start` would bypass database setup. Do not select a static-site/export preset or an `out` output folder. Hostinger must retain the app's server files, including `scripts/` and `migrations/mysql/`, as part of its Node deployment.

[Hostinger redeployment settings](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/).

## 6. Add environment variables in hPanel

In that deployment's **Environment variables** section, add each required row below. Paste values without surrounding quote marks. Use server-side names exactly as written: no `NEXT_PUBLIC_` prefix. Save and redeploy after changing values.

| Exact name | Value / what it does | Where to get it |
| --- | --- | --- |
| `EMAIL_ENABLED` | `false` for the current launch without email; defaults to `true` when omitted | Type this value in hPanel. SMTP and MAIL_FROM are only required when true. |
| `NODE_ENV` | `production` | Type this literal value. |
| `BETTER_AUTH_URL` | The complete public HTTPS app address, e.g. `https://operations.your-domain.com`; no trailing slash or path | hPanel website domain/temporary HTTPS address. Use the same address you open in your browser. Update and redeploy when changing domains. |
| `BETTER_AUTH_SECRET` | The generated 64-character secret | Browser secret generator in step 4. |
| `MYSQL_HOST` | Usually `localhost` for this hosting account | hPanel database details in step 1. |
| `MYSQL_PORT` | `3306` | Hostinger's MySQL port; type this value unless hPanel specifies otherwise. |
| `MYSQL_DATABASE` | `u840559204_infrastruct` | Full name in hPanel → Databases → Management. If you created a new empty database, use its full name instead. |
| `MYSQL_USER` | `u840559204_infra_app` | Database username in the same hPanel section. |
| `MYSQL_PASSWORD` | Database user's password | Password saved when creating/changing this database user in hPanel. |
| `R2_ENDPOINT` | S3 API endpoint, beginning `https://` | Cloudflare token confirmation / R2 overview, step 2. |
| `R2_BUCKET_NAME` | Your new bucket's exact name | Cloudflare → R2 → bucket list. |
| `R2_ACCESS_KEY_ID` | S3 Access Key ID | Cloudflare R2 token result, step 2. |
| `R2_SECRET_ACCESS_KEY` | S3 Secret Access Key | Same token result; shown once. Create replacement keys if lost. |
| `SMTP_HOST` | Normally `smtp.hostinger.com` | hPanel → Emails → your domain → Connect Apps & Devices → SMTP outgoing server. |
| `SMTP_PORT` | Normally `465` | Same SMTP settings. |
| `SMTP_SECURE` | `true` for SSL/465; `false` for STARTTLS/587 | Match the encryption/port from the SMTP settings. |
| `SMTP_USER` | Full mailbox address | hPanel → Emails → mailbox list. |
| `SMTP_PASSWORD` | That mailbox's password | Mailbox creation/change-password screen; not your hPanel password. |
| `MAIL_FROM` | Same full mailbox address as `SMTP_USER` | Your chosen Hostinger mailbox. |

Optional/provider-managed variables:

| Exact name | Value / effect | Where to get it |
| --- | --- | --- |
| `SEED_DEMO_DATA` | Set `true` **before the first signup** for demo content; omit or use `false` for a completely empty workspace | Your choice in hPanel. Only the first newly created membership is eligible; later signup/restart never adds it again. |
| `MYSQL_SSL_CA` | Omit for normal same-host MySQL. Only set if your database provider requires TLS; full PEM CA certificate, including line breaks | Hostinger support/database provider, if a TLS endpoint is supplied. Do not invent a certificate or disable verification. |
| `PORT` | Leave unset; Hostinger supplies the listening port | Hostinger runtime. The start script honours it. |
| `OPENAI_API_KEY` | Optional; enables the existing AI document extraction features | Not from hPanel/Cloudflare: create an API key in your own [OpenAI API account](https://platform.openai.com/api-keys), with API billing enabled, then paste into hPanel. Manual workflows still work without it. |
| `OPENAI_DOCUMENT_MODEL` | Optional model override; omit to use the application's existing default (`gpt-4o-mini`) | Your OpenAI account's supported model ID; only needed if you want to override the default. |

There is no `DATABASE_URL`, R2 region variable, ChatGPT auth header, old bucket credential, or D1 credential to configure. Do **not** add `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`, `MIGRATION_ADMIN_USER_ID`, or `MIGRATION_ORGANISATION_ID` for this fresh deployment. Those belong only to the retained optional legacy tools.

## 7. Deploy and create your account

1. Click **Deploy/Redeploy**. Check the deployment/runtime logs in hPanel. Initial startup should show `Applied ...` for the MySQL migrations, then `Database migrations ready`, then Next.js ready. Later restarts skip completed migrations.
2. Open the app's HTTPS address. Click **Create an account**, enter your name, email and a password of at least 12 characters. Be the first person to register if you want the demo in your organisation.
3. With email disabled, signup signs you in immediately. With email enabled, open the verification email and click its link. Sign in if prompted. Your account is automatically **admin** of a new organisation. There is no old-owner email, account-ID attachment, database edit, or terminal step.
4. With `SEED_DEMO_DATA=true`, your organisation gets a clearly labelled demo job, an estimate and frozen historical rate/budget revision, a planned shift, worker/client, and **six synthetic dockets** dated on signup. Three are approved and three await review. These are newly generated examples, not the old 64 records.
5. Explore Jobs, Planning, Field, Dockets, Commercial and Reports. The planned shift can be opened in Field. Other screens retain their normal empty states and creation forms. IMS readiness checks still need to be completed; demo data does not bypass approval gates. Demo dockets have no source files: upload your own sample through the app to test document storage and previews.
6. If email is enabled, open **Account / Team** to invite colleagues by email as **admin**, **office**, or **field**. They register/verify using the invited email, sign in, and reopen the invitation link to accept. An independent signup gets its own organisation and never access to yours; accepting your invitation attaches their membership to yours.
7. If email is enabled, test **Forgot your password?** on the login page. The email link opens the reset screen. A successful reset invalidates old sessions and the reset token cannot be reused.
8. You may set `SEED_DEMO_DATA=false` and restart after setup. This does not erase existing demo records. Turning it on after your first signup does not backfill data.

## 8. Browser checks and recovery

- Upload a small file in the app, reopen/download it, and check it appears in your new R2 bucket. The old Sites bucket is never used.
- Send one field invitation and confirm the field account cannot change branding/rates or perform office/admin writes.
- Click **Restart** in hPanel and sign in again. Your job and docket count must remain unchanged.
- MySQL connection/access errors: verify full database/user names, password, assigned user and hostname in hPanel; correct environment variables and redeploy.
- Migration interrupted: click Redeploy/Restart. A database advisory lock serialises deployments, checksums protect applied files, and a per-statement journal resumes the shipped CREATE/table/index/foreign-key statements after interruption. Successful migrations are recorded once; startup refuses to serve if migration fails. Do not manually edit migration tables or schemas in phpMyAdmin.
- A checksum or untracked-object error needs investigation, not deletion of tables. This fresh setup expects an empty database. Choose another empty database in hPanel if an earlier unrelated trial used the current one. Future non-repeatable data migrations must supply an explicit safe recovery strategy; the runner stops rather than replaying uncertain data writes.
- No verification/reset/invite email: check spam, mailbox password and outgoing SMTP settings, and the domain's email DNS setup in hPanel. Existing users can request a fresh verification email by trying to sign in again after SMTP is fixed. Invite delivery failures are reported in Account / Team and can be retried.
- Invalid-origin/login-link problems: match `BETTER_AUTH_URL` to the exact HTTPS address, without a trailing slash, and redeploy.

## What is automatic, and what you do

The repository supplies npm installation, Next.js build/start, automatic MySQL migrations, account/organisation creation, optional demo fixtures, MySQL sessions, server role checks, SMTP auth/invitation email, and private R2 S3 access. GitHub Actions runs lint, TypeScript, all eight business suites, a production build, fresh-start tests, and the retained migration/integration tests.

You create the database/mailbox/bucket in their dashboards, enter environment values, select the branch, deploy, and register/verify your account. Production credentials and your actual Hostinger/Cloudflare services must be checked by this browser smoke test; automated tests use disposable databases and local SMTP/S3 fixtures.

The export/import/attach scripts remain in `scripts/` for optional legacy administration. Nothing in install, build, startup, or first signup invokes them. You do not need to run them or any other local command.

## Team & permissions

Open your account avatar or **Team & permissions** in the sidebar. Admins can see their own organisation's members, choose Admin / Office / Field, and review and confirm access changes. Choose **Inactive** to revoke sessions and block workspace access; **Active** restores access without deleting any records. The last active admin cannot be deactivated or demoted, including simultaneous requests. Access changes are recorded in the screen's audit history. No new environment variables are required; the `active` membership column is added automatically during deployment/startup.

- **Admin:** all business features, organisation settings, rate libraries and team administration.
- **Office:** operational and commercial work, prices and approvals; no team management or admin-only changes.
- **Field:** daily shifts, operational quantities, attendance, site evidence and approved preparation documents for assigned shifts. All organisation shifts remain available; this is not assigned-job-only access. Commercial APIs, rates, invoices, dockets, tenders, reports, global search and generic record access are blocked. The field workspace does not load office dashboards.

Field API responses and saved-history views omit structured rates, costs, budgets and estimate snapshots. Field saves preserve server-side prices and flag missing prices for office review. Office staff reconcile these costs through an authorised amendment. Do not put confidential prices into free-text site instructions or documents approved for field use. Newly uploaded field evidence is available to field staff in that organisation; office uploads and legacy unclassified files are restricted to Admin/Office. Field document export cannot download a ZIP containing linked source/evidence files.

With `EMAIL_ENABLED=false`, invitations remain off. Separate signups create separate organisations and do not join your team. Existing members can still be managed. When email is enabled, invitations cannot be used to change an existing member's role or bypass last-admin protection; use this screen for role changes.
