# Docket parsing rules

How uploaded dockets (PDF or photo) become records. Rules are general; the synthetic works-docket fixture
(`scripts/fixtures/dockets/works-docket-1p.txt`) is the regression for one real layout. No real docket, name or signature is committed.

## What is one docket
- **Identity, not headings.** A docket starts at a labelled number (`Docket number: N`, `Docket No`, `Delivery docket N`, `Ticket`, `Dkt`…) whose value contains a digit and is
  not a date or time. A heading such as `WORKS DOCKET` is never a boundary and never a project. Not identities: `Physical docket number`, paper/manual/customer
  numbers, `Booking`, and cross-references (`replaces`, `original`, `see`, `ref`…). The same identity repeated is the same docket.
- **Pages.** A page with no identity continues the previous docket when it says so (`continued`, `Page 2 of N`) or has no header of its own; a repeated identity on the
  next page joins it. A page with its own heading and header fields but no number is a new docket (`UNREAD`, review). One file may hold one docket over several
  pages, several dockets on a page, or several dockets over several pages. A merged docket records `pages-A-to-B` as its source.

## Fields kept distinct
- **Work date** — a labelled work/service/shift/delivery date, then the resource rows, then a single unlabelled date. Never a sign-off, print, issue, invoice or due date;
  never the file name; **never today**. Unknown stays blank (`work_date = ''`), is listed in every month with "Date not read", and the docket cannot be approved until dated.
  Row dates without a year take the year of the sign-off (the nearest date on or before it) and are flagged for review.
- **Sign-off date**, **job / booking reference** and **contract reference** are stored in `links` (`signOffDate`, `jobReference`, `contractReference`). They are not the
  docket number, the PO or the project link (`jobId`).
- **PO / WOL** is only an explicit purchase/work order. Absent PO, rates and amounts stay unknown (`rate`/`amount` null, `valueSource: "unpriced"`); an unpriced row posts no cost.

## Resource rows
`Role : Name  [date]  start  finish  break  travel  allowance  total` (columns follow the printed header). Each labour row is a line item; **labour hours are the sum
of the row totals** (three 10-hour rows = 30). Travel is a separate `travel` line and never added to labour hours. Plant/vehicle lines (`Ute: REGO`) fill the vehicle field.

## Digital text vs understanding
- A PDF page with readable embedded text is read directly. Fields that were not understood send the docket to **review**; they never trigger OCR.
- OCR runs only for pages with no usable text layer (scans, photos). Alternate OCR passes are merged and conflict-checked as before.
- Fields inferred by layout (client/project split from the header line, year from the sign-off) keep the docket in review.

## After upload
The upload dialog shows **Review uploaded dockets**: the records actually created (as returned by the server), each with a Review button; files that failed stay listed with
**Retry**. Reprocess / Re-read open a draft only; saved records change only when the user saves.

Mixed PDFs: a PDF with readable printed labels but scanned or handwritten values is read as digital text first (values missing, review). Tick **Run OCR** on the file in
the upload dialog, or use **Run OCR (local)** in the review dialog, to run the local OCR on every page. The choice is stored (`extraction_method = local-ocr:run`) and **Reprocess**
keeps honouring it. The PDF's own text is kept beside the OCR result in a comparison panel and is never applied to the record. No other OCR engine or paid service is used.

## Grouping rules (review round 2)
- **One identity rule everywhere.** `acceptableIdentity` is used for the labelled number, the stacked form (`Docket number:` with the value on the next line), the run-sheet/reference
  fallback and the file-name fallback: a value with a digit, not a date or time (`07:00`, `07.00`, `01/10/2026`), and not labelled physical/paper/booking/contract/job/order, `replaces`,
  `original`, `see`, `ref`. Heading-then-number is not an identity.
- **Identical pages** are not added twice (a warning is kept); resource rows already read on an earlier page are not added again.
- **Same number, different supplier** (ABN, else the first plain line) are separate dockets, both flagged. **Same number with no supplier or continuation evidence** (`continued`,
  `Page 2 of N`) is ambiguous: kept as separate records, both flagged for review.
- **Headers.** Each docket on a page keeps the client/project/date lines printed directly above its own number (header-first pages) or below it (identity-first pages). A header shared by
  the whole page is inherited only for fields a docket lacks, marked `[inherited from page header: …]`, and the record is reviewed.
- **Provenance.** A merged docket records every page (`pages-1+2`), joins raw text under `[page N]` markers and keeps every warning from every page and every OCR pass.
- **Resource columns.** `First Break`, `Unpaid Break`, `Travel Time`, `Total Hours` are single columns. Columns are used only when the header is recognised and matches the number of values;
  otherwise the printed last value is kept as the total, break/travel are not inferred, and the table is flagged. A printed total that disagrees with start/finish minus break is kept and flagged.

## Saving and approval
- `PUT /api/dockets` locks the docket row in a transaction and rejects (409) a save whose `expectedUpdatedAt` is not the current version, so a stale editor cannot overwrite corrections or
  undo an approval. `GET /api/dockets?id=` returns the current record (own organisation only); the review dialog and the upload list always load it from there.
- A work date is required for **ready** and **approved** on create (`POST`, whole batch rejected before anything is written), update (`PUT`) and in the cost seam. Rejections write nothing.
