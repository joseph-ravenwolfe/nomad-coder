Session — Manage Telegram agent sessions.

Routes:
- session/start — create new session OR recover an existing same-transport session (idempotent)
- session/list — list all active sessions
- session/close — close current or target session
- session/rename — rename current session
- session/idle — list idle (unresponsive) sessions

action(type: "session") — lists sub-paths in live API.

Token: opaque integer. Save immediately after session/start.
First session = governor by default. Second+ require operator approval.

Recovery: there is no separate session/reconnect verb in v8. If your token is lost (e.g. compaction wiped it), call session/start again with the same name — same-transport recovery returns the existing token (action: "recovered"), preserving queued messages.

Related: profile/load, shutdown, dequeue
