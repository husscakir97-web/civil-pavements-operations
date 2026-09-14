// CLAUDE.md §10: "AI governance — no AI-authored record can reach an approved
// status without a human action in the audit log."
//
// Covers the three §7 rules against the code that exists today:
//   §7.1 AI writes drafts only
//   §7.2 every AI output is source-linked
//   §7.3 deterministic stays deterministic
//
// Where enforcement does not exist yet the gap is a `todo`, not a silent pass.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { createTestDb, seedOrganisation } from './helpers/d1.mjs';
import { createWorkerLoader } from './helpers/load-ts.mjs';

const ORG = 'roadworx-sydney';

/** Statuses a human action must be responsible for. */
const HUMAN_ONLY_STATUSES = ['Approved', 'Issued', 'Submitted', 'Accepted', 'approved', 'invoiced'];

describe('§7.1 AI writes drafts only', () => {
  let preparation;
  let dockets;

  before(() => {
    const { db } = createTestDb();
    const load = createWorkerLoader({ DB: db, BUCKET: {} });
    preparation = load('lib/preparation');
    dockets = load('lib/dockets-db');
  });

  it('defaults an extracted requirement row to Draft', () => {
    const row = preparation.blankRow('Describe your environmental controls.');
    assert.equal(row.status, 'Draft');
  });

  it('refuses a status outside the reviewed set, so a model cannot invent one', () => {
    for (const status of ['Auto-approved', 'AI approved', 'Signed', '']) {
      assert.throws(
        () => preparation.rowSchema.parse({ id: 'r1', status }),
        `row status '${status}' must be rejected`,
      );
    }
  });

  it('marks every extracted requirement as needing human confirmation', () => {
    const rows = preparation.extractQuestions([
      {
        fileId: 'file-1',
        ref: 'page 3',
        text: 'Describe your traffic management approach.\nProvide a WHS management plan.',
        method: 'ocr',
        confidence: 82,
      },
    ]);
    assert.ok(rows.length >= 2, 'the fixture should yield extracted requirements');
    assert.ok(rows.every((row) => row.uncertain), 'extracted rows must start uncertain');
    assert.ok(rows.every((row) => row.status === 'Draft'), 'extracted rows must start as drafts');
  });

  it('blocks approval of a record whose rows are still unconfirmed', () => {
    const record = draftRecord(preparation, {
      rows: [
        preparation.rowSchema.parse({
          id: 'r1',
          question: 'Describe your environmental controls.',
          answer: 'Drafted by extraction.',
          owner: 'user-a',
          due: '2999-01-01',
          status: 'Approved',
          uncertain: true,
        }),
      ],
    });
    const issues = preparation.recordIssues(record, () => undefined);
    assert.ok(
      issues.some((issue) => /requires confirmation/i.test(issue)),
      `expected an unconfirmed-source issue, got: ${issues.join(' | ')}`,
    );
  });

  it('blocks approval when linked evidence is itself unapproved', () => {
    const evidence = draftRecord(preparation, { id: 'ev-1', title: 'Company WHS plan', status: 'Draft' });
    const record = draftRecord(preparation, { evidence: [{ id: 'ev-1', revision: 1 }] });
    const issues = preparation.recordIssues(record, (ref) => (ref.id === 'ev-1' ? evidence : undefined));
    assert.ok(
      issues.some((issue) => /evidence revision is not approved/i.test(issue)),
      `expected an unapproved-evidence issue, got: ${issues.join(' | ')}`,
    );
  });

  it('coerces an unrecognised extracted docket status to review, never to an approved state', () => {
    for (const status of ['AI approved', 'auto', '', null, undefined, 'issued']) {
      assert.equal(dockets.cleanStatus(status), 'review', `'${status}' must fall back to review`);
    }
  });

  it.todo(
    'rejects an AI-authored record written directly at an approved status — no code-level guard exists yet ' +
      '(CLAUDE.md §7.1). dockets.cleanStatus still accepts "approved" straight from an extraction payload, and ' +
      'preparation record status is an unconstrained string. Needs the AI-write guard task.',
  );
});

describe('§7.2 every AI output is source-linked', () => {
  let parseDocket;

  before(() => {
    ({ parseDocket } = createWorkerLoader({})('lib/docket-parser'));
  });

  const complete =
    'Docket No: ABC-1234\nDate: 09/09/2026\nClient: Example Civil\nJob Location: Test Road\nQuantity: 18.4 tonnes';

  it('records the source document, location and confidence on every extraction', () => {
    const record = parseDocket(complete, 'scan.pdf', 91, {
      pageNumber: 2,
      pageCount: 4,
      sectionNumber: 1,
      sectionCount: 2,
    });
    assert.equal(record.sourceName, 'scan.pdf');
    assert.equal(record.sourcePage, 2);
    assert.equal(record.sourceCrop, 'section-1-of-2');
    // Confidence is derived from the OCR score and field completeness, not copied through.
    assert.ok(Number.isFinite(record.confidence) && record.confidence > 0 && record.confidence <= 100);
    assert.ok(record.fieldConfidence && Object.keys(record.fieldConfidence).length > 0, 'per-field confidence required');
    assert.ok('docketNo' in record.fieldConfidence, 'confidence must be recorded per field, not just per document');
    assert.ok(record.rawText.length > 0, 'the extracted text must be retained for audit');
  });

  it('never produces an approved or issued record from extraction alone', () => {
    for (const [text, file] of [
      [complete, 'scan.pdf'],
      ['No readable docket text', 'IMG_5590.jpg'],
      ['Docket No: X1\nDate: 10/09/2026\nClient: C', 'scan.png'],
    ]) {
      const { status } = parseDocket(text, file, 99);
      assert.ok(
        !HUMAN_ONLY_STATUSES.includes(status),
        `extraction of ${file} produced '${status}', which requires a human action`,
      );
    }
  });

  it('holds an unreadable scan for review rather than guessing', () => {
    const record = parseDocket('No readable docket text', 'IMG_5590.jpg', 95);
    assert.equal(record.docketNo, 'UNREAD');
    assert.equal(record.status, 'review');
  });
});

describe('§7.3 deterministic stays deterministic', () => {
  let preparation;
  let db;
  let sqlite;
  let appendStatements;

  before(() => {
    ({ sqlite, db } = createTestDb());
    seedOrganisation(sqlite, { id: ORG, userId: 'user-a', email: 'a@example.test' });
    const load = createWorkerLoader({ DB: db });
    preparation = load('lib/preparation');
    ({ appendStatements } = load('lib/preparation-db'));
  });

  it('writes an audit event naming the human actor for every revision', async () => {
    const record = draftRecord(preparation, { id: 'pack-1', revision: 1, actor_id: 'user-a', reason: 'created' });
    await db.batch(appendStatements(db, record));

    const events = sqlite
      .prepare('SELECT name, metadata FROM audit_events WHERE organisation_id=?')
      .all(ORG);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, 'preparation.created');
    assert.equal(JSON.parse(events[0].metadata).actorId, 'user-a');
  });

  it('records an approval as a new immutable revision with its own audit event', async () => {
    const approved = draftRecord(preparation, {
      id: 'pack-1',
      revision: 2,
      status: 'Approved',
      actor_id: 'user-a',
      reason: 'approved',
    });
    await db.batch(appendStatements(db, approved));

    const revisions = sqlite
      .prepare('SELECT revision, status FROM preparation_revisions WHERE organisation_id=? AND id=? ORDER BY revision')
      .all(ORG, 'pack-1')
      .map((row) => ({ revision: Number(row.revision), status: String(row.status) }));
    assert.deepEqual(revisions, [
      { revision: 1, status: 'Draft' },
      { revision: 2, status: 'Approved' },
    ]);

    const approval = sqlite
      .prepare("SELECT metadata FROM audit_events WHERE organisation_id=? AND name='preparation.approved'")
      .get(ORG);
    assert.ok(approval, 'an approval must leave an audit event');
    const metadata = JSON.parse(approval.metadata);
    assert.equal(metadata.actorId, 'user-a');
    assert.equal(metadata.status, 'Approved');
    assert.equal(metadata.revision, 2);
  });

  it('refuses to overwrite an existing revision', async () => {
    const duplicate = draftRecord(preparation, { id: 'pack-1', revision: 2, actor_id: 'user-a', reason: 'approved' });
    await assert.rejects(() => db.batch(appendStatements(db, duplicate)), /UNIQUE constraint/);
  });
});

/** A minimal, schema-valid preparation record. */
function draftRecord(preparation, overrides = {}) {
  const { rows, evidence, ...rest } = overrides;
  return {
    id: 'record-1',
    organisation_id: ORG,
    revision: 1,
    kind: 'project-pack',
    title: 'Pre-commencement pack',
    status: 'Draft',
    job_id: null,
    opportunity_id: null,
    data: preparation.dataSchema.parse({ rows: rows ?? [], evidence: evidence ?? [] }),
    actor_id: 'user-a',
    reason: 'created',
    created_at: '2026-09-14T00:00:00.000Z',
    ...rest,
  };
}
