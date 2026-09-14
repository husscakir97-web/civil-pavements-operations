# Product direction

Pavement Operations OS is a white-label subscription product for civil and pavement contractors. Roadworx is an existing customer workspace, not the platform identity. Preserve its records; never copy customer data, rates, people or branding into another customer's defaults.

## Document capture

- Standard extraction reads digital PDF text first and uses local OCR for printed scans. It incurs no AI-provider charge.
- Handwriting AI is a separate explicit action for both dockets and invoices. It reads original page images, not only damaged OCR text.
- Show a server-issued price in AUD, page count and confirmation before any paid request. Customer scan prices are distinct from provider costs.
- AI is not activated yet. Do not enable it merely because an API key exists. Billing, valid company entitlement, consent, spending controls and an idempotent usage ledger must be connected first.
- Retries must not charge a customer twice. Do not claim a charge or refund unless recorded by the billing system.
- Results remain drafts. Missing dates, quantities and hours must remain unconfirmed; printed form labels must not be accepted as values.

## White-label and subscription release gates

- Workspace product name, company display name, workspace name and accent colour are configurable and company-scoped.
- Complete the migration of legacy hardcoded organisation queries and helper functions before enabling multiple customer organisations. Keep the current fail-closed organisation guard until all affected APIs, files, reports and background tasks pass cross-company isolation tests.
- Replace the current account-specific bootstrap with verified onboarding and membership provisioning; add customer invitations and role enforcement.
- Add verified subscription checkout/webhooks, plan entitlements, cancellation and payment-failure handling, plus optional AI usage charging.
- Add company logos, branded quote/invoice templates and custom-domain support when the corresponding hosting capabilities are confirmed.
- Subscription amounts and AI retail prices require the product owner's decision. Do not present example estimates as live prices or billing as operational before integration.
# Release testing requirement

The owner requires multiple meaningful tests before any review deployment.
Run document regression tests, persistence and permission tests, the production
build, and authenticated browser workflows. Report failures and untested areas
explicitly. Parser fixtures do not establish real image/handwriting accuracy.
Do not publish this update until authenticated browser QA can be completed.
