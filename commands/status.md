---
description: Report nomad-coder daemon health — service state, port, recent logs, version, cache size, paired user.
argument-hint: ""
allowed-tools: [Bash, Read]
disable-model-invocation: true
---

# /nomad-coder:status

Read-only health check. Does not modify anything.

## Checks

```bash
# 1. launchd job loaded?
launchctl print "gui/$(id -u)/com.joseph-ravenwolfe.nomad-coder" 2>/dev/null \
  | grep -E "^\s*(state|pid|path|runs)\s*=" \
  || echo "  service NOT loaded"

# 2. Listening on 3099?
lsof -nP -iTCP:3099 -sTCP:LISTEN 2>/dev/null \
  || echo "  port 3099 NOT listening"

# 3. Bridge version (read from package.json since dist/build-info may be stale)
node -p "require('$CLAUDE_PLUGIN_ROOT/package.json').version" 2>/dev/null

# 4. Recent log activity
echo "--- last 10 stdout lines ---"
tail -10 "$HOME/Library/Logs/nomad-coder.log" 2>/dev/null || echo "(no stdout log)"
echo "--- last 10 stderr lines ---"
tail -10 "$HOME/Library/Logs/nomad-coder.err.log" 2>/dev/null || echo "(no stderr log)"

# 5. Cache size
du -sh "$HOME/.cache/nomad-coder" 2>/dev/null || echo "  (no cache dir)"

# 6. Paired user (read from ~/.nomad-coder.json — the canonical config)
if [ -f "$HOME/.nomad-coder.json" ]; then
  node -e '
    const c = JSON.parse(require("fs").readFileSync(process.env.HOME + "/.nomad-coder.json", "utf8"));
    const t = c.telegram || {};
    if (t.allowed_user_id) console.log("  ALLOWED_USER_ID=" + t.allowed_user_id);
    if (t.chat_id)         console.log("  CHAT_ID=" + t.chat_id);
    if (!t.allowed_user_id && !t.chat_id) console.log("  (no telegram pairing in ~/.nomad-coder.json)");
  '
else
  echo "  (~/.nomad-coder.json missing — run /nomad-coder:pair)"
fi
```

## Summary format

After running the checks, present a one-glance summary:

```
Nomad Coder status:
  Service:    [running PID xxxxx] | [not loaded]
  Port:       [listening 3099]    | [not listening]
  Version:    8.0.0
  Paired:     ALLOWED_USER_ID=...  CHAT_ID=...
  Cache:      4.2K
  Last log:   "Nomad Coder Online" (~2 min ago)
```

If anything is red, suggest the right next command:
- Service not loaded → `/nomad-coder:setup --reinstall` or `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.joseph-ravenwolfe.nomad-coder.plist`
- Port not listening → check `~/Library/Logs/nomad-coder.err.log`, then `/nomad-coder:setup --reinstall`
- No pairing → `/nomad-coder:pair`
