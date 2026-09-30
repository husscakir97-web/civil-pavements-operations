/* eslint @typescript-eslint/no-require-imports: "off" */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { REPO, FINISH, issueHash, validateTask, approval, gate, checkTool, collectChanges,
  dockerArgs, runChecks, publish, finish } = require('./claude-approved-task.cjs');
const task = { summary: 'Scoped correction', request: 'Fix the message', acceptance: 'Regressions pass',
  allowed_paths: ['components/example.tsx', 'scripts/test-example.cjs'] };
const body = '\x60\x60\x60json\n' + JSON.stringify(task) + '\n\x60\x60\x60';
const issue = { number: 4, title: '[claude-task] Correction', body, updated_at: '2026-09-30T10:00:00Z', state: 'open' };
const state = { number: 4, approvedHash: issueHash(issue), actor: 'husscakir97-web', task,
  base: 'a'.repeat(40), branch: 'claude/task-4-' + issueHash(issue).slice(0, 16) };
function mock() {
  const calls = [];
  let branch = null, pr = null, failPR = false;
  const api = async (method, suffix, data) => {
    calls.push({ method, suffix, data });
    if (suffix === '/issues/4') return { ...issue };
    if (suffix === '/branches/main') return { commit: { sha: state.base } };
    if (suffix === '/git/commits/' + state.base) return { tree: { sha: 'base-tree' } };
    if (suffix === '/git/trees') return { sha: 'new-tree' };
    if (suffix === '/git/commits' && method === 'POST') return { sha: 'commit' };
    if (suffix.startsWith('/git/ref/')) { if (branch) return branch; throw Object.assign(new Error('Missing'), { status: 404 }); }
    if (suffix === '/git/refs') { branch = { object: { sha: data.sha } }; return branch; }
    if (suffix === '/git/commits/commit') return { tree: { sha: 'new-tree' },
      parents: [{ sha: state.base }], message: '[claude-task] #4 ' + state.approvedHash };
    if (suffix.startsWith('/pulls?')) return pr ? [pr] : [];
    if (suffix === '/pulls' && method === 'POST') {
      if (failPR) throw new Error('Transient PR failure');
      pr = { number: 7, state: 'open', draft: true, base: { ref: 'main' },
        head: { sha: 'commit', repo: { full_name: REPO } }, html_url: 'https://github.com/' + REPO + '/pull/7' };
      return pr;
    }
    throw new Error('Unexpected route: ' + method + ' ' + suffix);
  };
  return { api, calls, setFailPR: value => { failPR = value; }, setPR: value => { pr = value; } };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'base']);
  fs.mkdirSync(path.join(root, 'components'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'components/example.tsx'), 'export default 1;');
  fs.writeFileSync(path.join(root, 'scripts/test-example.cjs'), 'module.exports = 1;');
  return { ...state, root, tracked: [] };
}
test('task accepts exact product and regression paths; rejects tooling and traversal', () => {
  assert.deepEqual(validateTask(body), task);
  for (const p of ['components/../x', '.github/automation/x.cjs', 'scripts/start.mjs',
    'scripts/test-x.cjs/evil', 'package.json', 'lib/AGENTS.md', 'app/.env.local', 'lib/x*', 'lib//x']) {
    assert.throws(() => validateTask(body.replace('components/example.tsx', p)));
  }
  assert.throws(() => validateTask(body + body));
});
test('hash binds complete task content, issue identity and edit version', () => {
  for (const update of [{ body: body + 'x' }, { title: '[claude-task] changed' }, { number: 5 }, { updated_at: 'later' }]) {
    assert.notEqual(issueHash({ ...issue, ...update }), state.approvedHash);
  }
});
test('queued or manual dispatch cannot reuse stale approval or a label', async () => {
  await approval(mock().api, 4, state.approvedHash, state.actor);
  await assert.rejects(approval(mock().api, 4, '0'.repeat(64), state.actor), /renew owner approval/);
  await assert.rejects(approval(mock().api, 4, state.approvedHash, 'collaborator'), /Owner/);
  await assert.rejects(approval(mock().api, 4, 'claude-approved', state.actor));
  await assert.rejects(approval(async () => ({ ...issue, state: 'closed' }), 4, state.approvedHash, state.actor));
});
test('gate rejects every event/ref/repository outside owner main dispatch', async () => {
  const context = { repo: { owner: 'husscakir97-web', repo: 'civil-pavements-operations' },
    eventName: 'workflow_dispatch', ref: 'refs/heads/main' };
  for (const update of [{ eventName: 'issues' }, { ref: 'refs/heads/other' },
    { repo: { owner: 'other', repo: 'civil-pavements-operations' } }]) {
    await assert.rejects(gate({ github: {}, context: { ...context, ...update }, core: {} }), /fixed repository main/);
  }
});
test('runtime hook permits exact edit and blocks publisher/config/other tools BEFORE execution', () => {
  const s = fixture();
  try {
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'components/example.tsx' } };
    checkTool(input, s);
    checkTool({ ...input, tool_name: 'Edit' }, s);
    for (const p of ['/tmp/claude-approved/state.json', '.github/automation/claude-approved-task.cjs', '../outside', 'package.json']) {
      assert.throws(() => checkTool({ ...input, tool_input: { file_path: p } }, s));
    }
    for (const tool of ['Agent', 'Task', 'Skill', 'Glob', 'Grep', 'WebFetch', 'mcp__github__create_pull_request']) {
      assert.throws(() => checkTool({ ...input, tool_name: tool }, s));
    }
    assert.throws(() => checkTool(input, s, true), /publication complete/);
    assert.throws(() => checkTool({ ...input, tool_name: 'Read', tool_input: { file_path: '/proc/self/environ' } }, s));
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
test('Bash exact command enforcement rejects suffixes, substitutions and background use', () => {
  const input = command => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  checkTool(input(FINISH), state);
  for (const cmd of [FINISH + '; env', FINISH + ' x', 'env ' + FINISH, 'npm test', FINISH + ' &']) assert.throws(() => checkTool(input(cmd), state));
  assert.throws(() => checkTool({ ...input(FINISH), tool_input: { command: FINISH, run_in_background: true } }, state));
});
test('collector accepts approved source and regression, blocks unexpected files and deletion', () => {
  const s = fixture();
  try {
    assert.equal(collectChanges(s).length, 2);
    fs.writeFileSync(path.join(s.root, 'outside.txt'), 'not allowed');
    assert.throws(() => collectChanges(s), /outside approved scope/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
test('runtime path guard rejects hardlinks', () => {
  const s = fixture();
  try {
    fs.linkSync(path.join(s.root, 'components/example.tsx'), path.join(s.root, 'components/link.tsx'));
    assert.throws(() => checkTool({ hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'components/example.tsx' } }, s), /hardlink/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
test('test failure stops publication before ANY branch/PR write', async () => {
  const s = fixture(), m = mock();
  try {
    await assert.rejects(finish(m.api, s, () => { throw new Error('regression failed'); }), /regression failed/);
    assert.equal(m.calls.filter(c => c.method === 'POST').length, 0);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
test('successful finish publishes only fixed-base draft after checks', async () => {
  const s = fixture(), m = mock(); let checked = false;
  try {
    await finish(m.api, s, () => { checked = true; });
    assert.equal(checked, true);
    const ref = m.calls.find(c => c.suffix === '/git/refs');
    assert.equal(ref.data.ref, 'refs/heads/' + state.branch);
    const pr = m.calls.find(c => c.suffix === '/pulls');
    assert.equal(pr.data.draft, true); assert.equal(pr.data.base, 'main');
    assert.match(pr.data.title, /^\[claude-task\]/);
    assert.equal(m.calls.some(c => ['PATCH', 'PUT', 'DELETE'].includes(c.method)), false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
test('branch-created / PR-failed rerun recovers without overwriting branch', async () => {
  const m = mock(); m.setFailPR(true);
  await assert.rejects(publish(m.api, state, []), /Transient/);
  m.setFailPR(false);
  await publish(m.api, state, []);
  await publish(m.api, state, []);
  assert.equal(m.calls.filter(c => c.suffix === '/git/refs').length, 1);
  assert.equal(m.calls.filter(c => c.suffix === '/pulls').length, 2);
});
test('existing branch mismatch and changed main block PR creation', async () => {
  for (const suffix of ['/branches/main', '/git/commits/commit']) {
    const m = mock();
    const api = async (method, route, data) => {
      const result = await m.api(method, route, data);
      if (route === suffix) return suffix.includes('branches') ? { commit: { sha: 'different' } } :
        { ...result, parents: [{ sha: 'different' }] };
      return result;
    };
    await assert.rejects(publish(api, state, []), /Main moved|Existing branch differs/);
    assert.equal(m.calls.some(c => c.suffix === '/pulls'), false);
  }
});
test('changed approval during publication prevents PR creation', async () => {
  const m = mock(); let reads = 0;
  const api = async (method, route, data) => {
    const result = await m.api(method, route, data);
    if (route === '/issues/4' && ++reads > 1) return { ...result, body: result.body + 'edited' };
    return result;
  };
  await assert.rejects(publish(api, state, []), /renew owner approval/);
  assert.equal(m.calls.some(c => c.suffix === '/pulls'), false);
});
test('container plan has no credential forwarding, network, host PID or Docker socket', () => {
  const args = dockerArgs('/tmp/public-source', 'sha256:' + 'a'.repeat(64));
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--user=1000:1000']) assert.ok(args.includes(flag));
  const text = args.join(' ');
  assert.doesNotMatch(text, /GH_TOKEN|GITHUB_TOKEN|OAUTH|docker.sock|--privileged|--pid=host/);
  assert.throws(() => dockerArgs('/tmp/source', 'node:latest'));
});
test('workflow stays inert, uses official App OAuth and npm test includes this suite', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../../docs/automation/claude-approved-task.yml.disabled'), 'utf8');
  assert.match(yaml, /false && vars.CLAUDE_TASKS_ENABLED/);
  assert.match(yaml, /task_sha256:/); assert.match(yaml, /PreToolUse/);
  assert.match(yaml, /--max-turns 12/); assert.match(yaml, /timeout-minutes: 30/);
  assert.doesNotMatch(yaml, /anthropic_api_key:|private-key:|create-github-app-token@|issues:\s*\n\s*types:/);
  for (const match of yaml.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[0-9a-f]{40}$/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.includes('node --test .github/automation/claude-approved-task.test.cjs'));
});
test('Linux CI: container cannot read parent credentials, write source or reach network', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true',
  timeout: 180000
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-isolation-probe-'));
  fs.chmodSync(directory, 0o755);
  try {
    fs.writeFileSync(path.join(directory, 'canary'), 'public source');
    execFileSync('docker', ['pull', 'busybox:1.37.0'], { stdio: 'pipe', timeout: 120000 });
    const image = execFileSync('docker', ['image', 'inspect', 'busybox:1.37.0', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
    const args = dockerArgs(directory, image);
    args[args.length - 1] = 'test -z "$GH_TOKEN$GITHUB_TOKEN$CLAUDE_CODE_OAUTH_TOKEN"; test ! -e /var/run/docker.sock; test ! -e /home/runner; test -r /source/canary; if echo changed > /source/canary; then exit 1; fi; if wget -T 2 -q -O /dev/null http://1.1.1.1; then exit 1; fi';
    execFileSync('docker', args, { stdio: 'pipe', timeout: 15000,
      env: { PATH: process.env.PATH, GH_TOKEN: 'must-not-enter-container', GITHUB_TOKEN: 'must-not-enter-container',
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-enter-container' } });
    assert.equal(fs.readFileSync(path.join(directory, 'canary'), 'utf8'), 'public source');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('publisher rejects main or any non-derived branch before API access', async () => {
  const m = mock();
  for (const branch of ['main', 'hostinger-migration', 'claude/task-4-other']) {
    await assert.rejects(publish(m.api, { ...state, branch }, []), /fixed publishing scope/);
  }
  assert.equal(m.calls.length, 0);
});
test('lost successful PR response recovers the existing draft', async () => {
  const m = mock();
  const api = async (method, route, data) => {
    const result = await m.api(method, route, data);
    if (method === 'POST' && route === '/pulls') throw new Error('Response lost');
    return result;
  };
  assert.equal((await publish(api, state, [])).number, 7);
  assert.equal(m.calls.filter(c => c.suffix === '/pulls').length, 1);
});
test('closed or non-draft existing PR is never reopened or modified', async () => {
  for (const update of [{ state: 'closed' }, { draft: false }]) {
    const m = mock(); const pr = await publish(m.api, state, []);
    m.setPR({ ...pr, ...update });
    await assert.rejects(publish(m.api, state, []), /human review required/);
    assert.equal(m.calls.filter(c => c.suffix === '/pulls').length, 1);
  }
});
test('hook process fails closed with exit 2 for malformed input and forbidden paths', () => {
  const s = fixture();
  const trusted = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hook-test-'));
  try {
    const helper = path.join(trusted, 'claude-approved-task.cjs');
    fs.copyFileSync(path.join(__dirname, 'claude-approved-task.cjs'), helper);
    fs.writeFileSync(path.join(trusted, 'state.json'), JSON.stringify(s));
    for (const input of ['not JSON', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '../outside' } })]) {
      assert.throws(() => execFileSync(process.execPath, [helper, 'hook'], { input, stdio: ['pipe', 'pipe', 'pipe'] }), error => error.status === 2);
    }
  } finally {
    fs.rmSync(trusted, { recursive: true, force: true });
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});
test('Linux CI: actual isolated runner executes lint, typecheck and the regression chain', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true',
  timeout: 900000
}, () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-image-'));
  try {
    for (const p of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, p), path.join(directory, p));
    execFileSync('docker', ['pull', 'node:22-bookworm'], { stdio: 'pipe', timeout: 180000 });
    const base = execFileSync('docker', ['image', 'inspect', 'node:22-bookworm', '--format', '{{index .RepoDigests 0}}'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(directory, 'Dockerfile'), 'FROM ' + base + '\nWORKDIR /deps\nCOPY package.json package-lock.json ./\nRUN npm ci --ignore-scripts --no-audit --no-fund\n');
    const imageFile = path.join(directory, 'image-id');
    execFileSync('docker', ['build', '--iidfile', imageFile, directory], { stdio: 'pipe', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    // No GITHUB_ACTIONS is forwarded, so the nested suite skips Docker tests.
    runChecks({ root, tracked, task: { allowed_paths: [] } }, execFileSync, fs.readFileSync(imageFile, 'utf8').trim());
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
