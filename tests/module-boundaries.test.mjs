// CLAUDE.md §10: "Module boundaries — a lint rule failing the build on
// cross-module imports."
//
// `pnpm lint` is the gate that fails the build. This suite guards the rule
// itself: that every source file is classified, that the resolution logic is
// right, and that the grandfathered baseline can only shrink.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BASELINE,
  MODULES,
  PLATFORM,
  SHELL,
  baselineKey,
  enforcedSourceFiles,
  findViolations,
  isAllowed,
  isEnforced,
  ownerOf,
  resolveSpecifier,
} from '../tools/module-map.mjs';

const OWNERS = new Set([PLATFORM, SHELL, ...MODULES]);

describe('module ownership', () => {
  it('assigns every enforced source file to exactly one owner', () => {
    const unassigned = enforcedSourceFiles().filter((file) => !ownerOf(file));
    assert.deepEqual(
      unassigned,
      [],
      `These files have no module assignment. Add them to tools/module-map.mjs:\n  ${unassigned.join('\n  ')}`,
    );
  });

  it('only ever assigns a known owner', () => {
    for (const file of enforcedSourceFiles()) {
      assert.ok(OWNERS.has(ownerOf(file)), `${file} is owned by an unknown owner '${ownerOf(file)}'`);
    }
  });

  it('scopes enforcement to app, components, lib, db, hooks and middleware', () => {
    assert.equal(isEnforced('lib/dockets-db.ts'), true);
    assert.equal(isEnforced('middleware.ts'), true);
    assert.equal(isEnforced('components/docket-dashboard.tsx'), true);
    assert.equal(isEnforced('scripts/test-field.cjs'), false);
    assert.equal(isEnforced('tools/module-map.mjs'), false);
    assert.equal(isEnforced('vendor/anything.ts'), false);
  });
});

describe('import resolution', () => {
  it('resolves the @/ alias to a repo-relative file', () => {
    assert.equal(resolveSpecifier('app/api/field/route.ts', '@/lib/planning'), 'lib/planning.ts');
    assert.equal(
      resolveSpecifier('app/api/dockets/extract/route.ts', '@/app/api/ai-scans/route'),
      'app/api/ai-scans/route.ts',
    );
  });

  it('resolves relative specifiers against the importing file', () => {
    assert.equal(resolveSpecifier('lib/field.ts', './planning'), 'lib/planning.ts');
    assert.equal(resolveSpecifier('lib/ims-readiness.ts', './preparation-db'), 'lib/preparation-db.ts');
  });

  it('ignores bare and protocol specifiers', () => {
    for (const specifier of ['zod', 'react', 'node:crypto', 'cloudflare:workers', 'drizzle-orm/sqlite-core']) {
      assert.equal(resolveSpecifier('lib/field.ts', specifier), null, `${specifier} should be ignored`);
    }
  });
});

describe('the boundary rule', () => {
  it('lets anyone import platform', () => {
    assert.equal(isAllowed('dockets', PLATFORM), true);
    assert.equal(isAllowed(SHELL, PLATFORM), true);
    assert.equal(isAllowed(PLATFORM, PLATFORM), true);
  });

  it('lets a module import itself', () => {
    assert.equal(isAllowed('preparation', 'preparation'), true);
  });

  it('forbids a module importing another module', () => {
    assert.equal(isAllowed('dockets', 'commercial'), false);
    assert.equal(isAllowed('tenders', 'estimates'), false);
  });

  it('forbids platform depending back on a module', () => {
    assert.equal(isAllowed(PLATFORM, 'delivery'), false);
  });

  it('forbids a module reaching back into the shell', () => {
    assert.equal(isAllowed('field', SHELL), false);
  });

  it('lets the shell compose every module', () => {
    for (const module of MODULES) assert.equal(isAllowed(SHELL, module), true);
  });
});

describe('the grandfathered baseline', () => {
  const violations = findViolations();

  it('covers every cross-module import that exists today', () => {
    const unlisted = [...new Set(violations.filter((v) => !(v.key in BASELINE)).map((v) => v.key))].sort();
    assert.deepEqual(
      unlisted,
      [],
      'New cross-module imports were introduced. Build these as seams (CLAUDE.md §6) rather than adding them to ' +
        `tools/module-boundary-baseline.json:\n  ${unlisted.join('\n  ')}`,
    );
  });

  it('holds no stale entries, so the list can only shrink', () => {
    const live = new Set(violations.map((v) => v.key));
    const stale = Object.keys(BASELINE).filter((key) => !live.has(key)).sort();
    assert.deepEqual(
      stale,
      [],
      'These boundary violations are fixed. Delete them from tools/module-boundary-baseline.json:\n  ' +
        stale.join('\n  '),
    );
  });

  it('names the seam each entry stands in for', () => {
    for (const [key, reason] of Object.entries(BASELINE)) {
      assert.ok(typeof reason === 'string' && reason.length > 20, `${key} needs a reason explaining the seam`);
    }
  });

  it('keys entries as "<file> -> <owner>"', () => {
    for (const key of Object.keys(BASELINE)) {
      const [file, owner] = key.split(' -> ');
      assert.ok(isEnforced(file), `${key}: '${file}' is not an enforced source file`);
      assert.ok(OWNERS.has(owner), `${key}: '${owner}' is not a known owner`);
      assert.equal(baselineKey(file, owner), key);
    }
  });
});
