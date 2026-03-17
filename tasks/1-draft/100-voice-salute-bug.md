# Bug: Voice salute (🫡) not appearing on dequeue

## Status: CLOSED

**Root cause identified and fixed** in commit `e4bd7a2` (2026-03-17). See `tasks/4-completed/2026-03-17/100-voice-salute-testing.md` for full completion report.

**Root cause:** Poller only checked global queue state (`hasPendingWaiters`, `isMessageConsumed`). In multi-session mode, messages route to session queues, so the global queue was empty — the poller would set 😴 even when a session agent was actively waiting. Fix: check `hasAnySessionWaiter()` and `isSessionMessageConsumed()` from session-queue.

## Type

Bug

## Description

Voice messages dequeued through `dequeue_update` are not getting the 🫡 reaction that signals acknowledgment to the user.

## Observed Behavior

- Messages 8811, 8814, 8815, 8817 (session of 2026-03-16) all lacked 🫡
- Message 8833 (session of 2026-03-17) also missed — confirmed by successfully setting 🫡 manually afterward

## Expected Behavior

When a voice message is dequeued via `dequeue_update`, `ackVoice` should fire and `ackVoiceMessage` should set the 🫡 reaction on the message.

## Code Path

1. `dequeue_update.ts` — `for (const evt of batch) ackVoice(evt)`
2. `ackVoice()` — checks `event.from === "user"` and `event.content.type === "voice"`, calls `ackVoiceMessage(event.id)`
3. `ackVoiceMessage()` in `telegram.ts` — resolves chat, dedup check via `getBotReaction`, fire-and-forget `trySetMessageReaction`
4. `trySetMessageReaction()` — `getApi().setMessageReaction()`, swallows all errors, returns `true/false`

## Status

Downgraded to draft — user reports salute is working as of 2026-03-17 session restart. Likely a transient issue from the previous session (possibly related to the multi-session isolation bugs that were active at the time). Monitor for recurrence.

## Investigation So Far

- `ALLOWED_USER_ID` is set (49154463) — `resolveChat()` returns a number
- `getBotReaction()` returns `null` (poller doesn't call `recordBotReaction`) — dedup is NOT the issue
- `set_reaction` tool works fine (same API, same chat) — the API layer is functional
- `trySetMessageReaction` swallows errors silently (`.then(() => true, () => false)`)
- The outbound proxy might be interfering — needs investigation
- Fire-and-forget pattern means Promise rejections could be silently lost
- No stderr output observed for `[ack] 🫡 failed for msg` — but stderr isn't easily captured in current setup

## Possible Causes

- Outbound proxy intercepting `setMessageReaction` and triggering side effects
- Race condition with poller's 😴 reaction
- API rate limiting silently eating the call
- Something in the Grammy API layer failing silently

## Next Steps

- Add temporary debug logging to `ackVoiceMessage` to confirm it's being called
- Check if `trySetMessageReaction` is actually resolving `true` or `false`
- Check outbound proxy interception of `setMessageReaction`
