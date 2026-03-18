# Color Tags On by Default

**Type:** Feature Change
**Priority:** 050 (Critical — design decision)

## Description

Session color tags must be **on by default** — not behind a feature flag. If there's a name tag (multi-session mode), it always has a color. Remove the feature flag and make colors unconditional.

## Current Behavior

- `isSessionColorTagsEnabled()` checks a config flag, defaults to `false`
- `buildHeader()` only prepends color when the flag is `true`

## Desired Behavior

- Remove `sessionColorTags` config option and `isSessionColorTagsEnabled()` / `setSessionColorTags()`
- `buildHeader()` always prepends color when in multi-session mode and session has a color
- Sessions always get a color assigned on creation

## Code Path

- `src/config.ts` — remove `sessionColorTags` field, `isSessionColorTagsEnabled()`, `setSessionColorTags()`
- `src/outbound-proxy.ts` — `buildHeader()`: remove the feature flag check, always use color
- `src/outbound-proxy.test.ts` — update tests: remove flag toggle tests, color is always on
- `docs/multi-session.md` — remove feature flag mention

## Acceptance Criteria

- [ ] No `sessionColorTags` config option exists
- [ ] `buildHeader()` always uses color in multi-session mode
- [ ] Tests updated — no flag toggling, color always present
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
