#!/usr/bin/env bash
# Nomad Coder — SessionEnd hook handler
#
# Fires when Claude Code exits cleanly (`/exit`, Ctrl-C, `/clear`, logout,
# resume). Tells the bridge to close the matching bridge session
# deterministically — without waiting for the MCP HTTP transport's
# `onclose` event, which has historically been late or absent on forced
# exits and was the original reason we briefly tried a server-driven
# liveness pinger.
#
# Best-effort:
#   * 2 s curl timeout — never delay CC's exit
#   * No `set -e`: any failure (bridge offline, missing session_id, etc.)
#     should exit 0 so we don't pollute the operator's terminal on shutdown
#   * Crash exits (kill -9, OOM, segfault) bypass this hook entirely;
#     those are caught by the long-tail health check in `health-check.ts`.

BRIDGE_URL="http://127.0.0.1:3099/mcp"

# Read the hook payload. Claude Code emits a JSON object on stdin:
#   { "session_id": "<UUID>", "transcript_path": "...", "cwd": "...",
#     "hook_event_name": "SessionEnd", "reason": "<matcher>" }
HOOK_INPUT="$(cat || true)"
[ -z "$HOOK_INPUT" ] && exit 0

# Extract session_id. Empty → nothing to do.
CC_SESSION_ID="$(printf '%s' "$HOOK_INPUT" | node -e "
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => {
    try { const o = JSON.parse(buf); process.stdout.write(String(o.session_id ?? '')); }
    catch { process.stdout.write(''); }
  });
" 2>/dev/null || true)"
[ -z "$CC_SESSION_ID" ] && exit 0

# Fire-and-forget MCP call: action(type: 'session/close-by-cc-id',
# cc_session_id: <uuid>). The bridge looks up the matching session and
# closes it; missing/no-match returns { closed: false, reason: "not_found" }
# which we treat as success (idempotent).
#
# We don't need to maintain an MCP session for one call — the streamable-
# http transport accepts a single tools/call with an inline initialize
# isn't supported, so we just open a fresh transport: initialize → call →
# done. If the bridge is offline (daemon stopped), curl errors and we
# silently exit 0.
#
# Note: the streamable-http transport returns an SSE stream; we discard it.
curl -s --max-time 2.0 -o /dev/null -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json,text/event-stream' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"action\",\"arguments\":{\"type\":\"session/close-by-cc-id\",\"cc_session_id\":\"${CC_SESSION_ID}\"}}}" \
  2>/dev/null || true

exit 0
