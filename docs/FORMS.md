# Forms engine (Tranche 8A)

Core infrastructure for configurable operational forms: prestarts, inspections, toolbox records,
audits, plant/environmental inspections, quality and project checklists. The first product surface
is **IMS & HSEQ → Forms**. The same engine also serves Project → Quality & HSEQ and the field shift view.

> A published form is a controlled record definition. A submitted form is evidence.
> Neither changes after the fact.

Existing Risks, Incidents, NCRs, Corrective actions, ITPs, SWMS and Workshop records are **not**
replaced or migrated. They remain their own domain records.

## Model (migration `0019_forms_engine.sql`)

| Table | Purpose |
|---|---|
| `form_templates` | Name, description, category, `module` (`ims` today), active/archived, `current_version_id`. |
| `form_template_versions` | `version_number` (unique per organisation + template), `draft`/`published`/`superseded`, full `schema_json`, change reason, publisher and time. |
| `form_submissions` | Immutable evidence: exact `template_version_id`, `context_type`/`context_id`, derived `project_id`, responses, provenance, submitter and time. No update path exists. |
| `form_submission_amendments` | Append-only corrections: sequence (unique per submission), full corrected snapshot, changed field ids, mandatory reason, author and time. |

Every table has `organisation_id` with an index.

## Versioning

- A draft is the only editable version.
- Publishing a draft supersedes the previous published version and makes the draft current.
- "Start new revision" copies the current schema into draft `n+1`. Only one open draft is allowed per template.
- Published and superseded versions are refused on edit (409) and stay readable.
- A submission always renders and validates against the version it used. Submitting against a stale version returns 409.

## Schema

The schema is a set of sections containing fields. Field and section ids are stable keys: lowercase letters, digits and `_`. Labels can change in later versions without breaking history. Choice options have stable `value`s.

Field types:
- Short text, long text, number (min/max), date, date & time
- Yes/no, single choice, multiple choice, checkbox/acknowledgement
- Person: organisation users or workers
- Asset: the `plant` master
- Location: a Core `locations` row owned by the submission
- Photo and file: document ids from the existing Documents store (never inline binary)
- Signature: typed name plus confirmation, and optionally a drawn signature stored as a document. The server stamps the signer account and the time. This is an operational sign-off, not a certified digital signature.

### Conditions

Conditions support `equals`, `does not equal`, `is one of` and `is answered`. A condition may only reference an **earlier** field, so there are no cycles and evaluation is deterministic.

The server evaluates visibility too:
- A condition on a hidden field sees that field as unanswered.
- Hidden fields are never required, and their values are dropped rather than stored.
- A required field that is visible is enforced.

## Server-side validation

The server rejects:
- unknown field ids and wrong value types
- invalid choices
- missing required visible fields
- an unconfirmed signature
- a person or asset from another organisation
- a document from another organisation or another project, or one uploaded by someone else (unless the file is already on the record being corrected)
- invalid location data
- submissions against drafts, archived forms or superseded versions
- inaccessible contexts

## Contexts and access

Supported contexts are `organisation` (use `current` to mean your own organisation), `project`, `shift` and `asset`. The model is a string pair, so more contexts can be added without a schema change.

Every request re-resolves the owning record. The supplied project id is never trusted: a shift's project is derived from the shift.

| Context | Rule |
|---|---|
| organisation | `hseq.view` |
| project | `project.view` plus project scope; Project and Site Engineers need membership (404 otherwise) |
| shift | Existing shift-audience rules; field workers need to be assigned or supervising |
| asset | `workshop.view`, `resources.edit` or `schedule.view` |

A shift never grants project-wide access. Field workers cannot open project-level evidence.

Routes run under the **IMS** entitlement:
- disabled: the routes return 404;
- read-only: writes are refused.

## Capabilities

| Capability | Who (defaults) |
|---|---|
| `forms.view` | Everyone with HSEQ or field access; read-only |
| `forms.submit` | Field roles, engineers, supervisors, scheduler, PM, office, admin |
| `forms.manage` (drafts, revisions, archive) | PM, office, admin |
| `forms.publish` | PM, office, admin |
| `forms.amend` (corrections) | PM, Project/Site Engineer, supervisor, office, admin |

Field workers never get template management or correction rights. Accounts does not see forms.

## Audit

The existing `audit_log` records these events:
- `form_template.created`, `draft_updated`, `published`, `revision_started`, `archived`, `restored`
- `form_submission.submitted`, `amended` (the amendment event includes the changed fields before and after)

## Not in this tranche (8B/8C)

- Incident investigation, NCR and corrective-action verification chains, root cause
- Prestart → Workshop defect automation, safety holds, return to service
- Evidence packs, analytics, AI form generation, offline form queue, QR launch
