// TEST-ONLY preload for scripts/test-security-audit.mjs. Never loaded by the production gate: it only runs when a test
// launches `node --require scripts/fixtures/fake-npm-preload.cjs scripts/security-audit.mjs`.
// It replaces child_process.spawnSync so `npm audit` returns the controlled response in FAKE_NPM_SCENARIO. Node reads this
// file as data, so it works where the temp directory is mounted noexec (the isolated automation sandbox).
// Any call other than `npm audit --json [--omit=dev]` throws, so an unintended real command can never slip through.
'use strict';
const cp = process.getBuiltinModule('node:child_process');
const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
const scenario = JSON.parse(process.env.FAKE_NPM_SCENARIO || '{}');
const missing = process.env.FAKE_NPM_MISSING === '1';
const real = cp.spawnSync;
cp.spawnSync = function fakeSpawnSync(command, args = [], options = {}) {
  if (command !== 'npm') return real.call(cp, command, args, options);
  if (!Array.isArray(args) || args[0] !== 'audit' || !args.includes('--json')) throw new Error('fake npm: unexpected arguments ' + JSON.stringify(args));
  // What Node returns when the executable cannot be found or launched.
  if (missing) return { pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error: Object.assign(new Error('spawnSync npm ENOENT'), { code: 'ENOENT', errno: -2, syscall: 'spawnSync npm', path: 'npm' }) };
  const c = scenario[args.includes('--omit=dev') ? 'prod' : 'full'];
  if (!c) throw new Error('fake npm: no scenario for this scan');
  // Killed by a signal: status is null and the signal is set (same shape as the real process).
  if (c.crash) return { pid: 1, output: null, stdout: '', stderr: '', status: null, signal: 'SIGKILL' };
  const stdout = c.stdout ?? '', stderr = c.stderr ?? '';
  return { pid: 1, output: [null, stdout, stderr], stdout, stderr, status: c.exit ?? 0, signal: null };
};
// security-audit.mjs uses a named ESM import; live bindings of builtins must be refreshed after patching the CJS exports.
syncBuiltinESMExports();
