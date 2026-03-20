# 05-044: Rename 1-draft to 1-drafts

**Strategy: Direct**

## Problem

All task pipeline directories use plural/past-tense names except `1-draft`:
- `0-backlog` (acceptable as-is — noun)
- `1-draft` ← singular, inconsistent
- `2-queued`
- `3-in-progress`
- `4-completed`

## Changes

1. Rename `tasks/1-draft/` → `tasks/1-drafts/`
2. Update all references in agent files, workflow docs, and instructions that mention `1-draft/`
3. Update `claim.ps1` if it references the directory

## Acceptance

- `tasks/1-drafts/` exists with all contents moved
- `tasks/1-draft/` is gone
- All references updated (grep for `1-draft` returns zero hits outside completed tasks and changelogs)
