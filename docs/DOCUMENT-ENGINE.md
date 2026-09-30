# Document Engine foundation (Tranche 9A)

Core capability (not a paid module). A **managed document** is a durable business record; its **versions** are immutable; each version points at one **physical file** in the existing `documents` layer.

```
managed_documents  (identity, metadata, ONE access context, current_version_id)
   └─ document_versions  (version_number, revision_label, issue_date, author, company, change_note, sha256) — never updated
        └─ documents  (existing private object + SHA-256; raw ids unchanged)
document_links  (relevance only: target_type/target_id) — never grants access
```

Migration `0022_document_engine_foundation.sql` is additive. No PDF library, viewer, annotation, signature or approval workflow is included, and Claims & Proformas is not built.

## Rules enforced by `lib/platform/managed-documents.ts`

- **One security owner.** The document's `context_type/context_id` (organisation, library, project, tender, variation, claim, action) decides who can open it, through the same rules as raw documents (module entitlement, context capability, project scope, field visibility). A link never widens access. Guessed managed/version/file/link ids return 404.
- **Immutability.** A new revision stores a *new* object and a *new* `documents` row, then a new version row, under a row lock on the managed document. Old versions and files are never rewritten or removed. `expectedVersion` / `revision` give 409 to stale callers.
- **Exact-version download.** `/api/managed-documents?id=&versionId=&download=1` streams that version's own file (never the current one). `getManagedVersion()` returns `{versionId, fileDocumentId, sha256}` so a later approval can pin an exact artifact.
- **Legacy mirror.** `documents.version/status/supersedes_id` stay as compatibility mirrors written by the managed service in the same transaction; the raw supersede path refuses managed files, so the two cannot contradict each other.
- **Metadata.** Identity metadata (title, description, number, type, discipline, tags) is editable without a new version. Version metadata (revision label, issue date, author, company, change note) is immutable. `document_number` is optional and not unique.
- **No delete.** Archive/restore only.
- **Audit.** `managed_document.created | updated | version_created | link_added | link_removed | archived | restored` in the Core `audit_log` (version events carry version id, file id, revision label, SHA-256 and the previous version id). No domain events were added.

## Capabilities

`document.upload` (create), `document.edit` (metadata, links, archive), `document.manage_versions` (new revisions). `document.approve` is unchanged and reserved for controlled release.

| Role | edit / manage_versions |
|---|---|
| Admin, Office | yes |
| Project Manager, Project Engineer | yes (project scope still applies) |
| Estimator | yes (tender/company documents they can already access) |
| Site Engineer, Supervisor, Scheduler, Field, Accounts, Read only | no |

## Backfill (`scripts/backfill-documents.mjs`, runs from `migrate.mjs`)

Deterministic (`md-<head file id>`, `dv-<file id>`), idempotent, non-destructive. Only register-style contexts (organisation, library, project, tender) are adopted: a lone current file, or a strict linear `supersedes_id` chain (version 1..n, all but the last `superseded`, one context). Anything ambiguous (branch, gap, dangling pointer, cross-context) stays a legacy attachment and is recorded in `data_migration_issues`. Evidence contexts (actions, incidents, NCRs, SWMS, ITPs, variations, claims, field…) and controlled Forms evidence are never converted. No number, revision label or other metadata is invented.

## Consuming it from another module (e.g. the future Commercial tranche)

```ts
const doc = await createManagedDocument({title, contextType:'claim', contextId:claimId, documentType:'Proforma',
  content:{fileName, contentType, bytes}, generated:true, source:'generated'});   // no browser upload
await addDocumentVersion(doc.id, {content:{...}, generated:true, expectedVersion:1});
const pinned = await getManagedVersion(doc.id, versionId);  // {versionId, fileDocumentId, sha256}
await linkDocument(doc.id, {targetType:'claim', targetId});  // relevance only
```
`generated:true` skips only the `document.upload` / `document.manage_versions` capability (the calling module has authorised its own action). Entitlement, context capability (`claim` needs `commercial.view` and Commercial writable), project scope and tenant isolation still apply, so an Accounts user can read a claim artifact without document administration rights, and a Project Engineer cannot open it through project access alone.

## Known limitations

- Project and company uploads go through managed documents in the UI; the tender workspace still uses its existing raw upload (the managed API supports the tender context).
- Legacy chains in evidence contexts stay raw; there is no "promote to managed" action yet.
- Browser QA was not performed; the UI is typechecked, linted and built, and every API behaviour it relies on is covered by the journey.
- `npm run db:generate` was not run: migrations 0018–0022 are hand-written like their predecessors and drizzle snapshots stop at 0017.
