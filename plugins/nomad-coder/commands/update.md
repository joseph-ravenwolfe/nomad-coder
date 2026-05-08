---
description: Pull latest nomad-coder source, rebuild, and restart the launchd daemon. Use to upgrade after `git pull` would have new commits.
argument-hint: "[--no-pull]"
allowed-tools: [Bash]
disable-model-invocation: true
---

# /nomad-coder:update

Refresh the bridge to the latest commit on the tracking branch.

## Execution

```bash
set -euo pipefail
cd "$CLAUDE_PLUGIN_ROOT/../.."

# 1. Pull (skip if --no-pull was passed)
if [ "${1:-}" != "--no-pull" ]; then
  git fetch origin --quiet
  git pull --ff-only
fi

# 2. Reinstall deps + rebuild
npm install --silent
npm run build

# 3. Kick the daemon so it picks up the new build.
# `kickstart -k` SIGTERMs the old process and respawns from the (updated) plist.
launchctl kickstart -k "gui/$(id -u)/com.electrified-cortex.nomad-coder"

# 4. Wait for it to come back up.
echo -n "Waiting for bridge to restart "
for i in $(seq 1 20); do
  if lsof -nP -iTCP:3099 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✓"
    break
  fi
  sleep 0.5
  echo -n "."
done

# 5. Confirm version + recent log line.
echo ""
echo "Version: $(node -p "require('./package.json').version")"
echo "Last log:"
tail -5 "$HOME/Library/Logs/nomad-coder.log"
```

## Notes

- `--no-pull` is for local-dev iteration: rebuild the current working tree without touching git.
- If `git pull` would conflict (uncommitted changes), the command aborts. The user resolves manually.
- If `npm run build` fails, the daemon keeps running the prior build (kickstart only fires on success). Surface the build error.
- For a major-version bump, the user may also want to run `/nomad-coder:setup --reinstall` to re-render the plist (e.g., if env vars changed).
