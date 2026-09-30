# Dependency security (Security 1)

Audit date: 2026-09-30, from `main` at `0f09707` (after PR #45). Source: `npm audit` (GitHub Advisory Database via the npm
registry) plus `npm view` for published releases. Reproduce with `npm run security:audit`.

> Hostinger's aggregate warnings are not evidence of a breach, and a fixed repository is not evidence that the hosted app is
> patched: the hosted app must be rebuilt/redeployed from this code and its own dependency install checked separately.

## Method and scope
- **Production** = what `npm audit --omit=dev` reports, i.e. what a production install ships. Note `drizzle-kit` is a
  *development* dependency of this repo but is also a peer dependency of `better-auth`, so npm installs it in production
  too; it is therefore classified as production-installed but not runtime-reachable (see below).
- **Confirmed exposure** = the vulnerable feature is used by this code. **Unknown reachability** = the vulnerable code ships
  in the production tree and we could not rule out use. **Not reachable** = evidence in this repository.

## Before (installed versions on `main`)
`10 vulnerabilities: 1 critical, 3 high, 6 moderate` (production and full-tree counts were identical).

| Package | Installed | Severity | Advisories | Exposure |
|---|---|---|---|---|
| next | 16.2.6 | **critical** (11 advisories) | [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) (RCE, Windows hosts), [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) (RCE, Image Optimization with AVIF), [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24), [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj), [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x), [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4), [GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742), [GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q), [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3), [GHSA-q8wf-6r8g-63ch](https://github.com/advisories/GHSA-q8wf-6r8g-63ch), [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) | Image Optimization is on by default and `next/image` is used in two components → **unknown reachability**. No Server Actions, no middleware/proxy, no rewrites, webpack (not Turbopack) build, `next start` via the CLI → the Server Action, middleware, rewrite and Turbopack advisories are **not reachable** in this code. Hosting OS unknown (the Windows RCE applies to Windows hosts only). |
| next → postcss (nested) | 8.4.31 | high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | Build-time CSS processing; unknown reachability. |
| sharp (optional dep of next) | 0.34.5 | high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) (libvips/libheif) | Used by the Next image optimizer: unknown reachability. |
| nodemailer | 7.0.13 | high (13 advisories) | e.g. [GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j), [GHSA-2x7j-588g-ccc2](https://github.com/advisories/GHSA-2x7j-588g-ccc2), [GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f), [GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v) | Used for SMTP mail (`lib/platform/email.ts`, plain `sendMail` with server-composed text). Address parsing/DoS advisories: **unknown reachability** (recipients are user email addresses). |
| esbuild 0.18.20 → @esbuild-kit/core-utils → @esbuild-kit/esm-loader → drizzle-kit | 0.31.10 | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (esbuild dev server) | Dev-server-only; the app never runs esbuild's dev server. **Not reachable** at runtime. |
| exceljs → uuid | 4.4.0 → 8.3.2 | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (uuid v3/v5/v6 with a `buf` argument) | exceljs only calls `v4()` without a buffer (`cf-rule-ext-xform.js`): **not reachable**. |

## After (this PR)
`6 vulnerabilities: 0 critical, 0 high, 6 moderate` (production and full tree).

| Package | Change | Why this version |
|---|---|---|
| next | 16.2.6 → **16.3.8** | Latest published release (verified with `npm view next version` on 2026-09-30). Fixes every listed Next advisory (the ranges end at 16.2.11 / 16.3.3). Same major/minor line family; peer deps unchanged (React 19.2.6). |
| eslint-config-next | 16.2.6 → **16.3.8** | Matching tooling for Next. |
| next → postcss (nested) | 8.4.31 → 8.5.23 | Pulled in by next 16.3.8 (fixes the four postcss advisories). |
| sharp | 0.34.5 → 0.35.5 | Pulled in by next 16.3.8 (`^0.35.4`); fixes the libvips/libheif advisories. |
| nodemailer | 7.0.13 → **10.0.13** | Latest published; all advisories are fixed in ≥10.0.6. Semver-major: only `createTransport` + `sendMail` are used, verified by the SMTP fixture tests. Engines `node >=20`. |
| @next/swc-* | 16.2.6 → 16.3.8 | Same release as next. |

Nothing else was upgraded and no `npm audit fix --force` was used. `@types/nodemailer@7` was left in place (nodemailer 10 ships its own types; removing the stale types package is a separate cleanup).

## Remaining (all moderate; none gate the build) — for human review
1. **esbuild / @esbuild-kit/* via drizzle-kit 0.31.10** (moderate, [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)). No compatible fix: drizzle-kit 0.31.11 (latest 0.31.x) still depends on `@esbuild-kit/esm-loader`; npm's suggested "fix" is a downgrade to 0.18.1, which we do not apply. Installed in production only because `better-auth` peers on drizzle-kit; the affected esbuild dev server is never started. *Proposed mitigation:* move to a drizzle-kit release that drops `@esbuild-kit` when one is published; optionally stop installing the peer in production.
2. **uuid 8.3.2 via exceljs 4.4.0** (moderate, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)). exceljs 4.4.0 is the latest release and pins `uuid ^8.3.0`. Not reachable (only `v4()`). *Proposed mitigation (needs approval, not applied):* an npm `overrides` entry for `uuid` at `^11.1.1` (CJS-compatible), tested with the XLSX round-trip suites.
3. **Next image optimizer exposure.** Fixed by the upgrade, but if the hosted app is still on 16.2.x the AVIF/SVG image advisories remain; confirm the deployed version.

## Next.js release status (refreshed 2026-09-30) — partly postponed upstream
- **Applied:** `next` and `eslint-config-next` 16.3.8 — `npm view next dist-tags.latest` = 16.3.8 (same 16.3 stable line; the 16.3.x versions 16.3.7 and 16.3.8 are both on the registry). The 16.3.7 and 15.5.27 versions were the ones named in the upcoming-release notice as accompanying the advisories.
- **Already covered:** GHSA-vcvr-r3jv-pc5j (critical `next/og` RCE, published 2026-09-22) is patched in 16.3.6, so included. This code does not use `next/og`.
- **Official September release (as reported to this PR; nextjs.org is blocked by this environment's proxy, so the notice could not be re-read here):** the coordinated 2026-09-30 release delivered **seven** fixes. **One critical and one high fix were postponed upstream** and are **not** remediated by 16.3.8 or by this PR. Do not read this PR as patching all nine announced advisories (1 critical, 2 high, 5 medium, 1 low).
- **Follow-up:** track the postponed critical and high advisories upstream; when their patch is published, read the advisories, bump `next` and `eslint-config-next` together, and rerun the gate. Until then the application remains exposed to those two issues.
- This PR is incremental remediation. It does not prove the deployed/hosted app is patched or safe.

## The automated check
- `npm run security:audit` (also a CI step right after `npm ci`) runs two scans: the **production** set (`npm audit --omit=dev`, the gate) and the **full tree** (informational for development-only findings).
  - Exit **0**: both scans produced valid reports and no unresolved high/critical production finding exists.
  - Exit **1**: unresolved high/critical production finding(s).
  - Exit **2**: a scanner failure in **either** scan (network error, non-JSON output, error payload, malformed or internally inconsistent report, unexpected exit code, npm not runnable). `PASS` is never printed on a failure. If a blocking finding and a scanner failure occur together, the exit is 2 and both are printed.
  - Moderate/low production findings are printed but do not gate; development-only vulnerabilities in a *successful* full-tree scan are informational.
- **Strict report validation** (`scripts/security-audit-lib.mjs`): the report must be a JSON object (not an array) with `auditReportVersion` exactly the number `2` (missing, invalid or unsupported versions are rejected), `metadata.vulnerabilities` must contain the five known severities and a total as non-negative integers with no unknown severity, `vulnerabilities` must be an object of well-formed findings (known severity, `via` list, advisories with title/url/severity, valid `fixAvailable`, and no finding labelled less severe than an advisory it carries — e.g. a "moderate" finding containing a critical advisory is a contradiction), per-severity counts and the total must match the findings listed, and the npm exit code must agree with the report. Anything else is a scanner failure, never a clean result.
- There is deliberately **no ignore/allow list**: exceptions are human decisions made in review.
- **Tests** (`scripts/test-security-audit.mjs`, part of `npm test`): offline classifier tests for every malformed shape above, plus real subprocess runs of the CLI against a fake `npm` on `PATH` — clean, moderate-only, high/critical, production scan OK then full-tree network failure, other full-tree failures (non-JSON, empty, killed, array, contradictory counts), production failures, both failing, blocking + failed full-tree, dev-only findings, and npm missing. The regression is reproduced: the previous runner exited 0 and printed PASS when the production scan succeeded and the full-tree scan failed; it now exits 2.
- Limits: `npm audit` covers known, ingested advisories only; it does not prove absence of vulnerabilities and does not scan the hosting platform, the OS, or Node.js itself.

## How the audit gate CLI is tested
`scripts/test-security-audit.mjs` runs every CLI case (exit codes, stdout/stderr, scanner errors, malformed reports, missing npm, mixed production/full-tree outcomes) through two harnesses, each in a fresh Node subprocess running the real `scripts/security-audit.mjs`:
- **Preload harness (mocked npm boundary):** `node --require scripts/fixtures/fake-npm-preload.cjs scripts/security-audit.mjs`. The test-only fixture replaces `child_process.spawnSync` (and refreshes the ESM named binding with `syncBuiltinESMExports`) so `npm audit` returns a controlled response. Node reads the fixture as data, so this works in the isolated automation sandbox, where `/tmp` is `noexec` and the sandbox is deliberately unchanged. It always runs. The production gate has no override and never loads the fixture.
- **Executable harness (real command launching):** a fake `npm` executable placed first on `PATH`, which exercises actual process launching. It is **required on ordinary CI** (`GITHUB_ACTIONS=true`; a launch failure there fails the test). Elsewhere it runs when launchable, and the test prints that it was NOT RUN (not a silent skip) when the directory is `noexec`.
Inside the isolated sandbox the CLI tests therefore use a mocked npm boundary; actual executable launching is covered by ordinary CI.
