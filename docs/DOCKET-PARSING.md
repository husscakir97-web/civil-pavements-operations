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

Known limit: a PDF that has a text layer of printed labels but handwritten values is read as digital text (all values missing, review). Use Reprocess on a scan, or the
separate paid AI scan, for those.
