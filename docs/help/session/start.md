session/start — Create a new Telegram session OR idempotently recover an existing one.

Returns a session token. Pass it on every subsequent call.

In v8, this verb does double duty:

- **Fresh creation** (`action: "fresh"`): no session with this name exists, OR the
  caller is on a different HTTP transport than any same-named session. Second+
  sessions require operator approval via Telegram color-picker dialog.
- **Same-transport recovery** (`action: "recovered"`): a session with this name
  already exists AND was created on the SAME MCP HTTP transport that's making
  this call. The bridge silently returns the existing session's token,
  preserving queued messages (`pending` reflects the queue depth). No operator
  approval, no chat noise. This handles the "agent forgot its token after
  compaction" failure mode without a separate reconnect verb.

## Params
name: display name (optional for first session, required for 2nd+; letters, digits, spaces only)
color: preferred color emoji hint for approval dialog (optional, ignored on recovery)
  Palette: 🟦 Coordinator · 🟩 Builder · 🟨 Reviewer · 🟧 Research · 🟥 Ops · 🟪 Specialist

## Example — fresh
action(type: "session/start", name: "Worker 2", color: "🟩")
→ { token: 3165424, sid: 3, suffix: 165424, sessions_active: 2, action: "fresh", pending: 0, discarded: 0, watch_file: "..." }

## Example — recovery
action(type: "session/start", name: "Worker 2")  // after compaction wiped your token
→ { token: 3165424, sid: 3, suffix: 165424, sessions_active: 2, action: "recovered", pending: 4, discarded: 0, watch_file: "..." }

Save token immediately — two formats accepted:

- Minimal: write raw token integer to `<Name>/telegram/session.token`
- Full: YAML body in `<Name>/telegram/session.md` with `token:`, `sid:`, `name:`, `started:` fields — no PIN field

## After start (or recovery)

1. Load profile: action(type: "profile/load", token: ..., key: "Worker")
2. Verify reminders: action(type: "reminder/list", token: ...)
3. Arm Monitor on watch_file; drain via dequeue(token: ..., max_wait: 0) on each notification

## Error cases
NAME_CONFLICT → a different agent owns this name. Retry with a unique-suffix name (e.g. "Worker 22").
SESSION_DENIED → operator denied a fresh second+ session; do not retry.

Related: session/list, session/close, profile/load