/* eslint @typescript-eslint/no-require-imports: "off" */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const REPO = 'husscakir97-web/civil-pavements-operations';
const OWNER = 'husscakir97-web';
const PREFIX = '[claude-task]';
const HELPER = '/tmp/claude-approved/claude-approved-task.cjs';
const FINISH = '/tmp/claude-approved/node ' + HELPER + ' finish';
const GUARD_ERROR = 'Approved task guard failed. Check scope, current approval and deterministic checks.';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const EXPECTED_ASSERTION = "require('node:assert/strict').fail('CLAUDE_ACCEPTANCE_EXPECTED_FAILURE');\n";
const NEGATIVE_TARGET = 'scripts/test-planning.cjs';
const NEGATIVE_COMMAND = '/tmp/claude-approved/node ' + HELPER + ' negative-fixture';
const ACCEPTANCE_SEQUENCE = ['scope_denied_probe', 'checks_started', 'checks_failed_expected_assertion',
  'checks_started', 'checks_passed', 'published'];
const AUDIT_EVENTS = new Set(['scope_denied', 'scope_denied_probe', 'checks_started',
  'checks_failed', 'checks_failed_expected_assertion', 'checks_passed', 'published']);
function readAudit(directory) {
  const file = path.join(directory, 'audit.jsonl');
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 16384) throw new Error('Invalid audit');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s));
  if (rows.length > 64 || rows.some(row => Object.keys(row).sort().join(',') !== 'digest,event' ||
      !AUDIT_EVENTS.has(row.event) || !(row.digest === null || /^[a-f0-9]{64}$/.test(row.digest)))) throw new Error('Invalid audit');
  return rows;
}
function appendAudit(directory, event, digest = null) {
  const rows = readAudit(directory);
  if (rows.length >= 64 || !AUDIT_EVENTS.has(event) || !(digest === null || /^[a-f0-9]{64}$/.test(digest))) throw new Error('Invalid audit');
  fs.appendFileSync(path.join(directory, 'audit.jsonl'), JSON.stringify({ event, digest }) + '\n', { mode: 0o600 });
}
function publicationReceipt(receipt) {
  if (!receipt || Object.keys(receipt).sort().join(',') !== 'sha,url' ||
      typeof receipt.sha !== 'string' || !/^[a-f0-9]{40}$/.test(receipt.sha) ||
      typeof receipt.url !== 'string' || !new RegExp('^https://github\\.com/' + REPO + '/pull/[1-9][0-9]*$').test(receipt.url)) throw new Error('Invalid publication receipt');
  return receipt;
}
function auditReport(directory, state) {
  if (!Number.isSafeInteger(state.number) || state.number < 1 || !/^[a-f0-9]{64}$/.test(state.approvedHash) ||
      !/^[a-f0-9]{40}$/.test(state.base)) throw new Error('Invalid audit identity');
  const file = path.join(directory, 'published.json');
  return { schema: 1, issue_number: state.number, approval_hash: state.approvedHash, base_sha: state.base,
    events: readAudit(directory), publication: fs.existsSync(file) ? publicationReceipt(JSON.parse(fs.readFileSync(file, 'utf8'))) : null };
}
// An acceptance task exercises the full denial -> expected failure -> corrected publication sequence.
// It is declared with "acceptance_sequence": true, or (for tasks written before that field) by naming the
// scope_denied_probe receipt in its acceptance text. Ordinary tasks are unaffected.
function isAcceptanceTask(task) {
  return Boolean(task) && (task.acceptance_sequence === true || /scope_denied_probe/.test(String(task.acceptance || '')));
}
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function verifyCompletion(outcome, conclusion, report, acceptance) {
  if (outcome !== 'success' || conclusion !== 'success') throw new Error('Claude did not conclude successfully');
  const receipt = publicationReceipt(report.publication);
  const receiptDigest = hash(JSON.stringify(receipt));
  if (acceptance === undefined || acceptance === null) {
    const last = report.events.slice(-2);
    if (last.length !== 2 || last[0].event !== 'checks_passed' || last[1].event !== 'published' ||
        last[1].digest !== receiptDigest) throw new Error('Missing checked publication evidence');
    return;
  }
  // Acceptance: the COMPLETE ordered sequence with matching source digests; anything missing, extra or mismatched fails closed.
  const { negativeDigest, finalDigest } = acceptance;
  const events = report.events;
  if (!sha(negativeDigest) || !sha(finalDigest) || negativeDigest === finalDigest ||
      events.length !== ACCEPTANCE_SEQUENCE.length || ACCEPTANCE_SEQUENCE.some((name, i) => events[i].event !== name) ||
      events[0].digest !== null || events[1].digest !== negativeDigest || events[2].digest !== negativeDigest ||
      events[3].digest !== finalDigest || events[4].digest !== finalDigest || events[5].digest !== receiptDigest)
    throw new Error('Incomplete or mismatched acceptance evidence');
}
function issueHash(issue) {
  return hash(JSON.stringify({ repository: REPO, number: issue.number, title: issue.title,
    body: issue.body || '', updated_at: issue.updated_at }));
}
function validateTask(body) {
  const blocks = [...body.matchAll(/\x60\x60\x60json\s*([\s\S]*?)\x60\x60\x60/g)];
  if (blocks.length !== 1) throw new Error('Require exactly one JSON task');
  const task = JSON.parse(blocks[0][1]);
  for (const key of ['summary', 'request', 'acceptance']) {
    if (typeof task[key] !== 'string' || !task[key].trim() || task[key].length > 8000) throw new Error('Invalid ' + key);
  }
  if (!Array.isArray(task.allowed_paths) || !task.allowed_paths.length ||
      task.allowed_paths.length > 20 || new Set(task.allowed_paths).size !== task.allowed_paths.length) throw new Error('Require 1-20 distinct exact paths');
  for (const p of task.allowed_paths) {
    const product = /^(app|components|lib|db|migrations\/mysql)\/[A-Za-z0-9_./\[\]-]+$/.test(p);
    const regression = /^scripts\/test-[a-z0-9-]+\.(cjs|mjs)$/.test(p);
    if (!(product || regression) || p.split('/').some(s => !s || s === '.' || s === '..' ||
        /^(CLAUDE(?:\.local)?\.md|AGENTS\.md|SKILL\.md|\..*|.*\.(pem|key))$/i.test(s))) throw new Error('Forbidden path: ' + p);
  }
  if (task.acceptance_sequence !== undefined && typeof task.acceptance_sequence !== 'boolean') throw new Error('Invalid acceptance_sequence');
  if (task.acceptance_comment !== undefined && !/^\/\/ [^\r\n]{1,200}$/.test(task.acceptance_comment)) throw new Error('Invalid acceptance_comment');
  return task;
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
}
function safeFile(root, relative, missing = false) {
  if (!relative || relative.includes('\\') || path.isAbsolute(relative) ||
      relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe path');
  const parts = relative.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = path.join(root, ...parts.slice(0, i));
    let stat;
    try { stat = fs.lstatSync(p); } catch (error) {
      if (missing && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length && !stat.isDirectory()) ||
        (i === parts.length && (!stat.isFile() || stat.nlink > 1))) throw new Error('Symlink, hardlink or non-file forbidden');
  }
  return path.join(root, relative);
}
async function approval(api, number, approvedHash, actor) {
  if (actor !== OWNER || !Number.isSafeInteger(number) || number < 1 || !/^[a-f0-9]{64}$/.test(approvedHash)) throw new Error('Owner and exact approval hash required');
  const issue = await api('GET', '/issues/' + number);
  if (issue.pull_request || issue.state !== 'open' || !issue.title.startsWith(PREFIX)) throw new Error('Require open task issue');
  if (issueHash(issue) !== approvedHash) throw new Error('Task changed: renew owner approval with current hash');
  return { issue, task: validateTask(issue.body || '') };
}
async function gate({ github, context, core }) {
  if (context.repo.owner + '/' + context.repo.repo !== REPO || context.eventName !== 'workflow_dispatch' ||
      context.ref !== 'refs/heads/main') throw new Error('Owner dispatch from fixed repository main only');
  const api = async (method, suffix) => (await github.request(method + ' /repos/' + REPO + suffix)).data;
  const inputs = context.payload.inputs;
  const number = Number(inputs.issue_number);
  const approvedHash = inputs.task_sha256;
  const { task } = await approval(api, number, approvedHash, context.actor);
  const base = (await api('GET', '/branches/main')).commit.sha;
  const root = fs.realpathSync(process.env.GITHUB_WORKSPACE);
  if (git(root, ['rev-parse', 'HEAD']).trim() !== base) throw new Error('Main moved after checkout; dispatch again');
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  for (const p of task.allowed_paths) {
    safeFile(root, p, true);
    if (p.startsWith('migrations/mysql/') && tracked.includes(p)) throw new Error('Migrations append-only');
  }
  const state = { root, number, approvedHash, actor: context.actor, task, base, tracked,
    branch: 'claude/task-' + number + '-' + approvedHash.slice(0, 16) };
  fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify(state), { mode: 0o400 });
  core.setOutput('task', JSON.stringify(task));
  core.setOutput('hash', approvedHash);
}
function checkTool(input, state, finished = false) {
  if (!input || input.hook_event_name !== 'PreToolUse') throw new Error('Unknown hook');
  const tool = input.tool_name;
  const args = input.tool_input || {};
  if (tool === 'Bash') {
    if (![FINISH, NEGATIVE_COMMAND].includes(args.command) || args.run_in_background || (args.timeout && args.timeout > 600000)) throw new Error('Only exact trusted finish command permitted');
    return;
  }
  if (!['Read', 'Edit', 'Write'].includes(tool)) throw new Error('Tool not permitted');
  if (typeof args.file_path !== 'string') throw new Error('Exact file path required');
  const absolute = path.resolve(state.root, args.file_path);
  const relative = path.relative(state.root, absolute).split(path.sep).join('/');
  if (args.file_path.includes('..') || /[\r\n\0]/.test(args.file_path)) throw new Error('Unsafe path');
  const reading = tool === 'Read';
  if (reading ? !state.tracked.includes(relative) && !state.task.allowed_paths.includes(relative) :
      finished || !state.task.allowed_paths.includes(relative)) throw Object.assign(new Error('Path outside approved scope or publication complete'), { code: 'SCOPE_DENIED' });
  if (reading && relative.split('/').some(p => p.startsWith('.') || /\.(pem|key)$/i.test(p))) throw new Error('Private/configuration path forbidden');
  safeFile(state.root, relative, !reading);
}
function collectChanges(state) {
  const changes = git(state.root, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean);
  const untracked = git(state.root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const paths = [...new Set([...changes, ...untracked])].sort();
  if (!paths.length || paths.some(p => !state.task.allowed_paths.includes(p))) throw new Error('No changes or changed path outside approved scope');
  return paths.map(p => {
    if (p.startsWith('migrations/mysql/') && state.tracked.includes(p)) throw new Error('Migrations append-only');
    const full = safeFile(state.root, p);
    const stat = fs.statSync(full);
    if (stat.size > 256000 || (process.platform !== 'win32' && (stat.mode & 0o111))) throw new Error('Large or executable file forbidden');
    const content = fs.readFileSync(full);
    if (content.includes(0) || !Buffer.from(content.toString('utf8')).equals(content)) throw new Error('UTF-8 text only');
    return { path: p, mode: '100644', type: 'blob', content: content.toString('utf8') };
  });
}
// The negative fixture is generated by trusted code from EXPECTED_ASSERTION (including its newline) and the committed file;
// the model never types it. Only after a confirmed probe denial, once, and only on an otherwise untouched target.
function negativeSource(original) { return EXPECTED_ASSERTION + original; }
function writeNegativeFixture(state, events, directory) {
  if (!isAcceptanceTask(state.task) || !state.task.allowed_paths.includes(NEGATIVE_TARGET) ||
      !state.tracked.includes(NEGATIVE_TARGET)) throw new Error('Negative fixture not available');
  if (events.length !== 1 || events[0].event !== 'scope_denied_probe') throw new Error('Negative fixture requires the confirmed probe denial first');
  const file = safeFile(state.root, NEGATIVE_TARGET);
  const original = git(state.root, ['show', 'HEAD:' + NEGATIVE_TARGET]);
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('Negative fixture requires the untouched target');
  // One use, recorded in trusted state the model cannot touch: restoring the original file never re-arms it.
  fs.writeFileSync(path.join(directory, 'negative-fixture.used'), '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(file, negativeSource(original));
}
// The approved comment: the owner-approved (hash-bound) "acceptance_comment" field or, for tasks written before that field,
// the single "prepend exactly // ... followed by a newline" sentence of the approved request. Never read from the candidate.
function approvedComment(task) {
  if (typeof task.acceptance_comment === 'string') return task.acceptance_comment;
  const found = [...String(task.request || '').matchAll(/prepend exactly (\/\/ [^\r\n]+?) followed by a newline/g)];
  if (found.length !== 1) throw new Error('Approved comment not identifiable');
  return found[0][1];
}
const blobDigest = content => hash(JSON.stringify([{ path: NEGATIVE_TARGET, mode: '100644', type: 'blob', content }]));
// Both expected digests come from independent bytes: EXPECTED_ASSERTION / the approved comment plus the committed baseline file.
function acceptanceExpectations(state) {
  if (JSON.stringify(state.task.allowed_paths) !== JSON.stringify([NEGATIVE_TARGET])) throw new Error('Acceptance scope must be exactly the planning suite');
  const original = git(state.root, ['show', 'HEAD:' + NEGATIVE_TARGET]);
  return { negativeDigest: blobDigest(negativeSource(original)), finalDigest: blobDigest(approvedComment(state.task) + '\n' + original) };
}
// Runs inside finish() before publish(): the history must be exactly the canonical five events so far and the candidate
// being published must be the independently expected bytes. Any deviation rejects before any publishing API call.
function assertAcceptanceBeforePublication(state, events, candidateDigest) {
  const expected = acceptanceExpectations(state);
  const wanted = ACCEPTANCE_SEQUENCE.slice(0, 5);
  if (!Array.isArray(events) || events.length !== wanted.length || wanted.some((name, i) => events[i].event !== name) ||
      expected.negativeDigest === expected.finalDigest || events[0].digest !== null ||
      events[1].digest !== expected.negativeDigest || events[2].digest !== expected.negativeDigest ||
      events[3].digest !== expected.finalDigest || events[4].digest !== expected.finalDigest ||
      candidateDigest !== expected.finalDigest) throw new Error('Incomplete or mismatched acceptance evidence');
}
function dockerArgs(snapshot, image) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Require locally resolved immutable test image ID');
  return ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=256', '--cpus=2', '--memory=3g',
    '--user=1000:1000', '--tmpfs=/tmp:rw,nosuid,nodev,size=2g,mode=1777',
    '--mount', 'type=bind,source=' + snapshot + ',target=/source,readonly',
    '--env=HOME=/tmp', '--env=CI=true', image, '/bin/sh', '-ec',
    'mkdir /tmp/project; cp -R /source/. /tmp/project/; cd /tmp/project; ln -s /deps/node_modules node_modules; npm run lint; npm run typecheck; npm test || { code=$?; printf "\\nCLAUDE_CHECK_STAGE_FAILED=npm-test\\n" >&2; exit "$code"; }'];
}
function runChecks(state, run = execFileSync, image = fs.readFileSync(path.join(__dirname, 'test-image.txt'), 'utf8').trim()) {
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-checks-'));
  fs.chmodSync(snapshot, 0o755);
  // Only approved/public source enters the container. No .git, runner files,
  // Claude configuration, host home, Docker socket or inherited environment.
  for (const p of [...new Set([...state.tracked, ...state.task.allowed_paths])]) {
    if (p.split('/').some(s => s === '.git' || s === '.claude' || s === '.mcp.json' ||
        /^\.env/.test(s) || /\.(pem|key)$/i.test(s))) continue;
    const source = safeFile(state.root, p);
    const dest = path.join(snapshot, p);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }
  try {
    run('/usr/bin/docker', dockerArgs(snapshot, image), {
      timeout: 600000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: '/tmp' }
    });
  } catch (error) {
    const probe = path.join(snapshot, 'scripts/test-planning.cjs');
    const stderr = String(error.stderr || '');
    const expectedAssertion = error.status === 1 && fs.existsSync(probe) &&
      fs.readFileSync(probe, 'utf8').startsWith(EXPECTED_ASSERTION) &&
      /(?:^|\n)AssertionError \[ERR_ASSERTION\]: CLAUDE_ACCEPTANCE_EXPECTED_FAILURE\r?\n/.test(stderr) &&
      /(?:^|\n)CLAUDE_CHECK_STAGE_FAILED=npm-test\r?\n/.test(stderr);
    throw Object.assign(new Error('Isolated checks failed'), { expectedAssertion });
  } finally { fs.rmSync(snapshot, { recursive: true, force: true }); }
}
async function maybe(api, suffix) {
  try { return await api('GET', suffix); } catch (e) { if (e.status === 404) return null; throw e; }
}
async function publish(api, state, changes) {
  if (!/^[a-f0-9]{40}$/.test(state.base) ||
      state.branch !== 'claude/task-' + state.number + '-' + state.approvedHash.slice(0, 16)) throw new Error('Invalid fixed publishing scope');
  await approval(api, state.number, state.approvedHash, state.actor);
  if ((await api('GET', '/branches/main')).commit.sha !== state.base) throw new Error('Main moved; renew approval against current base');
  const baseCommit = await api('GET', '/git/commits/' + state.base);
  const tree = await api('POST', '/git/trees', { base_tree: baseCommit.tree.sha, tree: changes });
  let ref = await maybe(api, '/git/ref/heads/' + state.branch);
  if (!ref) {
    const commit = await api('POST', '/git/commits', {
      message: PREFIX + ' #' + state.number + ' ' + state.approvedHash,
      tree: tree.sha, parents: [state.base]
    });
    try { ref = await api('POST', '/git/refs', { ref: 'refs/heads/' + state.branch, sha: commit.sha }); }
    catch (error) {
      if (error.status !== 422) throw error;
      ref = await maybe(api, '/git/ref/heads/' + state.branch);
      if (!ref) throw error;
    }
  }
  const existing = await api('GET', '/git/commits/' + ref.object.sha);
  if (existing.tree.sha !== tree.sha || existing.parents.length !== 1 || existing.parents[0].sha !== state.base ||
      existing.message !== PREFIX + ' #' + state.number + ' ' + state.approvedHash) throw new Error('Existing branch differs; never overwrite it');
  await approval(api, state.number, state.approvedHash, state.actor);
  const query = '/pulls?state=all&head=' + OWNER + ':' + state.branch + '&base=main&per_page=100';
  const find = async () => {
    const prs = await api('GET', query);
    if (!prs.length) return null;
    if (prs.length !== 1 || prs[0].state !== 'open' || !prs[0].draft || prs[0].base.ref !== 'main' ||
        prs[0].head.sha !== ref.object.sha || prs[0].head.repo.full_name !== REPO) throw new Error('Existing PR is closed, non-draft or differs; human review required');
    return prs[0];
  };
  let pr = await find();
  if (!pr) {
    try {
      pr = await api('POST', '/pulls', { base: 'main', head: state.branch, draft: true,
        title: PREFIX + ' #' + state.number + ' ' + state.task.summary.slice(0, 120),
        body: 'Approved task #' + state.number + '. Approval SHA-256: ' + state.approvedHash +
          '\n\nLint, typecheck and npm test passed in a credential-free, network-disabled test container. ' +
          'Full build/MySQL integration requires exact-head PR CI. Human review and merge required.\n\n' + state.task.acceptance });
    } catch (error) {
      // Covers a lost successful response as well as duplicate-create races.
      pr = await find();
      if (!pr) throw error;
    }
  }
  return pr;
}
async function finish(api, state, checks = runChecks, audit = () => {}, history = null) {
  const acceptance = isAcceptanceTask(state.task);
  if (acceptance && typeof history !== 'function') throw new Error('Acceptance history required');
  await approval(api, state.number, state.approvedHash, state.actor);
  const changes = collectChanges(state);
  const digest = hash(JSON.stringify(changes));
  audit('checks_started', digest);
  try { checks(state); } catch (error) {
    audit(error.expectedAssertion === true ? 'checks_failed_expected_assertion' : 'checks_failed', digest);
    throw new Error('Isolated checks failed');
  } // No branch/PR writes if any real regression fails.
  const after = collectChanges(state);
  if (JSON.stringify(changes) !== JSON.stringify(after)) throw new Error('Source changed during checks');
  audit('checks_passed', digest);
  if (acceptance) assertAcceptanceBeforePublication(state, history(), digest);
  const pr = await publish(api, state, changes);
  audit('published', hash(JSON.stringify({ url: pr.html_url, sha: pr.head.sha })));
  return pr;
}
function githubApi(token) {
  if (!token) throw new Error('Official App token unavailable inside action; no fallback');
  return async (method, suffix, body) => {
    if (!suffix.startsWith('/') || suffix.includes('..')) throw new Error('Invalid API route');
    const response = await fetch('https://api.github.com/repos/' + REPO + suffix, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) { const error = new Error('GitHub request failed: ' + response.status); error.status = response.status; throw error; }
    return response.json();
  };
}
function preflight(executable = '/tmp/claude-approved/node', helper = HELPER) {
  // Actual CLI entry points, with no inherited credentials, PATH, NODE_OPTIONS,
  // summary destination or model invocation. Nothing is published or edited.
  const invoke = (mode, input, extra = {}) => {
    const result = spawnSync(executable, [helper, mode], {
      encoding: 'utf8', input, timeout: 10000, maxBuffer: 32768,
      env: { ...extra }, windowsHide: true
    });
    if (result.error || result.signal) throw new Error('Trusted entry point unavailable');
    return result;
  };
  const hook = command => JSON.stringify({ hook_event_name: 'PreToolUse',
    tool_name: 'Bash', tool_input: { command } });
  const allowed = invoke('hook', hook(FINISH));
  if (allowed.status !== 0 || JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision !== 'allow')
    throw new Error('Trusted hook unavailable');
  const denied = invoke('hook', hook(FINISH + '; echo forbidden'));
  if (denied.status !== 2 || denied.stderr.trim() !== GUARD_ERROR)
    throw new Error('Trusted hook did not reject altered command');
  const report = invoke('audit-export');
  if (report.status !== 0 || !report.stdout.startsWith('CLAUDE_APPROVED_AUDIT='))
    throw new Error('Trusted audit export unavailable');
  const audit = JSON.parse(report.stdout.trim().slice('CLAUDE_APPROVED_AUDIT='.length));
  if (audit.publication !== null || audit.events.length !== 0)
    throw new Error('Preflight requires a fresh unpublished run');
  const completion = invoke('verify-completion', undefined,
    { CLAUDE_STEP_OUTCOME: 'success', CLAUDE_STEP_CONCLUSION: 'success' });
  const finishResult = invoke('finish');
  const negativeResult = invoke('negative-fixture');
  for (const result of [completion, finishResult, negativeResult]) {
    if (result.status !== 1 || result.stderr.trim() !== GUARD_ERROR)
      throw new Error('Trusted entry point did not fail closed');
  }
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'hash') {
    const issue = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    console.log(issueHash(issue)); return;
  }
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
  if (mode === 'preflight') {
    preflight();
    console.log('Trusted entry-point preflight passed; no model or publication attempted.');
  } else if (mode === 'hook') {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    try { checkTool(input, state, fs.existsSync(path.join(__dirname, 'published.json'))); }
    catch (error) {
      if (error.code === 'SCOPE_DENIED') {
        const probe = input.tool_name === 'Write' && path.resolve(state.root, input.tool_input.file_path) === path.join(state.root, 'scripts/test-claude-denial-probe.cjs');
        appendAudit(__dirname, probe ? 'scope_denied_probe' : 'scope_denied');
      }
      throw error;
    }
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  } else if (mode === 'finish') {
    const pr = await finish(githubApi(process.env.GH_TOKEN), state, runChecks, (event, digest) => appendAudit(__dirname, event, digest), () => readAudit(__dirname));
    fs.writeFileSync(path.join(__dirname, 'published.json'), JSON.stringify({ url: pr.html_url, sha: pr.head.sha }));
    console.log('Draft PR: ' + pr.html_url);
  } else if (mode === 'negative-fixture') {
    writeNegativeFixture(state, readAudit(__dirname), __dirname);
    console.log('Negative fixture written from the trusted expected assertion.');
  } else if (mode === 'audit-export') {
    const report = JSON.stringify(auditReport(__dirname, state));
    console.log('CLAUDE_APPROVED_AUDIT=' + report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n```json\n' + report + '\n```\n');
  } else if (mode === 'verify-completion') {
    verifyCompletion(process.env.CLAUDE_STEP_OUTCOME, process.env.CLAUDE_STEP_CONCLUSION, auditReport(__dirname, state),
      isAcceptanceTask(state.task) ? acceptanceExpectations(state) : undefined);
  } else throw new Error('Unknown helper mode');
}
if (require.main === module) main().catch(() => {
  // Do not echo API responses, environment or tool input into public logs.
  console.error(GUARD_ERROR);
  process.exitCode = process.argv[2] === 'hook' ? 2 : 1;
});
module.exports = { REPO, FINISH, issueHash, validateTask, safeFile, gate, approval, checkTool,
  collectChanges, dockerArgs, runChecks, publish, finish, EXPECTED_ASSERTION, NEGATIVE_TARGET, NEGATIVE_COMMAND,
  ACCEPTANCE_SEQUENCE, isAcceptanceTask, approvedComment, assertAcceptanceBeforePublication, writeNegativeFixture, acceptanceExpectations,
  readAudit, appendAudit, auditReport, publicationReceipt, verifyCompletion, preflight };
