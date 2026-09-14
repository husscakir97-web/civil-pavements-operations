// CLAUDE.md §10: "Tenancy isolation — two orgs cannot see each other's data."
//
// Three layers:
//   1. schema     every table carries organisation_id and an index led by it (§8)
//   2. actor      requireActor fails closed for a foreign organisation (§5.4)
//   3. queries    org-scoped helpers return only the caller's rows

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { actorRequest, createTestDb, seedOrganisation } from './helpers/d1.mjs';
import { createWorkerLoader } from './helpers/load-ts.mjs';

const ORG_A = 'roadworx-sydney'; // DEFAULT_ORGANISATION_ID
const ORG_B = 'second-contractor';

/** `organisations` is the tenant table itself, so it has no organisation_id. */
const EXEMPT_TABLES = new Set(['organisations']);

describe('schema tenancy (CLAUDE.md §8)', () => {
  const { sqlite } = createTestDb();
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name)
    .filter((name) => !EXEMPT_TABLES.has(name));

  it('applies every committed migration cleanly', () => {
    assert.ok(tables.length > 20, `expected the full schema, got ${tables.length} tables`);
  });

  it('gives every table an organisation_id', () => {
    const missing = tables.filter(
      (table) => !sqlite.prepare('SELECT name FROM pragma_table_info(?)').all(table).some((c) => c.name === 'organisation_id'),
    );
    assert.deepEqual(
      missing,
      [],
      `These tables have no organisation_id and leak across tenants (CLAUDE.md §5.3, §8):\n  ${missing.join('\n  ')}`,
    );
  });

  it('gives every table an index led by organisation_id', () => {
    const missing = tables.filter((table) => {
      const indexes = sqlite.prepare('SELECT name FROM pragma_index_list(?)').all(table);
      return !indexes.some((index) =>
        sqlite
          .prepare('SELECT seqno, name FROM pragma_index_info(?)')
          .all(index.name)
          .some((column) => column.seqno === 0 && column.name === 'organisation_id'),
      );
    });
    assert.deepEqual(
      missing,
      [],
      `These tables index nothing by organisation_id, so every tenant query is a scan (CLAUDE.md §8):\n  ${missing.join('\n  ')}`,
    );
  });
});

describe('requireActor (CLAUDE.md §5.4)', () => {
  let requireActor;
  let db;
  let sqlite;
  let ownerA;
  let memberB;

  before(() => {
    ({ sqlite, db } = createTestDb());
    ownerA = seedOrganisation(sqlite, { id: ORG_A, userId: 'user-a', email: 'a@example.test' });
    memberB = seedOrganisation(sqlite, { id: ORG_B, userId: 'user-b', email: 'b@example.test' });
    ({ requireActor } = createWorkerLoader({ DB: db })('lib/authz'));
  });

  it('rejects an unauthenticated request', async () => {
    await assert.rejects(
      () => requireActor(new Request('https://test.invalid/api/test'), db),
      (error) => error.status === 401,
    );
  });

  it('fails closed for an organisation other than the default when the path is not scoped', async () => {
    await assert.rejects(
      () => requireActor(actorRequest(memberB), db),
      (error) => error.status === 403,
      'A second organisation must not reach legacy, unparameterised query helpers',
    );
  });

  it('admits the same actor once the caller declares the path organisation-scoped', async () => {
    const actor = await requireActor(actorRequest(memberB), db, 'read', true);
    assert.equal(actor.organisationId, ORG_B);
  });

  it('never widens an actor beyond their own organisation', async () => {
    const a = await requireActor(actorRequest(ownerA), db, 'read', true);
    const b = await requireActor(actorRequest(memberB), db, 'read', true);
    assert.equal(a.organisationId, ORG_A);
    assert.equal(b.organisationId, ORG_B);
    assert.notEqual(a.organisationId, b.organisationId);
  });

  it('refuses an identity with no membership', async () => {
    await assert.rejects(
      () => requireActor(actorRequest({ userId: 'nobody', email: 'nobody@example.test' }), db, 'read', true),
      (error) => error.status === 403,
    );
  });
});

describe('org-scoped queries', () => {
  let db;
  let sqlite;
  let preparation;
  let preparationDb;

  before(() => {
    ({ sqlite, db } = createTestDb());
    seedOrganisation(sqlite, { id: ORG_A, userId: 'user-a', email: 'a@example.test' });
    seedOrganisation(sqlite, { id: ORG_B, userId: 'user-b', email: 'b@example.test' });

    const load = createWorkerLoader({ DB: db });
    preparation = load('lib/preparation');
    preparationDb = load('lib/preparation-db');

    for (const [org, title] of [
      [ORG_A, 'Org A project pack'],
      [ORG_B, 'Org B project pack'],
    ]) {
      sqlite
        .prepare(
          'INSERT INTO preparation_revisions (id,organisation_id,revision,kind,title,status,job_id,opportunity_id,data,actor_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          `pack-${org}`,
          org,
          1,
          'project-pack',
          title,
          'Draft',
          'job-1',
          null,
          JSON.stringify(preparation.blankData()),
          'seed',
          'created',
          new Date().toISOString(),
        );
    }
  });

  it('returns only the caller organisation rows', async () => {
    const a = await preparationDb.preparationRecords(db, ORG_A);
    const b = await preparationDb.preparationRecords(db, ORG_B);

    assert.deepEqual(a.map((r) => r.title), ['Org A project pack']);
    assert.deepEqual(b.map((r) => r.title), ['Org B project pack']);
    assert.ok(a.every((r) => r.organisation_id === ORG_A));
    assert.ok(b.every((r) => r.organisation_id === ORG_B));
  });

  it('does not leak another organisation readiness through a shared job id', async () => {
    // Both organisations used the same job id. Readiness must still be per-tenant.
    const a = await preparationDb.preparationReadiness(db, ORG_A, 'job-1');
    const b = await preparationDb.preparationReadiness(db, ORG_B, 'job-1');
    assert.ok(Array.isArray(a) && a.length > 0, 'org A has an unapproved pack, so it must report blockers');
    assert.ok(Array.isArray(b) && b.length > 0, 'org B has an unapproved pack, so it must report blockers');
    assert.ok(a.every((issue) => !issue.includes('Org B')));
    assert.ok(b.every((issue) => !issue.includes('Org A')));
  });

  it('reports no readiness at all for an organisation with no records', async () => {
    assert.equal(await preparationDb.preparationReadiness(db, 'third-contractor', 'job-1'), null);
  });
});
