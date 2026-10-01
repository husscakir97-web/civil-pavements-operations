/* eslint @typescript-eslint/no-require-imports: "off" */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { REPO, FINISH, issueHash, validateTask, approval, gate, checkTool, collectChanges,
  dockerArgs, runChecks, publish, finish, EXPECTED_ASSERTION, appendAudit, readAudit,
  auditReport, verifyCompletion, preflight } = require('./claude-approved-task.cjs');

test('preflight exercises real CLI paths and rejects missing interpreter or helper', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-preflight-'));
  const helper = path.join(dir, 'claude-approved-task.cjs');
  try {
    fs.copyFileSync(path.join(__dirname, 'claude-approved-task.cjs'), helper);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    preflight(process.execPath, helper);
    assert.equal(fs.existsSync(path.join(dir, 'audit.jsonl')), false);
    assert.equal(fs.existsSync(path.join(dir, 'published.json')), false);
    assert.throws(() => preflight(path.join(dir, 'missing-node'), helper), /unavailable/);
    assert.throws(() => preflight(process.execPath, path.join(dir, 'missing.cjs')), /unavailable/);
    fs.writeFileSync(path.join(dir, 'published.json'), JSON.stringify({
      url: 'https://github.com/' + REPO + '/pull/7', sha: 'c'.repeat(40)
    }));
    assert.throws(() => preflight(process.execPath, helper), /fresh unpublished/);
    fs.unlinkSync(path.join(dir, 'published.json'));
    fs.writeFileSync(helper, 'process.exit(0);');
    assert.throws(() => preflight(process.execPath, helper));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('workflow and inert template use the same fixed executable and preflight before Claude', () => {
  for (const file of ['.github/workflows/claude-approved-task.yml', 'docs/automation/claude-approved-task.yml.disabled']) {
    const yaml = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(yaml, /\/usr\/bin\/node/);
    assert.match(yaml, /node_binary=.*realpath/);
    assert.match(yaml, /ln -s "\$node_binary" \/tmp\/claude-approved\/node/);
    assert.ok(yaml.indexOf('claude-approved-task.cjs preflight') < yaml.indexOf('uses: anthropics/'));
    const modes = file.endsWith('.disabled') ? ['hook', 'finish'] : ['hook', 'finish', 'audit-export', 'verify-completion'];
    for (const mode of modes)
      assert.ok(yaml.includes('/tmp/claude-approved/node /tmp/claude-approved/claude-approved-task.cjs ' + mode));
  }
  for (const command of ['node ' + FINISH.split(' ').slice(1).join(' '),
    FINISH.replace('/tmp/claude-approved/node', '/usr/bin/node')]) {
    assert.throws(() => checkTool({ hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command } }, state));
  }
});

test('Linux CI: exact workflow binding and preflight entry point execute before any model', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true'
}, () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../workflows/claude-approved-task.yml'), 'utf8');
  const block = yaml.split('      - name: Bind verified Node 22 before trusted helper execution\n')[1]
    .split('      - name: Freeze helper')[0].split('        run: |\n')[1];
  const script = block.split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const dir = '/tmp/claude-approved';
  assert.equal(fs.existsSync(dir), false, 'never reuse or remove another trusted directory');
  try {
    execFileSync('/bin/bash', ['-e', '-c', script], { stdio: 'pipe' });
    fs.copyFileSync(path.join(__dirname, 'claude-approved-task.cjs'), path.join(dir, 'claude-approved-task.cjs'));
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    execFileSync(path.join(dir, 'node'), [path.join(dir, 'claude-approved-task.cjs'), 'preflight'],
      { env: {}, stdio: 'pipe' });
    assert.equal(fs.existsSync(path.join(dir, 'audit.jsonl')), false);
    assert.equal(fs.existsSync(path.join(dir, 'published.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
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
    await assert.rejects(finish(m.api, s, () => { throw new Error('regression failed'); }), /Isolated checks failed/);
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
    const probeRoot = path.join(directory, 'negative-probe');
    fs.mkdirSync(path.join(probeRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(probeRoot, 'package.json'), JSON.stringify({ scripts: {
      lint: 'node -e ""', typecheck: 'node -e ""', test: 'node scripts/test-planning.cjs' } }));
    fs.writeFileSync(path.join(probeRoot, 'scripts/test-planning.cjs'), EXPECTED_ASSERTION);
    assert.throws(() => runChecks({ root: probeRoot, tracked: ['package.json', 'scripts/test-planning.cjs'],
      task: { allowed_paths: [] } }, execFileSync, fs.readFileSync(imageFile, 'utf8').trim()), error => error.expectedAssertion === true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('audit exports only fixed events, hashes and validated public identity; rejects injected fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-audit-'));
  try {
    appendAudit(dir, 'scope_denied_probe');
    appendAudit(dir, 'checks_failed_expected_assertion', 'b'.repeat(64));
    const report = auditReport(dir, { ...state, secret: 'DO_NOT_EXPORT', task: { request: 'PRIVATE_PROMPT' } });
    assert.doesNotMatch(JSON.stringify(report), /DO_NOT_EXPORT|PRIVATE_PROMPT|request|secret/);
    assert.deepEqual(report.events.map(x => x.event), ['scope_denied_probe', 'checks_failed_expected_assertion']);
    assert.throws(() => appendAudit(dir, 'secret=DO_NOT_EXPORT'));
    assert.throws(() => appendAudit(dir, 'checks_failed', 'DO_NOT_EXPORT'));
    fs.appendFileSync(path.join(dir, 'audit.jsonl'), JSON.stringify({ event: 'checks_failed', digest: null, stdout: 'DO_NOT_EXPORT' }) + '\n');
    assert.throws(() => auditReport(dir, state), /Invalid audit/);
    fs.writeFileSync(path.join(dir, 'audit.jsonl'), 'not JSON');
    assert.throws(() => readAudit(dir));
    fs.writeFileSync(path.join(dir, 'audit.jsonl'), 'x'.repeat(16385));
    assert.throws(() => readAudit(dir), /Invalid audit/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real hook denial produces exportable safe probe receipt without echoing tool input', () => {
  const s = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-audit-hook-'));
  try {
    const helper = path.join(dir, 'claude-approved-task.cjs');
    fs.copyFileSync(path.join(__dirname, 'claude-approved-task.cjs'), helper);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {
      file_path: 'scripts/test-claude-denial-probe.cjs', content: 'DO_NOT_EXPORT' } });
    assert.throws(() => execFileSync(process.execPath, [helper, 'hook'], { input, stdio: 'pipe' }), error => error.status === 2);
    assert.ok(!fs.existsSync(path.join(s.root, 'scripts/test-claude-denial-probe.cjs')));
    const output = execFileSync(process.execPath, [helper, 'audit-export'], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    assert.match(output, /CLAUDE_APPROVED_AUDIT=/);
    assert.match(output, /scope_denied_probe/);
    assert.doesNotMatch(output, /DO_NOT_EXPORT|file_path|tool_input/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('failed checks audit their digest, redact errors and never publish; success records checked publication', async () => {
  const s = fixture();
  try {
    const m = mock(); const events = [];
    await assert.rejects(finish(m.api, s, () => { throw Object.assign(new Error('DO_NOT_EXPORT'), { expectedAssertion: true }); },
      (event, digest) => events.push({ event, digest })), /Isolated checks failed/);
    assert.deepEqual(events.map(x => x.event), ['checks_started', 'checks_failed_expected_assertion']);
    assert.equal(events[0].digest, events[1].digest);
    assert.match(events[0].digest, /^[a-f0-9]{64}$/);
    assert.ok(!m.calls.some(x => x.method === 'POST'));
    assert.doesNotMatch(JSON.stringify(events), /DO_NOT_EXPORT/);
    events.length = 0;
    await finish(m.api, s, () => {}, (event, digest) => events.push({ event, digest }));
    assert.deepEqual(events.map(x => x.event), ['checks_started', 'checks_passed', 'published']);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('test marker requires actual failing status, npm-test stage, assertion error and matching source', () => {
  const s = fixture();
  s.tracked = ['scripts/test-planning.cjs']; s.task = { allowed_paths: [] };
  const file = path.join(s.root, 'scripts/test-planning.cjs');
  const stderr = '\nAssertionError [ERR_ASSERTION]: CLAUDE_ACCEPTANCE_EXPECTED_FAILURE\nCLAUDE_CHECK_STAGE_FAILED=npm-test\nDO_NOT_EXPORT\n';
  try {
    fs.writeFileSync(file, EXPECTED_ASSERTION);
    for (const [status, output, expected] of [[1, stderr, true], [2, stderr, false], [1, 'DO_NOT_EXPORT', false],
      [1, stderr.replace('CLAUDE_CHECK_STAGE_FAILED=npm-test', ''), false]]) {
      assert.throws(() => runChecks(s, () => { throw Object.assign(new Error('DO_NOT_EXPORT'), { status, stderr: output }); }, 'sha256:' + 'a'.repeat(64)),
        error => error.expectedAssertion === expected && !error.message.includes('DO_NOT_EXPORT'));
    }
    fs.writeFileSync(file, '// no failure');
    assert.throws(() => runChecks(s, () => { throw Object.assign(new Error('private'), { status: 1, stderr }); }, 'sha256:' + 'a'.repeat(64)), error => error.expectedAssertion === false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('completion rejects empty/skipped conclusions, missing receipts, failed outcomes and unmatched audit', () => {
  const receipt = { url: 'https://github.com/' + REPO + '/pull/7', sha: 'c'.repeat(40) };
  const digest = require('node:crypto').createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  const report = { publication: receipt, events: [{ event: 'checks_passed', digest: 'b'.repeat(64) }, { event: 'published', digest }] };
  verifyCompletion('success', 'success', report);
  for (const conclusion of ['', undefined, 'skipped', 'failure']) assert.throws(() => verifyCompletion('success', conclusion, report));
  assert.throws(() => verifyCompletion('failure', 'success', report));
  assert.throws(() => verifyCompletion('success', 'success', { ...report, publication: null }));
  assert.throws(() => verifyCompletion('success', 'success', { ...report, events: [] }));
  assert.throws(() => verifyCompletion('success', 'success', { ...report, publication: { ...receipt, secret: 'private' } }));
});
