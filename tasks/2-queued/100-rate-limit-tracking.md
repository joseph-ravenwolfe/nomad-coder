# Track Telegram Rate Limits Server-Side

**Type:** Hardening / Future Feature
**Priority:** 300 (Low — nice-to-have, not blocking v4 release)

## Description

When Telegram returns a 429 rate limit error with `retry_after`, the server returns the error to the caller but does **not** persist the rate limit window. Subsequent sends during the ban window still attempt Telegram API calls, wasting cycles and potentially extending the ban.

## Current Behavior

- Agent sends rapid messages → Telegram returns 429 with `retry_after: 45`
- Server returns error to caller
- Next tool call immediately attempts another API call → gets 429 again
- Ban window may extend

## Desired Behavior

- On 429, track `_rateLimitUntil = Date.now() + (retry_after * 1000)` in `telegram.ts`
- Subsequent API calls during the window return a `RATE_LIMITED` error immediately without hitting Telegram
- After the window expires, resume normal operation

## Code Path

- `src/telegram.ts` — wrap the API call layer with rate limit tracking
- Tests: add tests for 429 handling, window enforcement, window expiry

## Acceptance Criteria

- [ ] 429 errors set a rate limit window in `telegram.ts`
- [ ] Subsequent API calls during the window return `RATE_LIMITED` error without calling Telegram
- [ ] After the window expires, calls resume normally
- [ ] Tests cover: window set on 429, blocked during window, unblocked after expiry
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
