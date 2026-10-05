# Graphite Studio design (first implementation)

Visual source of truth: `docs/design/graphite-studio-reference.png`. Before/after screenshots (synthetic demo company): `docs/design/screens/`.

## Tokens (`app/globals.css`, `--gs-*`)
ivory `#f5f3ee` · paper `#faf9f5` · sheet `#fdfcf9` · fog `#ebe8e0` · line `#dad6cc` · line-strong `#b4afa3` · ink `#242424` · graphite `#2d2f31` · graphite-2 `#4a4d50` · muted `#66635b` · select `#e3dfd4`, plus warn / error / ok trios. shadcn variables are remapped (`--primary` = graphite, `--radius` .25rem); the legacy orange brand default maps to graphite, custom company accents are still honoured.

## Reusable pieces
- CSS: `.gs-eyebrow`, `.gs-title`, `.gs-rows`, `.gs-rail*`, `.gs-wordmark`, `.gs-crumb`, `.gs-tabs/.gs-tab`, `.gs-note(-warn/-error/-ok)`; `.plan-ui` scope retones Planning.
- `components/v1/kit.tsx` (PageHeader, Section, Tabs, Btn, field, Stat, states), `components/v1/studio.tsx` (discipline patterns, swatch, definition rows).
- Work areas are distinguished by pattern plus word, never colour alone. Warnings/errors/selection carry text or icons.

## Covered
App shell (icon rail, quiet top bar, section tabs in the page header, flat mobile nav), Work map (canvas, label chip, contextual detail panel, compact list, edit form), work-point strip, Planning (list, editor, canvas, inspector), shift work-area picker swatches. Behaviour, permissions, redaction, geometry and save/retry states are unchanged; map shows no imagery.

## Not redesigned (inherit tokens/controls only, layouts unchanged)
Home, CRM, Pipeline/tendering, Estimating, Schedule, Resources, Commercial, IMS & HSEQ, Documents, Reports, Admin, Field/dockets, login/onboarding, remaining Projects tabs.

## Not implemented (would invent data)
"Today's programme" timeline, Sequence stepper, "Next handover" block, aerial imagery.

## Polish batched for later
Mobile Projects header is tall (title, next-action, picker before the map); Planning mobile editor density; unify the legacy dockets/field screens.

## Verification (final build)
lint, typecheck OK; unit 15/15; Planning 78, picker 83, feedback 46, work-map 165, connected-map 75 checks, all passing.

## Interaction timing (same machine/browser/demo DB, interleaved, median ms)
| Interaction | Before | After |
|---|---|---|
| Open Work map | 907 | 914 (+1%) |
| Select an area | 31 | 40 (+9 ms, +28%, flagged: larger detail panel) |
| Open Planning list | 902 | 900 |
| Open a plan | 64 | 69 (+9%) |
| Select plan activity | 50 | 49 |
| Open Schedule list | 957 | 978 (+2%) |
Draw-a-shape timing was not obtained (the timing script's drawing step failed on both builds); drawing is covered by the work-map journey.
