# Super Tools

> Super tools are high-level Telegram primitives that manage their own message lifecycle —
> they auto-pin themselves when created, update in-place, and auto-unpin when complete.
> They spare the agent from writing pin/edit/unpin boilerplate by handling it internally.

---

## Concept

Standard tools like `send_text` and `notify` fire-and-forget.
Super tools instead maintain a **persistent, mutable presence** in the chat:

1. **Create** — sends the message, pins it (silent), returns `message_id`
2. **Update** — agent edits in-place by passing `message_id`; pinned message stays visible
3. **Complete** — agent marks done; tool replies to original message, then unpins it;
   user can scroll back to the pinned message to review the final state

The reply-before-unpin pattern keeps a visible thread breadcrumb in the chat so the user
can always jump back to the completed task.

---

## Skip the reply when no context exists

If no messages arrived after the super-tool message (i.e., the checklist or bar is the
last message in the chat), skip the reply and just unpin.
The user can see the final state as the last message directly — a reply-to-self adds clutter.

---

## Planned Super Tools

### `send_new_checklist`

A live task checklist with per-step status indicators.
Implemented as of v3 (renamed from `update_status`).

**Status values:** `pending` · `running` · `done` · `failed` · `skipped`

**API (current — single-tool pattern):**

```text
# Create
{ message_id } = send_new_checklist(title, steps)

# Update (in-place edit)
send_new_checklist(title, steps, message_id)

# Complete (agent-managed — not yet automatic)
pin_message(message_id, unpin: true)
```

**Planned:**

- Auto-pin on first call
- Auto-reply + unpin when all steps reach a terminal status (`done` / `failed` / `skipped`)

---

### `progress_bar`

A visual progress bar rendered with emoji blocks.
Not yet implemented.

**Concept:**

```text
{ message_id } = progress_bar(title, percent, subtext?)

# Built-in render example (50%, default style):
# ▓▓▓▓▓░░░░░  50%
# Building dist/...

progress_bar(title, 100, "Done in 4.2s", message_id)
```

**Parameters (planned):**

| Parameter | Type | Notes |
| --- | --- | --- |
| `title` | string | Bold heading |
| `percent` | 0–100 | Current progress |
| `subtext` | string (optional) | Italicized detail line below the bar |
| `width` | number (optional) | Bar width in chars; default 10 |
| `style` | string (optional) | Named style preset; default uses `▓`/`░` |
| `message_id` | number (optional) | Omit to create; pass to edit in-place |

**Auto-lifecycle (planned):**

- First call (no `message_id`): send + pin (silent)
- Subsequent calls: edit in-place
- `percent: 100`: reply to original message → unpin (if messages exist after it)

---

## Design Principles

- **Auto-pin on create** — super tools are important enough to stay visible; no separate
  `pin_message` call required
- **Auto-unpin on complete** — with a breadcrumb reply so the user can scroll back
- **In-place editing** — one message evolves rather than a stream of status messages
- **Single-tool API** — create and update share one tool name; `message_id` distinguishes them
- **Agent-transparent** — agent passes `message_id` around; the tool handles pin state internally

---

## Planned: Reaction Tools

### `set_temporary_reaction` *(implemented, v3)*

Set a reaction that **auto-reverts** when the agent takes any outbound action.

**Core concept:**  
Current `set_reaction` is permanent — the agent must manually restore the previous emoji.
`set_temporary_reaction` automates the restore pattern: set 👀 to signal *"reading this"*,
and it snaps back to whatever was there before (or a specified `restore_emoji`) the moment
anything outbound happens (typing, send message, etc.).

**Trigger for auto-removal:**
- Any outbound event fires the cleanup: `show_typing`, `send_text`, `send_message`, `notify`, `send_file`, etc.
- Optionally: a `timeout_seconds` deadline (e.g. `300` = 5 min) — reaction reverts on whichever comes first.

**Proposed API (draft):**

```text
set_temporary_reaction(
  message_id,
  emoji,                    // e.g. "👀" — the temporary reaction to set
  restore_emoji?,           // e.g. "🫡" — what to set once done; omit = remove
  timeout_seconds?          // fallback deadline; default: none
)
```

**Examples:**

```text
# Classic "I'm reading this" pattern (currently done manually):
set_temporary_reaction(message_id, "👀", restore_emoji: "🫡")
# → sets 👀 immediately
# → first outbound action replaces 👀 with 🫡 automatically

# Temporary ack with no follow-up:
set_temporary_reaction(message_id, "👍", timeout_seconds: 30)
# → sets 👍 immediately
# → removed after 30s or on next outbound action

# Timed reading indicator:
set_temporary_reaction(message_id, "👀", timeout_seconds: 300)
# → reverts to no reaction after 5 min (or first outbound)
```

**Implementation sketch:**
- Store `{ message_id, restore_emoji }` in session state (single active slot — only one temporary at a time)
- Outbound proxy intercepts every outbound API call → fires restore + clears slot
- Timeout handled by a `setTimeout` that fires the same restore logic

**Why this matters:**  
The agent currently does 👀 set → work → 🫡 set manually on every voice message. This
is 2 explicit tool calls that could be replaced by 1 declarative call, and the agent
never forgets the restore.

---

## See Also

- [`docs/keyboard-interactions.md`](keyboard-interactions.md) — keyboard primitive taxonomy
- [`docs/communication.md`](communication.md) — when to use `send_new_checklist`
- [`src/tools/send_new_checklist.ts`](../src/tools/send_new_checklist.ts) — implementation
