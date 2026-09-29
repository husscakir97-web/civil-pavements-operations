# Programme collaboration

Tranche 5 turns the existing dependency-aware programme into a collaborative planning surface without duplicating the operational Schedule.

## Views

- **Board** — Planned / Ready / In progress / Blocked / Complete. Drag an activity between columns to change status.
- **List** — fast inline name/date/duration/status/owner changes plus drag reorder. Up/down buttons remain as the accessible fallback.
- **Timeline** — dependency-adjusted activity bars over the programme date range (capped to a practical 90-day window).
- **Lookahead** — incomplete activities overlapping the next 14 days.
- **Calendar** — four-week start-date calendar with previous/next navigation.

The same activity rows power every view.

## Dependencies

The existing finish-to-start engine remains authoritative:

- an activity may reference one predecessor;
- projected start = later of planned start and predecessor finish + 1 day;
- duration uses calendar days;
- cycles and foreign predecessors are rejected;
- the saved planned start is not silently rewritten when a dependency pushes the projected date.

## Drag/drop

List drag/drop calls the existing full-order reorder endpoint. Server validation requires the complete current set of activity IDs, so stale or partial reorder attempts fail instead of losing activities.

Board drag/drop changes only status. It does not rewrite order, dates or dependencies.

Touch/mobile users can still use status controls and the List up/down buttons; drag is an enhancement, not the only control.

## Project-team owners

No schema migration was needed.

The existing `responsible` column remains backward compatible:

- historical free-text names remain visible as **Legacy** assignments;
- new typed assignments are stored as `user:<user-id>`;
- the server validates new typed owners against the active project team (or recorded project manager);
- GET resolves the token to the person's current display name.

This makes new programme ownership stable by user ID without guessing legacy names.

Project Manager, Project Engineer and Site Engineer receive `programme.edit`. This capability does **not** grant broad project administration to Site Engineers.

## My Work

Home → My Work reads activities assigned with the typed `user:<id>` token.

The activity link opens the assigned project directly on the Programme tab.

Legacy free-text responsibilities are deliberately not auto-matched to people.

## Comments

Activity comments use the existing immutable audit log:

- event type: `program.comment`;
- entity: `program_activity`;
- project ID retained;
- actor and timestamp retained;
- text capped at 500 characters.

Comments therefore inherit the existing tenant/project scoping and audit guarantees. They are not a parallel chat database.

## Schedule seam

Programme remains planning-level:

- work package;
- dates and dependencies;
- owner;
- resource requirement prose;
- quantity/production assumptions.

Operational crew/plant assignments, dispatch, conflicts and shift readiness remain in **Schedule**.

The **Plan shifts** action links the project into Schedule rather than duplicating shift records inside Programme.

## Deliberately deferred

- @mentions / watchers and notification delivery — Communications tranche;
- activity attachments — shared Documents/communications seam;
- multiple dependency types beyond finish-to-start;
- automatic schedule generation from programme activities;
- baseline/critical-path scheduling and working calendars.

These should extend this activity model rather than replacing it.
