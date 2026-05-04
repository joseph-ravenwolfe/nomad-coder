Post-Compaction Recovery (Telegram side)

You just lost conversational context. This help topic covers Telegram/MCP recovery only — your agent harness injects the agent-specific checklist on startup.

1. Your session token is in your memory if previously configured. Read it from there.
2. If token is present: `dequeue(max_wait: 0, token)` to drain pending messages and confirm the bridge link.
3. If token is missing or `dequeue` returns AUTH_FAILED: call `action(type: 'session/start', name: '<your_name>')`. Two possible outcomes:
   - `action: "recovered"` — the bridge recognized your HTTP transport and returned the token of the session you previously created. Queued messages from the lapse are in `pending`. Use the returned `token` and `watch_file`.
   - `action: "fresh"` — your previous session is gone (transport closed before recovery, or this is genuinely a new session). Continue normally.
4. Resume your Monitor watcher (or arm one) and dequeue loop.

For a richer refresher, call:

- `help('guide')` — full communication/routing protocol
- `help('send')` — message forms (text, voice, hybrid, buttons, checklist, progress)
- `help('reactions')` — reaction priority queue, voice auto-salute, temporary vs permanent
- `help('presence')` — show-typing, animations, presence cascade
- `help('reminders')` — reminder-driven delegation pattern
- `help('identity')` — bot + server version (requires token)
