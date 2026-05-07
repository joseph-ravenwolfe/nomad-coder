---
description: Install the nomad-coder daemon, pair the Telegram bot, and verify the bridge is online. Use after `/plugin install nomad-coder@nomad-coder`.
argument-hint: "[--reinstall] [--no-auto-approve]"
allowed-tools: [Bash, Read, Write, Edit]
disable-model-invocation: true
---

# /nomad-coder:setup

End-to-end install for the nomad-coder bridge. Runs once on a fresh machine
(or with `--reinstall` to redo). Prerequisites: macOS, Node 18+, Ghostty.

## What this command does

1. Detect prerequisites (Node, Ghostty, plugin root).
2. Capture or reuse the Telegram bot credentials (BOT_TOKEN, ALLOWED_USER_ID, CHAT_ID) into `.env` at the plugin root.
3. Optionally capture ELEVENLABS_API_KEY (for higher-quality voice).
4. Build the bridge (`npm install && npm run build`).
5. Render and install the launchd plist via `scripts/install/install-launchd.sh`.
6. Trigger the AppleScript automation permission prompt up-front (so it doesn't ambush the operator on first `/cc`).
7. Verify the bridge is listening on `127.0.0.1:3099` and report the next steps.

## Execution

### 0. Resolve the plugin root

The plugin's source lives at `${CLAUDE_PLUGIN_ROOT}` — set by Claude Code
when this command runs. Use that as `REPO_ROOT` throughout. Confirm by:

```bash
echo "$CLAUDE_PLUGIN_ROOT"
ls "$CLAUDE_PLUGIN_ROOT/scripts/install/install-launchd.sh"
```

If `CLAUDE_PLUGIN_ROOT` is empty (running outside CC), abort with a clear
message asking the user to invoke this via the `/nomad-coder:setup` slash
command, not directly.

### 1. Prerequisite check

```bash
node --version            # must be >= 18
which node                # must resolve
ls /Applications/Ghostty.app  # must exist (or warn — /cc requires it)
```

If Node is missing, point the user at https://nodejs.org or `brew install node`.
If Ghostty is missing, warn but don't abort — the bridge runs fine without it;
only `/cc` (the in-Telegram session launcher) needs it.

### 2. Bot pairing

Read `${CLAUDE_PLUGIN_ROOT}/.env` if it exists. If `BOT_TOKEN`,
`ALLOWED_USER_ID`, and `CHAT_ID` are all set, ask the user "Reuse existing
bot credentials? (Y/n)" — if yes, skip pairing.

Otherwise, run the existing pairing flow:

```bash
cd "$CLAUDE_PLUGIN_ROOT" && npm install --silent && npm run pair
```

`src/setup.ts` walks the user through:
- Pasting their `BOT_TOKEN` from BotFather
- Receiving a 6-character pairing code
- Sending that code to their bot from Telegram
- The script captures their numeric user ID and chat ID and writes
  `BOT_TOKEN`, `ALLOWED_USER_ID`, `CHAT_ID` to `.env`

If the pair script fails (bad token, timeout), surface the error and stop.

### 3. Optional ElevenLabs key

Ask: "Configure ElevenLabs for higher-quality voice? (y/N)"

If yes, prompt for `ELEVENLABS_API_KEY` (paste from https://elevenlabs.io
account → API keys). Append `ELEVENLABS_API_KEY=<key>` to `.env`. Optionally
also prompt for `ELEVENLABS_VOICE_ID` (default: leave unset → bridge uses
its default rotation).

### 4. Build

```bash
cd "$CLAUDE_PLUGIN_ROOT" && npm install && npm run build
```

### 5. Install launchd service

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/install/install-launchd.sh"
```

If the user passed `--no-auto-approve`, forward it:

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/install/install-launchd.sh" --no-auto-approve
```

The script renders the plist template, bootouts any prior service,
bootstraps the new one, and verifies port 3099 listening within 10s. It
prints the install path and PID on success.

### 6. AppleScript permission probe

macOS prompts for "Nomad Coder wants to control Ghostty" the first time
`/cc` runs. Trigger it now so the operator handles all permission dialogs
at install time:

```bash
osascript -e 'tell application "System Events" to tell process "Finder" to get name' >/dev/null 2>&1 || true
osascript -e 'tell application "Ghostty" to get id' >/dev/null 2>&1 || true
```

The first call surfaces the System Events automation prompt; the second
the Ghostty automation prompt. If Ghostty isn't installed, skip the second.

### 7. Verify and summarize

```bash
launchctl print "gui/$(id -u)/com.electrified-cortex.nomad-coder" | head -5
lsof -nP -iTCP:3099 -sTCP:LISTEN
tail -10 "$HOME/Library/Logs/nomad-coder.log"
```

Print to the user:

```
Nomad Coder is online.

  Bridge:   http://127.0.0.1:3099/mcp
  Plist:    ~/Library/LaunchAgents/com.electrified-cortex.nomad-coder.plist
  Logs:     ~/Library/Logs/nomad-coder.{log,err.log}
  Cache:    ~/.cache/nomad-coder/
  Source:   $CLAUDE_PLUGIN_ROOT

Next steps:
  • Open a new shell so the SessionStart hook is in scope.
  • Start a new `cc` session in any project directory.
  • The agent will bootstrap and send "online" to your Telegram bot.
  • Test with: /nomad-coder:status

If you previously ran the manual install on this machine, run
/nomad-coder:migrate to clean up the legacy artifacts (cc() shell function
override, ~/.claude.json mcpServers entry, ~/.claude/CLAUDE.md section).
```

## Re-install flow

If the user passed `--reinstall`, do steps 4-7 only (skip prereq + pairing —
they're already set up; just rebuild and restart).

## Failure modes

- **No `BOT_TOKEN` after pairing:** `.env` is empty or malformed → re-run pairing.
- **launchctl bootstrap returns 5: Input/output error:** typically a stale prior service. Run `launchctl bootout gui/$(id -u)/com.electrified-cortex.nomad-coder`, wait 3s, retry.
- **Port 3099 not listening within 10s:** check `~/Library/Logs/nomad-coder.err.log` for the actual startup error (usually a missing env var).
