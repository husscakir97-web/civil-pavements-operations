# Communications, notifications and external job links

Tranche 7 adds a **Core communications layer** over existing business records.

The design rule is:

> Communicate where the work lives.

It is not a separate chat product and it does not create duplicate project, shift, HSEQ or commercial records.

## Contextual discussions

One discussion thread may exist for a supported record:

- project
- programme activity
- shift
- tender
- variation
- claim
- incident
- NCR
- corrective action
- SWMS
- ITP
- workshop work order

The thread is identified by organisation + context type + context ID.

Every read/write resolves the owning record again. Knowing a thread/message ID never grants access.

Project-scoped roles therefore retain the same project-membership rules as the owning record.

Field workers only reach shift discussions for shifts that the existing shift-audience rule says they can see.

## Messages, mentions and acknowledgements

Messages are append-only in this tranche.

A sender may:

- write a general context update;
- select people to notify / mention;
- reply to a message;
- require acknowledgement from selected recipients.

Receipts record:

- unread/read;
- mentioned;
- acknowledgement timestamp.

An acknowledgement-required message must have at least one authorised recipient.

The sender can see aggregate and per-recipient receipt state.

## Notifications

In-app notifications are Core.

Current notification sources:

- contextual message / mention;
- acknowledgement-required message;
- shift assignment/change;
- external recipient response.

The notification carries a permission-safe target back to the owning workspace.

Users can store:

- email notification preference;
- SMS preference;
- quiet-hours start/end;
- timezone.

Email is delivered only when SMTP is configured and the user opted in. Delivery is best effort and never rolls back the business action.

SMS preference is stored now; actual SMS delivery requires a provider integration and is deliberately not faked.

Quiet hours suppress optional email delivery, not in-app records.

## Shift-change notifications

The existing deterministic shift save remains authoritative.

Only **after the shift has committed**, the system compares:

- date;
- start;
- finish;
- scope;
- status;
- assigned users/resources.

Affected assigned users receive an in-app shift-change notification.

Notification failure is non-blocking. A successfully committed shift must never appear to the user as a failed save because an optional notification provider was unavailable.

## External job links

External shift links are bearer capabilities designed for subcontractors / suppliers / other short-term recipients who should not require a full Infrastruct account.

Security characteristics:

- 32 random bytes, base64url encoded;
- only SHA-256 hash stored;
- raw token returned only when created;
- single-shift context;
- maximum 30-day expiry;
- explicit revocation;
- last-access timestamp;
- disabled Operations entitlement invalidates the link;
- every response is audited.

The public page can show only:

- shift date/time/scope;
- project/client/site information appropriate to the shift;
- exact work point / directions when available;
- field-visible project/SWMS/ITP/field documents.

Office-only documents, commercial evidence and tender material are never exposed merely because a token exists.

## External recipient actions

The recipient can:

- accept;
- decline;
- acknowledge details;
- nominate operator;
- nominate plant / vehicle;
- add a note;
- upload PDF/image evidence.

Returned evidence is stored in the existing secure Documents model as:

- context: field;
- context ID: shift;
- project ID: shift project;
- category: External evidence;
- visibility: field;
- source: external_link;
- no fabricated internal uploader identity.

The link creator receives an in-app notification when the external party responds.

## Role capabilities

Core capabilities:

- communication.view
- communication.send
- external.share

Normal project/site/shift permissions still apply after the capability check.

Default external-share roles:

- Admin
- Office
- Scheduler
- Project Manager

Project Engineer, Site Engineer, Supervisor, Field, Estimator, Accounts and Read-only do not create external job links by default.

Read-only users may read authorised communication but cannot send.

## Current UI surfaces

- global notification bell: office shell and field shell;
- Project workspace → Communication;
- saved Shift details → Shift communication;
- saved Shift details → External job link manager;
- public /external/job/<token> recipient page.

The API already supports the other declared context types so future workspace panels should reuse the same CommunicationPanel rather than create new thread systems.

## Deliberately deferred

- real SMS delivery provider;
- mobile push provider;
- notification digests;
- message editing/deletion;
- full @-text parser/autocomplete (the current recipient picker is the authoritative mention mechanism);
- supplier portal account experience;
- threaded file attachments for internal messages;
- webhook fan-out.

These should extend the same Core tables and permission resolver.
