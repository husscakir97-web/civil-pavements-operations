# Modular foundation tranche

Standalone by design. Connected by default.

Inspected remote main: c8a33de7b9ff3fb0c14d0a20f4a7052c2dda46b1.
Authoritative requirements: uploaded Pasted text.txt, 28 September 2026.

## Impact map

| Current component | Treatment | Migration |
| --- | --- | --- |
| Node 22 / Next 16 / React 19 / Hostinger / MySQL / Drizzle / Better Auth / R2 | Keep | None |
| Entitlements and nine-role capability matrix | Extend fail-closed access and tenant guard | Preserve keys and rows |
| Module catalogue | Explicit contracts, owned entities, Core dependencies, optional seams, surfaces and reporting | None |
| Existing award and docket cost seams | Keep synchronous transactions; add typed tenant event journal | Append-only 0006 |
| Home, engine overview and navigation | Shared workspace visibility, permission-filtered Core summaries | None; old URLs remain |
| Conflict engine, offline queue, Civil Knowledge Engine, storage, billing, financial arithmetic | Keep | None |
| Workshop, HR, forms, dispatch, external links | Later tranches | No placeholder UI or trial grants |

## Event contract

The monolith keeps controlled financial and award effects synchronous. Domain events
are a durable journal committed in the same database batch as the source mutation,
not an unconfigured background broker. Actor and tenant come only from the session.
Event payloads contain references, not prices, HR details or documents. Publishing
requires the source capability and active entitlement. Reads require audit access
and the source module's read capability and entitlement. Disabled modules remain
stored, but cannot be read through this endpoint. Optional seams also check their
initiating capability and all participating entitlements. Nothing replays past
controlled actions automatically when a module is re-enabled.

## Continuation

- Add a transactional outbox/delivery receipt and explicit retry policy before any
  asynchronous notification or webhook consumer. Revalidate current target
  entitlement and a restricted service capability at delivery. No public publish API.
- Extend shared resource access for standalone Workshop before selling it. Implement
  immutable defect/repair verification and resource-availability projections with
  two-tenant integration tests; do not grant Workshop on signup until usable.
- Make each module's field functions available through a module-aware delivery
  surface before retiring legacy Field entitlement checks. Preserve offline sync IDs.
- Versioned Forms needs immutable published revisions, submission/amendment history
  and offline replay tests before migrating existing HSEQ workflows.
- Existing project-centric Commercial and some Field/HSEQ links need further
  standalone workflow work. This tranche does not certify every product standalone.
- Billing checkout, SMS, address autocomplete and platform administration remain
  unavailable until real adapters and explicit operator policies are implemented.

## Release gate

Do not deploy until lint, typecheck, regressions, build, MySQL/V1 integration and
authenticated browser QA pass. Validation results are recorded below after execution.

Schema generation was run. The prior release had no 0005 snapshot, so Drizzle
also proposed recreating the existing knowledge tables. That duplicate SQL was
excluded: 0006 contains only the new journal. The generated 0006 snapshot now
captures the current schema for subsequent generation; no applied SQL was edited.
