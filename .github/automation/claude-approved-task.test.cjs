/* eslint @typescript-eslint/no-require-imports: "off" */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { validateTask, validateIssue, gate, publish, collectChanges } = require('./claude-approved-task.cjs');
const task = { summary: 'Small correction', request: 'Implement scoped correction', acceptance: 'Regression passes', allowed_paths: ['components/example.tsx'] };
const body = '\x60\x60\x60json\n' + JSON.stringify(task) + '\n\x60\x60\x60';
const context = { repo: { owner: 'husscakir97-web', repo: 'civil-pavements-operations' }, actor: 'owner', eventName: 'issues', runId: 123, payload: { action: 'labeled', label: { name: 'claude-approved' }, issue: { number: 4 } } };
function mock(overrides = {}) {
  const issue = { number: 4, state: 'open', title: '[claude-task] Correction', body, updated_at: 'unchanged', labels: [{ name: 'claude-approved' }], user: { login: 'owner', type: 'User' }, ...overrides };
  const github = { rest: {
    users: { getByUsername: async () => ({ data: { type: 'User' } }) },
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }), getBranch: async () => ({ data: { commit: { sha: 'base' } } }) },
    issues: { get: async () => ({ data: issue }) },
    pulls: { list: async () => ({ data: [] }) }
  } };
  return { github, issue };
}
test('accept explicit scoped JSON', () => assert.deepEqual(validateTask(body), task));
test('reject path escape, workflow, instruction, wildcard and secret paths', () => {
  for (const p of ['components/../x', '.github/workflows/x.yml', 'lib/AGENTS.md', 'lib/x*', 'app/.env.local', 'lib/.claude/x', 'lib//x']) {
    assert.throws(() => validateTask('\x60\x60\x60json\n' + JSON.stringify({ ...task, allowed_paths: [p] }) + '\n\x60\x60\x60'));
  }
});
test('reject missing specification and empty scope', () => {
  assert.throws(() => validateTask('just text'));
  assert.throws(() => validateTask('\x60\x60\x60json\n' + JSON.stringify({ ...task, allowed_paths: [] }) + '\n\x60\x60\x60'));
});
test('reject closed, unapproved, PR-shaped and bot-authored issues', async () => {
  for (const overrides of [{ state: 'closed' }, { labels: [] }, { pull_request: {} }, { user: { login: 'bot', type: 'Bot' } }, { title: 'unscoped' }]) {
    await assert.rejects(validateIssue(mock(overrides).github, context, 4));
  }
});
test('reject bot actor and non-write actor or author', async () => {
  const m = mock(); m.github.rest.users.getByUsername = async () => ({ data: { type: 'Bot' } });
  await assert.rejects(validateIssue(m.github, context, 4));
  const n = mock(); n.github.rest.repos.getCollaboratorPermissionLevel = async () => ({ data: { permission: 'read' } });
  await assert.rejects(validateIssue(n.github, context, 4));
  const a = mock({ user: { login: 'external', type: 'User' } });
  a.github.rest.repos.getCollaboratorPermissionLevel = async ({ username }) => ({ data: { permission: username === 'external' ? 'read' : 'write' } });
  await assert.rejects(validateIssue(a.github, context, 4));
});
test('gate freezes approved task, isolated branch and base', async () => {
  const outputs = {}; await gate({ github: mock().github, context, core: { setOutput: (k, v) => outputs[k] = v } });
  assert.equal(outputs.branch, 'claude/task-4-123'); assert.equal(outputs.base, 'base'); assert.deepEqual(JSON.parse(outputs.task), task);
});
test('reject unsupported events and non-main dispatch', async () => {
  await assert.rejects(gate({ github: mock().github, context: { ...context, eventName: 'issue_comment' }, core: {} }));
  await assert.rejects(gate({ github: mock().github, context: { ...context, eventName: 'workflow_dispatch', ref: 'refs/heads/other' }, core: {} }));
});
test('reject duplicate open task PR', async () => {
  const m = mock(); m.github.rest.pulls.list = async () => ({ data: [{ head: { ref: 'claude/task-4-99' } }] });
  await assert.rejects(gate({ github: m.github, context, core: { setOutput() {} } }));
});
test('publication rejects task edited after approval before writes', async () => {
  process.env.TASK_ISSUE = '4'; process.env.TASK_SNAPSHOT = '{}';
  await assert.rejects(publish({ github: mock().github, context, core: {} }), /Approval changed/);
});
test('collectChanges rejects forbidden file and accepts exact allowed file', () => {
  const previous = process.cwd(); const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-setup-test-'));
  try {
    process.chdir(temporary); execFileSync('git', ['init', '-q']);
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'base']);
    fs.mkdirSync('components'); fs.writeFileSync('components/example.tsx', 'export default 1;');
    assert.equal(collectChanges(task.allowed_paths)[0].path, 'components/example.tsx');
    fs.writeFileSync('unexpected.txt', 'outside scope');
    assert.throws(() => collectChanges(task.allowed_paths), /outside approved scope/);
  } finally { process.chdir(previous); }
});
test('workflow is inert and narrowly scoped', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../../docs/automation/claude-approved-task.yml.disabled'), 'utf8');
  assert.match(yaml, /false && vars.CLAUDE_TASKS_ENABLED/); assert.match(yaml, /timeout-minutes: 30/);
  assert.match(yaml, /--max-turns 20/); assert.match(yaml, /mcp__\*/);
  assert.doesNotMatch(yaml, /anthropic_api_key:|allowed_bots: ['"]\*|pull_request_target:|schedule:/);
  for (const match of yaml.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[0-9a-f]{40}$/);
});
