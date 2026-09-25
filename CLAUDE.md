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

- Next.js 16 App Router on Node.js 22 (`next build` / `next start`)
- React 19, TypeScript, Tailwind 4, shadcn/ui (vendored in `vendor/`)
- Hostinger Node.js hosting, MySQL, R2 through the S3 API
- Drizzle ORM; active migrations in `migrations/mysql/`
- npm with committed package-lock.json
- Better Auth email/password and MySQL sessions

---

## 3. Layout and boundaries

```
app/api/<module>/route.ts   HTTP handlers (every handler wrapped by withActor or api())
app/api/registers/[key]     generic typed-register API (lib/v1/registers.ts definitions)
components/v1/*             V1 workspaces (pipeline, projects, SWMS, commercial, field…)
components/<module>-*.tsx   legacy workspace components still in use (dockets, planning…)
lib/platform/*              platform: auth, route guard, permissions, entitlements, audit,
                            workflow state machines, documents, finance, sql helpers
lib/modules/<module>/*      module services (pipeline, estimating, projects, hseq,
                            commercial, field) — may NOT import each other (lint-enforced)
lib/seams/*                 cross-module seams and aggregation (award→project,
                            docket→cost, project control, home feed, reports)
lib/v1/*                    isomorphic definitions shared by server and UI
lib/*.ts                    legacy flat modules (dockets, tender files, planning, field…)
db/schema.ts, schema-v1.ts  Drizzle schema (legacy + V1 typed tables)
migrations/mysql/           ACTIVE migrations (append-only, applied on start)
drizzle/                    archived D1 migrations (historical; used by legacy tests only)
scripts/                    migration runner, tests, admin tools
```

### Module list

`pipeline` (opportunities, tenders) · `estimating` · `projects` · `ims` (HSEQ, SWMS,
ITP) · `operations` (schedule, resources) · `field` · `dockets` · `commercial`
(variations, claims, invoices) · `reports` · `ai` — plus `core` (always on).

### The boundary rule

**A module may not import another module's code.** `lib/modules/*` is enforced by
the `import/no-restricted-paths` ESLint rule; the build fails on a violation.

Shared logic goes in `lib/platform/`. Cross-module behaviour goes through a seam in
`lib/seams/`. If you find yourself wanting a direct import, that's the signal
you've found a seam — build it as a seam, not an import.

`lib/utils.ts`, `lib/authz.ts`, `lib/platform/*`, `lib/v1/*` and `db/` are platform
and may be imported by anyone.

---

## 4. Architecture

```
MODULES        pipeline │ estimating │ projects │ ims │ field │ dockets │ commercial
                              ↓ never direct imports
SEAM LAYER     award→project │ docket→cost │ variation→claim │ project control │ home │ reports
                              ↓
PLATFORM       org │ membership │ capabilities │ entitlements │ documents │ audit │
               workflow state machines │ finance arithmetic │ AI orchestration (not activated)
```

Legacy files in flat `lib/` move toward `lib/platform/` or `lib/modules/<module>/`
only as part of a task that already touches them. **Do not do a repo-wide
reorganisation** unless explicitly asked.

---

## 5. Known debt — do not build on top of these

Resolved on the V1 branch (kept for history): the forgeable `oai-*` header auth and
hardcoded owner (replaced by Better Auth sessions + membership), the non-org-scoped
`dockets` table (now scoped), the fail-closed single-organisation guard (every query
is scoped to the session organisation; `DEFAULT_ORGANISATION_ID` no longer exists —
use `currentOrganisationId()`), and URL-regex permissions (explicit `withActor`
guards + `lib/platform/permissions.ts` capabilities).

### 5.1 Authentication

`lib/platform/auth.ts` owns Better Auth. Business routes use explicit `withActor`
guards (or `api()` from `lib/platform/http.ts`) and capability checks. Never trust
`oai-*` headers, email matching, client role claims, or client organisation IDs.

### 5.2 `orgEntity()`-style JSON tables

Legacy tables (workers, plant, shifts, commercial_records, quote_revisions…) keep
real data inside a `metadata` JSON string. `opportunities`, `jobs`, `estimates` and
`tender_requirements` gained typed columns in migration 0003 (legacy metadata is
still read as a fallback).

**Rule:** never add new JSON-blob tables. New entities get typed columns (see
`db/schema-v1.ts`). Promote a legacy entity when a task needs to query or
constrain its fields — one entity at a time, with a migration.

### 5.3 Two data layers

Legacy routes use the D1-compatible `database` wrapper (`lib/platform/database.ts`)
so the SQLite regression suites keep running; V1 services use `lib/platform/sql.ts`
(mysql2, transactions, `IN (?)` arrays). Code that legacy SQLite tests exercise
(entitlements, estimate approval, award seam, docket seam) uses the wrapper.

### 5.4 AI is not activated

`OPENAI_API_KEY` alone must not enable AI. Billing, consent, spending controls and
an idempotent usage ledger come first (PRODUCT.md). All workflows work without AI.

---

## 6. Seams and entitlements

### Entitlements (`lib/platform/entitlements.ts`)

Modules are turned on and off per organisation in `organisation_entitlements`
(`active` / `read_only` / `disabled`). All checks go through this service:
`withActor(handler, permission, module)` for routes, `session.module()` for
navigation, `seamEnabled()` for seams. Never scatter `if (hasModule)` through
components. New signups get the beta full-access trial; billing is not connected.

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

- **Migrations are append-only.** Never edit an applied file in `migrations/mysql/` or the archived `drizzle/`. Add a
  new one. Never write a destructive migration against customer data.
- **Every new table gets `organisation_id` and an index on it.** No exceptions.
- **Every mutable business entity should carry** `revision`, `status`,
  `created_at`, `updated_at`, and — where AI can write it — `source_reference`.
- **Prefer immutable revisions** over in-place updates for anything with
  compliance or contractual weight. `preparation_revisions` is the reference
  implementation.
- Run `npm run db:generate` after schema changes; commit the generated migration.

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

- TypeScript compiles, `npm run lint` passes
- New logic has a test that actually runs (see §10)
- Any new table has a migration and an `organisation_id`
- No new reliance on the `oai-*` auth headers
- No new `orgEntity()` tables
- No cross-module imports introduced

---

## 10. Testing

- `npm test` — legacy SQLite business suites + `scripts/test-v1-logic.cjs`
  (state machines, capabilities, ABN, finance, estimate items, docket cost lines).
- `npm run test:mysql` — production HTTP integration (Better Auth, MySQL, SMTP/S3 fixtures).
- `npm run test:v1` — the V1 business journey (scenarios A–G) against the built
  production server. Run `npm run build` first.
- CI runs lint, typecheck, test, build, test:fresh, db:migrate, test:mysql, test:v1.

These requirements are automated:
- **Tenancy isolation** — scenario G + test:mysql (read/update/delete/search/report/export by known IDs)
- **Module boundaries** — ESLint `import/no-restricted-paths` on `lib/modules/*`
- **AI governance** — extracted/AI requirements start `suggested`; state machines
  refuse `suggested → complete`; SWMS/estimates/claims approvals need a human
  capability and are written to `audit_log` (logic + journey)

When a V1 behaviour change breaks a legacy test, update the test only when the
change is an intended rule (and say so in the PR); never delete or weaken tests.

---

## 11. Build order

Do not jump ahead. Each phase has an exit test that must pass before the next.

1. **Platform hardening** — real auth, entitlement service, test runner + CI,
   docket org-scoping *(done on the V1 branch)*
2. **Tender & Prequalification** — extraction, response library, submission assembly
3. **Job setup, pre-commencement, planning**
4. **Field & Dockets** — offline, mobile-first
5. **Commercial** — variations, claims, retention *(last: highest liability,
   needs real field data to be trustworthy)*

The owner-directed V1 completion run delivered phases 2–5 at V1 depth
(docs/V1-COMPLETION.md). Not yet built: offline field capture and retention
accounting.

---

## 12. When in doubt

Ask. A question costs one message. A wrong architectural decision, built on for two
weeks by two agents, costs far more.
