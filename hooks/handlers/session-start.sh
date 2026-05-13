#!/usr/bin/env bash
# Nomad Coder — SessionStart hook handler
#
# Probes the bridge daemon at 127.0.0.1:3099. When reachable, prints a JSON
# hook output that injects a bootstrap directive into the agent's context
# before its first turn. When the daemon is offline, exits silently so the
# session continues normally without nomad tools.

set -euo pipefail

BRIDGE_URL="http://127.0.0.1:3099/mcp"

# Read the hook payload from stdin (Claude Code provides session_id, cwd,
# transcript_path, hook_event_name). Capture it BEFORE the reachability
# probe — curl below doesn't consume stdin, but bash's `read` semantics
# make multi-step stdin handling fragile, so we just slurp it all once.
HOOK_INPUT="$(cat || true)"

# Reachability probe — 1.5s budget. Skip injection if the bridge is down.
if ! curl -s -o /dev/null --max-time 1.5 -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json,text/event-stream' \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook-probe","version":"0"}}}'; then
  exit 0
fi

# Extract the Claude Code session_id so the agent can forward it to the
# bridge in session/start. The bridge stores it on the session record;
# the matching SessionEnd hook later uses it to close that session via
# the no-auth `session/close-by-cc-id` action. An empty value just means
# no SessionEnd auto-close — the long-tail health check still cleans up.
CC_SESSION_ID="$(printf '%s' "$HOOK_INPUT" | node -e "
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => {
    try { const o = JSON.parse(buf); process.stdout.write(String(o.session_id ?? '')); }
    catch { process.stdout.write(''); }
  });
" 2>/dev/null || true)"

# Derive a session name from the current working directory's basename.
# Strip non-alphanumeric (the bridge requires alphanumeric + spaces only).
# Fall back to "Worker" if the result is empty.
RAW_NAME="$(basename "$PWD")"
SESSION_NAME="$(printf '%s' "$RAW_NAME" | tr -cd '[:alnum:] ' | sed 's/  */ /g; s/^ *//; s/ *$//')"
[ -z "$SESSION_NAME" ] && SESSION_NAME="Worker"

# Build the inline JS literal for the cc_session_id arg. Empty → omit the
# field entirely (so old bridge versions don't choke on unknown params).
if [ -n "$CC_SESSION_ID" ]; then
  CC_ARG=", cc_session_id:'${CC_SESSION_ID}'"
else
  CC_ARG=""
fi

# Build the directive. JSON-encode it via Node (already a hard dep of the bridge).
read -r -d '' DIRECTIVE <<EOF || true
NOMAD CODER BOOTSTRAP (v8 Monitor pattern) — execute first, then handle the user request below.

The bridge is exposed as MCP server 'nomad'. In the deferred-tools list it appears as: mcp__nomad__action, mcp__nomad__send, mcp__nomad__dequeue, mcp__nomad__help. To use them you must FIRST load their schemas via ToolSearch (e.g. ToolSearch select:mcp__nomad__action,mcp__nomad__send,mcp__nomad__dequeue), then call them.

Bootstrap procedure (run immediately, only once):
  0) Load schemas: ToolSearch with query 'select:mcp__nomad__action,mcp__nomad__send,mcp__nomad__dequeue'. If ToolSearch reports 'No matching deferred tools found' or returns nothing, the bridge is offline — skip the bootstrap silently and continue.
  1) mcp__nomad__action({type:'session/start', name:'${SESSION_NAME}'${CC_ARG}})  — capture the returned token (integer) and watch_file (absolute path) from the response.
  2) mcp__nomad__send({token, type:'notification', severity:'info', title:'online', text:'${SESSION_NAME}'})
  3) mcp__nomad__dequeue({token, max_wait:0}) in a loop until empty:true  (drain any startup backlog)
  4) Monitor({command: 'tail -F ' + watch_file, description: 'Nomad — Listening for Telegram Messages', persistent: true})
  5) Done bootstrapping — do NOT enter a blocking dequeue loop. On each Monitor notification, drain via dequeue({token, max_wait:0}) until empty:true, then handle events. See the nomad-agent-guide skill for full behavior policy.

NAME_CONFLICT means a DIFFERENT live agent already owns this name — retry session/start with name '${SESSION_NAME}2', then '${SESSION_NAME}3', etc. (still pass cc_session_id), until you get a fresh session.

If the response comes back with action:'recovered' (not 'fresh'), that's the bridge recognizing the same HTTP transport you created the session on; it just returned your existing token after compaction wiped it from memory. Use the returned token as-is. There is no separate session/reconnect verb — session/start handles both new sessions and same-transport recovery transparently.
EOF

# Emit the canonical hook JSON. Node handles the string escaping correctly.
node -e '
const directive = process.argv[1];
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: directive
  }
}));
' "$DIRECTIVE"

exit 0
