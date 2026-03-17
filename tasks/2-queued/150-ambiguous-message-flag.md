# Feature: Ambiguous Message Flag in Dequeue Response

## Type

Feature / Routing UX

## Description

When governor routing is active, `dequeue_update` should include a `routing` field on each event so the receiving agent knows whether the message was targeted (reply-to a known bot message) or ambiguous (fresh message, no reply-to context).

This lets agents implement the multi-session protocol: "Did the user mean this for me, or should I route it elsewhere?"

## Dependencies

- **200-governor-default-routing** — governor mode must be active for ambiguous vs targeted to matter

## Current State

`dequeue_update` returns events as `{ id, event, from, content }`. There is no routing metadata. The routing decision happens in `session-queue.ts` `routeMessage()` but the result isn't propagated to the consumer.

## Code Path

1. `src/session-queue.ts` — `routeMessage()` already classifies messages as targeted (reply-to) or ambiguous (fresh)
2. `src/message-store.ts` — `recordInbound()` stores events; could tag routing metadata
3. `src/tools/dequeue_update.ts` — formats the response; would include the routing field
4. `src/update-sanitizer.ts` — strips fields from events before returning to agent

## Design

### Event shape (multi-session, governor active)

```json
{
  "id": 8910,
  "event": "message",
  "from": "user",
  "routing": "ambiguous",
  "content": { "type": "text", "text": "Hey, can you check on that?" }
}
```

### Routing values

| Value | Meaning |
| --- | --- |
| `"targeted"` | User replied to a bot message → routed to the session that sent it |
| `"ambiguous"` | Fresh message, no reply-to → routed to governor by default |
| (omitted) | Single-session mode or no routing active |

### Agent protocol

When an agent dequeues a message with `routing: "ambiguous"`:

1. Consider: "Is this for me based on context?"
2. If yes → handle normally
3. If no → use `route_message(target_sid)` to forward
4. If unsure → handle it (governor is the fallback, it's OK)

## Acceptance Criteria

- [ ] `dequeue_update` includes `routing: "ambiguous"` or `routing: "targeted"` on events when governor routing is active
- [ ] `routing` field is omitted entirely in single-session mode (backward compat)
- [ ] Targeted messages (reply-to bot message) tagged as `"targeted"`
- [ ] Ambiguous messages (no reply-to) tagged as `"ambiguous"`
- [ ] Test: governor active + fresh message → `routing: "ambiguous"`
- [ ] Test: governor active + reply-to → `routing: "targeted"`
- [ ] Test: single session → no `routing` field
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`
