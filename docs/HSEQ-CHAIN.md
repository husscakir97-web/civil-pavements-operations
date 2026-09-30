# HSEQ investigation & corrective-action chain (Tranche 8B)

Source → investigation → finding/cause → corrective actions → completion → independent verification → source closed.

The chain extends the existing records rather than replacing them:
- `hseq_incidents`, `hseq_ncrs` and `hseq_actions` remain authoritative.
- New child records: `hseq_investigations` and the append-only `hseq_action_reviews`.

Service: `lib/modules/hseq/corrective.ts`. API: `/api/hseq/chain` (IMS entitlement). UI: the chain panel on each incident and NCR (`components/v1/hseq-chain.tsx`).

## Migration `0020_hseq_corrective_chain.sql` (additive)

- `hseq_investigations`: source type and id (unique per organisation + source), project derived from the source, status (`investigating` → `complete`), summary, facts, finding, root cause, explicit `root_cause_not_established`, contributing factors, method, investigator, completed by/at, revision.
- `hseq_action_reviews`: outcome (`accepted`/`rejected`), note, optional evidence document and reviewer. Each review keeps a snapshot of the completion it judged (completed by/at, notes, document).
- `hseq_actions` gains `verified_by`, `verified_at`, `verification_note` and `verification_document_id`, plus source and owner indexes.
- `hseq_incidents` gains `closure_rationale`, `closed_by` and `closed_at`.

Legacy rows are untouched. Old free-text NCR `cause`, `corrective_action` and `verification` still count towards closure.

## Rules (server-enforced)

### Sources

An action's `source_type`/`source_id` must be one of the following, and the record must exist in the organisation and be in scope:
- `incident`, `ncr`, `form_submission` or `risk`.
- The action's `project_id` comes from the source. An Incident Alpha action tagged to Project Bravo is refused.
- Nonexistent or cross-tenant sources return 404.
- `inspection`, `audit` and `other` carry no record id.

### Investigations

- Available for incidents and NCRs; there is one investigation per source. Starting one moves a reported incident to `investigating`.
- Completing it requires a summary or facts, a finding, and either a root cause or an explicit "not established" conclusion.
- A completed investigation is locked. Reopening needs a reason and is audited.

### Actions

- New actions need a real `owner_user_id`; `owner_name` is kept as a snapshot.
- Lifecycle: `open → in progress → complete → verified`.
- Completing an action requires completion notes. `completed_by` and `completed_at` are server-stamped.
- Complete and verified actions cannot be edited.

### Verification

- Verification is a dedicated action: generic status buttons cannot verify or reject.
- The verifier needs `hseq.verify`, must not be the person who completed the action, and must record a note.
- Accept moves the action to `verified`. Reject moves it back to `in progress`.
- Both outcomes append a review row, so rejected completion evidence stays in the history.

### Incident closure

Closure is a dedicated action and needs `hseq.edit`. It is refused while an investigation is incomplete or any linked action is unverified. With no investigation and no actions, a closure rationale of at least 10 characters is required.

### NCR closure

Closure is a dedicated action and needs `hseq.verify`. The NCR must meet all of these:
- it is in `verification`;
- the investigation is complete, or there is a recorded cause;
- every linked action is verified, and there is at least one action or legacy action text;
- final verification text has been recorded.

### Overdue

An action is overdue when its due date is before today (Australia/Sydney) and its status is not `verified`. It is derived at read time, never stored.

## Evidence and ownership integrity

### Evidence

Completion and verification evidence are ordinary Documents in the `action` context, stored in the existing table and R2 bucket.

When evidence is uploaded, it must be bound to a real corrective action that is in scope for the uploader. The document's project is taken from the action. An upload claiming another project is refused.

Before completion evidence (`completion_document_id`, when newly set or changed) or verification evidence (`reviewAction`) is accepted, `resolveAuthorisedDocument()` in `lib/platform/documents.ts` must pass. This is a server-only helper that authorises a document without streaming it. It requires all of the following:
- the same organisation;
- a `current` document;
- context `action` with `context_id` equal to that exact action;
- the action's project;
- the generic open rules for the actor.

It refuses:
- another action's evidence;
- another project's evidence;
- organisation, tender, commercial or project documents;
- controlled Forms evidence;
- other-tenant files.

Completion evidence cannot be set on create, because the action must exist before evidence can be bound to it. Verification never rewrites completion evidence. Reviews snapshot the completion evidence they judged.

Existing legacy references are left as they are and still read.

### Owner

Every new `hseq_actions` row needs a real organisation user (`owner_user_id`), on both the register and chain paths. `owner_name` is its snapshot. An owned action's owner cannot be cleared.

Legacy ownerless rows still read, and can be given an owner later.

## `hseq.verify`

Granted to Admin, Office, Project Manager and Project Engineer. It is not granted to Site Engineer, Supervisor, Field Worker, Scheduler, Accounts, Estimator or Read only.

## Access

Every call re-resolves the source with the existing scope rules. Project and Site Engineers are limited to their projects, and out-of-scope ids return 404.

Field Workers can still report incidents. They cannot open the chain, investigate, create or verify actions, or close records: the chain routes need IMS read/write role access.

## My Work

- Owners see their open and in-progress actions, and their completed actions as "awaiting verification". Verified actions drop off.
- Verifiers see a queue of completed actions they did not complete themselves.
- Overdue counts cover every unverified action past its due date.

## Audit events

- `hseq_investigation.started`, `.updated`, `.completed`, `.reopened`
- `corrective_action.created`, `.verified`, `.rejected`, plus the register's `actions.in_progress` and `actions.complete`
- `incident.closed`, `ncr.closed`

Verification events record both the completer and the verifier.

## Forms seam

`addAction` with `sourceType: form_submission` creates an ordinary corrective action from an authorised submission. The project and context are resolved from the submission. The submission itself is never modified. Actions are not raised automatically from answers.
