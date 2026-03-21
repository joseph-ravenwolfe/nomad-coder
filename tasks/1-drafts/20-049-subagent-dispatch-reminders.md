# 049 — Subagent Dispatch for Reminders

**Strategy: Direct**

## Goal

Convert overseer reminders from "do-it-yourself procedures" to "dispatch a specialist subagent." The overseer's reminder handler becomes: read the agent prompt, fire `runSubagent`, read the report, act on findings.

## Background

Currently, when a reminder fires (e.g., "check PRs"), the overseer loads the full context itself — reads PR diffs, runs builds, checks markdown lint. This wastes overseer context on mechanical work.

The new model: each reminder that can be automated becomes a `.agent.md` file in `tasks/agents/`. The overseer fire-and-forgets a subagent with the prompt, gets back a structured report, and acts on it (queue tasks, notify operator, etc).

## Deliverables

### 1. Create `tasks/agents/` directory

Agent prompt templates for subagent dispatch. These are NOT VS Code agents (not in `.github/agents/`). They're prompt templates the overseer reads and passes to `runSubagent`.

### 2. Create agent prompt files

Each file follows a standard structure: identity, tools needed, procedure, report format.

| File | Replaces Reminder | What it Does |
|---|---|---|
| `pr-review.agent.md` | 08 (PR review exhaustion) | Check open PRs for Copilot/human comments, CI status. Fix trivial comments inline, reply. Report unresolvable issues for task creation |
| `pr-health.agent.md` | 09 (PR health check) | List open PRs. Check new comments, CI status, Dependabot. Report items needing attention |
| `build-lint.agent.md` | 03 (build/lint health) | Run `pnpm build && pnpm lint`. Report pass/fail with error details |
| `test-suite.agent.md` | 04 (test suite health) | Run `pnpm test`. Report pass/fail, test count, failures |
| `changelog-audit.agent.md` | 05 (changelog review) | Diff unreleased.md vs recent commits. Flag behavior changes without entries |
| `doc-hygiene.agent.md` | 06 (doc hygiene) | Scan docs for broken links, stale content, formatting issues. Fix trivial issues |
| `markdown-lint.agent.md` | (new) | Run markdownlint on all .md files. Report violations and auto-fix where possible |

### 3. Reminders that stay with the overseer

These require session state and should NOT be subagent-dispatched:

| Reminder | Why Overseer-Only |
|---|---|
| 01 (task board hygiene) | Requires task board judgment, worker assignment decisions |
| 02 (git state audit) | Quick `git status` — not worth subagent overhead |
| 07 (operator check-in) | Requires Telegram session for `notify` |
| 10 (worker health) | Requires `list_sessions` and DM capability |
| 11 (server build drift) | Quick `get_me()` comparison — not worth subagent overhead |

### 4. Update overseer agent file

Update `.github/agents/overseer.agent.md` reminder table to distinguish:
- **Direct reminders** — overseer handles inline (quick checks)
- **Dispatch reminders** — overseer fires subagent, reads report, acts on findings

### 5. Update reminder procedures

Either update or replace the existing `tasks/reminders/` files to reference the new agent dispatch pattern.

## Agent Prompt Template Structure

```markdown
# [Agent Name]

## Identity
One-line role description.

## Tools
List of tools this agent should use.

## Procedure
Step-by-step instructions.

## Report Format
What the agent should return to the caller.
```

## Report Contract

Every subagent returns a structured report the overseer can parse:

```
STATUS: pass | findings | failure
SUMMARY: one-line description
DETAILS: (optional) specifics
ACTION_NEEDED: (optional) what overseer should do
```

## Acceptance Criteria

- [ ] `tasks/agents/` directory exists with 7+ agent prompt files
- [ ] Each agent file has identity, procedure, and report format sections
- [ ] Overseer agent file updated with dispatch vs. direct reminder classification
- [ ] `tasks/reminders/README.md` updated to reference new pattern
- [ ] At least one agent (pr-review or build-lint) successfully tested via `runSubagent`
