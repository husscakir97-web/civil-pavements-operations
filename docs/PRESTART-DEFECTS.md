# Prestart / inspection → Workshop defect chain (Tranche 8C)

The chain runs: form (prestart or inspection) → defect → severity → critical safety hold → Workshop work order → repair → independent verification → return to service.

It joins the Forms engine (IMS) to the existing Workshop module through the named seam `form.defect`. Workshop's own rules are reused unchanged:
- A critical defect puts the asset on safety hold (`Out of service`, which also blocks scheduling).
- Repairs need independent verification by someone other than the repairer (`workshop.verify`).
- The hold only clears when the last open critical defect is verified.

## How it works

- `POST /api/forms/defects {submissionId, assetId, fieldId, title, severity, note}` raises the defect. `lib/seams/form-defects.ts` then:
  - checks that both IMS and Workshop are entitled (`requireSeam('form.defect')`, capability `forms.submit`);
  - re-resolves the submission's form context, so an operator can raise defects from shifts they are assigned to but not from project-level evidence;
  - only accepts plant recorded on that evidence (the asset context or an asset field answer) and a field that exists on the form version;
  - calls Workshop's `raiseSourcedDefect()`, which locks the asset, opens the work order and applies the critical hold, then writes the entry, audit and a `workshop.defect.reported` domain event.
- `GET /api/forms/defects?submissionId=` lists the defects for anyone who can see the submission, with status (awaiting repair, rework, awaiting verification, returned to service) and the current hold.
- There is one defect per answer: `workshop_orders.source_type/source_id/source_field` has a unique index (migration `0021_form_defect_links.sql`, additive).
- The form submission is never modified.
- Without Workshop the seam does not fire (409). The submission is kept, and the defect can be recorded manually later.
- Field workers still cannot use Workshop directly. Repair and verification stay with Workshop roles.

## UI

- The submission view has a **Plant defects** panel: safety-hold banner, linked defects with status, and "Raise defect" (plant, answer, severity, details).
- Workshop orders raised this way are labelled "raised from a form".

## Not in this tranche

- Automatic defects from answers (for example "plant safe = No" → defect) are not built. Raising is a deliberate user action.
- QR launch and offline prestarts are not built.
