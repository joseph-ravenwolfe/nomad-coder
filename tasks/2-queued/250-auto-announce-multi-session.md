# Feature: Auto-Announce Multi-Session Activation

## Type

Feature / UX

## Description

When the second session joins and is approved, the server should automatically:

1. Switch routing to governor mode (SID 1 = governor)
2. Start injecting name tags on all outbound messages
3. Notify both sessions that multi-session mode is active

This makes multi-session "just work" — no manual configuration needed.

## Dependencies

- **200-governor-default-routing** — governor auto-activation logic
- **200-session-approval-gate** — approval before session creation
- **300-mandatory-message-headers** — name tag injection

## Current State

`session_start.ts` creates the session and sends an intro message. It already reports `fellow_sessions` when `sessionsActive > 1`. But it does NOT:

- Change routing mode
- Notify the existing session(s)
- Trigger name tag injection

## Code Path

1. `src/tools/session_start.ts` — after session creation, orchestrates the announce
2. `src/routing-mode.ts` — `setRoutingMode("governor", firstSessionSid)`
3. `src/session-queue.ts` — `broadcastOutbound()` can deliver notifications to all sessions
4. `src/outbound-proxy.ts` — name tag injection checks `activeSessionCount()` to decide

## Design

### Trigger

After `createSession()` succeeds and `activeSessionCount()` transitions from 1 → 2:

1. Auto-set routing: `setRoutingMode("governor", lowestActiveSid)`
1. Inject name tags: `activeSessionCount() > 1` is the only guard needed — outbound proxy checks this
1. Notify existing session(s) via internal broadcast:

    ```text
    📢 Multi-session active. 🤖 Worker has joined.
    Routing: governor (🤖 Primary handles ambiguous messages).
    ```

1. Return to the new session with routing info in the `session_start` response

### Teardown

When `activeSessionCount()` drops from 2 → 1:

1. Disable name tags (proxy stops prepending)
2. Reset routing to default
3. Notify remaining session: "Single-session mode restored"

## Acceptance Criteria

- [ ] Governor mode auto-activates when 2nd session joins
- [ ] Existing session(s) receive notification about new session
- [ ] Name tags start appearing on outbound messages immediately
- [ ] Teardown: name tags stop and routing resets when back to 1 session
- [ ] Remaining session notified on teardown
- [ ] Test: 2nd session join triggers auto-governor
- [ ] Test: close back to 1 session resets routing
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`
