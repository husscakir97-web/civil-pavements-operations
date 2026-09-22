# Performance and bug fixes — 22 September 2026

## Changes

- Load workspaces on demand and begin loading their code when a navigation item receives hover or keyboard focus. Home no longer imports every editor and document workflow.
- Share PDF/OCR loaders without importing the Docket Dashboard into the tender reader.
- Send only the report summary used by the dashboard. Keep the existing full report response available for consumers that need records.
- Pause report polling while the tab is hidden, prevent overlapping requests, abort obsolete requests, and avoid rerendering the application when totals have not changed.
- Run independent search and project-detail queries concurrently through the existing five-connection pool. All queries retain tenant filters and server permission checks.
- Restore the selected project before fetching; abort stale project requests and hide old project content during switching.
- Replace SQLite string concatenation in search with MySQL CONCAT_WS, so client/contact/docket details are searchable.
- Calculate unbilled completed work from approved, unclaimed dockets. Keep remaining contract value as a separate figure.
- Restore the Operations / Field navigation entry and support the current office/field roles in navigation and home actions.

## Measurement

Production Next.js builds on Node 22, comparing the same page client-reference manifest entry for `app/pavement-os.tsx`:

| Initial workspace JavaScript | Before | After |
| --- | ---: | ---: |
| Uncompressed bytes | 566,279 | 202,709 |
| Gzip bytes | 151,937 | 59,690 |

This is a **60.7% reduction in compressed initial workspace JavaScript**. It measures the manifest-listed workspace chunks, including their shared chunks, not the entire page transfer, server latency, or a browser Core Web Vitals score. Deferred workspaces still download when used.

The six-docket fresh-start fixture returns 12,455 JSON bytes for the full report and 563 for the summary (95.5% smaller). Both responses produce identical totals. This is a fixture payload measurement, not a claim about all datasets.

## Regression coverage

The commercial suite checks approved docket value before a claim and zero unbilled value after claiming. The fresh-start production integration checks identical full/summary report totals, omission of records in summary responses, all six demo dockets found by client search in MySQL, isolation from another organisation, and the demo's $4,500 unbilled value. Existing suites continue to cover historical rates, permissions, docket parsing, field work, claims and document workflows.

Browser smoke checks should cover Home, all top-level areas, Operations / Field including reload, project selection, Council search (including six dockets), Commercial ($4,500 unbilled with the untouched demo), Reports and Account / Team. Do not create or modify operational records just to perform this navigation check.

Large OCR scans, first visits to deferred workspaces, network conditions and hosting response times can still take time. These changes do not claim zero latency or high-volume load-test results. No schema, credentials or Hostinger settings change is required for this update.
