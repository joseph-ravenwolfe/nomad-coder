# Feature: SID Required on All Tools

## Type

Feature / Safety

## Description

When multiple sessions are active, SID must be required on **every** tool call — not just `dequeue_update`. Currently only `dequeue_update` enforces `SID_REQUIRED` when `activeSessionCount() > 1`. The remaining 36 tools silently fall back to `getActiveSession()`, which is a race condition when two agents share a server process.

## User Quote

> "It's not optional. For any messages now, nothing is ever optional."

## Current State

**Already enforced (2 patterns):**

- `dequeue_update` — explicit `sid` parameter (optional), returns `SID_REQUIRED` error when omitted with `activeSessionCount() > 1` (commit `aa2006b`)
- 5 session-auth tools — use `SESSION_AUTH_SCHEMA` (requires `sid` + `pin`): `close_session`, `pass_message`, `request_dm_access`, `route_message`, `send_direct_message`

**Not yet enforced (37 tools):**

`answer_callback_query`, `append_text`, `ask`, `cancel_animation`, `choose`, `confirm`, `delete_message`, `download_file`, `dump_session_record`, `edit_message`, `edit_message_text`, `get_agent_guide`, `get_chat`, `get_debug_log`, `get_me`, `get_message`, `list_sessions`, `notify`, `pin_message`, `send_chat_action`, `send_choice`, `send_file`, `send_message`, `send_new_checklist`, `send_new_progress`, `send_text`, `send_text_as_voice`, `session_start`, `set_commands`, `set_default_animation`, `set_reaction`, `set_topic`, `show_animation`, `show_typing`, `shutdown`, `transcribe_voice`, `update_progress`

## Code Path

1. `src/session-manager.ts` — `activeSessionCount()` returns `_sessions.size` (L81)
2. `src/session-auth.ts` — `SESSION_AUTH_SCHEMA` defines `sid`/`pin` Zod fields; `checkAuth(sid, pin)` validates via `validateSession()`
3. `src/tools/dequeue_update.ts` — reference implementation of `SID_REQUIRED` gate (L72-80)
4. Each tool file in `src/tools/*.ts` — `register(server)` calls `server.registerTool()` with `inputSchema`

## Design Decisions

### Which tools need SID?

**All tools** when `activeSessionCount() > 1`. No exceptions. Even read-only tools like `get_me` and `list_sessions` need to know who's asking for logging and attribution.

### Authentication method

**Updated requirement (2026-03-17 voice direction):** All gated tools require **both `sid` AND `pin`** as the first two parameters. Not just SID — PIN authenticates the caller, preventing any agent from accidentally or intentionally using another session's SID. Two numbers = minimal token cost.

**Exempt tools** (no sid/pin required): `session_start`, `shutdown`, `get_agent_guide`, `get_me`

**All other tools:** `sid` (number, required when multi-session) + `pin` (number, required when multi-session). When `activeSessionCount() <= 1`, both are optional (backward compat). When `activeSessionCount() > 1` and either is omitted/invalid, return `SID_REQUIRED` or `AUTH_FAILED` error.

The existing `SESSION_AUTH_SCHEMA` pattern (used by `close_session`, `pass_message`, etc.) already validates both — extend this to all gated tools via the shared `requireSid()` helper, which should become `requireAuth(sid, pin)`.

> **Previous design (superseded):** SID-only on non-auth tools, PIN only on cross-session tools. Per operator direction, PIN is now universal.

### Implementation pattern

Extract the gate logic into a shared helper:

```typescript
// src/session-gate.ts
export function requireAuth(sid: number | undefined, pin: number | undefined):
  ErrorResult | number {
  if (activeSessionCount() <= 1) return getActiveSession() || 0;
  if (sid === undefined) return toError({ code: "SID_REQUIRED", ... });
  const session = validateSession(sid, pin);
  if (!session) return toError({ code: "AUTH_FAILED", ... });
  return sid;
}
```

Then in each tool handler: `const _sid = requireAuth(args.sid, args.pin); if (isError(_sid)) return _sid;`

## Exempt Tools

These tools do NOT require sid/pin: `session_start`, `shutdown`, `get_agent_guide`, `get_me`, `list_sessions`

## Acceptance Criteria

- [ ] All gated tools add `sid` and `pin` as optional parameters (first two params)
- [ ] All gated tools return `SID_REQUIRED` when `sid` omitted and `activeSessionCount() > 1`
- [ ] All gated tools return `AUTH_FAILED` when `pin` is wrong or missing (multi-session)
- [ ] All gated tools work unchanged when only 1 session is active (backward compat)
- [ ] Exempt tools (`session_start`, `shutdown`, `get_agent_guide`, `get_me`, `list_sessions`) have no sid/pin gate
- [ ] Shared `requireAuth(sid, pin)` helper — no copy-paste gate logic
- [ ] Test: multi-session + no sid → `SID_REQUIRED`
- [ ] Test: multi-session + wrong pin → `AUTH_FAILED`
- [ ] Test: multi-session + valid sid+pin → works
- [ ] Test: single session + no sid/pin → works normally
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`
