---
description: Install the nomad-coder daemon, pair the Telegram bot, and verify the bridge is online. Use after `/plugin install nomad-coder@nomad-coder`.
argument-hint: "[--reinstall] [--no-auto-approve]"
allowed-tools: [Bash, Read, Write, Edit]
disable-model-invocation: true
---

# /nomad-coder:setup

End-to-end install for the nomad-coder bridge. Runs once on a fresh machine
(or with `--reinstall` to redo). Prerequisites: macOS, Node 18+, one of the
supported terminals (Ghostty, iTerm2, Terminal.app, Wave, Warp).

## What this command does

1. Detect Node + ask the operator which terminal and CLI command they use.
2. Walk the operator through creating a Telegram bot with @BotFather and
   capturing the `BOT_TOKEN`, `ALLOWED_USER_ID`, `CHAT_ID`.
3. Ask which voice provider to use (ElevenLabs / Kokoro / system `say`) and
   walk through the install for whichever they pick.
4. Build the bridge (`npm install && npm run build`).
5. Render and install the launchd plist via `scripts/install/install-launchd.sh`,
   passing `--terminal <choice> --cli <choice>`.
6. Trigger the AppleScript automation permission prompt up-front.
7. Verify the bridge is listening on `127.0.0.1:3099` and report next steps.

## Execution

### 0. Resolve the plugin root

Claude Code sets `${CLAUDE_PLUGIN_ROOT}` to the plugin clone root, which
contains both the plugin metadata (.claude-plugin/, hooks/, commands/,
skills/, .mcp.json) and the bridge source (package.json, src/, dist/,
scripts/). Confirm by:

```bash
echo "$CLAUDE_PLUGIN_ROOT"
ls "$CLAUDE_PLUGIN_ROOT/scripts/install/install-launchd.sh"
```

If `CLAUDE_PLUGIN_ROOT` is empty (running outside CC), abort with a clear
message asking the user to invoke this via the `/nomad-coder:setup` slash
command.

### 1. Prereq + terminal + CLI questions

```bash
node --version            # must be >= 18
which node                # must resolve
```

If Node is missing, point at https://nodejs.org or `brew install node` and
abort.

Then ask **two questions** and remember the answers as `TERMINAL` and
`CLI_COMMAND`:

> **Which terminal do you use?**
> 1. Ghostty
> 2. iTerm2
> 3. Terminal (macOS default)
> 4. Wave
> 5. Warp

Map their answer to the canonical short name expected by `install-launchd.sh`:
`ghostty`, `iterm`, `terminal`, `wave`, or `warp`. The installer rejects any
other value.

> **What CLI command do you use to launch Claude Code?**
>
> Press Enter for the default (`cc`), or paste your alias (`claude`,
> `claude-code`, or whatever shell function you've set up).

Save these into `~/.nomad-coder.json` so future `/nomad-coder:status` and
`/nomad-coder:update` runs can report them, and so the launchd plist gets
re-rendered with them on `--reinstall`:

```bash
node -e '
const { writeCanonicalConfig } = require("'"$CLAUDE_PLUGIN_ROOT"'/dist/config-file.js");
writeCanonicalConfig({
  behavior: {
    terminal: "'"$TERMINAL"'",
    cc_cli_command: "'"$CLI_COMMAND"'",
  },
});
'
```

### 2. Telegram bot — get a token, then pair

If `~/.nomad-coder.json` already has `telegram.bot_token`,
`telegram.allowed_user_id`, and `telegram.chat_id`, ask "Reuse existing bot
credentials? (Y/n)" and skip the rest of this step on Y.

Otherwise, walk the operator through creating a bot with **BotFather** —
the Telegram bot that hands out tokens for new bots:

```
You need a Telegram bot to talk to. Here's how to create one in 60 seconds:

  1. Open Telegram and search for:  @BotFather
  2. Tap Start (or send /start) to open the chat.
  3. Send:  /newbot
  4. BotFather asks for a display name. Anything works:
       Joe's Coding Bot
  5. BotFather asks for a username. Must end in "bot" and be unique:
       jravenwolfe_coding_bot
     (If it's taken, try another. The username is just for the bot URL —
      it doesn't have to look pretty.)
  6. BotFather replies with a token that looks like:
       7891234567:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     Copy that whole string — you'll paste it next.

Tip: keep the BotFather chat — you can come back later to set the bot's
description, profile photo, or revoke the token if it leaks.
```

Then prompt for the token:

```
Paste your BOT_TOKEN:
```

Set it in the environment for the pair script (which reads it via dotenv)
and run pairing:

```bash
export BOT_TOKEN="<the pasted token>"
cd "$CLAUDE_PLUGIN_ROOT" && npm install --silent && npm run pair
```

`src/setup.ts` walks the rest:
- Verifies the token via Telegram's `getMe`.
- Generates an 8-char pairing code.
- Prints a `t.me/<bot>` link and asks the operator to send the code from
  Telegram.
- Captures the user ID and chat ID from that message.
- Writes `BOT_TOKEN` + `ALLOWED_USER_ID` to `.env` (legacy backup) and the
  full triplet to `~/.nomad-coder.json`.

If the pair script fails (bad token, timeout, 3 wrong attempts), surface
the error and stop. The operator can retry by re-running `/nomad-coder:pair`.

### 3. Voice — pick a provider

Ask:

```
How would you like voice messages synthesized? Pick one:

  1. ElevenLabs (most sophisticated, minor cost — ~$5/mo for typical use)
  2. Kokoro (free, requires install on this machine)
  3. Default (nothing needed, highly robotic — uses macOS `say`)
```

#### If 1 — ElevenLabs

```
1. Go to https://elevenlabs.io and sign up (free tier works for testing).
2. Account menu → API Keys → Create API Key.
3. Paste the key here:
```

Capture the key, then write it:

```bash
node -e '
const { writeCanonicalConfig } = require("'"$CLAUDE_PLUGIN_ROOT"'/dist/config-file.js");
writeCanonicalConfig({ elevenlabs: { api_key: "'"$ELEVENLABS_KEY"'" } });
'
```

Optionally also ask for `ELEVENLABS_VOICE_ID` (default: leave unset → bridge
picks one). If the operator wants to browse voices first, point them at
https://elevenlabs.io/app/voice-library and tell them they can switch later
with the `set_voice` MCP tool inside any `cc` session.

#### If 2 — Kokoro

Walk the operator through running a Kokoro server locally. The simplest
path is the Kokoro-FastAPI Docker image:

```
Kokoro is a free, locally-hosted TTS server with OpenAI-compatible API.

Easiest install (Docker):

  docker run -d --name kokoro -p 8880:8880 \
    ghcr.io/remsky/kokoro-fastapi-cpu:latest

  # Or, if you have an Apple Silicon GPU and want faster synth:
  # ghcr.io/remsky/kokoro-fastapi-gpu:latest

Wait ~30s for the model to download on first run, then verify:

  curl http://localhost:8880/health

If you don't have Docker, see https://github.com/remsky/Kokoro-FastAPI
for native install instructions.

What URL is your Kokoro server reachable at? (default: http://localhost:8880)
```

Capture the host, then write it:

```bash
node -e '
const { writeCanonicalConfig } = require("'"$CLAUDE_PLUGIN_ROOT"'/dist/config-file.js");
writeCanonicalConfig({ kokoro: { host: "'"$KOKORO_HOST"'" } });
'
```

The bridge maps `kokoro.host` → `TTS_HOST` env var at startup; tts.ts then
posts to `${TTS_HOST}/v1/audio/speech`.

#### If 3 — Default

Nothing to capture. The bridge falls back to macOS `say` automatically when
neither `ELEVENLABS_API_KEY` nor `TTS_HOST` is set. Print:

```
Voice will use macOS `say`. You can switch later by re-running
/nomad-coder:setup --reinstall and picking a different option.
```

### 4. Build

```bash
cd "$CLAUDE_PLUGIN_ROOT" && npm install && npm run build
```

### 5. Install launchd service

Pass the operator's terminal and CLI choices through to the install script:

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/install/install-launchd.sh" \
  --terminal "$TERMINAL" \
  --cli "$CLI_COMMAND"
```

If the operator passed `--no-auto-approve`, forward it:

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/install/install-launchd.sh" \
  --terminal "$TERMINAL" \
  --cli "$CLI_COMMAND" \
  --no-auto-approve
```

The script renders the plist template (substituting `{{TERMINAL}}` →
`scripts/cc/<terminal>-cc-tab.applescript` and `{{CC_CLI_COMMAND}}` → the
CLI choice), bootouts any prior service (current label *or* legacy
`com.electrified-cortex.nomad-coder`), bootstraps the new one, and verifies
port 3099 listening within 10s.

### 6. AppleScript permission probe

macOS prompts for "Claude Code wants to control <Terminal>" the first time
`/cc` runs. Trigger it now so the operator handles all permission dialogs
at install time. Tailor the second probe to the chosen terminal:

```bash
osascript -e 'tell application "System Events" to tell process "Finder" to get name' >/dev/null 2>&1 || true

case "$TERMINAL" in
  ghostty)  osascript -e 'tell application "Ghostty" to get id' >/dev/null 2>&1 || true ;;
  iterm)    osascript -e 'tell application "iTerm" to get id' >/dev/null 2>&1 || true ;;
  terminal) osascript -e 'tell application "Terminal" to get id' >/dev/null 2>&1 || true ;;
  wave)     osascript -e 'tell application "Wave" to get id' >/dev/null 2>&1 || true ;;
  warp)     osascript -e 'tell application "Warp" to get id' >/dev/null 2>&1 || true ;;
esac
```

The first call surfaces the System Events automation prompt; the second
the per-terminal automation prompt.

### 7. Verify and summarize

```bash
launchctl print "gui/$(id -u)/com.joseph-ravenwolfe.nomad-coder" | head -5
lsof -nP -iTCP:3099 -sTCP:LISTEN
tail -10 "$HOME/Library/Logs/nomad-coder.log"
```

Print to the user:

```
Nomad Coder is online.

  Bridge:    http://127.0.0.1:3099/mcp
  Plist:     ~/Library/LaunchAgents/com.joseph-ravenwolfe.nomad-coder.plist
  Logs:      ~/Library/Logs/nomad-coder.{log,err.log}
  Cache:     ~/.cache/nomad-coder/
  Source:    $CLAUDE_PLUGIN_ROOT
  Terminal:  $TERMINAL
  CLI:       $CLI_COMMAND
  Voice:     <elevenlabs|kokoro|system>

Next steps:
  • Open a new shell so the SessionStart hook is in scope.
  • Start a new `<CLI_COMMAND>` session in any project directory.
  • The agent will bootstrap and send "online" to your Telegram bot.
  • Test with: /nomad-coder:status

If you previously ran the manual install on this machine, run
/nomad-coder:migrate to clean up legacy artifacts (cc() shell function
override, ~/.claude.json mcpServers entry, ~/.claude/CLAUDE.md section).
```

## Re-install flow

If the user passed `--reinstall`, do steps 1, 4–7 only (skip pairing and
voice prompts — they're already captured; just re-confirm terminal + CLI,
rebuild, and restart). Re-running step 1 lets the operator switch terminals
or CLI command without redoing everything else.

## Failure modes

- **No `BOT_TOKEN` after pairing:** `~/.nomad-coder.json` is missing
  `telegram.bot_token` → re-run pairing.
- **launchctl bootstrap returns 5: Input/output error:** typically a stale
  prior service. Run `launchctl bootout
  gui/$(id -u)/com.joseph-ravenwolfe.nomad-coder` (and `gui/$(id -u)/com.electrified-cortex.nomad-coder`
  on machines from before the rename), wait 3s, retry.
- **Port 3099 not listening within 10s:** check `~/Library/Logs/nomad-coder.err.log`
  for the actual startup error (usually a missing env var or a Kokoro
  server URL that isn't responding).
- **Unknown terminal:** the install script rejects any `--terminal` value
  not matching one of `ghostty | iterm | terminal | wave | warp`. Pick one
  of those — operators using something else (Alacritty, kitty, etc.) can
  drop a sibling `<name>-cc-tab.applescript` in `scripts/cc/` and pass
  `--terminal <name>`.
