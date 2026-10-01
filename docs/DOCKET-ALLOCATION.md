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
