# Enforce Identity on All Tool Calls

**Type:** Security / Architecture
**Priority:** 010 (Critical — auth model must be correct before release)
**Supersedes:** Task 060 (auth-gate dequeue_update — now part of this task)

## Design Intent (from operator)

> "Every tool except for very few must have an identity. Once you've received your identity from session_start, you reuse it. You don't pass around your pin code — you use it yourself. SID could be targeting a different session (like DMs). But YOUR identity is always present."
>
> "Multi-session mode is all the time. It's never not multi-session mode. The only thing that changes with one session is UI (name tags not shown). That's it."

## Key Rule

**`identity` is ALWAYS required.** There is no "single-session bypass." The server is always in multi-session mode. The 1-session case only affects UI (name tags). `requireAuth()` must NEVER skip auth because there's only one session.

## Current State (3 patterns)

| Pattern | Tools | Auth | Problem |
| --- | --- | --- | --- |
| A (strict) | close_session, route_message, send_direct_message | Explicit sid+pin via `checkAuth` | ✅ Correct |
| B (flexible) | send_text, send_message, notify, show_animation, send_text_as_voice | Optional `identity: [sid, pin]`, required in multi-session | ⚠️ Close but "optional" is wrong |
| C (already have identity) | ask, confirm, choose + 30 more | `identity` tuple + `requireAuth()` — but optional bypass | ⚠️ Remove bypass |
| Hybrid | dequeue_update | Conditional auth (only when sid passed) | ❌ Must always auth |

## Desired State

**All tools accept `identity: [sid, pin]`** — ALWAYS required (not optional):

- `identity` is required on every tool call, period
- No "single-session" bypass — the server is always multi-session
- `requireAuth()` must always validate, never skip
- The only difference with 1 session vs 2+ is UI (name tags shown or not)
- Middleware ALS remains as internal plumbing but is NOT a substitute for explicit auth

## Changes Needed

### 1. Remove single-session bypass from `requireAuth()`:

- `src/session-gate.ts` — remove the `activeSessionCount() <= 1` bypass
- `requireAuth()` must ALWAYS validate identity, never skip
- If identity is omitted, return `SID_REQUIRED` error (no fallback to `getActiveSession()`)

### 2. Convert 5 tools from separate `sid`/`pin` to `identity` tuple:

- `src/tools/close_session.ts` — replace `SESSION_AUTH_SCHEMA` (separate sid/pin) with `identity` tuple + `requireAuth()`
- `src/tools/route_message.ts` — same
- `src/tools/send_direct_message.ts` — same (note: also has `target_sid` for the recipient — keep that separate)
- `src/tools/rename_session.ts` — same
- `src/tools/dequeue_update.ts` — replace separate optional `sid`/`pin` with required `identity` tuple + `requireAuth()`

### 3. No-auth tools (leave as-is):

- `session_start` — creates credentials, no auth possible before session exists
- `get_me` — bot info, public
- `get_agent_guide` — docs, public
- `list_sessions` — discovery, public
- `shutdown` — system level

### 4. 35 tools already have `identity` tuple — just remove "optional" semantics:

- These already call `requireAuth(identity)` — the bypass removal in step 1 makes them enforce auth automatically
- No changes needed in the tool files themselves

### Tests:

- Update test files for ask, confirm, choose, dequeue_update
- Add tests: missing identity in multi-session → error
- Add tests: valid identity → success

### Docs:

- Update `docs/multi-session.md` — all tools require identity in multi-session mode
- Update `docs/design.md` — auth model section

## Acceptance Criteria

- [ ] All tools accept `identity: [sid, pin]` as a required parameter
- [ ] `requireAuth()` always validates — no single-session bypass
- [ ] Tool calls without valid identity return `AUTH_FAILED` or `SID_REQUIRED`
- [ ] No tool relies solely on ALS for auth — `requireAuth()` is the gate
- [ ] dequeue_update uses `identity` tuple like everything else
- [ ] Tests cover auth enforcement for all modified tools
- [ ] Reply to Copilot comment on GitHub PR (dequeue_update auth)
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated
