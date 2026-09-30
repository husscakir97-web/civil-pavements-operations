/* eslint @typescript-eslint/no-require-imports: "off" */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const REPO = 'husscakir97-web/civil-pavements-operations';
const LABEL = 'claude-approved';
const PREFIX = '[claude-task]';
function validateTask(body) {
  const match = body.match(/\x60\x60\x60json\s*([\s\S]*?)\x60\x60\x60/);
  if (!match) throw new Error('Task needs one fenced JSON specification');
  const task = JSON.parse(match[1]);
  for (const key of ['summary', 'request', 'acceptance']) {
    if (typeof task[key] !== 'string' || !task[key].trim() || task[key].length > 8000) throw new Error('Invalid ' + key);
  }
  if (!Array.isArray(task.allowed_paths) || !task.allowed_paths.length || task.allowed_paths.length > 20) throw new Error('Require 1-20 exact allowed_paths');
  for (const path of task.allowed_paths) {
    if (!/^(app|components|lib|db|migrations\/mysql)\/[A-Za-z0-9_./\[\]-]+$/.test(path) ||
        path.split('/').some(part => part === '..' || part === '.' || !part) ||
        path.split('/').some(part => /^(CLAUDE(?:\.local)?\.md|AGENTS\.md|SKILL\.md|\.env.*|\.claude|\.git|\.mcp\.json)$/.test(part))) throw new Error('Forbidden path: ' + path);
  }
  return task;
}
async function validateIssue(github, context, number) {
  if (context.repo.owner + '/' + context.repo.repo !== REPO) throw new Error('Wrong repository');
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid issue number');
  const actor = context.actor;
  const user = (await github.rest.users.getByUsername({ username: actor })).data;
  if (user.type !== 'User') throw new Error('Human actor required');
  const permission = (await github.rest.repos.getCollaboratorPermissionLevel({ ...context.repo, username: actor })).data.permission;
  if (!['admin', 'maintain', 'write'].includes(permission)) throw new Error('Actor needs write access');
  const issue = (await github.rest.issues.get({ ...context.repo, issue_number: number })).data;
  if (issue.pull_request || issue.state !== 'open' || !issue.labels.some(l => l.name === LABEL)) throw new Error('Require open approved issue, never a PR');
  if (issue.user.type !== 'User') throw new Error('Human task author required');
  const authorPermission = (await github.rest.repos.getCollaboratorPermissionLevel({ ...context.repo, username: issue.user.login })).data.permission;
  if (!['admin', 'maintain', 'write'].includes(authorPermission)) throw new Error('Task author needs write access');
  if (!issue.title.startsWith(PREFIX)) throw new Error('Task title must start ' + PREFIX);
  return { issue, task: validateTask(issue.body || '') };
}
async function gate({ github, context, core }) {
  if (!['issues', 'workflow_dispatch'].includes(context.eventName)) throw new Error('Unsupported event');
  if (context.eventName === 'issues' && (context.payload.action !== 'labeled' || context.payload.label.name !== LABEL)) throw new Error('Approval-label event required');
  if (context.eventName === 'workflow_dispatch' && context.ref !== 'refs/heads/main') throw new Error('Dispatch only main');
  const number = Number(context.payload.inputs?.issue_number || context.payload.issue?.number);
  const { issue, task } = await validateIssue(github, context, number);
  const prs = (await github.rest.pulls.list({ ...context.repo, state: 'open', per_page: 100 })).data;
  if (prs.some(p => p.head.ref.startsWith('claude/task-' + number + '-'))) throw new Error('Task already has an open PR');
  const base = (await github.rest.repos.getBranch({ ...context.repo, branch: 'main' })).data.commit.sha;
  core.setOutput('issue', String(number));
  core.setOutput('base', base);
  core.setOutput('branch', 'claude/task-' + number + '-' + context.runId);
  core.setOutput('task', JSON.stringify(task));
  core.setOutput('snapshot', JSON.stringify({ title: issue.title, body: issue.body, updated_at: issue.updated_at }));
}
function collectChanges(allowedPaths) {
  const tracked = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const paths = [...new Set([...tracked, ...untracked])];
  if (tracked.some(p => p.startsWith('migrations/mysql/'))) throw new Error('Migrations are append-only');
  if (!paths.length) throw new Error('No changes');
  if (paths.some(p => !allowedPaths.includes(p))) throw new Error('Changed a path outside approved scope');
  return paths.map(path => {
    // Reject symlinks in every path segment, deletions, executable files, and large files.
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const stat = fs.lstatSync(parts.slice(0, i).join('/'));
      if (stat.isSymbolicLink()) throw new Error('Symlink forbidden');
    }
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.size > 256000) throw new Error('Regular small files only');
    const content = fs.readFileSync(path);
    if (content.includes(0)) throw new Error('Binary forbidden');
    return { path, mode: '100644', type: 'blob', content: content.toString('utf8') };
  });
}
async function publish({ github, context, core }) {
  const number = Number(process.env.TASK_ISSUE);
  const { issue, task } = await validateIssue(github, context, number);
  const snapshot = JSON.stringify({ title: issue.title, body: issue.body, updated_at: issue.updated_at });
  if (snapshot !== process.env.TASK_SNAPSHOT) throw new Error('Approval changed during run; reapprove');
  const branch = process.env.TASK_BRANCH;
  if (branch !== 'claude/task-' + number + '-' + context.runId) throw new Error('Wrong task branch');
  const base = process.env.TASK_BASE;
  if ((await github.rest.repos.getBranch({ ...context.repo, branch: 'main' })).data.commit.sha !== base) throw new Error('Main changed; rerun after review');
  const changes = collectChanges(task.allowed_paths);
  const baseCommit = (await github.rest.git.getCommit({ ...context.repo, commit_sha: base })).data;
  const tree = (await github.rest.git.createTree({ ...context.repo, base_tree: baseCommit.tree.sha, tree: changes })).data;
  const commit = (await github.rest.git.createCommit({ ...context.repo, message: PREFIX + ' ' + task.summary, tree: tree.sha, parents: [base] })).data;
  await github.rest.git.createRef({ ...context.repo, ref: 'refs/heads/' + branch, sha: commit.sha });
  // App token creates the PR so normal pull_request CI is triggered. Never auto-merge.
  const pr = (await github.rest.pulls.create({
    ...context.repo, base: 'main', head: branch, draft: true,
    title: PREFIX + ' #' + number + ' ' + task.summary.slice(0, 150),
    body: 'Implements approved task #' + number + '.\n\nLocal checks: lint, typecheck and npm test passed. Full MySQL/build integration remains subject to CI.\n\nAcceptance criteria:\n' + task.acceptance + '\n\nHuman review and merge required. No live deployment authorized.'
  })).data;
  core.notice(pr.html_url);
  await core.summary.addLink('Draft task PR', pr.html_url).write();
}
module.exports = { validateTask, validateIssue, collectChanges, gate, publish };
