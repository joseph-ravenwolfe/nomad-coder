# Nomad Coder

[![CI](https://github.com/joseph-ravenwolfe/nomad-coder/actions/workflows/ci.yml/badge.svg)](https://github.com/joseph-ravenwolfe/nomad-coder/actions/workflows/ci.yml)
[![Docker](https://github.com/joseph-ravenwolfe/nomad-coder/actions/workflows/publish.yml/badge.svg)](https://github.com/joseph-ravenwolfe/nomad-coder/actions/workflows/publish.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-nomad--coder-blue?logo=docker)](https://github.com/joseph-ravenwolfe/nomad-coder/pkgs/container/nomad-coder)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

<img align="right" src="interaction.jpg" width="320" alt="AI agents coordinating through Nomad Coder" />

## No Claw? No Problem.

**Anthropic restricted Claude Code's native instance API** — but this bridge doesn't care. It's a standard [Model Context Protocol](https://modelcontextprotocol.io) server. Any IDE, any model, any agent framework that speaks MCP connects out of the box — no proprietary lock-in, no webhooks, no public URL required.

---

## What Is This?

**Nomad Coder** connects AI assistants to Telegram bidirectionally. It lets any MCP-compatible client send messages, ask questions, receive voice replies, and run multiple concurrent agent sessions — all through a single bot you control.

**Works with:** VS Code (GitHub Copilot Chat), Claude Code, Cursor, Windsurf, Copilot CLI, and any MCP-compatible host.

---

## Highlights

| Feature | Description |
| --- | --- |
| **Two-way messaging** | Text, Markdown, files, voice notes |
| **Interactive controls** | Inline buttons, confirmations, questions |
| **Super tools** | Self-pinning checklists and emoji progress bars that update in-place |
| **Voice** | Auto-transcription (bundled Whisper ONNX, no ffmpeg) + TTS (local Kokoro, OpenAI, or bundled ONNX) |
| **Multi-session** | Multiple agents share one bot with isolated queues, token auth, and color identity |
| **Animations** | Cycling status frames while your agent works |
| **Reminders** | Scheduled synthetic events delivered via dequeue |
| **Slash commands** | Dynamic bot menu; commands arrive as structured events |
| **No webhooks** | Pure long-polling — no public URL, no reverse proxy |

---

## Quick Start (Claude Code, macOS)

Three slash commands inside Claude Code:

```text
/plugin marketplace add joseph-ravenwolfe/nomad-coder
/plugin install nomad-coder@nomad-coder
/nomad-coder:setup
```

`setup` walks you through bot pairing, optional ElevenLabs voice, builds
the bridge, installs the launchd daemon, and surfaces the AppleScript
permission prompts up front. Total time: a few minutes.

After install, three more commands keep things running:

| Command | What it does |
| --- | --- |
| `/nomad-coder:status` | Daemon health, port, paired user, recent logs |
| `/nomad-coder:pair` | Re-pair (e.g., to switch bots) |
| `/nomad-coder:update` | `git pull && build && launchctl kickstart` |
| `/nomad-coder:migrate` | One-time cleanup if you previously had a manual install |

Configuration lives at `~/.nomad-coder.json` (mode 0600). The bridge listens
on `http://127.0.0.1:3099/mcp`. The plugin's SessionStart hook auto-injects
the bootstrap directive into every new `cc` session, so agents come online
in Telegram on their first turn.

<details>
<summary><strong>From source — for contributors and non-Claude-Code hosts</strong></summary>

### 1. Clone and build

```bash
git clone https://github.com/joseph-ravenwolfe/nomad-coder.git
cd nomad-coder
npm install && npm run build
```

### 2. Create a bot

Message [@BotFather](https://t.me/BotFather) on Telegram:

```text
/newbot
```

Copy the token it gives you.

### 3. Pair interactively

```bash
npm run pair
```

The wizard prompts for your bot token, generates a one-time pairing code,
captures your Telegram user/chat IDs when you echo the code back to the bot,
and writes them to `~/.nomad-coder.json` (canonical) and `.env` (legacy).

### 4. Configure your MCP host

See [`docs/setup.md`](docs/setup.md) for per-client config snippets
(VS Code, Cursor, Windsurf, Docker, raw stdio).

</details>

---

## Transports

| Transport | Entry Point | Best For |
| --- | --- | --- |
| **Streamable HTTP** | `npm start -- --http` | Multiple clients sharing one server (recommended) |
| **stdio** | `node dist/index.js` | Single client, no persistent server |
| **Launcher bridge** | `node dist/launcher.js` | Auto-starts HTTP if needed, bridges stdio ↔ HTTP |

<details>
<summary><strong>Streamable HTTP MCP config example</strong></summary>

**Claude Code / Cursor / other MCP hosts**

```json
{
  "mcpServers": {
    "nomad": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3099/mcp"
    }
  }
}
```

**VS Code (.vscode/mcp.json)**

```json
{
  "servers": {
    "nomad": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3099/mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>stdio MCP config example</strong></summary>

**Claude Code / Cursor / other MCP hosts**

```json
{
  "mcpServers": {
    "nomad": {
      "command": "node",
      "args": ["/path/to/nomad-coder/dist/index.js"],
      "env": {
        "BOT_TOKEN": "your-token",
        "ALLOWED_USER_ID": "your-user-id"
      }
    }
  }
}
```

**VS Code (.vscode/mcp.json)**

```json
{
  "servers": {
    "nomad": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/nomad-coder/dist/index.js"],
      "env": {
        "BOT_TOKEN": "your-token",
        "ALLOWED_USER_ID": "your-user-id"
      }
    }
  }
}
```

</details>

---

## Tools — The v7 API

Version 7 consolidates the entire API into **4 tools** with type-based routing. Call `help(topic?)` at any time for interactive documentation discovery.

### `send` — Outbound Messaging

All outbound operations flow through a single `send` call. The `type` parameter determines behavior.

| Type | Description |
| --- | --- |
| `text` | Formatted Markdown text; pass `audio: "..."` to speak via TTS |
| `file` | Photo, document, video, audio, or voice note |
| `notification` | Status notification with severity: `info` · `success` · `warning` · `error` |
| `choice` | Message with inline buttons (non-blocking) |
| `question` | Blocking prompt — route with `ask`, `confirm`, or `choose` |
| `dm` | DM to another session (`target_sid` or `target` alias); `"direct"` accepted as alias |
| `append` | Append text to an existing message |
| `animation` | Start a cycling status animation |
| `checklist` | Create a self-pinning live checklist; requires `title`, accepts `steps` array of `{label, status}` objects |
| `progress` | Create an emoji progress bar (width configurable) |

> Update in-place with `action(type: "checklist/update", message_id: ...)` and `action(type: "progress/update", message_id: ...)` respectively. See [`docs/super-tools.md`](docs/super-tools.md).

```js
// Examples — token required for all session-scoped calls; session/start and most help topics work without a token
// token: 1234567 (required for all session-scoped calls)
send({ token: 1234567, type: "text", text: "Hello from your AI agent!" })
send({ token: 1234567, type: "notification", severity: "success", text: "Build passed." })
send({ token: 1234567, type: "question", ask: "Proceed with deployment?" })
send({ token: 1234567, type: "checklist", title: "Pipeline", steps: [{ label: "Design", status: "pending" }, { label: "Implement", status: "pending" }, { label: "Review", status: "pending" }, { label: "Deploy", status: "pending" }] })
send({ token: 1234567, type: "progress", title: "Processing files", percent: 40, subtext: "4 of 10 complete", width: 10 })
```

### `dequeue` — Receive Inbound Events

Long-poll for the next inbound event: messages, button presses, voice notes, slash commands, reminders.

> **Note:** `token` is the integer returned by `action(type: "session/start")`.

```js
dequeue({ token: 1234567 })              // default timeout — idles until event
dequeue({ token: 1234567, timeout: 0 }) // non-blocking drain (coordination gates)
```

### `action` — Universal Dispatcher

RESTful path routing via `type`. Supports progressive discovery:

- Omit `type` → list all categories
- Pass a category → list sub-paths
- Pass a full path → execute

<details>
<summary><strong>Full action reference</strong></summary>

#### Session
`session/start` · `session/close` · `session/list` · `session/rename` · `session/idle`

#### Profile
`profile/voice` · `profile/topic` · `profile/save` · `profile/load` · `profile/import` · `profile/dequeue-default`

#### Reminder
`reminder/set` · `reminder/cancel` · `reminder/list`

#### Animation
`animation/default` · `animation/cancel`

#### Message
`message/edit` · `message/delete` · `message/pin` · `message/route` · `message/history` · `message/get`

#### Chat
`chat/info`

#### Super Tools
`checklist/update` · `progress/update`

#### Confirm Presets
`confirm/ok` · `confirm/ok-cancel` · `confirm/yn`

#### Standalone
`react` · `acknowledge` · `show-typing` · `commands/set` · `logging/toggle` · `transcribe` · `download`

#### Governor-only
`approve` · `shutdown` · `shutdown/warn` · `log/get` · `log/list` · `log/roll` · `log/delete` · `log/debug`

</details>

### `help` — Documentation Discovery

```js
help()                    // list all topics
help({ topic: "send" })  // targeted reference for a specific tool or type
```

---

## Multi-Session

Multiple agents can share one bot simultaneously without cross-talk.

```text
session/start → token (integer) → pass on every session-scoped call
```

**Token format:** `token = sid * 1_000_000 + pin` — a single integer, returned by `action(type: "session/start")`.

| Capability | Description |
| --- | --- |
| **Isolated queues** | Per-session routing; no messages bleed between agents |
| **Color identity** | Outbound messages prefixed with color + name (e.g., `🟩 Worker 1`) |
| **Governor model** | First session is primary; additional sessions require operator approval via color-picker keyboard |
| **DMs** | Inter-session messaging via `send(type: "dm", target_sid: N, ...)` (alias: `"direct"`; `target_sid` alias: `target`) |
| **Health monitoring** | Unresponsive sessions trigger operator prompts to reroute or promote |
| **Graceful teardown** | Orphaned events rerouted; callback hooks replaced on close |

See [`docs/multi-session-protocol.md`](docs/multi-session-protocol.md) for the full routing protocol.

---

## Voice

### Transcription (Inbound)

Voice messages are auto-transcribed before delivery. No external API, no ffmpeg required — the Whisper ONNX model is bundled.

```env
WHISPER_MODEL=onnx-community/whisper-base   # default
WHISPER_CACHE_DIR=/path/to/cache            # optional
```

### Text-to-Speech (Outbound)

Triggered by `send(type: "text", audio: "...")`. Provider is selected automatically:

| Environment Variable | Provider |
| --- | --- |
| `TTS_HOST` | Any OpenAI-compatible `/v1/audio/speech` endpoint |
| `OPENAI_API_KEY` | api.openai.com |
| Neither set | Bundled ONNX model (zero config) |

#### Kokoro (recommended local TTS)

High-quality local TTS with 25+ voices. No API key, no cost.

```bash
docker run -d --name kokoro -p 8880:8880 ghcr.io/hexgrad/kokoro-onnx-server:latest
```

```env
TTS_HOST=http://localhost:8880
TTS_FORMAT=ogg
TTS_VOICE=af_heart
```

Send `/voice` in Telegram to browse and sample voices live.

Per-session voice override: `action(type: "profile/voice")` or `/voice` in Telegram.

---

## MCP Resources

Five resources are available to any connected client — no tool call required:

| URI | Contents |
| --- | --- |
| `nomad-coder://agent-guide` | Behavioral guide for AI agents |
| `nomad-coder://communication-guide` | Communication patterns and loop rules |
| `nomad-coder://quick-reference` | Hard rules + compact tool table |
| `nomad-coder://setup-guide` | Setup walkthrough |
| `nomad-coder://formatting-guide` | Markdown / MarkdownV2 / HTML reference |

---

## Docker

```text
ghcr.io/joseph-ravenwolfe/nomad-coder:latest
```

> **Before running Docker:** Create your `.env` file first by running `npm run pair` on a machine with Node.js, or copy `.env.example` and fill it in manually.

**Streamable HTTP (recommended)** — run as a long-lived service:

```bash
docker run -d --name nomad-coder \
  --env-file /absolute/path/to/.env \
  -e MCP_PORT=3099 \
  -p 3099:3099 \
  -v nomad-coder-cache:/home/node/.cache \
  ghcr.io/joseph-ravenwolfe/nomad-coder:latest
```

Connect MCP hosts to `http://127.0.0.1:3099/mcp`.

<details>
<summary><strong>stdio mode</strong> (per-host process, no persistent server)</summary>

```json
{
  "command": "docker",
  "args": [
    "run", "--rm", "-i",
    "--env-file", "/absolute/path/to/.env",
    "-v", "nomad-coder-cache:/home/node/.cache",
    "ghcr.io/joseph-ravenwolfe/nomad-coder:latest"
  ]
}
```

</details>

The cache volume persists Whisper and TTS model weights across container restarts.

---

## Development

```bash
npm run build     # Compile TypeScript
npm run dev       # Watch mode
npm test          # Run tests
npm run coverage  # Coverage report
npm run pair      # Re-run pairing wizard
```

---

## Agent Setup

**Claude Code:** the plugin's `SessionStart` hook auto-injects the bootstrap
directive into every new `cc` session. No manual setup needed beyond
`/plugin install nomad-coder@nomad-coder`. The bridge's heartbeat-files
delivery (v8) replaces the old long-poll `dequeue` loop; agents arm a
single `Monitor({command: "tail -F <watch_file>"})` task and rest until a
line arrives.

**Other hosts (VS Code, Cursor, etc.):** see
[`docs/agent-setup.md`](docs/agent-setup.md) for the loop-guard hook that
keeps agents in the dequeue loop on idle or forced stop.

---

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/setup.md`](docs/setup.md) | Full setup walkthrough with per-client config |
| [`docs/multi-session-protocol.md`](docs/multi-session-protocol.md) | Multi-session routing and governor model |
| [`docs/super-tools.md`](docs/super-tools.md) | Checklist and progress bar reference |
| [`docs/agent-setup.md`](docs/agent-setup.md) | Loop-guard hooks for VS Code and Claude Code |
| [`docs/migration-v5-to-v6.md`](docs/migration-v5-to-v6.md) | v5 → v6 tool name mapping |
| [`docs/git-index-safety.md`](docs/git-index-safety.md) | Git index safety notes for multi-agent environments |

---

## License

[AGPL-3.0-only](LICENSE)
