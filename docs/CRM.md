# CRM — client, contact and site master (Tranche 2)

One authoritative client master, in **Core** so every module (Scheduling-only, Estimating-only,
Projects-only, full suite) uses the same records. Enter once, reuse everywhere.

## Schema (migration `0016_crm_completion.sql`, additive)
- `clients`: `client_code`, `website`, `billing_email`, `credit_status`, `tags`, `owner_user_id`,
  `merged_into_id` (+ indexes on `(organisation_id, abn)` and `(organisation_id, client_code)`).
  Existing `legal_name`, `abn`, `account_reference`, `payment_terms_days`, `status` are reused.
- `client_contacts`: `first_name`, `last_name`, `department` (display `name` kept).
- `opportunities`, `tenders`, `jobs`: `contact_id` next to the existing `client_id`/`site_id`.
- Text snapshots (`client_name`, `location`, `site_address`) are kept for history and export.

## Matching (`lib/v1/crm-match.ts`, deterministic)
Clients: valid ABN (checksum) → client code → exact normalised legal/trading name (unique, no
conflicting ABN) = **exact**. Suffix-insensitive name, business email domain, phone =
**possible duplicate** (a person decides: use existing / create new / skip). Several candidates
for a strong signal are always "possible". Contacts (within a client): same email or same name
= exact; same phone = possible. Sites (within a client): same normalised name or exact address.
Normalisation is for comparison only; stored names are never rewritten (imports only fill an
empty name/legal name).

## Import (`lib/platform/crm-import.ts`, `/api/platform/clients/import`)
Same pattern as the employee/plant importer: `.xlsx`/`.csv`, headings mapped by label/aliases
or manually, preview (Create / Update / Possible duplicate / Skip / Error per row), decisions
for possible duplicates, then apply in one transaction. Template workbook: Clients, Contacts,
Sites (contacts/sites reference a client by name, code or ABN — including clients created in the
same file). A flat customer sheet may carry contact and address columns on the client row.
Audit `crm_import.completed` records file name, user, time and counts; the file is not stored.

## Pickers (`components/v1/lookup.tsx`)
- `ClientPicker`: server typeahead (never the whole master), recent clients first, active before
  inactive, ABN/code disambiguation, inline quick create (name only; ABN/name match returns the
  existing client).
- `SitePicker` / `ContactPicker`: the chosen client's sites/contacts, inline add without leaving
  the form; primary contact suggested.
Used in: opportunities (register form), tenders, standalone estimates, new project, project
setup, scheduling job setup (client → site → contact) and shift editing (client narrows the
job list; site/contact from the job's client).

## Inheritance
Opportunity → tender (client, site, contact) → estimate (tender's client) → award → project
(`client_id`, `site_id`, `contact_id`; standalone estimates carry their own chosen client/site/
contact, validated against the organisation). Changing the client clears a contact that belonged
to the previous client.

## Legacy text
`GET ?view=legacy` / `linkLegacy`: opportunities, tenders and projects with a client name but no
client link. Only exactly one exact normalised-name match links; ambiguous and unmatched records
stay "Client not linked" with manual "Choose matching client". The original text is never
changed; every link is audited (`client.legacy_linked`).

## Merge
`merge` (preview, then confirm): moves opportunities, tenders, projects, contacts and sites to
the kept client, fills its empty identity fields, marks the duplicate `merged` with
`merged_into_id` (never deleted), audited. Estimates keep their revision snapshot.

## Client Work view (`lib/seams/client-history.ts`)
Reads the real records: active/completed projects, upcoming shifts, tenders, open opportunities,
estimates. Each section needs its module entitlement and capability; project rows and shifts
are limited to the user's accessible projects; no totals over records the user cannot see.
Money fields only with commercial access.

## Permissions (capabilities, enforced by the server)
| Capability | Meaning | Roles |
|---|---|---|
| view (pipeline, project or schedule view) | search, open and pick clients | all office roles; Project/Site Engineers only for clients of their assigned projects |
| `crm.create` | quick create a client, or add a site/contact to a client, inside a workflow | Admin, Office, Estimator, Scheduler, Project Manager |
| `crm.edit` | change existing master records: identity/contact fields, status (inactivate/reactivate), account owner, contacts and sites | Admin, Office |
| `crm.manage` | bulk import, merge, legacy linking, bulk status/owner changes | Admin, Office |

Quick create never grants editing: a Scheduler, Estimator or Project Manager cannot edit a client
afterwards, even one they created. Commercial client fields (payment terms, credit status, billing
email, account reference) still require `commercial.view` on read and write; no CRM capability
implies commercial access. Project/Site Engineers and Accounts hold no CRM capability.

## Merge and primary contacts
A client keeps at most one active primary contact. On merge the kept client's primary stays
primary and moved primaries are cleared; if the kept client has none and the duplicate has exactly
one, that contact stays primary; if the duplicate has several, none is promoted (the preview says
so). Contacts are never archived or deleted by a merge, so opportunity/tender/project `contact_id`
references stay valid. The preview warns about contacts sharing an email and sites that look like
the same place; both records are kept.

## Known limitations
- Documents tab: the document model has no client context yet, so client documents are reached
  through their projects/tenders.
- Address autocomplete/maps are the next tranche; sites keep address text.
- Estimates store the client inside the revision snapshot; merge does not rewrite past revisions.
