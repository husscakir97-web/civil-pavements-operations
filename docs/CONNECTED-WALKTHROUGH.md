# Connected workflow — populated walkthrough (about 10 minutes)

Address search → confirmed work point → shared work areas → scheduled job with traffic-management context. Synthetic demo data only; no aerial imagery (plain grid), no paid services.

Load: `node scripts/seed-demo-company.mjs` against a **local `_test` database**, or the guarded importer (`docs/DEMO-TENANT-IMPORT.md`). Sign in as the demo admin. Local fake address provider: `LOCATION_PROVIDER=fake`.

1. **Projects → PRJ-0001 Quarry Road resurfacing → Work map.** The panel says *Work point confirmed* and that the location is inherited from the client site. 12 `DEMO –` areas are on the grid: asphalt, stabilisation, traffic management (two own crew, two subcontracted to a demo traffic-control firm), a subcontracted linemarking area and one archived option.
2. **PRJ-0003 Coastal Motorway (setup).** *Moved: review* — the project location was moved 450 m after confirmation. The saved areas did not move; a dashed marker shows the old confirmed point. *Confirm this work point* accepts the new location (the areas are still where they were).
3. **PRJ-0002 Anzac Parade (closed).** Has a project-specific location; the client site keeps its own. Read-only: no Draw / Confirm / Change.
4. **New project:** Projects → New. Open *Work map* → *Set project location* → type `dover road rose bay`, pick it, *Save location*, then *Confirm this work point* and *Draw area*. Reload: the same area is there. Change the location to `24 york road ingleburn`: the panel flags *Moved* and the polygon is byte-identical.
5. **Schedule → List → search `Paving Quarry Road` → Details.** *Work areas for this shift* lists the asphalt and traffic-management areas it uses. *Open on map* lands on the Work map with that area selected. *Change work areas* links another saved area (IDs only; nothing is copied).
6. **Roles:** a read-only user sees the map and links but no buttons; a scheduler can link shifts but cannot draw areas or confirm a work point; field workers and other tenants get nothing.

Everything on the map is an operational overview — not an approved traffic management plan.
