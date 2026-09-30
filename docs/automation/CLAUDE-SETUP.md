# Claude approved task setup (inactive draft)

This proposal does not enable execution. The template is outside .github/workflows,
has a .disabled extension, and its job has a literal false guard. No credentials,
App installation, permission changes, AI runs, merges or deployments were performed.

## Current repository and route

Inspected main at 131bc35dac1bdf8f8cfedcfe06537f6ec6f442b2 on 2026-09-30.
Connected GitHub user: husscakir97-web (id 328914270), repository permission admin.
There is already .github/workflows/claude.yml on main with issue/comment/review
events and an ANTHROPIC_API_KEY reference. It has no explicit approval-label gate,
time/turn/concurrency cap, or deterministic draft-PR step. Its actual App and secret
status are unknown: this connector cannot enumerate secrets or Claude installations.
The existing workflow is unchanged. Before configuring auth, review and separately
approve retirement or restriction of that workflow so it cannot provide a second,
broader execution path. Do not trigger @claude while doing setup.

Main has CLAUDE.md (read and honored); no AGENTS.md or .agents/skills/SKILL.md entries
were present in its recursive tree. No checkout, gh CLI, or RW-PB440DEC23 remote
tool was exposed in this delegated environment. The draft uses GitHub API writes
to its own branch, so no current device checkout needs changing.

## Proposed behavior

Human collaborator applies claude-approved to an open [claude-task] issue, or
manually dispatches from main with that approved issue number. Both the actor and
task author must currently have write/maintain/admin permission; bot users and
untrusted external tasks are rejected. This does not support bot-triggered dot tasks.
Dot may write a scoped task, but a human collaborator must author/approve it for
this first version. Do not broaden allowed_bots or allowed_non_write_users.

Claude edits only a JSON task's exact approved paths and runs deterministic checks.
The workflow rechecks approval and unchanged task content, rejects out-of-scope
changes, then explicitly creates a separate claude/task-N-RUN branch and draft PR
using the GitHub API. It does not rely on the default @claude prefilled PR link.
No existing branch is pushed, merged, or deployed. Main must still match the frozen
base SHA at publication. An existing open task PR prevents another run for that task.

Example issue title: [claude-task] Clarify the empty docket message

Issue body (human must review the complete scope before applying approval):

```json
{
  "summary": "Clarify the empty docket message",
  "request": "Describe the exact current problem and the requested behavior here.",
  "acceptance": "State observable results and regression checks here.",
  "allowed_paths": ["components/dockets-workspace.tsx"]
}
```

Only 1-20 exact paths under app/, components/, lib/, db/ or migrations/mysql/
are supported. Wildcards, deletions, symlinks, binary/large files, instructions,
package scripts, dependency files, workflows, credentials and live configuration
are excluded. Scope expansions and tooling changes need a separate reviewed task.
Migrations remain append-only under CLAUDE.md; use only NEW migration paths.

## Authentication recommendation and explicit user handoff

The user confirmed Claude Pro. Prefer that existing subscription for this single-repository
pilot. Run claude setup-token LOCALLY in the user's own trusted Claude terminal and
paste its result directly into GitHub's protected environment secret form as
CLAUDE_CODE_OAUTH_TOKEN. Never paste it into chat, an issue, a PR, or a committed file.
If no trusted computer has Claude Code CLI, the user must first install the official
CLI following https://code.claude.com/docs/en/setup . It need not be installed on
this Windows computer if another trusted computer already has it. This preparation
did not install software or run setup-token. No gh CLI is needed for manual setup.
Subscription OAuth uses subscription capacity; it is not an API spend cap and
GitHub runner minutes can still incur charges. No API fallback is configured.

Use a custom GitHub App for the smallest documented permission set and deterministic
publishing after Claude exits. The official Claude App's generated token is revoked
at the end of its composite action, so it cannot be reused safely in a later
publishing step. A custom App token supplied as github_token remains available until
create-github-app-token revokes it in job cleanup. No PAT is required.

User steps, only after explicit approval:
1. Create a private custom App in https://github.com/settings/apps/new following
   https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md#using-a-custom-github-app .
   Repository permissions: Contents read/write, Issues read/write, Pull requests
   read/write; Metadata read is implicit. No account, organization, Actions,
   Workflows, administration, or deployment permissions. Disable its webhook
   (the App is an authentication identity here, not an event receiver).
   Install on ONLY civil-pavements-operations.
2. Generate/download its private key in GitHub yourself. Create the GitHub
   environment claude-approved-tasks with required human reviewers and deployment
   branch policy permitting only main. Place CLAUDE_TASK_APP_PRIVATE_KEY and
   CLAUDE_CODE_OAUTH_TOKEN in that environment's secrets. Put the App's numeric ID
   in environment variable CLAUDE_TASK_APP_ID. Do not use production secrets.
   Confirm environment protection availability for this public repository.
3. Separately review/restrict the pre-existing broad Claude workflow BEFORE adding
   repository-level auth secrets or installing the official Claude App. The custom
   route above does not need the official App or ANTHROPIC_API_KEY.
4. Review this draft and its static checks. A human may merge the inert scaffold;
   that still cannot run Claude. In a SEPARATE activation PR copy
   docs/automation/claude-approved-task.yml.disabled to
   .github/workflows/claude-approved-task.yml and remove ONLY the literal false
   conjunction. Verify pins, scope and environment protections. A human merges.
5. Explicitly set repository variable CLAUDE_TASKS_ENABLED=true after approval.
   This variable alone cannot activate this draft. Create the claude-approved label
   and one human-authored scoped test issue. Apply approval or manually dispatch.
   The reviewer approves each environment run. Do not enter secrets using an agent.
6. Validate the first draft PR, branch, local test results and full PR CI to terminal.
   Keep it draft and do not merge/deploy during this acceptance test. Confirm no
   other Claude workflow ran, and that denied actors/paths fail without AI work.
   Only then describe the implementation/review loop as tested.

Stop switch after activation: set CLAUDE_TASKS_ENABLED=false and cancel active runs
in GitHub. Disabling a variable does not cancel an already running job. Revoke the
custom App installation/key or OAuth credential through the provider if needed.

The official App alternative is https://github.com/apps/claude (verified via the
official docs). Its current full install grant is Actions, Checks, Contents,
Discussions, Issues, Pull requests, Repository hooks and Workflows read/write;
Members, Metadata and Statuses read. GitHub does not permit selecting a subset.
This draft deliberately uses the custom App route; do not install both blindly.

The user requires no extra spending. API billing, paid Claude extra usage and new
paid subscriptions are not authorized. Keep this scaffold inactive until the user
confirms Claude paid extra usage is OFF and GitHub spending is blocked outside
included/free usage. Pause when Pro allowance is exhausted; do not retry using API
billing or enable extra usage. The connector cannot verify those account settings.
The 20-turn/30-minute/concurrency controls bound work, not money, and are not a
guarantee of zero extra charges. No paid-job or credential action was performed.

## Limits and review coordination

One repository-wide concurrent run, 20 turns and a 30-minute job timeout. No schedule,
issue_comment, PR, fork, repository_dispatch or workflow_run trigger is present.
No all-bot allowlist, web tools, MCP tools, general shell allowlist, or live secrets.
Bash autoapproval is limited to npm run lint, npm run typecheck and npm test;
dontAsk rejects other unapproved commands. The publisher has no AI-controlled shell
or PR API calls. Task scope is checked before deterministic tests and again before
publication. The trusted helper is copied into RUNNER_TEMP before Claude starts.

These controls reduce authority; they are not a sandbox against malicious trusted
repository code or prompt injection. Human-authored and reviewed tasks, protected
environment approval, and a review of existing repository test/configuration code
remain required. npm tests execute repository code. Do not supply production
credentials. Do not enable Actions step debug or full Claude output in this public
repository. Local checks do not replace the existing full MySQL/build PR CI.

Task PR titles ALWAYS begin [claude-task] at creation; use that title prefix plus
repository scope for the parent review webhook. The setup PR uses [setup], so it
does not match task review. No PR label is required or added after opening, avoiding
the opening-event label race. PR author is the CUSTOM App bot, whose actual login
must be resolved after installation; don't filter by a guessed claude[bot] login.

The parent's supported webhook wakes on PR creation/head changes/human comments
or reviews, not issue events or workflow-run/check completion. After a PR wake,
the reviewer must inspect/monitor CI for that exact head SHA until terminal.
Do not assume bot comments wake it. Review findings do not automatically trigger
a second Claude run in this first version; a new human-approved scoped follow-up
issue is required. This is a staged task implementation pipeline, not an unattended
end-to-end loop.

## Validation

Run node --test .github/automation/claude-approved-task.test.cjs and
node --check .github/automation/claude-approved-task.cjs. Static checks cover
trusted actors, approved issue shape, event selection, scoped paths, frozen approval
and inert workflow. No Claude or Actions job should be dispatched during preparation.

Primary references checked 2026-09-30:
- https://code.claude.com/docs/en/github-actions
- https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
- https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md
- https://code.claude.com/docs/en/cli-reference
- Action pin fd1c128679612beff4ca259c78021c506e8aa7a7 resolved from v1
  (v1.0.237). Other actions are pinned to their current tag commit.
