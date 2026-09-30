# Infrastruct UX doctrine

Binding guidance for every future tranche (Business Units, Estimating, Scheduling, Work Records, Claims,
Ask Infrastruct). **Unified experience above, modular architecture below.** The architecture (modules,
entitlements, permissions, domain events, seams) is not weakened to make the surface simple; the surface
hides it.

The question the product answers is *"What are you trying to do?"* — never *"Which module, register or
record type do you want?"*

## Principles

1. **Ask once.** Never ask for information Infrastruct already knows.
2. **Ask progressively.** Request only what the current decision needs. Optional detail sits behind
   "More details".
3. **Context first.** Actions understand the current organisation, project, tender, estimate, shift, asset
   or commercial record and carry it into the next screen.
4. **Task before module.** Users choose an outcome ("Plan work"); Infrastruct routes to the capability that
   does it. Entry points use verbs, not module or database nouns.
5. **Generic engine, industry presets.** Core domain architecture stays generic. Contractor-specific
   vocabulary and defaults sit above it (presets are a later tranche).
6. **Chat is an accelerator.** Major workflows should eventually be callable conversationally, on top of the
   same deterministic task/service definitions. There is no natural-language mutation yet.
7. **Outputs belong to the work.** Dockets, PDFs, forms, documents and reports originate from authoritative
   records; they are not independent islands.
8. **Human confirms controlled decisions.** Automation prepares; authorised people approve or commit.
9. **Create once, reuse downstream.** A reliable business fact is entered once at its earliest authoritative
   point, then inherited or transformed downstream — Client → Project → Programme → Schedule → Work completed
   → Docket → Claim. Do not re-ask for Client or Site when the authoritative context supplies them.

## Role awareness

Different roles get different work, not the same app with greyed-out buttons. Home shows a role-ordered
"Start something" set; a Project shows "What do you need to do?". Each action is hidden entirely when the
user lacks the capability, the module is not entitled, or the target cannot be opened. There are no
disabled teasers.

## Task actions are presentation, not authority

`lib/v1/task-actions.ts` is the single table of task entry points (key, label, description, icon,
capability, module, context, target route, priority, availability). It only decides what is *shown*.
Server routes and services stay authoritative; a hidden button is never security, and every task target
is an existing route.

## Presentation vs architecture

- Primary navigation is conventional business areas (Home, CRM, Pipeline, Projects, Schedule, Resources,
  Commercial, IMS & HSEQ, Documents, Reports, Admin; Today for field-capture roles). The six internal
  engines are not primary navigation; the lifecycle view lives under Reports.
- User-facing labels may differ from stable route keys. Example: Commercial → **Work Records** presents the
  route key `Dockets`, so bookmarks and code keep working.
- Do not solve simplicity by coupling modules. Use navigation, task routing, contextual actions, capability
  checks and existing seams.

## Explicit non-goals of this doctrine's first tranche (UX-A)

Business Units, estimating presets, the scheduling canvas, the Work Record/Docket redesign, Claims &
Proformas and Ask Infrastruct are separate, later tranches that must follow this doctrine.
