# Product direction

Infrastruct is a modular, white-label operating system for civil and infrastructure contractors (civil construction, road maintenance, asphalt, profiling, traffic management, linemarking, earthworks, drainage, utilities, concrete, landscaping, maintenance, plant hire and specialist subcontractors). Doctrine: simple, fast, reliable, scalable. Roadworx is an existing customer workspace, not the platform identity. Preserve its records; never copy customer data, rates, people or branding into another customer's defaults.

## Document capture

- Standard extraction reads digital PDF text first and uses local OCR for printed scans. It incurs no AI-provider charge.
- Handwriting AI is a separate explicit action for both dockets and invoices. It reads original page images, not only damaged OCR text.
- Show a server-issued price in AUD, page count and confirmation before any paid request. Customer scan prices are distinct from provider costs.
- AI is not activated yet. Do not enable it merely because an API key exists. Billing, valid company entitlement, consent, spending controls and an idempotent usage ledger must be connected first.
- Retries must not charge a customer twice. Do not claim a charge or refund unless recorded by the billing system.
- Results remain drafts. Missing dates, quantities and hours must remain unconfirmed; printed form labels must not be accepted as values.

## White-label and subscription release gates

- Workspace product name, company display name, workspace name and accent colour are configurable and company-scoped.
- Done on the V1 branch: every query is scoped to the session organisation (two-organisation attack tests pass for reads, updates, deletes, search, reports, documents and exports); signup provisions an organisation, admin membership, beta entitlements and onboarding; invitations and capability enforcement are server-side.
- The entitlement service (`organisation_entitlements`) is the single switch for modules. Downgrades make data read-only, never deleted.
- Still required before charging: verified subscription checkout/webhooks, plan-to-entitlement mapping, cancellation and payment-failure handling, plus optional AI usage charging.
- Add company logos, branded quote/invoice templates and custom-domain support when the corresponding hosting capabilities are confirmed.
- Subscription amounts and AI retail prices require the product owner's decision. Do not present example estimates as live prices or billing as operational before integration.

## Civil Knowledge Engine

- Infrastruct may validate work against controlled civil knowledge, but it must never invent an engineering, legal, employment or specification requirement.
- Every enforceable knowledge rule must retain provenance: source/authority, reference, revision, effective dates where relevant, and clause/page when available.
- Only Current packs, Current sources and Current rules may affect live checks. Draft, superseded and retired knowledge remains historical only.
- Knowledge is deterministic code/data, not an AI answer. AI may help interpret or draft, but the platform rules engine is the authority for automated checks.
- Organisation and project/client-specific knowledge can coexist. Do not silently decide contractual precedence when requirements conflict; surface the applicable sources for human resolution.
- Do not reproduce copyrighted standards or licensed publications unless the organisation/platform has the right to store and use that content. Prefer encoded requirements plus source references.
- The first live consumer is Estimating; the same check API is designed for Project Setup, HSEQ, Scheduling, Workshop, Prestarts and Field capture.

# Release testing requirement

The owner requires multiple meaningful tests before any review deployment.
Run document regression tests, persistence and permission tests, the production
build, and authenticated browser workflows. Report failures and untested areas
explicitly. Parser fixtures do not establish real image/handwriting accuracy.
Do not publish this update until authenticated browser QA can be completed.

## AI doctrine

AI assists; it never approves. AI or extraction output starts as Suggested/Draft with source and confidence; a permissioned person confirms. Financial totals, numbering, ratings and state transitions are deterministic code. Every workflow works without an AI provider.

## Compliance language

Infrastruct helps businesses operate systems aligned with ISO 9001, ISO 45001 and ISO 14001. It does not certify; certification remains with external bodies.
