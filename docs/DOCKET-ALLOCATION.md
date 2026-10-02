# Docket project allocation and the unallocated queue

Office-uploaded dockets (OCR / scans) carry no project (`links: {}`); field dockets are already linked to a project and shift when they are created (`lib/modules/field/today.ts`). A docket with no project posts no cost, so this change adds, in the existing docket review screen (`components/docket-dashboard.tsx`), a **Project** control and an **Unallocated** queue. There is no new screen and **no shift picker**: shift matching waits for reliable partial-cost matching.

## Behaviour
- `GET /api/dockets` returns `unallocated: {count, approved}` (every non-archived, non-rejected docket with no project, any month). `?unallocated=1` lists them (up to 500); `?projects=1` lists the projects the actor may allocate to.
- `PUT /api/dockets` decides `links.jobId` and `links.allocationSeq` itself. The target project must exist in the organisation, be inside the actor's project scope and not be closed (existing policy: reopen it first through the audited reopening process; late costs follow that process unchanged). A `links` field that is omitted never unlinks a docket.
- **Allocating** a docket that has no posted cost (review, or approved with no project) is audited as `docket.allocated`; approving then posts cost to that project.
- **Moving or clearing** the project of a docket whose cost is posted is an audited cost correction (`docket.reallocated`): it needs `docket.approve` and a reason of at least 10 characters, is refused when the old or new project is closed, and is atomic. Posted rows are **reversed, never overwritten**: they keep their original project and amount, and the new cost is posted as new rows keyed `<line>@<n>` (`links.allocationSeq`). Moving back is a new allocation. Clearing the project reverses the posted cost (previously the old cost was left behind).
- A change of project drops the docket's shift link (it belonged to the previous project).
- Dockets in a progress claim stay locked.

## Not in this change
- Shift picker and category-aware accrual netting (a docket that references a shift still suppresses that shift's whole field-record accrual).
- GST basis and explicit docket-line categories (still regex-assigned).
- Labelling of cost figures as incomplete operational cost; a remaining-work forecast.

## Concurrency and consistency

Saving a docket is one database transaction that locks, in a fixed order, the project rows involved (by id) and then the docket, and re-reads
everything under those locks. Claims and project closure lock the project first too, so a reallocation, a claim and a closure cannot interleave:

- **Stale edits.** Changing the project requires `expectedUpdatedAt` (the docket's last-updated stamp when the form was opened); any request that
  sends it is checked against the locked row. A stale form gets 409 and changes nothing, so it cannot overwrite a newer allocation, its history or a claim status.
  The docket row update also requires the status it was read with.
- **Concurrent reallocations.** One wins; the other gets 409. The ledger has one set of current rows and one history step.
- **Claims.** A claim locks the project, takes only dockets that are still approved and in that project, and fails (409, rolled back) if any selected docket changed.
  A docket in a claim cannot be moved or returned to review (409).
- **Closure.** Allocating into a project that closes first is refused (409); moving posted cost out of a closed project is refused for any resulting status.
- **Approved → Review with a move or clear.** Needs a reason and `docket.approve`, reverses the posted cost (history kept) and writes the same `docket.reallocated` audit
  (before/after project, reason, "returned to review").
- **Projects disabled or read-only.** Moving or clearing a posted allocation is refused (409) before anything is written: the docket, ledger and audit are unchanged.

Tests: the "Docket allocation" block in `scripts/test-v1-journey.mjs` (real MySQL: parallel PUTs, project-lock interleaving with a claim and with closure, claim vs move race).
