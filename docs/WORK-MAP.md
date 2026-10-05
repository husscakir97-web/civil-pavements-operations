# Project Work map — shared work-area overview (V1, first slice)

An **operational work-area overview**. It is **not** an approved traffic management plan, survey or design,
and the screen says so. Authorised users draw simple polygons on a project, name them as **work areas** or
**stages**, tag the kind of work (asphalt, stabilisation, traffic management, other) and who delivers it
(own crew or subcontracted — including subcontracted traffic control), edit the vertices, archive areas,
Save/Cancel, and reopen the same saved geometry. It does not depend on the company having a traffic-control division.

## Where it lives

| Piece | File |
|---|---|
| Geometry rules, limits, labels (isomorphic) | `lib/v1/work-areas.ts` |
| Service (scope, closed rule, revisions, audit) | `lib/modules/projects/work-areas.ts` |
| HTTP handler | `app/api/projects/work-areas/route.ts` (`GET`, `POST`, `PATCH`) |
| Editor | `components/v1/work-map.tsx`, shown as the **Work map** tab of a project |
| Table | `project_work_areas` — migration `0027_project_work_areas.sql`, `db/schema-v1.ts` |
| Tests | `scripts/test-work-areas.cjs` (in `npm test`), `scripts/test-work-areas-migration.mjs` (runs inside `test:migration-recovery`), `scripts/work-map-journey.mjs` (`npm run test:work-map`) |
| Demo fixture | `scripts/seed-work-map-demo.mjs` (`npm run seed:work-map-demo`) |

The `jobs` record **is** the project; no second project entity was introduced. The module is `projects`
(no cross-module import; `project_work_areas` is listed in the module contract).

## Data model

One row per area: stable `id` (uuid; the anchor later document/measurement/programme links can attach to),
`organisation_id` (indexed), `project_id`, `name`, `kind` (`work_area` | `stage`), `discipline`, `delivery`
(`own` | `subcontracted`), `contractor_label` (a name only — not linked to the resource register), `sequence`,
`notes`, `status` (`active` | `archived`), `revision`, `created_by/updated_by/archived_by`, timestamps.
Geometry is one **open ring** of WGS84 points (7 dp) in `geometry`; `vertex_count`, `area_m2` and the bounding box are
typed columns. **Geometry is separate from the address pin**: the pin lives in `locations` and is never read for
editing or written by the work map (a test asserts the pin row is untouched). Areas are archived, never deleted.

## Rules enforced on the server

* **Read** needs `project.view`; **write** needs `project.edit`. Field workers have neither, so field access is not broadened.
* **Project membership**: scoped roles (project/site engineer) only reach projects they belong to — others get `404`, as do other tenants.
* **Entitlements**: the Projects module gates the route (`disabled` → 404; `read_only` → reads work, writes refused).
* **Closed projects** are read-only (`409`); reopen the project first.
* **Revision conflicts**: every update sends the revision it was based on; a stale one gets `409` and changes nothing.
* **Audit**: `workmap.area_created`, `workmap.area_updated` (before/after ring), `workmap.area_archived`, each with project, actor and entity id, written in the same transaction.
* **Validation / bounds**: 3–100 points; valid lat/lng (no strings, no NaN, no 0,0); no duplicate points; no self-crossing or fold-backs; area 1 m² – 25 km²; span ≤ 10 km; ≤ 200 active areas per project; active names unique per project.

## Basemap and Google: status and blocker

The editor draws on a **plain metric grid anchored to the project's location pin**, with scale bar and north arrow. It
uses **no imagery, no tiles and no Google call**. It works identically when maps are unavailable, and its tests use
the existing fake-provider approach (`LOCATION_PROVIDER=fake`). The existing address search, aerial pin map and
pin behaviour in `components/v1/location.tsx` are unchanged (the tab only *shows* the pin through `LocationSummary`).

**Unresolved licensing blocker — no aerial or Google-based drawing has been enabled.**

* The old Drawing Library is deprecated and was scheduled for removal in the Maps JavaScript API in May 2026 (Google's deprecations page), so it is not used. The supported route is plain `google.maps.Polygon` with `editable`/`draggable` plus our own controls, or a library such as Terra Draw.
* Google Maps Platform terms, as summarised by search results (the full official terms page could not be read in this session — the fetch tool returned truncated text), prohibit tracing or digitising "roadways, building outlines, utility posts, or electrical lines" from the Maps JavaScript API Satellite base map, and creating datasets derived from Google Maps Content. Drawing a *work area outline over Google aerial imagery* is close enough to that language that **we should not assume it is permitted**. Whether a user-drawn operational polygon on top of the map is "tracing" is a legal question for the owner (or a written answer from Google), not an engineering one.
* So the blocker is: **written confirmation (or a legal read of the current Google Maps Platform Terms and Service Specific Terms) that users may draw operational polygons over the Satellite/hybrid map type for this workflow.** Until then, only provider-independent storage and the grid editor ship.
* If it is confirmed: add a `MapSurface` adapter that supplies the same lat/lng ↔ pixel projection (the editor already isolates this in `toPx`/`fromPx`), keep Google attribution visible and unaltered, do not export/cache imagery, store only our own polygon coordinates, and reuse the existing browser key and Map ID (`docs/LOCATIONS.md`). No key creation, billing or live configuration is part of this change.
* Alternative that avoids the question: a non-Google basemap with a permissive licence and its own attribution — a product/licensing decision, not made here.

## Limitations (first slice)

* No imagery under the shapes, so placing them relative to real features means working from the project pin and metric grid.
* One polygon ring per area; no holes, no multi-part shapes, no snapping, no measurements, no traffic-control symbols, no routing, no AI, no live tracking, no automated programme changes, no document-link UI.
* Archived areas cannot be restored in the UI (the row is kept).
* Selection toggles by tapping the list row or the shape; reduced-motion and screen-reader behaviour of the SVG canvas have not been audited. Vertices are keyboard-focusable (arrows nudge 1 m, Shift 5 m, Delete removes).
* In view mode on touch devices a vertical drag scrolls the page instead of panning the map; use the zoom/fit buttons and the two-finger pinch while editing.
* **Unsaved work and navigation.** An unsaved drawing or reshape asks before any in-app route change (project tabs, the phone section picker and bottom bar, sidebar, project Back) and before browser Back/Forward, using the shared guard in `components/v1/nav.tsx` (`useNavGuard`, `confirmLeave`) wired into `useRoute` in `app/pavement-os.tsx`; reload and close are covered by `beforeunload`. Cancelling leaves the URL, screen and draft unchanged. The prompt is the browser's `confirm` dialog (the app's existing pattern). The history model is in `lib/v1/nav-history.ts` (pure, tested against a simulated browser in `scripts/test-nav-history.cjs`, which asserts all the invariants below together over named scenarios and 3,600 random sequences). Entry **identity** (`id`) is separate from **position** (`epoch`, `pos`): each entry this app creates is stamped, inside a copy of its `history.state` (Next's own fields are carried over untouched), with a position one greater than the browser's *live* current entry, so positions are always adjacent even after Back and a push replaces the forward branch. Distance is only defined inside one epoch. Invariants: adjacency; remembered position equals the live entry; no guessed distances; URL and screen agree after every event; no prompt for same-screen moves; positions survive reload. Same-fragment traversals (repeated or spelling-variant URLs) are tracked from `popstate`. **Remaining limitations:** an entry with no stamp or from another epoch (a manual hash edit, or one created before this build) has an unknown distance, so a cancelled move onto it is not undone by `history.go()`; the URL is rewritten back and the entry adopted into a new epoch, which can leave a duplicate history entry and mislabel that entry. A history entry pushed by another library with no event is not observed (the guard reads the live entry when it pushes, but cannot correct a screen the other library left out of date). The draft is not preserved across a confirmed discard, a different browser tab or a crash.
* The browser journey is local-only (like the Planning journeys); CI runs the unit test through `npm test`.

## Demo fixture

`npm run seed:work-map-demo` (app running against a local `*_test` database) creates one user, one project
**“DEMO – Work map sample project”** with a fictional location, and six active plus one archived areas, all named
`DEMO …`: two stages (stabilisation, asphalt), an asphalt intersection patch, two **subcontracted** traffic-control
areas, and a compound. It uses fixed ids and `INSERT IGNORE`, so repeating it changes nothing; `--reset` restores the
original shapes. It refuses to run unless the database name ends in `_test` and the host/URL are local.

## Contract for future AI-generated drafts (nothing AI is built here)

No AI call, key, billing or autonomous write exists in this feature. The contract below is what a later, separately
approved slice could rely on without changing the work-area model:

* **Stable ids.** The server generates every id (uuid). Callers cannot choose `id`, `status`, `revision`, tenant or creator: both request schemas are `.strict()`, so an unknown key is refused with 400 rather than silently ignored. An update never changes the id; archiving keeps it.
* **One geometry gate.** `validateRing` (pure, isomorphic, `lib/v1/work-areas.ts`) is the only way geometry reaches storage; both write paths go through it, and a person's browser and any generator are held to the same bounds.
* **Exported, typed schemas.** `createInput` / `updateInput` in `lib/modules/projects/work-areas.ts` are the validated service contract.
* **Human-owned today.** Every area is written `active` by a person holding `project.edit`, and audited with that person.
* **What an AI slice must add first (CLAUDE.md §7).** Today there is no `suggested`/`draft` status, no `source_reference`, confidence or extraction time, and no state machine refusing `suggested → active` without a human capability. These need an additive migration and an approval transition; until then a generator must not write to this table.

## Work point, saved locations and shift links (integrated workflow)

**Address → confirmed work point.** The Work map tab starts with a *Site location and work point* panel (`components/v1/work-point.tsx`). It reads the project's **effective** saved location (the project override `jobs.location_id` if set, otherwise the client site's) through the existing locations model and the shared `AddressLocationPicker`; nothing is geocoded or stored a second time. "Change project location" saves an override with `PATCH /api/projects/workspace` (the client site is never changed); "Use the client site location" removes the override. "Confirm this work point" (`POST /api/projects/work-point`, `project.edit`, not on closed projects, audited as `workmap.work_point_confirmed`) records the coordinates in `project_work_points` (one row per project). Status is computed, never stored: `none` (no location) · `unconfirmed` · `confirmed` (within 5 m of the confirmed point) · `moved`.

**Polygons never follow the pin.** Areas are stored in absolute coordinates. If the address or pin changes after confirmation the panel shows *Moved: review* with the distance, states that the saved areas have **not** moved, and the map draws a dashed marker where the work point was confirmed. A person reviews and confirms the new point; nothing is rewritten automatically.

**Shifts reference the same areas** (seam `shift.workarea`, `lib/seams/shift-work-areas.ts`; `GET`/`POST /api/delivery/work-areas`). `shift_work_areas` stores ids only (shift, area, project) — no geometry is copied. The Schedule shift editor shows the linked areas (discipline, own crew or subcontractor label) with *Open on map*, which routes to `#Projects//<id>/workmap/<areaId>` and selects that area. Linking needs `schedule.edit`; a link can only point at an area of the shift's own project; archived areas stay visible as archived. **Capability-aware:** when Projects is off (or the viewer lacks `project.view`, e.g. field workers) the section simply does not render and the shift works unchanged; writes return 409. On a closed project the links are read-only. The panel repeats that this is not an approved traffic management plan.

| Seam | Both on | Projects off |
|---|---|---|
| Shift → work areas | Shift lists/links shared areas, opens the map | Section hidden; shift unaffected |

## Demo company (integrated)

`scripts/demo/workmap.mjs` (stage `workmap`, after `shifts`) populates the full demo company through the HTTP API: synthetic site pins on the three demo sites, a project override on B2 (closed later), B3 confirmed then moved 450 m, 20 `DEMO –` areas, two extra stabilisation shifts on Quarry Road and 13 shift link sets (27 links). It is idempotent by natural keys. The guarded importer allows exactly the extra routes it needs (`import-guards.mjs`), the measured footprint (`docs/DEMO-IMPORT-FOOTPRINT.json`: 55 tables / 653 rows) and the verification (`import-verify.mjs`) include the new tables, and `scripts/connected-workmap-journey.mjs` (`npm run test:connected-workmap`) runs the whole journey on a disposable database. Hosted loading is **not** enabled (see `docs/DEMO-TENANT-IMPORT.md`).

## Remaining limitations (for a later hardening pass — none blocks the local candidate)

* **Aerial imagery** is not available and not claimed; the plain metric grid is the only basemap. Licensing is a separate unresolved dependency.
* **Hosted demo loading** is unfinished (the importer refuses anything but a local `_test` database).
* Field workers get no traffic-management context in the field shell (they have no `project.view`); a read-only, redacted field view needs a product decision.
* The work-point panel sits above the map, so on a phone the canvas starts below the fold; a collapsed summary would help.
* The *unconfirmed* banner only appears once a project has areas; a first-time user with a location but no areas sees the Confirm button without a banner.
* One work point per project (no history list beyond the audit log); tolerance is fixed at 5 m.
* The shift chooser lists every active area of the project without search/grouping (fine for the demo's 12, awkward for 200).
* A shift linked to an area that is later archived keeps the link (shown as archived); there is no "relink" suggestion.
* Moving the client site's own pin does not mark projects that inherit it as *moved* until their map is opened (status is computed on read, so it does show there; there is no list-level flag).
* Hash-route screens other than the Work map do not yet accept a `focus` segment.
* The history-guard limitations above still apply.
