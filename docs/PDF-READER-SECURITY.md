# Local PDF/OCR correction

Base: `49de431`. Branch: `fix/pdf-reader-security`.
The checkout is separate from quote-export, P&L and PR55. No remote writes,
publication, deployment, document uploads, dependency installs or model training.

## Security and compatibility decision

The PDF reader now uses the exact **pdfjs-dist 6.3.289** maintained distribution,
served by jsDelivr, with the matching `legacy/build/pdf.worker.min.mjs` worker.
Mozilla's latest release at verification:
https://github.com/mozilla/pdf.js/releases/tag/v6.3.289

The maintained `legacy` build is still an ES module; its polyfills provide wider
browser compatibility than the modern build. The loader uses `type="module"`,
checks the loaded API version, and configures a worker of that exact version.
CMaps, standard fonts and WASM assets are pinned to the same release.
https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported

This replaces the affected 3.11.174 library, rather than relying only on its
workaround. The explicit `isEvalSupported: false` option remains on every read
as a no-eval policy; the current build no longer needs that old workaround.
Mozilla lists 4.2.67 as patched for CVE-2024-4367 and 6.2.108 as patched for
CVE-2026-16633; the selected release is newer than both:
https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq
https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j

This is not a claim that all vulnerabilities are impossible. npm audit does not
cover CDN scripts, workers, fonts, WASM or OCR language assets.

## Behaviour

- OCR and PDF loaders share concurrent attempts, validate the global API, time
  out after 30 seconds, and remove failed scripts/listeners. Retrying an ES module
  uses a new query key to avoid a cached failed import of the same pinned asset.
- Docket upload and reprocessing create an OCR worker only when native PDF text
  proves insufficient. Images and scanned/mixed PDFs still use existing OCR.
- Parsing thresholds, page limits, source handling, upload security, human review
  and approval rules are unchanged. No financial fields are auto-approved.
- The timeout covers script loading, not PDF parsing, OCR worker initialization,
  language downloads or recognition. End-to-end cancellation remains separate.

## Validation

Windows; Node 24.19.0 (project requires Node 22); no MySQL. Existing dependencies
were reused via a junction. Two small upstream modules were downloaded only for
inspection, then removed; no new dependencies or browser tooling were installed.

- PASS: TypeScript (`tsc --noEmit --incremental false`).
- PASS: lint, zero errors; eight existing Next navigation warnings. An interim
  lint included temporary upstream minified files; those inspection files were
  removed before final validation.
- PASS: mocked reader regressions execute the real loader/reader functions with
  mocked DOM/network/PDF/OCR. They cover module type, pinned worker/assets, stale
  version rejection, concurrency, failure/retry, timeout/retry, missing globals,
  native text without OCR, scanned PDFs, errors and unchanged review guards.
- PASS: upload safety, idempotency retry, docket files/parser, mixed, planning,
  field, commercial, preparation, repairs, reporting, tender files, V1 logic,
  modularity, program/workshop and lookup suites (17 including new reader tests).
- BLOCKED: the complete `npm test` command stops at the existing Windows audit
  fixture (`ENOENT`, `/proc/self/mountinfo` diagnostic); the final automation
  suite cannot spawn Git (`EPERM`). Other suites were run individually.

### Real browser evidence

`node scripts/test-document-readers-browser.cjs` runs installed Chrome with a
localhost-only synthetic-document harness, real CDN modules and real OCR.
Set `CHROME_PATH` for another installed browser executable.

Final 6.3.289 legacy-module run **passed**, exit 0:

- A real module request returning HTTP 404 rejected and removed its script.
- Concurrent retries loaded one module; API version was `6.3.289`.
- Worker URL was the matching pinned `legacy/build/pdf.worker.min.mjs`.
- Both reads confirmed a real `Worker` port, not PDF.js fake-worker fallback.
- Digital PDF: `pdf-text`, confidence 99, expected text, no OCR script download.
- Image-only PDF: `local-ocr`, confidence 95, expected text, OCR loaded lazily.

Earlier restricted Chrome/Edge attempts timed out (Chrome 100-second overall
bound; Edge DevTools `Runtime.evaluate`). Reviewed execution permissions allowed
Chrome to run. A first harness exposed an unrelated test-only global `exports`
collision with Tesseract; the harness now scopes its transpiled exports locally.
The successful run used the final module/worker paths and corrected harness.

## Remaining release gates

Run complete CI/build and authenticated upload/reprocess journeys on Node 22 and
MySQL. Validate the deployed CSP/CDN access and the supported browser matrix,
including Safari/Firefox, mixed documents and representative customer formats.
The smoke is a standalone real-reader harness, not a full authenticated app test.
No production build was attempted on this low-disk, unsupported-Node desktop.
This correction is not a complete production-readiness sign-off.
