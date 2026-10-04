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
* **Unsaved work and navigation.** An unsaved drawing or reshape asks before any in-app route change (project tabs, the phone section picker and bottom bar, sidebar, project Back) and before browser Back/Forward, using the shared guard in `components/v1/nav.tsx` (`useNavGuard`, `confirmLeave`) wired into `useRoute` in `app/pavement-os.tsx`; reload and close are covered by `beforeunload`. Cancelling leaves the URL, screen and draft unchanged. The prompt is the browser's `confirm` dialog (the app's existing pattern). A Back/Forward jump to a history entry this page load never saw cannot be undone by step count, so the guard rewrites the URL back instead. The draft is not preserved across a confirmed discard, a different browser tab or a crash.
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

## Adding the Work map to the existing full demo company

The complete demo company is the seed on PR 64 (`chatgpt/demo-company-seed`: `scripts/seed-demo-company.mjs`, `scripts/demo/*`, `docs/DEMO-COMPANY.md`). It is not on `main`, and `scripts/seed-work-map-demo.mjs` here is a standalone fixture, not a second company seed. **Minimal integration point:** one new stage in `scripts/demo/stages.mjs`, `['workmap', workMapStage]` in `STAGES`, placed **before** `['close', closeStage]` (the closed project B2 refuses writes). It would:

1. for each demo project (B1 active, B2 closed later, B3 setup), set a project location pin through the already-allowed `PATCH /api/projects/workspace` (none of the `crm`, `pipeline` or `projects` stages sets a location, so the demo projects have no pin or inherited site pin);
2. `GET /api/projects/work-areas`, then `POST` any missing `DEMO – …` area. The natural key is the area name, because active names are unique per project, so the stage is idempotent like the others;
3. reuse the shapes and `polyArea`/projection helpers from `scripts/seed-work-map-demo.mjs` (move them into `scripts/demo/workmap.mjs`).

**Blockers, deliberately not changed here** (the task excludes changing the hosted importer):
* The importer's write guard (`scripts/demo/import-guards.mjs`) allows only listed routes. `POST /api/projects/work-areas` is not listed.
* `docs/DEMO-IMPORT-FOOTPRINT.json`, the `import-footprint.mjs` table spec (`project_work_areas` as a derived table with `project` as parent) and `DEMO-COMPANY-MANIFEST.json` would need the new table and counts; `test:import-demo` and `test:import-review` assert them.
* PR 64 is stacked on PR 63's branch and still open; this branch is on `main`. Both change `package.json` scripts, so expect a trivial merge there. Migration 0027 is already on this branch; no open PR adds a competing 0027.
* Hosted full-company demo loading is unfinished: PR 64's apply refuses anything except a local `_test` database.
