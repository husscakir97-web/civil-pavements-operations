# Infrastruct

The operating system for civil and infrastructure contractors:
**Win work → Prepare work → Resource work → Deliver work → Control money → Learn.**
Sold as a small core plus independently entitled modules (pipeline, estimating,
projects, IMS & HSEQ, operations, field, dockets, commercial, reports).

Next.js 16 / React 19 on Node.js 22, MySQL (Drizzle + mysql2), Better Auth sessions,
and Cloudflare R2 through its S3-compatible API. Hosted on Hostinger Node.js.

Start with [HOSTINGER-MIGRATION.md](HOSTINGER-MIGRATION.md) for browser-only deployment,
and [docs/V1-COMPLETION.md](docs/V1-COMPLETION.md) for what V1 covers and how each item is tested.

## What V1 does

| Area | Workflow |
| --- | --- |
| Company | Signup → organisation + admin membership → skippable onboarding (ABN checksum) → company profile → people, plant, rates, Company Library |
| Win | Opportunity → tender (one workspace: intake, requirements, bid review, estimate, returnables, internal approval, submission, clarifications, award) |
| Estimate | Discipline-neutral work items (or the paving engine) → review → approve (immutable revision with frozen rates) |
| Prepare | Award creates the project from the approved revision: immutable baseline, cost codes, readiness requirements, IMS pack, lineage → setup, risk register, SWMS, ITPs → calculated readiness |
| Deliver | Schedule (clash/competency checks) → field Today → SWMS acknowledgement → shift record → price-free docket → office approval |
| Money | Approved docket → actual cost (idempotent) → variations → progress claims → certification → invoice (GST) → payment → forecast |
| Learn | Estimate vs actual by cost category, labour hours, quantity and margin |

Every business route is guarded on the server: the verified session resolves membership
from MySQL, every query is scoped to that organisation, capabilities
(`lib/platform/permissions.ts`) decide actions, and the entitlement service decides
which modules exist. Field users receive allowlisted projections without rates, margins
or client pricing. Controlled changes are written to `audit_log`.

## Local development

Hostinger setup requires no local commands. For a local checkout:

```sh
npm ci
cp .env.example .env   # supply MySQL, R2 and auth values
npm run db:migrate
npm run dev
```

Quality gates (all run in CI on Node 22 with MySQL 8):

```sh
npm run lint
npm run typecheck
npm test            # legacy SQLite suites + V1 logic suite
npm run build
npm run test:fresh  # fresh automatic startup (needs CREATE/DROP DATABASE)
npm run db:migrate
npm run test:mysql  # production HTTP integration on a *_test database
npm run test:v1     # V1 business journey, scenarios A–G (after build)
```

`migrations/mysql/` is applied automatically (locked, checksummed) by `npm start` and
before builds that have database variables. `drizzle/` is the archived D1 history used
only by legacy tests and the export tool. Run `npm run db:generate` after schema changes.

Never commit `.env` or `exports/`.
