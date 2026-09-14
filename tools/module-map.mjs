// Single source of truth for CLAUDE.md §3 "The boundary rule".
//
// Every source file under an enforced root belongs to exactly one owner:
//
//   platform  shared foundation. Importable by anyone. May only import platform.
//   shell     the composition root that assembles module workspaces into the app.
//             May import anything. Nothing may import the shell.
//   <module>  one of MODULES. May import platform and its own module only.
//
// Both the ESLint rule (tools/eslint-plugin-module-boundaries.mjs) and the
// boundary test (tests/module-boundaries.test.mjs) resolve ownership through
// this file so they can never disagree.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const PLATFORM = 'platform';
export const SHELL = 'shell';

/** CLAUDE.md §3 "Module list". */
export const MODULES = [
  'tenders',
  'estimates',
  'dockets',
  'commercial',
  'field',
  'ims',
  'preparation',
  'delivery',
  'invoices',
  'job-hub',
  'reports',
  'opportunities',
];

/** Directories the rule is enforced over. Everything else is tooling or vendored. */
export const ENFORCED_ROOTS = ['app/', 'components/', 'lib/', 'db/', 'hooks/'];
export const ENFORCED_FILES = ['middleware.ts'];

/**
 * Files whose owner cannot be derived from their path.
 *
 * `lib/estimates-db.ts` is deliberately platform, not `estimates`: it contains
 * only the D1 binding accessor and generic JSON/text/error helpers, with no
 * estimating logic, and `lib/authz.ts` (platform per CLAUDE.md §3) already
 * depends on it. It is misnamed, not mis-layered — it belongs at
 * `lib/platform/db.ts`. Renaming it is a separate task (CLAUDE.md §4, §9).
 */
const FILE_OWNERS = {
  // ---- platform -----------------------------------------------------------
  'middleware.ts': PLATFORM,
  'lib/utils.ts': PLATFORM,
  'lib/authz.ts': PLATFORM,
  'lib/estimates-db.ts': PLATFORM,
  'lib/workspace-brand.ts': PLATFORM,
  'components/workspace-brand.tsx': PLATFORM,
  'components/universal-search.tsx': PLATFORM,
  // AI orchestration is a platform concern (CLAUDE.md §4).
  'components/paid-ai-scan.tsx': PLATFORM,

  // ---- shell --------------------------------------------------------------
  'app/page.tsx': SHELL,
  'app/layout.tsx': SHELL,
  'app/pavement-os.tsx': SHELL,
  'app/chatgpt-auth.ts': SHELL,
  'components/operations-workspace.tsx': SHELL,

  // ---- modules: lib -------------------------------------------------------
  'lib/commercial-links.ts': 'commercial',
  'lib/docket-parser.ts': 'dockets',
  'lib/dockets-db.ts': 'dockets',
  'lib/estimate-calculations.ts': 'estimates',
  'lib/field.ts': 'field',
  'lib/ims-pack.ts': 'ims',
  'lib/ims-readiness.ts': 'ims',
  'lib/invoice-parser.ts': 'invoices',
  'lib/planning.ts': 'delivery',
  'lib/preparation.ts': 'preparation',
  'lib/preparation-db.ts': 'preparation',
  'lib/preparation-export.ts': 'preparation',
  'lib/reporting.ts': 'reports',
  'lib/tender.ts': 'tenders',
  'lib/tender-db.ts': 'tenders',
  'lib/tender-reader.ts': 'tenders',

  // ---- modules: workspace components --------------------------------------
  'components/commercial-workspace.tsx': 'commercial',
  'components/docket-dashboard.tsx': 'dockets',
  'components/estimates-quotes.tsx': 'estimates',
  'components/field-preparation.tsx': 'field',
  'components/field-workspace.tsx': 'field',
  'components/ims-workspace.tsx': 'ims',
  'components/invoice-scanner.tsx': 'invoices',
  'components/job-hub.tsx': 'job-hub',
  'components/jobs-planning.tsx': 'delivery',
  'components/live-report.tsx': 'reports',
  'components/preparation-workspace.tsx': 'preparation',
  'components/tender-review-assistant.tsx': 'tenders',
};

/** Longest prefix wins, so `lib/platform/` beats nothing and `app/api/<module>/` is exact. */
const PREFIX_OWNERS = [
  ['components/ui/', PLATFORM], // vendored shadcn
  ['hooks/', PLATFORM],
  ['db/', PLATFORM],
  ['lib/platform/', PLATFORM],
  ['app/api/ai-scans/', PLATFORM], // AI orchestration
  ['app/api/search/', PLATFORM],
  ['app/api/workspace/', PLATFORM],
  ['app/api/os/', PLATFORM],
  ...MODULES.map((m) => [`app/api/${m}/`, m]),
  ...MODULES.map((m) => [`lib/modules/${m}/`, m]),
].sort((a, b) => b[0].length - a[0].length);

const BASELINE_PATH = path.join(ROOT, 'tools', 'module-boundary-baseline.json');

/**
 * Cross-module imports that predate this rule. Ratchet, not amnesty: nothing may
 * be added here, and the boundary test fails if an entry becomes stale so the
 * list can only shrink. Each entry names the seam the import is standing in for
 * (CLAUDE.md §6).
 */
export const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Repo-relative POSIX path for an absolute path. */
export function relativeToRoot(absolutePath) {
  return toPosix(path.relative(ROOT, absolutePath));
}

export function isEnforced(repoRelativePath) {
  if (!/\.(ts|tsx)$/.test(repoRelativePath)) return false;
  if (ENFORCED_FILES.includes(repoRelativePath)) return true;
  return ENFORCED_ROOTS.some((root) => repoRelativePath.startsWith(root));
}

/** @returns {string|null} owner id, or null when the file has no assignment. */
export function ownerOf(repoRelativePath) {
  const file = repoRelativePath.replace(/^\.\//, '');
  if (FILE_OWNERS[file]) return FILE_OWNERS[file];
  // Tolerate an extensionless path so import specifiers resolve the same way.
  for (const ext of ['.ts', '.tsx']) {
    if (FILE_OWNERS[file + ext]) return FILE_OWNERS[file + ext];
  }
  for (const [prefix, owner] of PREFIX_OWNERS) {
    if (file.startsWith(prefix)) return owner;
  }
  return null;
}

/**
 * Resolve an import specifier to a repo-relative path.
 * @returns {string|null} null for bare package specifiers and `cloudflare:*`.
 */
export function resolveSpecifier(fromRepoRelativePath, specifier) {
  let target;
  if (specifier.startsWith('@/')) {
    target = specifier.slice(2);
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = toPosix(path.posix.join(path.posix.dirname(toPosix(fromRepoRelativePath)), specifier));
  } else {
    return null; // npm package, node: builtin, cloudflare:workers
  }
  target = target.replace(/^\.\//, '');
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    const absolute = path.join(ROOT, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
  }
  return target;
}

export function isAllowed(fromOwner, toOwner) {
  if (toOwner === PLATFORM) return true; // platform is importable by anyone
  if (fromOwner === SHELL) return true; // the shell composes every module
  return fromOwner === toOwner;
}

export function baselineKey(fromRepoRelativePath, toOwner) {
  return `${fromRepoRelativePath} -> ${toOwner}`;
}

const IMPORT_PATTERN =
  /(?:^|[\s;}])(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]|(?:^|[^.\w])require\s*\(\s*['"]([^'"]+)['"]|(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;

function listSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      listSourceFiles(absolute, out);
    } else if (isEnforced(relativeToRoot(absolute))) {
      out.push(relativeToRoot(absolute));
    }
  }
  return out;
}

/** Every enforced source file in the repo, sorted. */
export function enforcedSourceFiles() {
  const files = [];
  for (const root of ENFORCED_ROOTS) {
    const absolute = path.join(ROOT, root);
    if (existsSync(absolute)) listSourceFiles(absolute, files);
  }
  for (const file of ENFORCED_FILES) {
    if (existsSync(path.join(ROOT, file))) files.push(file);
  }
  return files.sort();
}

/**
 * Text scan of the whole import graph. The ESLint rule walks the AST for the
 * file it is given; this gives the boundary test a repo-wide view so it can
 * prove the baseline holds no stale entries.
 */
export function scanImports() {
  const edges = [];
  for (const file of enforcedSourceFiles()) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!specifier) continue;
      const resolved = resolveSpecifier(file, specifier);
      if (!resolved) continue;
      edges.push({ file, specifier, resolved });
    }
  }
  return edges;
}

/** Boundary violations across the whole repo, baseline included. */
export function findViolations() {
  const violations = [];
  for (const edge of scanImports()) {
    const from = ownerOf(edge.file);
    const to = ownerOf(edge.resolved);
    if (!from || !to) continue; // unassigned files are reported separately
    if (isAllowed(from, to)) continue;
    violations.push({ ...edge, from, to, key: baselineKey(edge.file, to) });
  }
  return violations;
}
