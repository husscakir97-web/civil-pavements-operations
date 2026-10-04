# Tenant-scoped demonstration import (additive, local checkpoint)

`scripts/import-demo-tenant.mjs` adds the Kestrel demonstration dataset to **one existing organisation** without touching anything that
is already there. It is separate from `scripts/seed-demo-company.mjs`, whose test-only guards are unchanged. Nothing here has been run
against a hosted tenant, and nothing here is approval to do so.

## Commands

Dry run (read-only; a SELECT-only database user is enough; changes nothing):

```
node scripts/import-demo-tenant.mjs --organisation-id <organisation id> --out plan.json
```

After an import has started (or finished), add `--baseline <file> --baseline-sha256 <hash>` so the plan can prove which existing demo-keyed records the import itself created. Without a verified baseline an existing record under a demonstration key cannot be proven to be ours and is a conflict.

It prints, per group, what would be **created**, what already exists and is ours (**skip**), and what **conflicts**. It then lists **every table apply can write to** (55 tables, 653 rows for the full dataset): direct records, and everything that hangs from them — estimates and bid reviews under tenders; projects, baselines, members, claims, claim lines, invoices, risks, SWMS, ITPs, programme, cost transactions under projects; scenarios, activities and costs under plans; service events, workshop orders and meter readings under plant — each with expected, present and to-create counts. `--out` adds the planned parent key for every row (for example `DEMO-T-001 #2` for a claim). It also shows tables the application writes on first use only if missing (entitlements, profile, rate library), the append-only audit and event tables, and states that no attachments or files are created. Exit code 0 = clean
plan, 3 = conflicts or blockers (nothing may be applied), 2 = refused or bad input. The plan carries a `planHash`.

Apply (test environments only):

```
node scripts/import-demo-tenant.mjs --organisation-id <id> --apply --plan-hash <hash from a fresh dry run> --baseline <file>
```

The first apply writes the baseline file and prints its SHA-256. Resuming an interrupted import needs `--baseline-sha256 <that value>`.

with `DEMO_SEED_EMAIL` / `DEMO_SEED_PASSWORD` of an administrator **of that organisation**. Apply refuses unless the database name ends
in `_test`, the database is on this machine, `NODE_ENV` is not production, no external integration is configured
(`EMAIL_ENABLED`, SMTP, billing, AI, SMS, ABR), the plan hash matches a plan computed just now, the plan has no conflicts or blockers,
and the sign-in is an administrator of the named organisation. There is no flag that bypasses any of this.

## How the scope is known

`docs/DEMO-IMPORT-FOOTPRINT.json` is **measured, not hand-written**: the test imports the dataset into an empty tenant, records every table that gained rows and how many rows hang from each demonstration parent, and fails if any table gained rows that the footprint does not list, if the committed file differs from the measurement, or if a populated tenant gains a different number of rows than the plan said. A tenant that has records attached to demonstration parents beyond the dataset is a blocker.

## What is new in this revision (review findings)

- **Original records are never adopted.** A record under a demonstration key counts as ours only if a verified baseline shows it did not
  exist when the import began. A similar-name record or an exact copy that was already there is a conflict, and the write boundary
  independently refuses any write carrying the id of a record that existed before the import (anywhere in the request body or query),
  so a bypassed or stale plan still cannot modify an original row.
- **The writer is bound to the verified database.** The importer starts its own isolated app with the verified database settings, a
  random auth secret and every integration switched off, then proves the binding: the session the app issued for the owner must be
  in the inspected database. `--base-url` is rejected, because nothing outside this process can prove what a running app is bound to.
- **Resume works at substep granularity.** Each multi-step sequence is resumed from stored state: tender bid review then decision,
  estimate creation then pricing then the tender value update, approval then submission, risk create/controls/controlled, SWMS
  create/save/review/approve/issue, ITP then its items, project setup then ready then active, a shift then its In Progress marking,
  a meter reading then its service plan.

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
- **Self-check against a baseline of digests only.** Before the first change, every row of every table (all tenants) is reduced to salted
  HMAC-SHA-256 digests of its id and its content. The baseline file (mode 0600, never overwritten) holds table names, row counts, a
  random salt, a schema digest and those digests, plus the operator-supplied organisation id: no passwords, hashes, tokens, session
  contents, names, addresses, rates, free text or raw record ids. Session and verification tables are never read. After the import the
  same digests are recomputed; any pre-existing row that changed or disappeared fails the run (reported by table and count).
- **Baseline integrity on resume.** The operator is shown the file's SHA-256 when it is created and must supply it to resume; the file
  must be owner-only, name the same organisation, match the database schema, and be internally consistent (row counts agree with the
  digests). Any failure refuses before a single change. The SHA-256 is held outside the file, so replacing both the file and the
  recorded value together would defeat the check; the digests are fingerprints, not secrets (the salt is in the file), so the file is
  still not for publication.
- **No external side effects.** The importer refuses to run with any integration configured; the app used for the test runs with email
  disabled and no provider keys.

## The five demonstration team members

The SQL guard permits exactly one kind of write to `users`: inserting the five members defined in `scripts/demo/projects.mjs`
(Elena Voss, Marcus Doyle, Hana Kobayashi, Joel Mercer, Rina Patel), each with its fixed `@kestrel-demo.example.invalid` address, name
and non-admin role. The exception exists because the dataset's records need user ids (project manager, opportunity and action owners)
and the application can only create users by e-mailed invitation, which is not allowed here. The guard checks the address and the id
before writing and writes only when **both are absent**: an existing row (the owner, another member, or a previously imported demo
member) is never updated, and an address or id that belongs to someone else stops the import. No `auth_user` or `auth_account` row
is written, no password is set, so none of the five can sign in; nothing in the guard writes to login, session or membership tables,
and the API guard has no team, invitation, auth or admin route. They are active members in the team list; deactivate them there to hide them.

## What it does not prove

- The plan hash binds an apply to the plan that was reviewed. It is **not** proof of approval, of a valid backup or of a restore.
- Ownership of a plain-named record (division, shift, opportunity, plan, safety record) is a fingerprint: attached to a demo parent, or
  an exact name and description match. An owner record that deliberately copies a demo record exactly would be treated as ours and
  skipped, never overwritten.
- The footprint reflects the dataset as measured on the application version tested. A different application version could write
  different bookkeeping rows; the import test must be re-run (and the footprint regenerated with `WRITE_FOOTPRINT=1`) after any change.
- The dataset assumes the organisation holds the modules it needs (pipeline, estimating, projects, ims, operations, field, dockets,
  commercial, workshop); a disabled or read-only module is a blocker.
- Project numbers continue the tenant's own sequence, so the demo projects will not be `PRJ-0001…` in a tenant that already has projects.
- Business dates follow `--seed-date`; audit timestamps are the real time of the import.
- It cannot remove the demonstration records. Removal would be separate, explicitly approved work with its own dry run.
- Running against a hosted tenant is **not enabled** and needs separate approved work (below). The read-only dry run and
  `scripts/live-tenant-inventory.mjs` are the safe first steps.

## Remaining work before any hosted apply (not implemented, not enabled)

1. **A hosted execution path with its own guard.** Apply currently refuses everything but a local, `_test` database and a local app. A
   hosted run needs a separate, explicitly approved mode: an allow-list naming the one database and app URL, a verified-integrations-off
   check against the *hosted* app's configuration (the importer can only check its own environment today), and no generic bypass flag.
2. **A real maintenance window and write freeze.** The baseline comparison and any fingerprint comparison of other tenants are only
   meaningful while nobody else writes. Hosted apply needs a defined freeze and a way to confirm it.
3. **Backup and restore evidence the tool can check.** A backup file's existence is not proof. The approved procedure must include a
   restore into a scratch database, row-count and fingerprint comparison with the live baseline, and a named human approval recorded
   outside this tool. The plan hash is not that evidence.
4. **Owner-credential handling.** Apply signs in as the owner's administrator. A hosted run needs an agreed way to supply that session
   without storing a password in an environment or a file, and an audit trail showing the import acted as that administrator.
5. **Hosted-app side-effect proof.** Confirm on the hosted app that email, SMS, billing webhooks, AI and ABR are off and that
   claim/PDF generation sends nothing, before the first write.
6. **Dry run against the real tenant**, reviewed by the owner: the conflict list, the footprint table, the team-member decision, and the
   project-number sequence consequence.
7. **Rollback decision.** The import cannot remove what it adds. Either accept restore-from-backup as the only undo, or build a
   separate, approved, dry-run-first removal tool keyed to the same footprint.
8. **Re-run of the import test on the exact build to be deployed**, and a post-import verification pass on the hosted tenant.

## Tests

`npm run test:import-demo` (the full suite) and `npm run test:import-review` (the three review findings, with eight interruption points) both run in CI on isolated disposable databases (`import_check_test`, `import_review_test`). 
`MYSQL_DATABASE=import_check_test node scripts/test-import-demo-tenant.mjs` (empty disposable database, production build required)
builds an owner with a company profile, a division, a client, a worker and an opportunity, plus a second tenant, and proves: the guards;
dry run changes nothing, with a SELECT-only user; four deliberate conflicts are refused; an interrupted (killed) import resumes; no
pre-existing row of any tenant changed; the owner can still sign in; counts and totals equal an empty tenant's; a second run creates
nothing.
