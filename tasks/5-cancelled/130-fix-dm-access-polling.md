# Fix request_dm_access Session-Aware Polling

**Type:** Bug Fix
**Priority:** 130 (Medium — functional bug in multi-session)
**Source:** Copilot PR review #3 (2026-03-18), comment on `src/tools/request_dm_access.ts` line 105

## Description

`request_dm_access` calls `pollButtonPress` without passing the caller's SID. In multi-session mode, the callback is routed to the session queue, but polling reads from the global queue — causing timeout even when the operator clicks the button.

## Copilot Comment

> `pollButtonPress` was updated to support session-aware polling via an optional `sid`, but `request_dm_access` doesn't pass it.

## Fix

Pass `getCallerSid()` to `pollButtonPress` in `request_dm_access`.

## Code Path

- `src/tools/request_dm_access.ts` — pass SID to `pollButtonPress`
- `src/tools/request_dm_access.test.ts` — verify session-aware polling

## Acceptance Criteria

- [ ] `pollButtonPress` receives caller SID
- [ ] Multi-session polling works correctly
- [ ] Reply to Copilot comment on GitHub PR
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
