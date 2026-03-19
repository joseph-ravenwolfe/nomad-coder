# 540 — confirm.ts: use validated `_sid` instead of `getCallerSid()`

**PR Review Threads:** `PRRT_kwDORVJb9c51emLO`, `PRRT_kwDORVJb9c51emLj`

## Problem

In `src/tools/confirm.ts`, the tool handler validates the session via `requireAuth(identity)` and stores the result in `_sid` (line 84). However, two later callsites use `getCallerSid()` instead of the already-validated `_sid`:

1. **Line 92** — pending-updates guard:
   ```ts
   const sid = getCallerSid();  // ← should be _sid
   ```

2. **Line 171** — `pollButtonOrTextOrVoice` call:
   ```ts
   onVoiceDetected, signal, getCallerSid(),  // ← should be _sid
   ```

## Fix

Replace both `getCallerSid()` calls with `_sid`. If `getCallerSid` is no longer used anywhere in the file, remove the import.

## Acceptance

- Both callsites use `_sid`.
- Dead import removed if applicable.
- All tests pass.
