---
applyTo: "**"
---
# Telegram Communication

> **Authoritative guide:** `docs/communication.md` · **MCP resource:** `telegram-bridge-mcp://communication-guide`
>
> At session start, load the MCP resource for full patterns (formatting, commit/push flow, pinning, loop, session end).

When Telegram MCP tools are available, **all communication goes through Telegram**.

## Non-Negotiable Rules

1. **Drain before you speak.** `dequeue_update(timeout=0)` until empty before every outbound message. Never talk over the operator.
2. **Reply via Telegram** for every substantive response — not the agent panel.
3. **`reply_to_message_id`** on every reply — threads messages visually.
4. **`confirm`** for yes/no · **`choose`** for multi-option — always buttons.
5. **React 👀 immediately on voice messages.** Skip on short texts ("yes", "ok"). Never leave 👀 unresolved — always update to 🫡 or 👍 when work is complete.
6. **`show_typing`** when a text reply is imminent — not a generic receipt.
7. **Announce before major actions** (`send_text` or `notify`). Require `confirm` for destructive/irreversible ones.
8. **`dequeue_update` again** after every task, timeout, or error — loop forever.
9. **Never assume silence means approval.**

## Tool Selection

| Situation | Tool |
| --- | --- |
| Pure statement / preference | React (🫡 👍 👀 ❤) — no text reply |
| Yes/No decision | `confirm` |
| Fixed options | `choose` |
| Open-ended input | `ask` |
| Short status (1–2 sentences) | `notify` |
| Ephemeral placeholder ("Thinking…") | `show_animation` / `cancel_animation` |
| Structured result / explanation | `send_text` (Markdown) |
| Build / deploy / error event | `notify` with severity |
| Multi-step task (3+) | `send_new_checklist` + `pin_message` |
| Completed work / ready to proceed | `confirm` (single-button CTA) |

