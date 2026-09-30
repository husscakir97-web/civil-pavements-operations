# Divisions (business units)

A division is a dimension **inside one organisation** for organising and filtering work (Civil, Asphalt,
Profiling, Traffic Control, Drainage, Concrete…). It is not a tenant and not a permission boundary.

## Rules
- **Shared, not duplicated.** Clients, contacts, sites, people and plant stay organisation-level. They have no
  division column and are never copied per division.
- **A division never grants access.** Lists are still scoped by organisation, role and project assignment first;
  the division filter only narrows the result. Assigned-project restrictions (Project/Site Engineer) are unchanged.
- **Always one default.** Every organisation has exactly one default division (`bu_default_<organisation id>`, created by
  migration 0023 and at signup). Single-division companies never see a division choice; pickers/filters appear only
  when more than one active division exists. `NULL business_unit_id` reads as the default division.
- **Archive, never delete.** Archived divisions stay on historical records and in filters; they cannot be chosen for
  new work. The default division cannot be archived (make another the default first).
- **Management is `org.admin`.** Anyone signed in may list divisions (for pickers).

## Where a division lives and how it flows
`Tender → Estimate → Project → Shift`. A tender takes the chosen (or default) division; its estimate inherits it and
follows the tender if it changes; award copies estimate → project; shifts inherit their project's division when
synced and follow it if the project is moved. Standalone estimates and manual projects pick a division at creation or
default. Changing a project's division needs `project.edit`, is refused on closed projects, and is audited.

## Data
Migration `0023_business_units.sql` (additive): `business_units` table and nullable `business_unit_id` on `jobs`,
`estimates`, `tenders`, `shifts`, with the deterministic, idempotent backfill after its `-- BACKFILL` marker.
`scripts/backfill-business-units.mjs` re-runs the same statements; `scripts/test-business-unit-backfill.mjs` proves
reruns are no-ops.

## Not in this foundation
Division-specific rates, estimating presets, per-division permissions, per-division numbering, opportunities and
resource assignment by division, and reports filtered by division.
