// In-memory D1 for tests: a real SQLite database built from the committed
// migrations, wrapped in the subset of the D1Database surface this codebase
// uses. Same approach as the existing scripts/test-*.cjs, extracted so every
// suite shares one harness.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ROOT } from '../../tools/module-map.mjs';

const MIGRATIONS = path.join(ROOT, 'drizzle');

/** Migration files in apply order. Names are `NNNN_*` then `YYYYMMDD...`, so lexical order is apply order. */
export function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function d1(sqlite) {
  return {
    prepare(query) {
      let values = [];
      const statement = {
        bind(...bound) {
          values = bound;
          return statement;
        },
        async first() {
          return sqlite.prepare(query).get(...values) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(query).all(...values), success: true };
        },
        async run() {
          const result = sqlite.prepare(query).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/**
 * @returns {{sqlite: DatabaseSync, db: object}} `sqlite` for direct schema
 * inspection and seeding, `db` for code under test.
 */
export function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of migrationFiles()) {
    sqlite.exec(readFileSync(path.join(MIGRATIONS, name), 'utf8'));
  }
  return { sqlite, db: d1(sqlite) };
}

/** Seed an organisation and one member, returning the member's request headers. */
export function seedOrganisation(sqlite, { id, userId, email, role = 'Owner/Admin' }) {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO organisations (id,name,created_at) VALUES (?,?,?)')
    .run(id, id, now);
  sqlite
    .prepare('INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, id, email, email, role, now);
  return { userId, email };
}

/** A Request carrying the Sites proxy identity headers (CLAUDE.md §5.1). */
export function actorRequest({ userId, email }, url = 'https://test.invalid/api/test') {
  return new Request(url, {
    headers: { 'oai-authenticated-user-id': userId, 'oai-authenticated-user-email': email },
  });
}
