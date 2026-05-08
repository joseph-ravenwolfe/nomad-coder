---
description: Re-pair the Telegram bot. Use to switch to a different bot, or to recover after BOT_TOKEN was leaked or revoked.
argument-hint: ""
allowed-tools: [Bash, Read, Write]
disable-model-invocation: true
---

# /nomad-coder:pair

Runs the Telegram bot pairing flow only — no daemon (re)install.

## Execution

```bash
cd "$CLAUDE_PLUGIN_ROOT/../.." && npm run pair
```

`src/setup.ts` will:
1. Prompt for `BOT_TOKEN` (from BotFather).
2. Verify the token via `getMe`.
3. Generate a 6-character pairing code and print a `t.me/<bot>?start=<code>` link.
4. Long-poll until the user sends the code to the bot.
5. Capture the user ID and chat ID and write to `.env`.

After pairing succeeds, kick the daemon so it picks up the new credentials:

```bash
launchctl kickstart -k "gui/$(id -u)/com.electrified-cortex.nomad-coder"
sleep 2
tail -5 "$HOME/Library/Logs/nomad-coder.log"
```

The log should show `Nomad Coder Online` and `MCP Streamable HTTP server listening on http://127.0.0.1:3099/mcp`.

## When to use

- Switching to a fresh Telegram bot (e.g., revoked the old token).
- Migrating from one Telegram account to another.
- Initial install (though `/nomad-coder:setup` runs this automatically).
