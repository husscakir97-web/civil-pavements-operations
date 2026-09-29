# Navigation and roles (Tranche 1)

## Primary navigation
Defined once in `lib/v1/app-nav.ts`, filtered by capability (`lib/platform/permissions.ts`)
and module entitlement. Areas with no permitted sub-page are not shown; there are no
disabled items for unpurchased modules.

Home · Today (field-capture roles without office planning) · CRM · Pipeline (Opportunities,
Tenders, Estimates) · Projects (Projects, Programme) · Schedule · Resources (People, Plant &
Equipment, Crews, Suppliers & Subcontractors, Workshop) · Commercial (Commercial, Dockets) ·
IMS & HSEQ · Documents (Company Library) · Reports (Reports, Lifecycle) · Admin.

The six-engine model (`lib/v1/engines.ts`, `lib/v1/workspaces.ts`) is unchanged and is shown
under Reports → Lifecycle. `resolveRoute()` translates every older hash route (engine areas,
`Operations/…`, `Admin/People|Plant|Company Library`, `Field`) to the new areas, keeping
record id and tab, so bookmarks and links keep working.

Navigation hiding is never security: every API route keeps its `withActor` guard.

## Roles added
- **Project Engineer** (`project_engineer`): project view/edit, programme, schedule view,
  HSEQ edit, ITP completion, field capture, reports view. No commercial, rates, approvals,
  tender pricing, team/entitlement administration.
- **Site Engineer** (`site_engineer`): project view, schedule view, HSEQ edit, ITPs, field
  capture, documents upload; uses the responsive office shell with **Today** (Field Today).
  No pricing, commercial reporting, reports, payroll/HR or administration.

## Known limitation: no project-scoped authorisation
The platform authorises at organisation level. Project/Site Engineers therefore see all
projects in their organisation (as Project Managers do). No partial project scoping was
invented; proper assignment-based scope needs its own tranche (membership table + enforcement
in every project query).

## Home
Quick actions (max 3) come from one role-priority table (`quickActions`) and are filtered by
`canOpen`. The home seam adds real-count indicators (tomorrow's shifts fully resourced X / Y,
shifts with no resources, draft shifts, plant on safety hold, expired competencies, open hold
points), "My projects" (projects where the user is PM), and My Work sources read from existing
assignments (ITP points, corrective actions, readiness items) — no task records are copied.
