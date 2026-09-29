# Core locations — address search, aerial map and exact work point

Tranche 3. One Core location model and one picker replace hand-typed addresses for the entities
where the exact place matters. **The address is the general site; the pin is the exact work point.**

## Address input audit

| Input | Where | Decision |
|---|---|---|
| Client site address | CRM → client → Sites (`client_sites`) | **Replaced**: AddressLocationPicker (map). Address text columns are kept as the readable snapshot. |
| Quick site add in pickers | `SitePicker` inline add (`components/v1/lookup.tsx`) | **Replaced**: opens the same AddressLocationPicker inline, seeded with what the user already typed; saves the structured address and optional exact pin without leaving the workflow. |
| CRM quick-create site address | New client form | Kept as free text (one line, optional). |
| Project site address | Project → Setup (`jobs.site_address`) | **Inherited** from the CRM site; optional project-specific override (`jobs.location_id`). The free-text field is kept. |
| Scheduling job site | Job editor (via the CRM site) | Inherits the site location. The location is shown in the editor. |
| Shift location | Shift editor | **Work point**: inherits project → site; "Use different work point" sets `shifts.location_id`. The free-text `metadata.location` stays as the work-area description (e.g. chainage/lane). |
| Field Today | Shift detail | Shows the work location plus a **Directions** deep link to the exact pin. |
| Company registered / operating address | Admin → Company | **Autocomplete + structured** (address mode, map optional). The text columns stay as the document snapshot. |
| Depots / yards | Resources → Depots (new) | **New entity** with a location (map). |
| Incident location | IMS → Incidents | **Location** (compact picker) + free-text "Specific location" (`location_description`). |
| Crew "Base / depot" | Crews | Retained free text (a later tranche can link crews to depots). |
| Worker / plant base location | Resources | Retained free text. |
| Field record load / chainage | Field checks | Retained free text (not an address). |
| Suppliers / subcontractors | Resources | No address fields today; nothing to convert. |
| Permits | — | No permit entity exists. |

## Model (`locations`, migration 0017)

One row per owned location: `organisation_id`, `owner_type` (`client_site`, `project`, `shift`,
`depot`, `company`, `incident`), `owner_id`, `location_type`, `label`.

- **Address**: `formatted_address`, `address_line1/2`, `locality`, `state`, `postcode`, `country`.
- **Provenance**: `provider`, `provider_place_id`, `precision` / result granularity, `source` (`autocomplete` / `manual` / `inherited`), `geocoded_at`, `reverse_geocoded_at`. Place Details results use non-accuracy labels such as `ADDRESS`, `ROUTE`, `INTERSECTION` or `PLACE`; true geocoding accuracy labels such as `ROOFTOP` or `RANGE_INTERPOLATED` are only stored when the Geocoding API actually returned them.
- **Points**: `geocoded_lat/lng` is the provider's point for the address. `pin_lat/lng` is the exact operational point. Both are `decimal(10,7)`.
- **Pin**: `pin_adjusted` is true when the pin differs from the geocoded point. `pin_address` is the reverse-geocoded address of a moved pin.
- **Lifecycle**: `revision`, `status`, `created_by`, `created_at`, `updated_at`.

Owner links are `client_sites.location_id`, `jobs.location_id` (project override), `shifts.location_id`,
`depots.location_id`, `organisation_profiles.registered_location_id` / `operating_location_id`, and
`hseq_incidents.location_id` (+ `location_description`). The migration only adds tables, columns and
indexes. Existing rows keep their text and get no location until someone edits them. **Nothing is bulk-geocoded.**

## Exact-pin behaviour

- Choosing an autocomplete result stores the geocoded point and puts the pin on it (`pin_adjusted = false`).
- Dragging the marker, clicking the map, or typing coordinates moves only the pin. The geocoded point
  and the address stay; `pin_adjusted` becomes true.
- **Reset pin to address** moves the pin back to the geocoded point.
- The view is hybrid aerial (satellite + labels) so crews can place the pin on a gate, a lane or a pit.
- Coordinates are always visible. Coordinate entry is the keyboard alternative to dragging.

## Reverse geocoding

It runs once after a drag-end or click, never while dragging. The result is stored only as `pin_address`,
so the site address is never rewritten. No street number is invented: address parts come only from
provider address components, never from parsing free text. If reverse geocoding fails or finds nothing,
the pin and the original address are kept and the picker says so.

## Inheritance

Shift work point → project location → client site location. A project override is saved as a
project-owned location, so it **never changes the CRM site**. "Use site location" clears the override.
A shift work point changes only that shift. Clearing it returns to the project/site location.

## Provider abstraction

`lib/platform/location-provider.ts` defines `LocationProvider` (`autocomplete`, `place`, `geocode`,
`reverse`). Modules never call Google directly.

| Mode | When | Behaviour |
|---|---|---|
| `google` / browser | `GOOGLE_MAPS_BROWSER_KEY` set | Maps JS API loaded lazily (only when a map scrolls into view or search is used); Places (New) autocomplete + place details; Geocoder for reverse; aerial map with draggable pin. |
| `google` / server | only `GOOGLE_MAPS_SERVER_KEY` set | Search and reverse run through `/api/platform/locations` using Places API (New) REST and the Geocoding API. No map (coordinates stay visible and editable). |
| `fake` | `LOCATION_PROVIDER=fake` | Deterministic fixtures through the server endpoint. Used by CI; no network, no billing. |
| `none` | nothing configured | Manual structured address + optional coordinates. Admins see a notice explaining how to enable search. |

### Google APIs used (current APIs only)

- **Maps JavaScript API** (`importLibrary`, `loading=async`), `google.maps.Map` with `mapTypeId: 'hybrid'`,
  and **AdvancedMarkerElement** with `gmpDraggable`.
- **Places API (New)**: the Autocomplete Data API (`AutocompleteSuggestion.fetchAutocompleteSuggestions`)
  with an `AutocompleteSessionToken` per search session, then `Place.fetchFields` (formattedAddress,
  location, addressComponents, types). On the server: `places:autocomplete` and `places/{id}` with a field mask.
- **Geocoding API**: reverse geocoding (browser `Geocoder` or REST on the server).

The legacy `google.maps.places.Autocomplete` widget and legacy `google.maps.Marker` are not used. Google Place `types` describe the kind of result and are **not** treated as a guarantee of coordinate accuracy.

## Environment variables

| Variable | Purpose |
|---|---|
| `LOCATION_PROVIDER` | `google` (implied by a key), `fake` or `none`. |
| `GOOGLE_MAPS_BROWSER_KEY` | Browser key. It **is sent to the browser by design**; its protection is its restrictions, not secrecy. |
| `GOOGLE_MAPS_MAP_ID` | Map ID for advanced markers (defaults to `DEMO_MAP_ID`). |
| `GOOGLE_MAPS_SERVER_KEY` | Optional server-only key. Never sent to the browser. Used only when no browser key is set. |
| `LOCATION_DEFAULT_REGION` | Region bias (default `au`). |

No key is hardcoded. The config endpoint returns only the browser key and map ID.

### Browser key restrictions (Google Cloud console)

1. **Application restriction: HTTP referrers.** Add each hosted domain separately, for example
   `https://darkgray-…/*` for staging and `https://navajowhite-…/*` for production, plus
   `http://localhost:3000/*` only on a development key. Use a separate key per environment when you can.
2. **API restrictions:** Maps JavaScript API, Places API (New), Geocoding API. Nothing else.
3. Set **quotas** (per-day and per-minute caps) and a **billing budget alert**.

The server key (if used) is restricted by server IP and the same API list. It is not used in the browser.

## Cost controls

- Maps load lazily, only when a map is visible or the user searches. Pages without a picker load nothing.
- Autocomplete is debounced (300 ms), needs at least 3 characters, and uses session tokens so a
  search plus its place details bill as one session.
- Place details request only four fields.
- Reverse geocoding runs once per drag-end, not continuously.
- CI uses the fake provider: **no live Google calls and no billable requests**.

## Security

- Locations are org-scoped rows readable only through their owner's API (CRM site scope, project
  scope, delivery/Today scope, company profile, depots, incidents). There is **no global
  `/locations/:id` endpoint**. `/api/platform/locations` only proxies provider lookups and never reads stored locations.
- `saveLocation` updates an existing row only when it belongs to the same owner in the same
  organisation; otherwise it creates a new row, so a location is never re-pointed.
- Manual entries cannot carry forged provider provenance: without a real provider selection, the place ID and geocoded point are dropped.

## Future GIS compatibility

Points are WGS84 decimal degrees with 7 dp. `owner_type` / `location_type` let later tranches add
polygons or chainages (e.g. a `geometry` column or a sibling table) without changing owners. Road
intelligence, TMP and routing are out of scope here.
