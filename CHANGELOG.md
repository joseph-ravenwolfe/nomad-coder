# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Fixed

- **Voice transcription timeout** — added 60s timeout to `transcribeVoice` calls in the poller; prevents ✍ reaction from sticking forever when transcription hangs
- **Invalid reaction emoji** — changed poller queued-reaction from 📝 (not in Telegram's allowed set) to 😴
- **Markdown backslash escaping** — `markdownToV2` now strips agent-escaped special chars (`\_` → `_`, `\*` → `*`, etc.) before applying MarkdownV2 escaping
- **send\_confirmation skip flow** — switched from `pollButtonPress` to `pollButtonOrTextOrVoice`; voice/text replies now return `{ skipped: true, text_response }` instead of timing out
- **Context bloat in get\_message** — removed `raw` field that leaked full Telegram Message/CallbackQuery objects (2–5 KB each)
- **Context bloat in dump\_session\_record** — added `limit` parameter (default 100, max 1000) and compact JSON output; prevents unbounded 500 KB responses

### Added

- **Message store** (`message-store.ts`) — always-on store replacing both `session-recording.ts` and `update-buffer.ts`; provides `recordInbound`, `recordOutgoing`, `recordOutgoingEdit`, `recordBotReaction`, `dequeue`, `dequeueMatch`, `waitForEnqueue`, `getMessage` (random-access with version history), `dumpTimeline`
- **Background poller** (`poller.ts`) — continuously calls `getUpdates`, feeds `recordInbound` into the store, auto-transcribes voice messages with ✍→📝 reaction feedback
- **Animation state** (`animation-state.ts`) — manages typing/thinking animations via edit-not-delete mechanism with `startAnimation`, `cancelAnimation`, `resetAnimationTimeout`
- **`send_text` tool** — replaces `send_message` with `recordOutgoing` integration and `resetAnimationTimeout`
- **`send_file` tool** — consolidates `send_photo`, `send_document`, `send_video`, `send_audio`, `send_voice` into one tool with auto-detection by file extension
- **`dequeue_update` tool** — universal update consumption; blocks via `waitForEnqueue` with configurable timeout and filter predicate
- **`get_message` tool** — random-access lookup by `message_id` with optional version history
- **`append_text` tool** — delta-append using `getMessage` + `editMessageText` + `recordOutgoingEdit`
- **`show_animation` tool** — starts a typing/thinking animation via `startAnimation`
- **`cancel_animation` tool** — cancels active animation with optional replacement text
- **`reply_to` field in message store** — `EventContent` now captures `reply_to_message.message_id` from inbound messages

### Changed

- **Version bumped to 3.0.0** — major architecture change from polling-per-tool to background-poller + message-store
- **`server.ts` rewrite** — registers 29 tools (down from 40+); removed all V2 polling tool imports
- **`choose.ts`** — uses `pollButtonOrTextOrVoice` from button-helpers instead of `pollUntil`; voice arrives pre-transcribed from poller
- **`ask.ts`** — complete rewrite using `dequeueMatch`/`waitForEnqueue` loop from message-store
- **`button-helpers.ts`** — rewritten with V3 types (`ButtonResult`, `TextResult`, `VoiceResult`); uses store-based polling instead of `pollUntil`
- **`send_confirmation.ts`** — uses `recordOutgoing` and V3 `ButtonResult.callback_query_id`
- **`notify.ts`** — uses `recordOutgoing` and `resetAnimationTimeout`
- **`edit_message_text.ts`** — adds `recordOutgoingEdit` and `resetAnimationTimeout`
- **`speak.ts`** — renamed from `send_text_as_voice`; uses `recordOutgoing` and `resetAnimationTimeout`
- **`update_status.ts`** — uses `recordOutgoing` and `resetAnimationTimeout`
- **`show_typing.ts`** — absorbed `cancel_typing` via `cancel: boolean` parameter
- **`pin_message.ts`** — absorbed `unpin_message` via `unpin: boolean` parameter; `message_id` optional for unpin
- **`dump_session_record.ts`** — complete rewrite; returns JSON from `dumpTimeline`/`timelineSize`/`storeSize` (no recording needed)
- **`set_reaction.ts`** — adds `recordBotReaction` call
- **`index.ts`** — starts/stops background poller; removed `sendSessionPrefsPrompt`
- **`telegram.ts`** — removed `recordUpdate` from `advanceOffset` (poller handles recording)

### Removed

- **17 dead V2 tool files** and **14 associated test files** — replaced by consolidated V3 tools
- **`send_message` / `send_message_draft`** — replaced by `send_text`
- **`send_photo` / `send_document` / `send_video` / `send_audio` / `send_voice`** — replaced by `send_file`
- **`get_updates` / `get_update` / `wait_for_message` / `wait_for_callback_query`** — replaced by `dequeue_update`
- **`cancel_typing`** — absorbed into `show_typing`
- **`unpin_message`** — absorbed into `pin_message`
- **`send_temp_message`** — removed (animation system replaces ephemeral messages)
- **`start_session_recording` / `cancel_session_recording` / `get_session_updates`** — replaced by always-on message store

## [2.1.2] — 2026-03-11

### Added

- **Automatic session recording prefs prompt** — on startup the server sends a one-shot inline keyboard asking whether to auto-record and at what message interval (Off / 25 / 50 / 100); recording starts silently with no agent involvement; when the buffer fills, a `.txt` dump is sent to the chat and the buffer resets for the next window
- **Built-in `/session` command** — server-level panel intercepted before the agent sees it; shows session recording status with contextual inline keyboard buttons (▶ Start / 📤 Dump / ⏹ Stop / ✖ Dismiss); agent never receives the command or its callback queries; panel now shows auto-dump threshold when configured
- **Built-in commands merged into `set_commands`** — `BUILT_IN_COMMANDS` are always prepended to every `setMyCommands` call so they survive agent command registration; passing `[]` clears agent commands but retains built-ins
- **Startup command menu registration** — `src/index.ts` registers built-in commands in the Telegram bot menu immediately after the MCP server connects
- **`/command` detection in `wait_for_message`** — messages containing a leading `bot_command` entity are now deserialized as `{ type: "command", command: "status", args?: "..." }` instead of plain text; `@botname` suffix is stripped automatically (group-chat format)
- **Slash-command cleanup on shutdown** — new `shutdown.ts` module clears all registered slash-command menus (chat-scoped and default) on `SIGTERM`, `SIGINT`, and `restart_server`; commands no longer persist in the Telegram menu after the agent disconnects

### Changed

- **`send_temp_message` TTL** — default raised from 30 s to 300 s (5 minutes); maximum raised from 300 s to 600 s (10 minutes)
- **`clearPendingTemp` grace period** — instead of deleting immediately when any outbound tool fires, the temp message now lingers for 10 seconds so the user can still read it if the real response arrives fast

## [2.1.1] — 2026-03-07

### Changed

- Switched project license from MIT to AGPL-3.0-only
- Removed Codecov badge and upload step (coverage reported in CI logs only)

### Fixed

- Duplicate `### Added` headings under `[2.1.0]` in CHANGELOG merged into one section
- `_api` singleton now reset after tests that set `BOT_TOKEN`, preventing cross-test coupling

## [2.1.0] — 2026-03-07

### Added

- **Dual-instance hijack detection** — `advanceOffset()` detects `update_id` gaps caused by a competing MCP instance consuming the same bot's update queue. Emits a `console.error` and sends a ⚠️ Telegram message to the operator by default. Configurable via `HIJACK_NOTIFY=console,telegram,agent` (any combination; default `console,telegram`). When `agent` is included, `get_update` and `get_updates` return a `hijack_warning` field so the agent can act on it directly.
- **409 Conflict detection** — Telegram 409 responses (two live `getUpdates` calls on the same token) are now classified as `DUAL_INSTANCE_CONFLICT` and fire the same `HIJACK_NOTIFY` channels (console, Telegram message, or agent `hijack_warning`) as gap detection. Covers the simultaneous-overlap case that gap detection misses.
- **CI workflow** — new `.github/workflows/ci.yml` runs tests and uploads coverage to Codecov on every push/PR to `master`
- **Codecov integration** — coverage badge is now live and tied to the actual CI run
- **Cosign image signing** — every Docker image is signed with keyless Cosign (GitHub OIDC) in the publish workflow
- **SBOM attestation** — `sbom: true` in `docker/build-push-action`; inspect via `docker buildx imagetools inspect --format '{{json .SBOM}}'`
- **Full build provenance** — `provenance: mode=max`; inspect via `docker buildx imagetools inspect --format '{{json .Provenance}}'`
- **SHA-pinned GitHub Actions** — all actions in both workflows now reference exact commit SHAs to prevent supply-chain substitution attacks
- **Dependabot `github-actions` ecosystem** — weekly PRs to keep action pins current
- **Image verification docs** — `## Docker` section in README documents `cosign verify`, SBOM inspect, and provenance inspect commands

### Changed

- README badges replaced with live dynamic badges (CI status, Docker publish status, Codecov coverage, npm version, GHCR link, license)
- `publish.yml` permissions expanded with `id-token: write` and `attestations: write`

## [2.0.0] — 2026-03-07

### Fixed

- **Docker build**: `prepare` script now uses `|| true` so it doesn't fail when `git` is not available in the container build environment

### Added

- **ESLint v10 + typescript-eslint** — `eslint.config.js` (flat config) with `no-explicit-any`, `no-non-null-assertion`, and `no-unused-vars` (with `_` prefix ignore pattern); `pnpm lint` script added to `package.json`

### Changed

- **Eliminated all 199 ESLint errors** — Zero `as any` casts remain in the codebase:
  - `telegram.ts`: imported `ApiError` from `grammy/types`; `sendVoiceDirect` error construction uses `as ApiError`; `pollUntil` `allowed_updates` cast uses `ReadonlyArray<Exclude<keyof Update, "update_id">>`
  - `get_update.ts`, `get_updates.ts`: `allowed_updates` cast replaced with named type (`ReadonlyArray<Exclude<keyof Update, "update_id">>`)
  - `edit_message_text.ts`: `reply_markup` cast changed from `as any` to `as unknown as InlineKeyboardMarkup | undefined` with comment explaining discriminated-union mismatch
  - `set_reaction.ts`: imported `ReactionType` from `grammy/types`; `reaction` array typed as `ReactionType[]`; `ReactionEmoji` imported from `telegram.ts`; `as any` removed
  - `send_voice.ts`: `msg.voice?.field` — `as any` removed (grammy's `Voice` type is complete)
  - `update_status.ts`: `(edited as any).message_id` — removed cast (both union members have `message_id`)
  - `update-sanitizer.ts`: `u.message_reaction` accessed directly (exists in `@grammyjs/types@3.24.0`); `ReactionTypeEmoji` imported for typed filter predicate; `msg.poll.options.map(o => o.text)` — `(o: any)` removed
  - `test-utils.ts`: `parseResult` return type changed from `unknown` to `Record<string, unknown>`; `createMockServer` return type changed to `MockServer & McpServer` with `as unknown as MockServer & McpServer` cast + comment; all test files updated — `register(server as any)` → `register(server)`, `parseResult(result) as any` → `parseResult(result)`
  - `telegram.test.ts`: `makeGrammyError` accepts optional `parameters?: ResponseParameters`; GrammyError constructor now includes `parameters` — eliminates all `(err as any).parameters =` assignments; `makeMessageUpdate`/`makeCallbackUpdate` return `Update` via `as unknown as Update`; `noSender`/`noChatMsg` same pattern; `(result as any).code` → `(result as TelegramError).code`; `{ update_id: n } as any` → `as unknown as Update`; removed unused `escapePath` variable
  - `tts.test.ts`: `vi.mocked(decode as any)` / `vi.mocked(pipeline as any)` → `vi.mocked(decode)` / `vi.mocked(pipeline)` (test files excluded from `tsconfig.json`; esbuild strips types)
  - Five polling test files (`ask`, `choose`, `send_confirmation`, `wait_for_message`, `wait_for_callback_query`): `pollUntil` mock typed with `matcher: (updates: Update[]) => unknown`; `(u: any)` filter callbacks typed; `mocks.getUpdates()` cast to `Update[]`
  - `session_recording.test.ts`: `[] as any[]` replaced with `(): SessionEntry[] => []` / `(): Update[] => []` with proper imports
  - `get_update.test.ts`: `drainN: vi.fn(() => [] as any[])` typed as `(): Update[] => []`; spread passthrough simplified to `(n: number) => bufferMocks.drainN(n)`
  - `setup.ts`: removed dead `readEnv()` function (defined but never called)
- **Updated TypeScript standards doc** — Added `Linting` section with ESLint setup, three enforced rules, and suppression policy (`as unknown as T` over `as any`; `eslint-disable-next-line` only with explanation)

### Changed

- **Extracted all inline regex literals to named module-level constants** — 28 constants in `tts.ts` (`RE_ESCAPE_NEWLINE`, `RE_FENCED_CODE`, `RE_HTML_B`, `RE_TRAILING_SLASH`, etc.); `RE_BOT_COMMAND` in `set_commands.ts`; trailing-slash removal in `transcribe.ts` replaced with `endsWith`/`slice` string method
- **Code quality pass across 12 files** — guard clauses, no-else-after-return, ternaries, vertical dot chains, line-length (<100 chars), and deduplication:
  - `telegram.ts`: `advanceOffset` uses early return; `classifyGrammyError` and all validators split long return objects vertically; `validateCaption`, `validateCallbackData`, `validateText`, `validateTargetChat`, `resolveChat` refactored to guard-clause / positive-first pattern; `getApi()` and `getSecurityConfig()` use guard-clause + return-assignment; `SecurityConfig.userId` typed as `number` (`0` = no filter) — `> 0` check replaces null checks throughout; extracted `resolveMediaSource()` utility (path guard + http/https/file_id dispatch) shared by `send_document`, `send_audio`, `send_video`
  - `send_document.ts`, `send_audio.ts`, `send_video.ts`: now use `resolveMediaSource()` — 30 lines of duplicated path/URL validation replaced with a 3-line call
  - `ask.ts`: renamed `chatErr` → `textErr`; removed redundant `?? undefined` from `reply_to_message_id`; split long voice-branch return
  - `get_update.ts`: replaced `Awaited<ReturnType<typeof filterAllowedUpdates>>` with `Update[]`; extracted hint ternary to named const
  - `button-helpers.ts`: extracted private `appendSuffixAndEdit` helper — `editWithTimedOut`, `editWithSkipped`, and `ackAndEditSelection` now share it; split two long return objects in `pollButtonOrTextOrVoice`; `getApi().answerCallbackQuery().catch()` chain made vertical
  - `markdown.ts`: added `V2_SPECIAL_CHAR` non-global regex for single-char `.test()` — eliminates `lastIndex = 0` reset after each use
  - `tts.ts`: renamed inner `body` shadow variable → `errorBody` in `synthesizeHttpToOgg`; `getLocalPipeline()` uses guard-clause + return-assignment
  - `transcribe.ts`: extracted `canReact` boolean — eliminated duplicated guard in `transcribeWithIndicator`; `getApi().setMessageReaction().catch()` chains made vertical; `getPipeline()` uses `??=` (nullish coalescing assignment)
  - `typing-state.ts`: added `TypingAction` type alias for the union; extracted `unrefTimer()` helper — replaced 3 repeated inline guards
  - `topic-state.ts`: `applyTopicToTitle` two-branch if/return → ternary
  - `update-buffer.ts`: `drainN` — removed intermediate `taken` variable, direct return
  - `session-recording.ts`: extracted `pushEntry()` helper — `recordUpdate` and `recordBotMessage` no longer duplicate the cap-and-push logic
  - `update-sanitizer.ts`: all 11 long single-line return objects split vertically; unused `direction` binding renamed → `_direction`
  - `download_file.ts`: `isTextFile` inner `if (fileName)` block flattened to single-line guard

- **`chatId` type hardened to `number` throughout** — `SecurityConfig.chatId` changed from `string | null` to `number` (`0` = no filter, consistent with `userId`); extracted private `parseEnvInt(envVar): number` helper shared by both fields (returns `0` for unset/invalid, warns on invalid); `resolveChat()` now returns `number | TelegramError` (was `string | TelegramError`), eliminating all `String()` / `parseInt()` casts at call sites; `trySetMessageReaction(chatId)` parameter changed from `string` to `number`; all 23+ outbound tool files updated — type guards changed from `typeof chatId !== "string"` to `typeof chatId !== "number"`; `temp-message.ts` `PendingTemp.chatId: number`; `button-helpers.ts` all helper functions accept `chatId: number`, `String(id) === chatId` comparisons replaced with direct `id === chatId`

- **Added TypeScript standards instruction file** — `.github/instructions/typescript-standards.instructions.md` documents project-wide conventions (guard clauses, type narrowing, sentinel values, etc.) for Copilot and contributors

### Fixed

- **Identifier underscores no longer rendered as italic**: underscores bounded by word characters (e.g. `STT_HOST`, `my_var`) are now escaped in `markdownToV2` instead of triggering italic formatting — prevents cross-word pairing like `TTS_HOST … STT_HOST` from accidentally italicising the text between them

### Security

- **Path traversal in `send_document`, `send_audio`, `send_video`**: local file reads now restricted to `SAFE_FILE_DIR` (`$TMPDIR/telegram-bridge-mcp`); paths outside are rejected
- **Rejected plain HTTP URLs in media send tools**: `send_document`, `send_audio`, `send_video` now reject `http://` URLs — HTTPS required to prevent interception in transit
- **Filename collision in `download_file`**: saved filenames now include a `Date.now()_` prefix to prevent silent overwrites; returned `file_name` field remains the original name
- **CSPRNG for pairing code**: `setup.ts` now uses `crypto.randomInt()` instead of `Math.random()` for pairing code generation
- **BOT_TOKEN redacted in setup output**: `pnpm pair` no longer prints the full token to the terminal — only the first 8 chars are shown
- **TTS/STT error bodies no longer forwarded to LLM**: raw server error responses from TTS/STT providers are now logged to stderr only; a generic message is returned to the agent
- **`filterAllowedUpdates` covers `message_reaction` and `my_chat_member`**: these update types now have sender/chat ID extracted and filtered against `ALLOWED_USER_ID`/`ALLOWED_CHAT_ID`
- **`send_confirmation` validates callback data length**: `yes_data` and `no_data` are now validated against the 64-byte Telegram limit before sending
- **Supply chain / behavior guide integrity note**: documented in `SECURITY-MODEL.md` that `BEHAVIOR.md` is loaded verbatim into agent context; tampered content would inject instructions
- **HTTPS startup warning for TTS/STT hosts**: server now emits a `[warn]` to stderr at startup if `TTS_HOST` or `STT_HOST` is set but does not use `https://`

---

## [1.16.0] — 2026-03-07

### Security

- **Auth bypass fix**: `filterAllowedUpdates` now default-denies updates with undefined sender ID (channel posts, anonymous admins were previously let through)
- **Path traversal in `download_file`**: filenames from Telegram are now sanitized with `basename()` and leading dots stripped before writing to disk
- **File permissions**: downloaded files written with `0o600` (owner read/write only) instead of world-readable
- **`send_voice` file restriction**: local file reads in `sendVoiceDirect` restricted to the server's temp directory; check uses `path.relative` to prevent prefix-bypass (e.g. `telegram-bridge-mcp2/`)
- **`filterAllowedUpdates` null-chat gap**: updates where chat ID cannot be determined now default-denied when `ALLOWED_CHAT_ID` is configured

### Removed

- **`forward_message` tool**: removed. Forwarding a message back into the same single-user chat is redundant — `pin_message` covers the intent with less API surface.

### Changed

- Upgraded base Docker image from `node:22-slim` to `node:24-slim` (even-numbered release, becomes LTS Oct 2026, better security posture than the odd-numbered 25)
- Bumped `grammy` to 1.40.1
- Bumped `@modelcontextprotocol/sdk` to 1.27.1
- Bumped `zod` to 4.3.6
- Bumped `dotenv` to 17.3.1
- Bumped `@types/node` to 25.3.3

### Added

- 25 new security tests covering `filterAllowedUpdates`, `validateTargetChat`, `resolveChat`, offset management, and `sendVoiceDirect` path restriction (400 tests total)
- `CHANGELOG.md`

### Fixed

- `u.message?.chat?.id` optional chain (was `chat.id`, would throw TypeError if `chat` absent)

---

## [1.15.1] — prior

See git history.
