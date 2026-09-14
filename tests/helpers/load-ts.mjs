// Loads the app's TypeScript modules into the test process without a build
// step: transpile to CommonJS, evaluate, and resolve `@/*` and relative
// specifiers the same way the bundler does. Worker-only imports
// (`cloudflare:workers`) are supplied as stubs by the caller.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

import { ROOT } from '../../tools/module-map.mjs';

const nodeRequire = createRequire(import.meta.url);

function resolveFile(candidatePath) {
  const candidates = [
    candidatePath,
    `${candidatePath}.ts`,
    `${candidatePath}.tsx`,
    path.join(candidatePath, 'index.ts'),
    path.join(candidatePath, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve ${candidatePath} from the repository`);
}

/**
 * @param {Record<string, unknown>} stubs modules to substitute, keyed by specifier.
 * @returns {(repoRelativePath: string) => any} loader, cached per instance.
 */
export function createLoader(stubs = {}) {
  const cache = new Map();

  function load(target) {
    const absolute = resolveFile(path.resolve(ROOT, target));
    if (cache.has(absolute)) return cache.get(absolute).exports;

    const module = { exports: {} };
    cache.set(absolute, module);

    const { outputText } = ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: absolute,
    });

    const require = (specifier) => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      if (specifier.startsWith('@/')) return load(specifier.slice(2));
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(absolute), specifier));
      return nodeRequire(specifier);
    };

    // Deliberate: evaluating the transpiled module is what this loader is for.
    new Function('require', 'module', 'exports', '__filename', '__dirname', outputText)(
      require,
      module,
      module.exports,
      absolute,
      path.dirname(absolute),
    );
    return module.exports;
  }

  return load;
}

/** Convenience: a loader with `cloudflare:workers` bound to the given test bindings. */
export function createWorkerLoader(bindings) {
  return createLoader({ 'cloudflare:workers': { env: bindings } });
}
