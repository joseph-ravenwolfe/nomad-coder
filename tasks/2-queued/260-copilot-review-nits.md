# Fix Copilot Review Nits (zod import, regex, error codes, docs)

**Type:** Code Quality
**Priority:** 260 (Low — cleanup batch)
**Source:** Copilot PR review #3 (2026-03-18), comments 3-6

## Description

Four low-priority items from Copilot review. Bundle into one task.

### 3. `get_debug_log.ts` zod import

Uses `import { z } from "zod/v4"` — should be `import { z } from "zod"` for consistency.

### 4. `rename_session.ts` regex constant

Inline regex should be extracted to a named module-level constant.

### 5. `rename_session.ts` error code mismatch

Uses `NAME_TAKEN` but central `TelegramErrorCode` has `NAME_CONFLICT`. Standardize.

### 6. `routing-mode.ts` stale doc comment

Module comment says "only governor supported" but we have 3 routing modes.

## Code Path

- `src/tools/get_debug_log.ts` — fix import
- `src/tools/rename_session.ts` — extract regex, fix error code
- `src/routing-mode.ts` — update module doc comment

## Acceptance Criteria

- [ ] zod import uses `"zod"` not `"zod/v4"`
- [ ] Regex extracted to named constant
- [ ] Error code standardized to `NAME_CONFLICT`
- [ ] Module doc updated to reflect 3 routing modes
- [ ] Reply to all 4 Copilot comments on GitHub PR
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
