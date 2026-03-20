# Task #028: Worker Animation Identity (Docs)

**Priority:** 25 | **Status:** Draft

## Problem

Workers use the same animation presets as the governor (thinking, working), making them visually indistinguishable in the chat.

## Solution

Update worker instructions to encourage creating distinctive custom presets:

1. On session start, call `set_default_animation` with unique preset names (e.g., `worker:thinking`, `worker:working`) using different unicode frames
2. Store custom preset definitions in session memory so they survive compaction
3. Use these custom presets for `show_animation` calls instead of the built-in ones

## Scope

- `.github/instructions/worker-rules.instructions.md` — add animation identity guidance
- `docs/communication.md` — add section on worker animation conventions
- Example preset definitions for workers to copy

## Related

- Task #TBD: Server-side animation persistence (separate story)
