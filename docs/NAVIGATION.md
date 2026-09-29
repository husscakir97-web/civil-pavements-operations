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

## Project team and project scope
Application role = what someone may do. Project membership = where.

- `project_members` (migration `0015_project_members.sql`): `organisation_id`, `project_id`,
  `user_id`, `project_role` (project_manager, project_engineer, site_engineer, supervisor,
  commercial, hseq, other), `active`, `revision`, `created_by`, timestamps. Unique on
  (organisation, project, user); indexed on organisation and (organisation, user, active).
  The migration backfills every existing `jobs.project_manager_user_id` as an active
  project_manager member (`INSERT IGNORE`, rerunnable). `project_manager_user_id` stays valid and
  is also honoured at runtime.
- Project team section on the project Overview: add, change role, remove (deactivates; history
  kept). Managed by roles with `project.edit` + `project.all.view` (Admin, Office, Project Manager).
- `lib/platform/project-access.ts`: `canAccessProject`, `assertProjectAccess` (404),
  `projectScope`, `projectFilter`. Roles holding the capability `project.all.view` (Admin, Office,
  Estimator, Scheduler, Project Manager, Supervisor, Accounts, Read only) keep organisation-wide
  access. Project/Site Engineers do not hold it and are limited to active memberships (or
  projects where they are the recorded PM). Field workers have no project access and keep their
  assigned-shift rules.

Server-enforced for PE/SE: projects list/detail/update/transition (`loadProject`), create
(organisation roles only), programme GET/POST/PATCH, every project/ITP-scoped register (list,
create, update, transition, delete, cross-project `all=1` listings), SWMS list/detail/create/
actions, project documents (list, open by id, upload), job hub, schedule board (`/api/delivery`
jobs and shifts), field records (`/api/field`), field docket submission, global search, Today,
Home.

## Today scoping (one rule set: `lib/platform/shift-scope.ts`)
- Field worker: assigned or supervising (unchanged; other shifts still listed as "other today").
- Project/Site Engineer: assigned, supervising, or on one of their projects — today and upcoming.
- Organisation-wide roles: every shift (they dispatch from Schedule).
Home's Today list uses the same helper.

## Reports, overview and legacy attachments
- `/api/reports/v1` and `/api/platform/overview` (both from `lib/seams/reports.ts`) compute
  project, schedule, field-record and HSEQ figures only from the actor's projects for
  Project/Site Engineers; organisation-level HSEQ records (no project) stay counted.
  Organisation-wide roles are unchanged.
- Legacy `/api/delivery/documents` attachments have no project link. For Project/Site Engineers
  they fail closed: only their own uploads (or an attachment explicitly linked to one of their
  projects) open. Nothing is inferred from names or text.

## Remaining known gaps
- Organisation-level registers and HSEQ records without a project (company IMS) remain visible
  where the capability allows, by design.

## Home
Quick actions (max 3) come from one role-priority table (`quickActions`) and are filtered by
`canOpen`. Dispatch indicators (tomorrow's shifts fully resourced X / Y, shifts with no
resources, draft shifts, plant on safety hold, expired competencies) show for roles that plan
the schedule (`schedule.edit`); open hold points are counted within the user's project scope.
"My projects" = active projects from the user's project memberships plus projects they manage,
by user id. My Work reads existing assignments (ITP points, corrective actions, readiness items)
within project scope; organisation-level actions (no project) stay visible. No task records are
copied.
