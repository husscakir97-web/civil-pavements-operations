# Workshop: service plan, service due and plan correction

Extends the existing Workshop module (`lib/modules/workshop/workshop.ts`, `POST /api/workshop`, `components/v1/workshop.tsx`) and the scheduling conflict engine (`lib/modules/operations/conflicts.ts`). No new system.

## Rules

- **A meter reading never changes the service plan.** `action: 'meter'` records the reading only (non-decreasing, units locked). The schema is strict: a reading that carries a threshold is refused (400).
- **Initial plan** (`action: 'plan'`, `workshop.edit`): allowed only on an asset that has no plan. Existing assets with no thresholds stay without; nothing is invented, and an asset with no plan is never flagged.
- **Completed service** (`action: 'service'`, `workshop.edit`): records who, when (`performed_on` plus the server `recorded_at`), the meter reading, the previous and the new thresholds, and a note. It is atomic: `asset_service_events`, `asset_meter_readings`, the `plant` update, the audit event and the `workshop.service.recorded` domain event commit together or roll back. A client request id makes a retry return the first result; two different concurrent submissions on the same asset revision produce exactly one record (the other gets 409).
  - A completed service never touches `status` or `safety_hold`. Critical defects still need repair and independent verification (`workshop.verify`).
  - Rejected: a future date (in the organisation's time zone), a meter reading below the latest reading, a date before newer evidence (a later reading or an earlier service) — backdated service evidence is **not supported in this first version** and is refused with an explicit message — and thresholds that are not strictly after the service. Existing thresholds must be replaced.
- **Plan correction** (`action: 'correct'`, `workshop.plan.correct`, administrator only): needs the current asset revision and a mandatory reason (10+ characters); `null` clears a threshold. History keeps old/new values, actor and server timestamp. It is labelled "Plan corrected" and is never a "Service completed". It never changes the meter, the status or a safety hold. No manager permission and no mechanic role were added.
- **History** (`asset_service_events`) is insert-only in application code: kinds `completed`, `plan_set`, `plan_corrected`.

## Scheduling

`PLANT_SERVICE_OVERDUE` is a **warning** (`warn`), never a block, for Draft, Planned, Ready and In Progress alike.
- Date: a shift dated after `next_service_date` is flagged in advance (on the date itself is not after it). With no shift date the organisation's local "today" is used; with neither, nothing is flagged.
- Meter: the latest reading is at or above `next_service_meter` (a meter cannot be projected forward).
- A critical defect still hard-blocks through the safety hold (`Out of service`). **Major defects have no availability rule: no policy is defined and none is assumed.**

## Time zone

Date-only comparisons use `organisation_profiles.timezone`, defaulting to `Australia/Sydney` (the value the codebase already assumes elsewhere). There is no screen to change it yet; it is a column only.

## Write-path audit (every writer of `plant`)

| Writer | Meter / service columns |
| --- | --- |
| `workshop.ts` `meter` | `current_meter`, `meter_type` only |
| `workshop.ts` `service` | meter, thresholds (atomic, history) |
| `workshop.ts` `plan` / `correct` | thresholds (history) |
| `workshop.ts` `asset` (create) | none (thresholds not accepted) |
| `workshop.ts` defect / verify | `status`, `safety_hold` only |
| `operations/resources.ts` `savePlant` (generic asset edit) | none: fixed column list; unknown fields are stripped |
| `v1/resource-sync.ts`, `scripts/backfill-resources.mjs`, import | none: `mapPlant` columns exclude them |

`scripts/test-v1-logic.cjs` scans the sources so a new writer cannot silently touch these columns.

## Limitations

- Records created before this change that have thresholds keep them. A reading no longer updates them: an asset whose threshold was last set by a reading now needs a completed service or an administrator correction to move it.
- Service due uses the latest recorded reading; a stale reading under-reports.
- No service reminders/booking, recurring plans, QR, or parts: unchanged future increments.
- No UI to set the organisation time zone.
- History immutability is by application convention (no UPDATE/DELETE path); the database has no trigger.
