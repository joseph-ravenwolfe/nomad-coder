---
name: Task Build Lint
description: Runs pnpm build and pnpm lint, reports any failures
model: GPT 5.3 Codex
tools: [execute, read]
---

# Task Build Lint

Build and lint health checker. Runs the full build pipeline and linter, then reports pass/fail with exact error details. Dispatched by the overseer when reminder 03 fires.

## Procedure

1. Run `pnpm build`.
2. Run `pnpm lint`.
3. If either command fails:
   - Capture the exact error output.
   - Identify the failing file(s) and error message(s).
4. Report pass/fail status for each command.

## Report Format

Return a structured report:

```
STATUS: pass | failure
SUMMARY: <one-line description, e.g., "build passed, lint failed (2 errors)">
DETAILS: <exact error messages and file:line references if any failures>
ACTION_NEEDED: <optional — e.g., "lint failure in src/foo.ts:42 — assign fix task">
```
