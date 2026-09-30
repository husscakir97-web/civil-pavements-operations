# Claude approved tasks — inactive review draft

This PR does not enable automation. The template remains in
`docs/automation/claude-approved-task.yml.disabled`, outside Actions' workflow
directory, with a literal `false` job guard. Do not add OAuth credentials or
install an App until the separate activation/security review is approved.

## Small first version

Dot prepares a small task; the repository owner reviews its complete content and
dispatches its exact SHA-256; Claude edits approved files; a fixed helper runs
checks and opens a draft PR; a human reviews it. There is no automatic merge,
deployment, security work, feature work, or automatic retry using API billing.
The initial owner dispatch is intentional: dot and bot comments cannot authorize
their own task. The parent's review webhook is a separate, not-yet-configured step.

Use one open issue titled `[claude-task] ...` containing exactly one JSON block:

```json
{
  "summary": "Clarify the empty docket message",
  "request": "Describe the precise correction",
  "acceptance": "Describe observable behavior and the required regression",
  "allowed_paths": [
    "components/dockets-workspace.tsx",
    "scripts/test-example.cjs"
  ]
}
```

Scope is 1–20 distinct exact paths under app/, components/, lib/, db/,
migrations/mysql/, or scripts/test-*.cjs and scripts/test-*.mjs. Regression paths
must be explicitly approved too. Existing migration files cannot be edited.
Tooling, publisher, settings, instructions, dependency files, arbitrary scripts,
credentials, deletion, symlinks, hardlinks and non-text files are excluded.
New regression files must already be reached by the trusted test runner; adding
a new npm script remains a separate setup change. This PR wires the automation
suite into the existing npm test chain, so existing CI runs it.

## Approval binds the reviewed content

The sole trigger is workflow_dispatch from main, by husscakir97-web, with
`issue_number` and `task_sha256`. A label is never sufficient. Hash input is the
fixed repository, issue number, exact title, exact body and updated_at, serialized
in that order by issueHash(). Including the edit version invalidates approval
even when text is changed and subsequently restored. Some metadata changes may
also require renewal; that is deliberately conservative.

Fetch the current issue JSON, review that snapshot, and calculate its hash with
the trusted helper, for example on a machine with an authenticated gh CLI:

```sh
gh api repos/husscakir97-web/civil-pavements-operations/issues/NUMBER > task.json
node .github/automation/claude-approved-task.cjs hash task.json
```

The setup assistant can prepare the public task snapshot/hash for review; a
hash alone is not evidence that the owner reviewed it. The owner submits those
two dispatch inputs after review. The gate compares the current issue against
the supplied hash before any AI call, then checks again before/after tests and
before PR creation. Queued runs and manual reruns cannot silently use edited
content. GitHub cannot atomically couple issue editing to PR creation: an edit
after the final API read remains a narrow race, so reviewers must also verify
the approval hash recorded in the draft PR.

## Runtime boundaries and publication

The pinned official action supports user settings with PreToolUse command hooks.
A helper and approval state are copied outside the checkout before Claude starts.
The hook only permits Read of tracked public files, Edit/Write of exact approved
paths, and one exact foreground Bash command invoking the helper. It rejects
other tools, shell suffixes/arguments, background requests, path traversal and
link paths before execution. Project/local settings are excluded with
`--setting-sources user`; all MCP, agent, skill and web tools are denied.
The model cannot edit or read the helper, state or credential locations through
these permitted tools. A post-edit diff remains defense in depth, not the runtime
path boundary.

The fixed finish command runs lint, typecheck and the complete npm test chain in
a separate Docker container. Only a public source snapshot is mounted read-only;
the container has its own writable tmpfs, no forwarded host credentials, no host
home/process namespace or Docker socket, no network, dropped capabilities,
a non-root user, resource caps and a 10-minute process timeout. Dependencies are
prepared before OAuth/App credentials are supplied, using npm ci --ignore-scripts.
The Node 22 image is resolved before the run and checks use the resulting local
immutable image ID. The input Node image tag is still mutable between runs;
review/pin a verified registry digest before activation if required.

The trusted host helper, rather than repository tests, holds publication
authority. It rechecks approval and unchanged source, creates an isolated
`claude/task-N-HASH` branch, and requests a draft PR against main in this one
repository. No update-ref, merge, deploy or main-write operation exists.
A failed test blocks all branch/PR writes. If branch creation succeeds but PR
creation fails, rerunning verifies the existing commit's exact tree, parent and
approval message before reusing it; it never overwrites an existing branch.
An already matching open draft PR is reused. Changed, closed or non-draft PRs
require human review.

These are tool-policy controls plus test-container isolation, **not an OS sandbox
for the entire Claude process**. The official action and CLI remain trusted code
holding credentials. Hook loading, credential inheritance and draft publication
inside the pinned action still need a separately approved end-to-end acceptance
run. If that route fails, stop and investigate; do not introduce a custom App,
PAT, broader tools or API billing without a new user decision.

## Authentication route and the existing broad workflow

Use the official Claude App, installed on ONLY this repository, and the user's
existing Claude Pro subscription via CLAUDE_CODE_OAUTH_TOKEN. A custom App/private
key is no longer required merely because the official action revokes its token:
the pinned action sets GH_TOKEN/GITHUB_TOKEN during execution, and the trusted
helper publishes before that composite action's token-revocation step.

The official App's full install permission grant must still be reviewed by the
user at installation; it is broader than this workflow's declared permissions.
Do not claim this draft reduces the App installation's grant. No App has been
installed or granted access by this revision.

Inspected existing main `.github/workflows/claude.yml`:
- issue_comment created; pull_request_review_comment created; issues opened and
  assigned; pull_request_review submitted.
- actions/checkout@v4 and anthropics/claude-code-action@v1 are mutable tags.
- Contents, Issues, Pull requests and id-token permissions are write.
- It references ANTHROPIC_API_KEY, with no explicit task approval/hash, timeout,
  turn cap, concurrency group or deterministic draft-only publisher.

The action still supplies its own actor/mention checks; these triggers alone do
not mean every public commenter can run Claude. Credential/App availability and
account spend controls are unknown. Nevertheless, this is a second, broader
execution route and must be retired/restricted in a separately approved change
before authentication/activation. This PR does not change that live file.

Minimal inert restriction proposal for that later review (not applied here):

```yaml
name: Claude Assistant (retired pending approved-task activation)
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  disabled:
    if: ${{ false }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Use the separately approved task workflow."
```

## One-time human handoff — after guard review, not now

1. Review this inactive PR and exact-head CI, including the Linux container probe.
   Separately approve retirement/restriction of the old workflow and the final
   activation change. No activation follows automatically from merging this draft.
2. Confirm Claude paid extra usage is OFF and account spending controls satisfy
   the user's no-extra-spend requirement. Standard GitHub-hosted public-repository
   runners are currently free; private/larger/self-hosted runner billing is outside
   this proposal. These account settings have not been verified.
3. Approve the official App's displayed permissions and selected-repository
   installation. No custom App, PAT, extra subscription or API fallback.
4. Check for an official local Claude CLI. On DESKTOP-DK2PF99, it was not found on
   PATH or at ~/.local/bin/claude.exe or the npm global shim location. Ask the
   parent/user before installing it. Do not infer it is absent everywhere.
5. The user runs `claude setup-token` securely themselves and enters the result
   directly in GitHub as the protected environment's CLAUDE_CODE_OAUTH_TOKEN.
   Never send it to chat, a task, a log, an agent tool call or a committed file.
   Configure the claude-approved-tasks environment with required human reviewers
   and main-only deployment branches; review availability and bypass settings.
6. A separately approved activation PR may copy this template into
   .github/workflows/ and remove the literal false. A human merges it.
   Only after cost/permissions approval set CLAUDE_NO_EXTRA_SPEND_CONFIRMED=true
   and CLAUDE_TASKS_ENABLED=true. The variables alone cannot activate this draft.
7. Separately authorize one small acceptance run. Verify the hook rejects an
   unauthorized path before a write, test failure prevents publication, OAuth
   uses the intended subscription, the official App can publish before revocation,
   and the resulting draft's exact-head CI passes. No paid AI test is authorized
   during this setup revision.

Limits: one concurrent run, 12 model turns, 30-minute job timeout, 10-minute checks.
**Turn/time limits are not monetary caps.** Exhausted Pro allowance must stop the
run; no API-key fallback, paid extra usage or new subscription is authorized.
Stop switch: set CLAUDE_TASKS_ENABLED=false and cancel active/queued runs.
Changing a variable does not cancel an already-running job. User-managed credential
revocation/App removal is a separate incident action if needed.

## Review coordination and verification

Task PR titles start [claude-task] at creation, allowing the parent to scope its
GitHub PR-open/synchronize webhook to this repository and title prefix. The setup
PR starts [setup]. No review webhook has been configured here. Do not assume
CI-completion or bot-comment events will wake the parent: after a PR wake, it must
monitor checks for that exact head SHA. Review findings do not automatically
authorize another implementation run.

Run `npm test`, `npm run lint`, and `npm run typecheck`. The automation suite
includes approval changes, runtime tool/path denial, test-failure publication
blocking, successful draft creation, and branch/PR recovery. Its Linux GitHub
Actions probe exercises container credential exclusion, read-only source and
network denial. A second Linux CI test runs the actual isolated lint/typecheck/regression chain.
Windows skips both Docker tests and cannot establish Docker isolation.
Full MySQL/build integration remains the existing PR CI's responsibility.
No AI run is part of these checks.

Sources:
- https://code.claude.com/docs/en/github-actions
- https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
- https://github.com/anthropics/claude-code-action/blob/main/docs/configuration.md
- https://code.claude.com/docs/en/hooks
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://github.com/anthropics/claude-code-action/blob/fd1c128679612beff4ca259c78021c506e8aa7a7/src/entrypoints/run.ts
- https://github.com/anthropics/claude-code-action/blob/fd1c128679612beff4ca259c78021c506e8aa7a7/action.yml
