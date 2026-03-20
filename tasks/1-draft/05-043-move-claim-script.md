# 05-043: Move claim.ps1 to tasks/

**Strategy: Direct**

## Problem

`scripts/claim-task.ps1` is a task-workflow-specific script. It belongs in `tasks/` alongside the workflow docs and pipeline directories so the entire `tasks/` folder is self-contained and portable to other repos.

## Changes

1. Move `scripts/claim-task.ps1` → `tasks/claim.ps1`
2. Update all references in agent files (overseer.agent.md, worker.agent.md) to point to `tasks/claim.ps1`
3. If `scripts/` is now empty (only had `gen-build-info.mjs`), leave it — that script serves a different purpose

## Acceptance

- `tasks/claim.ps1` exists and works
- `scripts/claim-task.ps1` is deleted
- All agent docs reference the new path
- No broken references
