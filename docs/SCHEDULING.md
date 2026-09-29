# Scheduling — fast planning and resource allocation

Tranche 4 keeps the existing deterministic scheduling/conflict engine and rebuilds the planner surface around it.

## Product rule

**Fast to create. Controlled before delivery.**

A coordinator should be able to create a useful Draft shift with project, site, date/time, scope and resource requirements without completing every readiness field. Moving the shift into Planned / Ready / In Progress remains server-controlled.

## Day board

The Day view is the scheduler's primary operating surface:

- left: shift cards for the selected date;
- right: the Resource Rail for the selected shift;
- mobile/tablet: the rail stacks below the cards rather than forcing a desktop layout.

Cards show client, project, site, time, status, assignments, requirement coverage and the highest-priority readiness exceptions. Selecting a card changes the allocation target. **Details** opens the full shift editor. **Copy** creates a next-day Draft using the existing safe allowlist; resources are not copied from the card shortcut.

## Resource Rail

Tabs:

- People
- Plant
- Crews
- Subcontractors
- Suppliers

Search accepts names and operational identifiers such as plant number, registration and employee number.

The rail calls the existing read-only `/api/delivery` availability check for the selected shift. The same deterministic conflict engine used on save evaluates the candidates. Resources that satisfy a currently missing requirement are ranked first, then by availability. Blocked resources remain visible with the reason but cannot be quick-assigned.

Click-to-assign is the accessible/mobile fast path. Removing an assignment is also immediate. Both use the normal `/api/delivery` save route; there is no client-only bypass.

The server remains authoritative for:

- inactive/unavailable resources;
- worker/plant double booking;
- worker competency expiry/missing competency;
- plant safety hold/compliance expiry;
- resource-requirement shortages;
- project closure;
- IMS/readiness gates.

## Shift editor

The first screen exposes the planning essentials:

- client filter / project
- inherited site and contact
- classification
- exact work point / inherited project-site location
- date
- start / finish
- scope
- resource requirements

Less common detail is under **Advanced shift details**:

- occupancy window
- chainage / work-area description
- quantities / mix
- supervisor
- competencies
- PO
- permits
- TMP / TGS
- documents
- weather
- pre-start
- instructions
- planned cost inputs

The existing full resource editor and readiness checklist remain available below.

## Commercial integrity

Operational roles must never receive resource rates merely because they schedule work.

The GET projection already removes money. Tranche 4 also protects the write path:

- for an existing assignment, a non-commercial save restores the stored server-side rate;
- for a newly assigned resource, the server sources its stored rate when available;
- a browser-supplied rate from a non-commercial role is ignored;
- the POST response is passed through the same money-free projection;
- non-commercial users do not see the Rate input or Planned shift cost in the editor.

This prevents ordinary allocation changes from erasing or forging hidden commercial data.

## Deliberately not implemented here

- worker accept/decline or SMS/email dispatch — Communications tranche;
- proximity/distance ranking — requires reliable resource/depot location data;
- fatigue scoring — requires a proper hours/fatigue model;
- AI allocation — deterministic eligibility remains the source of truth; human chooses;
- new lifecycle statuses solely for notifications.

These should be added as capabilities over this board rather than replacing it.
