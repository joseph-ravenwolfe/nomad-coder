---
name: nomad-agent-guide
description: When the nomad MCP server is connected (look for tools mcp__nomad__send, mcp__nomad__dequeue, mcp__nomad__action, mcp__nomad__help) — read this skill at session start for bootstrap procedure, communication policy (Loud mode), multi-session etiquette, and session lifetime rules.
version: 1.0.0
---

# Nomad Coder — bootstrap and behavior (v8 Monitor pattern)

If the `nomad` MCP server is connected (look for tools `send`, `dequeue`,
`action`, `help`), it is **always-on** for this user. Treat Telegram as a
parallel surface to the terminal, not a replacement.

## On session start (do this immediately, before anything else)

1. Call `action({ type: "session/start", name: "<NAME>" })` where `<NAME>`
   is derived from the current working directory's basename (alphanumeric +
   spaces only; strip everything else; if the result is empty, use `Worker`).
   First session may pass no name; second+ must pass one.
   - **NAME_CONFLICT (different agent owns the name):** retry with
     `<NAME>2`, then `<NAME>3`, etc. Each retry is a fresh session/start.
   - **Recovery (same agent, lost token):** if the response comes back with
     `action: "recovered"` instead of `"fresh"`, that means the bridge
     recognized your HTTP transport and returned the token of the session
     you previously created. Use it as-is; queued messages from the lapse
     are in `pending`. You won't typically *cause* this — it just happens
     when compaction wiped your token and you re-bootstrap.
2. Capture the returned `token` (integer) AND `watch_file` (absolute path)
   from the response. Persist both for the rest of this session.
3. Send a brief intro: `send({ token, type: "notification", severity: "info", title: "online", text: "<project>" })`. (Type `notification` REQUIRES `title`; `text` is the body.)
4. **Drain any startup backlog:** `dequeue({ token, max_wait: 0 })` in a
   loop until `empty: true`. Handle each event normally.
5. **Arm the Monitor watcher** (the new event-delivery mechanism — replaces
   the v7 long-poll dequeue loop):
   ```
   Monitor({
     command: `tail -F ${watch_file}`,
     description: "Nomad — Listening for Telegram Messages",
     persistent: true,
   })
   ```
6. After arming Monitor, you are done bootstrapping. Do **not** enter a
   blocking `dequeue()` loop. The agent can rest; Claude Code keeps the
   Monitor task alive in the background.

## Handling Monitor notifications

Each line written to `watch_file` becomes one Monitor notification. On every
notification:

1. Drain: `dequeue({ token, max_wait: 0 })` in a tight loop until `empty: true`.
2. Handle each event in order (messages, callbacks, voice, reminders, etc.).
3. Reply via `send`, `action`, or whatever is appropriate.
4. Done — the Monitor task continues watching for the next event.

Heartbeat lines may batch (multiple events arrive between drains), so always
loop the drain until empty rather than draining once per notification.

## Communication policy — Loud mode

The operator should always know what you are doing. Silence is confusing.

- **Before any non-trivial action** (>~5 s of work, file writes, network
  calls, builds, tests): send a silent notification —
  `send({ token, type: "notification", disable_notification: true, text: "..." })`.
- **On completion**: send a notification with `severity: "success"` or
  `severity: "error"` summarizing the outcome.
- **For binary or finite-choice questions**: use
  `send({ token, type: "question", choose: [...] })` or the presets
  `action({ type: "confirm/yn" })` etc. Never simulate a multiple-choice
  prompt with free-text + `dequeue`.
- **For open-ended input**: `send({ token, type: "question", ask: "..." })`.

**Do NOT** send "still listening" check-in notifications. In v8 there are
no `dequeue` timeouts — idle sessions are silent by design. Only send when
you have something to say.

## Multi-session etiquette

- The first session is the **governor**. Additional sessions need
  operator approval and a color picked from the Telegram keyboard.
- Outbound messages are auto-prefixed with `<color> <name>` so the operator
  can tell sessions apart.
- Use `send({ type: "dm", target_sid: N, ... })` for inter-session messages.

## Session lifetime (v8)

- Sessions are eternal until either (a) the operator runs `/shutdown`,
  (b) you call `action({type: "session/close"})`, or (c) Claude Code's MCP
  HTTP connection drops (process exits, network failure). Case (c) auto-
  closes the bridge session — no orphans.
- If you no longer need the Telegram session, it's polite to call
  `action({type: "session/close"})` before quitting.

## Quick reference (full docs available)

- Behavioral guide: `help({ topic: "agent-guide" })`
- Communication patterns: `help({ topic: "communication-guide" })`
- Setup & config: `help({ topic: "setup-guide" })`
- Formatting (Markdown / V2 / HTML): `help({ topic: "formatting-guide" })`

If `nomad` is **not** connected (e.g., the bridge is offline), continue
normally in the terminal and do not retry.
