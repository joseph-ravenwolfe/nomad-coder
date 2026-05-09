---
description: Clean up legacy manual nomad-coder install artifacts (cc() shell function override, ~/.claude.json mcpServers entry, ~/.claude/CLAUDE.md section, ~/.claude/hooks/nomad-bootstrap.sh) and migrate .env secrets into ~/.nomad-coder.json. Idempotent — safe to re-run.
argument-hint: "[--dry-run]"
allowed-tools: [Bash, Read, Edit]
disable-model-invocation: true
---

# /nomad-coder:migrate

Operators who installed nomad-coder manually (before the plugin existed) have
old artifacts on their machine that the plugin now replaces. This command
detects and removes them.

**Run after `/plugin install nomad-coder@nomad-coder` succeeds.** Two
simultaneous registrations of the `nomad` MCP server (one from the plugin's
`.mcp.json`, one from `~/.claude.json` `mcpServers.nomad`) cause a duplicate
error — this command resolves that.

## What it does

1. **`~/.claude.json` `mcpServers.nomad` entry** — if present, remove it. The
   plugin's `.mcp.json` now registers the server canonically.
2. **`~/.zshrc` `cc()` function** — if it contains the "NOMAD CODER BOOTSTRAP"
   directive, surgically strip the boot-prepend block (the `local boot="..."`
   variable and the `${boot}$*` argument). Leave the `claude
   --dangerously-skip-permissions --chrome` invocation intact. The plugin's
   SessionStart hook now injects the bootstrap directive automatically.
3. **`~/.claude/CLAUDE.md`** — remove the "Nomad Coder — bootstrap and
   behavior" section (heading through end of section). Same content now
   ships as the `nomad-agent-guide` skill.
4. **`~/.claude/hooks/nomad-bootstrap.sh`** — delete. The plugin's
   `hooks/handlers/session-start.sh` replaces it (it was orphaned anyway —
   never wired into a `hooks.json`).
5. **`.env` → `~/.nomad-coder.json`** — if `.env` at the repo root
   contains `BOT_TOKEN`, `ALLOWED_USER_ID`, `CHAT_ID`, or any
   `ELEVENLABS_*` keys, copy them into the canonical dotfile. Existing
   `~/.nomad-coder.json` values are preserved (merge, not clobber). The
   legacy `.env` is left in place for backward compat — `npm run pair`
   writes both, and the bridge reads canonical first. Operators can
   delete `.env` after confirming the migration; nothing on this
   machine relies on it once `~/.nomad-coder.json` exists.

## Behavior

- Print each detected artifact and what would change.
- With `--dry-run`, only print; don't modify.
- Without flags, prompt the user once (Y/n), then apply all changes.
- After applying: print a one-line summary and remind the user to open a new
  shell or `source ~/.zshrc` so the cc() override takes effect.

## How to execute

For each step, before mutating, **read** the target file and check for the
exact marker text (e.g., `NOMAD CODER BOOTSTRAP` for the cc() function,
`"nomad":` under `"mcpServers"` for `~/.claude.json`, the `## Nomad Coder`
heading in CLAUDE.md). If the marker is absent, skip that step silently —
nothing to migrate. If the marker is present, perform the targeted edit (use
`Edit` tool with the smallest possible `old_string`/`new_string` pair).

For `~/.claude.json`:
```bash
node -e '
const fs = require("fs");
const path = process.env.HOME + "/.claude.json";
const j = JSON.parse(fs.readFileSync(path, "utf8"));
if (j.mcpServers && j.mcpServers.nomad) {
  delete j.mcpServers.nomad;
  fs.writeFileSync(path, JSON.stringify(j, null, 2) + "\n");
  console.log("Removed mcpServers.nomad");
} else {
  console.log("No mcpServers.nomad entry — already migrated");
}
'
```

For `~/.claude/hooks/nomad-bootstrap.sh`: just `rm -f` if it exists.

For the `.env` → `~/.nomad-coder.json` migration, parse `.env`
line-by-line (`KEY=VALUE` pairs, ignore comments and blanks), build a
partial `NomadCoderConfig` mapping known keys into their JSON sections
(BOT_TOKEN / ALLOWED_USER_ID / CHAT_ID → `telegram`, ELEVENLABS_* →
`elevenlabs`), then shell out to node to merge into `~/.nomad-coder.json`:

```bash
cd "$CLAUDE_PLUGIN_ROOT"
node -e '
const fs = require("fs");
const path = require("path");
const { writeCanonicalConfig } = require("./dist/config-file.js");
const envPath = path.join(process.cwd(), ".env");
if (!fs.existsSync(envPath)) process.exit(0);
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["\x27]|["\x27]$/g, "");
}
const partial = {};
if (env.BOT_TOKEN || env.ALLOWED_USER_ID || env.CHAT_ID) {
  partial.telegram = {};
  if (env.BOT_TOKEN) partial.telegram.bot_token = env.BOT_TOKEN;
  if (env.ALLOWED_USER_ID) partial.telegram.allowed_user_id = Number(env.ALLOWED_USER_ID);
  if (env.CHAT_ID) partial.telegram.chat_id = Number(env.CHAT_ID);
}
if (env.ELEVENLABS_API_KEY || env.ELEVENLABS_VOICE_ID || env.ELEVENLABS_MODEL_ID) {
  partial.elevenlabs = {};
  if (env.ELEVENLABS_API_KEY) partial.elevenlabs.api_key = env.ELEVENLABS_API_KEY;
  if (env.ELEVENLABS_VOICE_ID) partial.elevenlabs.voice_id = env.ELEVENLABS_VOICE_ID;
  if (env.ELEVENLABS_MODEL_ID) partial.elevenlabs.model_id = env.ELEVENLABS_MODEL_ID;
}
const { path: out, merged } = writeCanonicalConfig(partial);
console.log("Merged " + Object.keys(env).length + " keys from .env into " + out);
'
```

This preserves any pre-existing `~/.nomad-coder.json` values (merge
behavior), so running `/nomad-coder:migrate` twice is a no-op on the
second pass.

For `~/.zshrc`: read the file, find the `cc()` function block, locate the
inner `local boot="..."` heredoc-style assignment plus the `"${boot}$*"`
arg substitution, and replace with a plain `"$@"` arg. The `cc()` function
should still launch Claude Code; only the prepended bootstrap directive is
removed.

For `~/.claude/CLAUDE.md`: locate `## Nomad Coder` heading, find the next
`##` heading at the same level (or EOF), and delete the range. If no such
heading exists, the migration was already done.

## Safety

- All edits are surgical — never `rm` an entire user file.
- Edit tool requires the file to be Read first; that's automatic backup-by-context.
- `--dry-run` is the suggested first invocation.
- The launchd plist (`~/Library/LaunchAgents/com.joseph-ravenwolfe.nomad-coder.plist`,
  or the legacy `com.electrified-cortex.nomad-coder.plist` from before the
  rename) is **not** touched here — `/nomad-coder:setup --reinstall` does the
  swap, since `install-launchd.sh` bootouts both labels and removes the
  legacy plist file unconditionally.
