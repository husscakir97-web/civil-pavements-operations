# Tenant-scoped demonstration import (additive, local checkpoint)

`scripts/import-demo-tenant.mjs` adds the Kestrel demonstration dataset to **one existing organisation** without touching anything that
is already there. It is separate from `scripts/seed-demo-company.mjs`, whose test-only guards are unchanged. Nothing here has been run
against a hosted tenant, and nothing here is approval to do so.

## Commands

Dry run (read-only; a SELECT-only database user is enough; changes nothing):

```
node scripts/import-demo-tenant.mjs --organisation-id <organisation id> --out plan.json
```

It prints, per group, what would be **created**, what already exists and is ours (**skip**), and what **conflicts**. Exit code 0 = clean
plan, 3 = conflicts or blockers (nothing may be applied), 2 = refused or bad input. The plan carries a `planHash`.

Apply (test environments only):

```
node scripts/import-demo-tenant.mjs --organisation-id <id> --apply --plan-hash <hash from a fresh dry run> --base-url http://127.0.0.1:PORT
```

with `DEMO_SEED_EMAIL` / `DEMO_SEED_PASSWORD` of an administrator **of that organisation**. Apply refuses unless the database name ends
in `_test`, the database and the app are on this machine, `NODE_ENV` is not production, no external integration is configured
(`EMAIL_ENABLED`, SMTP, billing, AI, SMS, ABR), the plan hash matches a plan computed just now, the plan has no conflicts or blockers,
and the sign-in is an administrator of the named organisation. There is no flag that bypasses any of this.

## What it guarantees

- **Additive only.** Writes go through the application's own API (state machines, approvals, audit trail). An allow-list of API calls and
  two SQL statements is enforced in code (`scripts/demo/import-guards.mjs`): no company-profile write, no organisation rename, no team,
  billing, auth or admin call, no deletion, no update of a record the import did not create.
- **Preserved:** the owner's login, memberships, company profile, billing and every other tenant. The import adds five demonstration team
  members **without login accounts** (they cannot sign in; deactivate them to hide them from the team list).
- **Conflicts are refused, not guessed.** A division code, employee or plant number, tender reference, shift name, opportunity name,
  plan name, safety-record text or demo e-mail address that already exists and is not provably ours makes the plan exit 3.
- **Repeats and interruptions are safe.** Every record is found by a deterministic key and only created when missing. After an
  interruption the old plan hash is refused (the tenant changed); a fresh dry run shows the partly imported tenant as skip/create and
  the apply resumes.
- **Self-check.** Before and after an apply, every row of every table (all tenants) is hashed. Any pre-existing row that changed or
  disappeared fails the run. Only session and verification rows are excluded, because signing in creates them.
- **No external side effects.** The importer refuses to run with any integration configured; the app used for the test runs with email
  disabled and no provider keys.

## What it does not prove

- The plan hash binds an apply to the plan that was reviewed. It is **not** proof of approval, of a valid backup or of a restore.
- Ownership of a plain-named record (division, shift, opportunity, plan, safety record) is a fingerprint: attached to a demo parent, or
  an exact name and description match. An owner record that deliberately copies a demo record exactly would be treated as ours and
  skipped, never overwritten.
- Records created as a consequence (estimates, projects, claims, invoices, risks, SWMS, ITPs, programme, scenarios, workshop orders,
  service events, cost transactions) are keyed to demo tenders, projects and plant, so they cannot collide, but they are counted only in
  the post-import verification, not listed individually in the plan.
- The dataset assumes the organisation holds the modules it needs (pipeline, estimating, projects, ims, operations, field, dockets,
  commercial, workshop); a disabled or read-only module is a blocker.
- Project numbers continue the tenant's own sequence, so the demo projects will not be `PRJ-0001…` in a tenant that already has projects.
- Business dates follow `--seed-date`; audit timestamps are the real time of the import.
- It cannot remove the demonstration records. Removal would be separate, explicitly approved work with its own dry run.
- Running against a hosted tenant needs separate approved work: an explicit allow-listed target, a restore-tested backup, and a
  maintenance window. The read-only dry run and `scripts/live-tenant-inventory.mjs` are the safe first steps.

## Tests

`MYSQL_DATABASE=import_check_test node scripts/test-import-demo-tenant.mjs` (empty disposable database, production build required)
builds an owner with a company profile, a division, a client, a worker and an opportunity, plus a second tenant, and proves: the guards;
dry run changes nothing, with a SELECT-only user; four deliberate conflicts are refused; an interrupted (killed) import resumes; no
pre-existing row of any tenant changed; the owner can still sign in; counts and totals equal an empty tenant's; a second run creates
nothing.
