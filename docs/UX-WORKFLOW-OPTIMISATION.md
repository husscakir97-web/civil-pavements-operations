# UX / workflow optimisation (on top of V1)

Branch `claude/infrastruct-ux-workflow-optimisation`, based on the V1 release candidate
`fad1765` (`claude/infrastruct-v1-completion-03x6v8`). It is kept separate from the release so
the owner can decide whether it ships before or after V1.

**Scope.** Presentation, navigation and workflow continuity only. No business rules, calculations,
state machines, tenancy or permission rules changed. There are two small server additions:
- A read-only planner availability check that uses the existing conflict engine.
- `forecast()` now also returns `approvedVariationCost`, an input it already used.

## Measured effort (Playwright, same seeded organisation, `/tmp` QA harness)

| Flow | Before | After |
|---|---|---|
| Tender: open Pecks Road → approved estimate revision | 11 clicks, 5 context changes (the estimate opened in the Estimates module, with no way back to the tender) | 4 clicks, 2 context changes (the tender opens on its next step, and the estimate works inside the tender) |
| Project: open the awarded project → reach the fix for the first readiness blocker | 3 clicks, then scroll past an 18-field form to a read-only list with no action | 3 clicks straight to where it is fixed (each blocker has its own button) |
| Scheduling: allocate a resource to an unscheduled shift → know whether it can work | 5 clicks + 2 entries (the conflict appears only after setting Planned and saving) | 4 clicks + 1 entry (availability shows on every resource as you pick, before saving) |
| Field: Today → submitted docket | 6 clicks + 2 entries | 6 clicks + 2 entries (unchanged). The shift record now opens for the job in place; before, it meant switching to the Shift records tab and finding the shift again, about 3 extra clicks and 2 context switches, from the code path |
| Commercial: approved variation → claim sent for internal approval | 6 clicks + 1 typed amount | 5 clicks, nothing typed ("Include in next claim" prefills the line; "Submit for internal approval" creates and sends it in one action) |

## Changes by area

- **Home.** My work → Today → Needs attention → Portfolio. The portfolio shows live projects with existing per-project figures and no new arithmetic.
- **Pipeline.** Opens on Tenders.
  - One progression: an Opportunities link and phase filters (Preparing, Pricing, Awaiting approval, Submitted, Won / lost).
  - Sorted by due date, with urgency, owner and next action on each row.
- **Tender workspace.**
  - A lifecycle stepper (done / next / needs attention / counts) replaces the nine tabs. A tender opens on its next-action step, and Next action has a "Go to <step>" button.
  - The header shows client, due-date urgency and owner.
  - The estimate is embedded in the tender.
  - Requirements, returnables and clarifications open on "Needs attention".
- **Project workspace.**
  - Header: client, PM, contract value (authorised roles), blockers, and Go to the next action.
  - Overview: Needs attention (with fix buttons) → Today and upcoming → Financial snapshot → risks and activity.
  - Setup: "Not ready · N blockers" first, then a guided setup checklist (Complete / Needs attention / Not started) that opens the existing functionality.
  - Delivery: upcoming shifts first. "Plan shifts for this project" opens the schedule filtered to the project, with a way back. "Add to claim" on approved dockets.
- **Operations.**
  - Day summary (shifts, people and plant allocated, unassigned, not dispatched, warnings).
  - Live availability in the shift editor, e.g. "John Smith: Available", "Excavator 05: compliance expired".
- **Field and supervisor (375px).**
  - Job screen with Before work / During work / Finish, ticked from existing data.
  - The shift record opens for the job in place, with "Back to job".
  - The on-site SWMS panel shows only issued SWMS, with no office authoring.
- **Commercial.**
  - The financial position reads as Contract / Cost / Revenue / Result statements.
  - "Include in next claim" from approved variations.
  - The claim builder groups Contract work / Variations / Dockets. It shows gross, retention, net, GST and total using the same finance functions as the server, then "Submit for internal approval".
  - Certification, invoicing and payment use inline forms instead of browser prompts.
- **Global.**
  - AI panels collapse to one line while AI is off.
  - Server scheduling conflicts appear as plain-language errors.
  - Human status labels and consistent "Save".
  - Confirmation only for award, loss, SWMS issue, invoice issue and project close.

## Verification

- `npm ci`, lint (0 warnings), typecheck, `npm test`, build, test:fresh, db:migrate, test:backfill, test:mysql and test:v1 all pass.
- New logic tests cover tender steps and next-step targets, setup checklist and fix targets, next-action tabs, `availability()`, and the forecast budget change.
- The journey asserts that the availability check shows a double booking before saving, writes nothing, leaks nothing across organisations, and is refused for field users.
- Browser QA covered admin, estimator, project manager, operations, accounts and read-only at 1440, 1024, 768, 430 and 375, plus field and supervisor at 430 and 375. Every screen had no page errors and no horizontal overflow. Role visibility checks passed, and field and supervisor screens show no money.

## Final polish

- **One estimate status.**
  - The editor header shows the approval-workflow badge (draft / in review / approved).
  - Inside the tender, the legacy editable "Status" field is gone. The standalone register keeps only the non-duplicating outcome values as a separate "Quote outcome" (the stored legacy value is preserved).
  - The legacy "Internal review" button, which duplicated the workflow, is removed.
  - The embedded editor gets its own "Save changes". It is locked while a revision is in review.
- **Shift cards.** Instead of "N readiness warnings", cards show "Needs attention" with the two most urgent existing warnings and "+N more" to reveal the rest (`lib/v1/shift-warnings.ts` only orders them).
- **No native prompts.** Estimate approval/return, SWMS new revision, project reopen (explains Closed → Closeout) and competency revoke use a shared reason dialog. Each keeps the existing optional/required rule.
- **Phones.**
  - The project workspace uses a sticky section picker (project name and current section) instead of a sideways tab strip. It uses the same routes, so deep links and back/forward work.
  - Project and tender headers scroll away below 640px.
  - Next-action buttons wrap instead of covering the text.
- **Search.**
  - An estimate linked to a tender opens Tender → Estimate.
  - Dockets open their project's Delivery, and shifts their project's schedule.
  - Variations and claims open project Commercial, and SWMS open Quality & HSEQ.
  - Records without a known context fall back to their register (`lib/v1/search-routing.ts`).
- **Action consistency.** No competing "Go to Setup" when the next action is the header's own Mark ready / Start delivery. Status badges without a workflow machine and underscore options use readable labels.
