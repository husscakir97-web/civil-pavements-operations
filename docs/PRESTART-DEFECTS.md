# Prestart / inspection → Workshop defect chain (Tranche 8C)

The chain runs: form (prestart or inspection) → defect → severity → critical safety hold → Workshop work order → repair → independent verification → return to service.

It joins the Forms engine (IMS) to the existing Workshop module through the named seam `form.defect`. Workshop's own rules are reused unchanged:
- A critical defect puts the asset on safety hold (`Out of service`, which also blocks scheduling).
- Repairs need independent verification by someone other than the repairer (`workshop.verify`).
- The hold only clears when the **last** open critical defect on the asset is verified.

## Authority

`form.defect` requires IMS writable, Workshop writable and the capability **`workshop.defect.report`**. That capability means "may report a plant defect into Workshop" and nothing more: no repair (`workshop.edit`), verification (`workshop.verify`) or asset administration. Form submission never depends on Workshop, and `forms.submit` is not authority to create a defect.

Held by: admin, office, scheduler, project manager, project engineer, site engineer, supervisor, field worker. Not held by: estimator, accounts, read only. The domain event `workshop.defect.reported` is published under the same capability.

## How it works

- `POST /api/forms/defects {submissionId, assetId, fieldId, title, severity, note, clientRequestId}` raises the defect (`lib/seams/form-defects.ts`):
  - the submission is read through `resolveFormSubmissionForWorkflow()` in `lib/platform/forms.ts`: a server-only helper, not an endpoint, that re-applies the normal Forms rules (`forms.view`, project membership, shift audience) and returns only what downstream workflows need (template/version, schema, authoritative context, derived project and shift, submitter, effective responses, current amendment sequence, asset ids). The seam never rebuilds Forms logic;
  - inside the transaction the submission row is locked, so the amendment sequence recorded is the one effective at that moment;
  - only plant recorded on that evidence and a field that exists on the form version are accepted;
  - Workshop's `raiseSourcedDefect()` opens the work order, applies the critical hold, and writes the entry, audit and domain event.
- `GET /api/forms/defects?submissionId=` lists the defects for a submission with status, hold and `canRaise` (server-computed: capability + both modules writable).
- `GET /api/forms/defects?workOrderId=` describes the source of a Workshop order (see below).

## Provenance (migration `0021_form_defect_links.sql`, additive)

`workshop_orders` records: `source_type`, `source_id` (submission), `source_field` (answer), **`source_amendment_sequence`** (0 = original, N = correction N effective when raised), `source_context_type`, `source_context_id`, `source_project_id`. The reporter is the existing `created_by`. Forms responses are never copied; the submission id, the exact template version Forms retains, and the amendment sequence give the historical chain. Later corrections never change the order.

## Source relationship vs idempotency

They are separate. The source link (submission + answer) is a relationship and is **not unique**: one answer can produce several defects (rear beacon and work light from "safety lights OK? = No"). Retry-safety uses the platform client-request-id pattern (`lib/platform/idempotency.ts`, `client_requests`): the UI creates a request id per deliberate defect; a replay returns the first work order and creates nothing; the same id with different content is refused (409). The request id is required (400 without it).

## UI

- Submission view, **Plant defects** panel: hold banner, defects with status and evidence state ("raised on correction N"), and "Raise defect" only when the server says the actor can (read-only Workshop or no capability shows an explanation instead of an action that would fail).
- Workshop order detail: form name and version, submitted time and submitter, context (shift/project/plant), answer, evidence state (and that the form has since been corrected), and **View source inspection**, which opens the authoritative submission through the Forms API. A viewer outside the Forms scope sees only "raised from a form you are not authorised to view".
- Workshop asset selection: the reusable Forms launcher and submissions list for the `asset` context (needs IMS entitled and `forms.view`/`forms.submit`; hidden otherwise).

## Entitlements

- Workshop disabled: forms submit normally; the seam returns 409 and no defect panel is shown.
- Workshop read-only: existing orders and defects stay readable; no new defects; no "Raise defect".
- IMS disabled: Workshop still works; its Forms section and source link are hidden.

## Not in this tranche

- Automatic defects from answers ("plant safe = No" → defect). Raising is a deliberate user action.
- QR launch and offline prestarts.
