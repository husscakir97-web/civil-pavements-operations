# CLAUDE.md — Architecture Rules

Rules for **all** AI agents working in this repository (Claude Code, Codex, or any
other). Read this before making any change. If a task conflicts with a rule here,
stop and ask the human — do not resolve it yourself.

---

## 1. What this product is

Civil & Pavements Operations: an operating system for civil/infrastructure
contractors, sold as a **small mandatory core plus independently purchasable
modules**. A customer may buy Dockets alone, or Tendering alone, or everything.

Two consequences that govern every decision in this repo:

- **Each module must work standalone.** A module must never require another
  module to be present in order to function.
- **The seams are the product.** Where modules meet (award → job, docket → cost,
  variation → claim) is the competitive advantage. Seams are built at the platform
  layer, never inside a module.

---

## 2. Stack

- Next.js 16 App Router via `vinext` (Vite-based, **beta** — treat framework-level
  workarounds as suspect and comment them)
- React 19, TypeScript, Tailwind 4, shadcn/ui (vendored in `vendor/`)
- Cloudflare Workers + D1 (SQLite) + R2
- Drizzle ORM, migrations in `drizzle/`
- pnpm

---

## 3. Layout and boundaries

```
app/api/<module>/route.ts   HTTP handlers, one folder per module
components/<module>-*.tsx   one workspace component per module
lib/                        business logic (currently flat — see §4)
db/schema.ts                Drizzle schema
drizzle/                    migrations (append-only)
scripts/                    build + ad-hoc test scripts
```

### Module list

`tenders` · `estimates` · `dockets` · `commercial` · `field` · `ims` ·
`preparation` · `delivery` · `invoices` · `job-hub` · `reports` · `opportunities`

### The boundary rule

**A module may not import another module's code.**

Concretely: `lib/dockets-db.ts` must not import from `lib/tender-db.ts`,
`lib/commercial-links.ts`, or any other module's files. Same for API routes and
workspace components.

Shared logic goes in the platform layer (§4). Cross-module behaviour goes through
a seam handler (§6). If you find yourself wanting a direct import, that's the
signal you've found a seam — build it as a seam, not an import.

`lib/utils.ts`, `lib/authz.ts`, and `db/` are platform and may be imported by
anyone.

---

## 4. Target architecture (we are not here yet)

```
MODULES        tenders │ estimates │ dockets │ commercial │ field │ ims │ ...
                              ↓ events only, never direct imports
SEAM LAYER     award→job │ docket→cost │ field→variation │ variation→claim
                              ↓
PLATFORM       org │ users │ RBAC │ documents+revisions │ requirements │
               evidence │ workflow engine │ audit │ entitlements │ AI orchestration
```

`lib/` is currently flat with no enforced boundary. When you touch a file, move it
toward `lib/platform/` or `lib/modules/<module>/` — but only as part of a task
that already touches it. **Do not do a repo-wide reorganisation** unless explicitly
asked; large refactors are unreviewable and break the other agent's work in flight.

---

## 5. Known debt — do not build on top of these

These are recorded deliberately. If your task touches one, raise it rather than
working around it silently.

### 5.1 Auth is forgeable off-platform — CRITICAL

`lib/authz.ts` and `middleware.ts` trust the request headers
`oai-authenticated-user-id` and `oai-authenticated-user-email`. This is only safe
behind the ChatGPT Sites proxy, which strips client-supplied copies.

**On any other host, anyone can forge these headers and become any user,
including the owner.** This must be replaced with real session auth before the app
is deployed anywhere except Sites. Never add a feature that increases reliance on
these headers.

The owner email is also hardcoded in `lib/authz.ts`. Move it to config.

### 5.2 `orgEntity()` is a JSON blob, not a schema

`db/schema.ts` defines ~18 tables through the `orgEntity()` factory. They all share
`id, organisation_id, name, status, metadata, created_at`, with all real data
inside the `metadata` JSON string. No foreign keys, no constraints, nothing
queryable.

**Rule:** do not add new tables via `orgEntity()`. New entities get real, typed
columns. When a task requires querying or constraining a field currently inside
`metadata`, promote that entity to a real table as part of the task — one entity
at a time, with a migration.

`field_records`, `field_history` and `preparation_revisions` are correctly modelled.
Use those as the pattern.

### 5.3 `dockets` is not org-scoped

The `dockets` table has no `organisation_id`. Every other table has one. This is a
cross-tenant data leak and must be fixed before a second organisation is onboarded.

### 5.4 Multi-tenancy is effectively off

`requireActor` fails closed for any org other than `DEFAULT_ORGANISATION_ID` unless
called with `organisationScoped=true`. Keep that fail-closed behaviour. Never widen
it globally — parameterise the specific query helpers your task touches, and pass
`organisationScoped=true` only where every query in that path is genuinely scoped.

### 5.5 Permissions are string-matched by URL regex

`middleware.ts` picks a permission level from a regex on the path. Brittle. Prefer
adding an explicit `requireActor(...)` call with the right permission inside the
handler over extending the regex.

---

## 6. Seams and entitlements

### Entitlements (not yet built — this is the next major platform piece)

Modules are turned on and off per organisation. When the entitlement service
exists, all checks go through one function. Never scatter `if (hasModule)` through
components.

Three enforcement points:
- **Route** — module off means the route 404s. Not a paywall page.
- **Seam** — a seam only fires if *both* modules are entitled.
- **Data** — data created while entitled is never deleted on downgrade. It becomes
  read-only.

### Graceful degradation

Every seam needs a defined behaviour when the downstream module is absent. The
fallback is always: the upstream module still works fully, and offers an export.

| Seam | Both on | Downstream off |
|---|---|---|
| Award → Job | Job created with estimate lineage | Award recorded, CSV export offered |
| Docket → Cost | CostTransaction against budget | Docket stored and exportable |
| Field event → Variation | Variation draft with evidence | Event flagged for follow-up |
| Variation → Claim | Claim line created | Variation approved, exportable |

---

## 7. AI rules

Any AI feature in this product (tender extraction, docket OCR, invoice parsing,
document drafting) obeys these without exception:

1. **AI writes drafts only.** An AI-created or AI-updated record may only be
   written with status `Suggested` or `Draft`. Only a human, permissioned action
   may transition it to `Approved` / `Issued` / `Submitted`. Enforce this in code,
   not in a comment.
2. **Every AI output is source-linked.** Store `source_document_id`, location
   (page/clause), `confidence`, and `extracted_at`. The existing dockets table does
   this well (`sourceKey`, `sourcePage`, `sourceCrop`, `fieldConfidence`) — follow
   that pattern.
3. **Deterministic stays deterministic.** Numbering, versioning, entitlement
   checks, state transitions, rate calculations, claim arithmetic and notice-date
   calculations are code, never model output.

---

## 8. Data rules

- **Migrations are append-only.** Never edit an existing file in `drizzle/`. Add a
  new one. Never write a destructive migration against customer data.
- **Every new table gets `organisation_id` and an index on it.** No exceptions.
- **Every mutable business entity should carry** `revision`, `status`,
  `created_at`, `updated_at`, and — where AI can write it — `source_reference`.
- **Prefer immutable revisions** over in-place updates for anything with
  compliance or contractual weight. `preparation_revisions` is the reference
  implementation.
- Run `pnpm db:generate` after schema changes; commit the generated migration.

---

## 9. Working practice

- **One task, one branch, one agent, one PR.** Never two agents on the same branch.
- **Small tasks.** "Add the entitlement service with these three checks" — not
  "build the tender module."
- **Never merge to `main` yourself.** The human merges.
- **Don't reorganise, rename, or reformat outside your task's scope.** Drive-by
  cleanup makes PRs unreviewable and collides with the other agent.
- **Don't commit secrets.** `.env` is gitignored; add new variable names to
  `.env.example`.
- **If you can't complete a task, say so.** Never produce plausible-looking work in
  place of a real result.

### Definition of done

- TypeScript compiles, `pnpm lint` passes
- New logic has a test that actually runs (see §10)
- Any new table has a migration and an `organisation_id`
- No new reliance on the `oai-*` auth headers
- No new `orgEntity()` tables
- No cross-module imports introduced

---

## 10. Testing

There is currently **no test runner wired up**. `scripts/test-*.cjs` are ad-hoc
scripts with no `test` script in `package.json` and no CI.

Fixing this is a priority task. Until it exists: when you add logic, add a test in
the existing script style and note in the PR that it must be run manually.

Once a runner exists, these must be automated and run on every commit:
- **Tenancy isolation** — two orgs cannot see each other's data
- **Module boundaries** — a lint rule failing the build on cross-module imports
- **AI governance** — no AI-authored record can reach an approved status without a
  human action in the audit log

---

## 11. Build order

Do not jump ahead. Each phase has an exit test that must pass before the next.

1. **Platform hardening** — real auth (replacing §5.1), entitlement service,
   test runner + CI, docket org-scoping (§5.3)
2. **Tender & Prequalification** — extraction, response library, submission assembly
3. **Job setup, pre-commencement, planning**
4. **Field & Dockets** — offline, mobile-first
5. **Commercial** — variations, claims, retention *(last: highest liability,
   needs real field data to be trustworthy)*

---

## 12. When in doubt

Ask. A question costs one message. A wrong architectural decision, built on for two
weeks by two agents, costs far more.
