# Commercial pilot: claim output and the cost/billing boundary

The isolated implementation starts at main `b8a75ae` (PR55). Checkpoint
`c447376` adds a client-review PDF to the existing claims workflow; it does not
resolve the meaning of `docket.amount` or establish a new proforma money store.

## What the output guarantees

- The document title is **Progress claim - client review**. The footer says
  **Claimed amounts in AUD excluding GST. Client review copy - not a tax invoice.**
- Claim number, revision and status appear in the print header. Client, project,
  contract, claim period and approval date appear in the body. The filename is
  `Client-review-<sanitised project number or ID>-Claim-<number>-rev-<revision>.pdf`.
- Lines, gross, retention and net are the stored original claim values. The
  exporter does not read supplier cost transactions, infer a markup, calculate
  margin, or substitute certified values. It does not calculate GST.
- Only approved/submitted or later claims with approval provenance can export.
  Tenant, project and expected revision must match. Incomplete amounts fail
  closed. The claim row is locked while the snapshot is read; rendering is later.
- Project/customer labels come from the current project record. They are not an
  immutable historical identity snapshot. This is a review copy, not an issued
  invoice or a versioned managed-document publication.

## Verified synthetic example

The manually reviewed supplier docket records 2 tonnes at $300: $600 actual cost.
PR55 handles retry, reversal, reapproval and allocation round trips with one active
posting. Separately agreed contract work is entered as a $1,000 claim against a
$5,000 contract baseline, with $50 retention and $950 net excluding GST.

`scripts/test-commercial-output.cjs` checks the stored line is a contract line
against the baseline, not a docket line. It changes the supplier cost to $725 and
re-runs the cost seam: the client-review claim remains $1,000 / $50 / $950. It also
checks document labels/context, filename, stale revisions, missing amounts and
tenant/project/role refusals. These are SQLite service fixtures, not authenticated
UI or real MySQL concurrency evidence. Unknown or GST-incomparable margin remains
absent from this output; this change does not fix existing forecast/P&L screens.

## Claim-time billing confirmation (no migration)

Main and checkpoint `c447376` implicitly offered `docket.amount` as revenue. The
follow-up replaces that behavior without globally disabling docket-linked claims.
Existing fields cannot classify billability safely: docket type is a free-form
hint, extraction profiles describe OCR, `valueSource` describes extraction, and
field-entry dockets initially have quantities but no priced amount.

Approved, allocated, unclaimed dockets remain available as evidence. Their
`contractValue` and `remaining` are now **null**, with `billingRequired: true` and
`docketVersion` equal to the stored `updated_at`. No supplier amount is offered or
preselected as client revenue. To include one, a claim editor explicitly enters
an independently agreed positive client charge excluding GST, supplies a 10–200
character client agreement/contract-rate reference, and confirms the basis.

The existing claim-create input gains this optional property, required for every
nonzero docket line:

```ts
billingBasis: {
  confirmed: true;
  reference: string;
  expectedUpdatedAt: string;
}
// thisClaim is the separately agreed ex-GST client charge, never a docket-cost fallback.
```

The server checks permission and project scope, locks the project first, then
reads the latest docket eligibility/version. Missing/unconfirmed basis or stale
version fails before writes. The existing anti-doubleclaim key, conditional
docket status update and allocation/reversal locks remain in place. The UI clears
confirmation when the amount or reference changes. Internal claim approval is
still required before a client-review PDF is available.

No new persistent field is needed: existing claim-line `contract_value`,
`this_claim`, and `claimed_to_date` store the independently confirmed charge;
`description` stores its reference. The existing transactional `claim.created`
audit includes `billingConfirmations`: docket ID/version, ex-GST amount,
reference, confirming actor and timestamp. Deleting a draft releases the docket
as before, and a subsequent claim needs fresh confirmation. The source amount
and cost rows are never written by confirmation.

This is a recorded human confirmation, not automated proof of a client's
agreement or a contract-rate calculation. No docket-wide billing classification
or persistent rate library is inferred. Those shared foundations remain separate.

## Legacy behavior, tests and remaining validation

Existing claims/invoices are read unchanged. They are not retroactively marked
as confirmed, repriced or rewritten; historic ambiguous docket claims require
deliberate review. Old clients posting docket lines without `billingBasis` now
receive a refusal. Contract and approved-variation claims retain existing rules.
There is no schema migration or monetary backfill.

The local fixture verifies missing/stale confirmations cause no writes, cost
$600→$725 does not change a separately confirmed $1,000 client charge, audit
provenance, retry exclusion, draft deletion/reconfirmation, scope checks and the
approved output. The MySQL journey adds the confirmation to existing claim/race
fixtures: a queued claim behind a cost edit must now refuse its stale version,
then accept the independent charge after refresh. Full Node 22, Linux CI and
disposable MySQL concurrency/authenticated UI validation remain required.
