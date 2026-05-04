# Bridge Restart Protocol (v8)

## Overview

The bridge does NOT persist session state across process restarts. When the
bridge restarts (planned shutdown, crash, launchd kickstart, etc.), every
in-memory session is gone, every HTTP transport is closed, and every agent's
MCP client receives a connection drop.

There is no separate "reconnect" verb. Recovery is uniform:

1. Agent's MCP client re-establishes the HTTP transport on its next request
   (or the agent process exits, in which case `cc` reconnects on next launch).
2. Agent calls `action(type: "session/start", name: "<same name>")`.
3. Bridge has no record of any session — returns `action: "fresh"` with a new
   token, sid, and watch_file.

The agent should treat its previous token as invalid the moment a request
fails with `AUTH_FAILED` or its MCP client reports a transport disconnect.

---

## Why no persistence?

In v7, the bridge persisted session metadata to `session-state.json` and tried
to restore SIDs across restarts. That added a "planned bounce" mode with a
state file and a special-cased reconnect path that skipped operator approval.

In v8 we deleted that. The reasoning:

- HTTP-tied lifetime means a bridge restart always kills the agent's MCP
  transport, which means the agent's existing token is dead anyway.
- Restoring SIDs across restart created a parallel code path that was rarely
  exercised correctly and produced confusing edge cases (mismatched HTTP
  UUIDs, stale watch files, governor reassignment races).
- Same-transport recovery (the `action: "recovered"` path in `session/start`)
  handles the *intra-transport* recovery case that actually mattered:
  compaction wiping the agent's token while the MCP client stays connected.

---

## Same-transport recovery (NOT a restart concern)

`session/start` is idempotent on same-transport: if a same-named session is
already bound to the calling HTTP transport, the bridge returns its token
with `action: "recovered"` instead of creating a new one. This handles
"compaction wiped my token" without requiring the bridge to restart or
operator approval.

This is unrelated to bridge restart — it's purely about the agent's working
memory inside a single HTTP transport lifetime. See `docs/help/session/start.md`.

---

## Inter-restart probe

If you want to know whether the bridge is alive after a perceived disconnect:

```
action(type: "session/list")
# → { sids: [...] }  (any active SIDs, including yours if any)
```

`session/list` accepts an optional token; called without one it returns the
SID list only — safe as a liveness probe.

---

## Implementation Notes

- HTTP transport lifecycle owned by `src/http-transport-registry.ts` and
  the streamable-http handler in `src/index.ts`.
- `transport.onclose` calls `findSessionsByHttpId()` and `closeSessionById()`
  to tear down any bridge sessions bound to the closing transport.
- `session/start` checks `getCurrentHttpSessionId()` and falls back to the
  same-transport idempotency path when an existing same-named session matches
  the caller's HTTP UUID.
- No `session-state.json`, no `markPlannedBounce()`, no `restoreSessions()`.
