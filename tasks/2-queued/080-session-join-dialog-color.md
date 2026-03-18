# 080 — Session Join Dialog: Show Color Emoji

**Priority:** 080
**Status:** Queued
**Created:** 2026-03-18

## Problem

The session approval prompt (`requestApproval` in `session_start.ts`) currently shows:

```text
🤖 New session requesting access: Worker
```

No color emoji is shown. The operator wants the assigned color to appear in the prompt so they can see which color the joining session will get.

## Design

### Approval = Color Selection (double whammy)

The approval prompt becomes a color-picker AND approval gate in one step. Instead of generic Approve/Deny buttons, the operator sees available color squares as buttons. Tapping a color **approves the session AND assigns that color** in one action.

### First session (no approval gate)

No change — agent picks a color or gets auto-assigned. No operator approval required.

### Second+ session approval prompt

**Before decision:**

```text
🤖 New session requesting access: Worker
Pick a color to approve, or deny:
```

**Buttons (one row):**

```text
[🟦] [🟩] [🟨] [🟧] [🟥] [🟪]  [✗ Deny]
```

- Only show colors NOT already taken by active sessions (unless all 6 are taken — then show all, duplicates are fine)
- Agent's preferred color (from `color` param) goes first / gets `primary` style to guide the operator
- Deny button gets `danger` style (existing behavior)
- Color buttons: unstyled (just the emoji, no `primary`/`danger` — keeps them neutral so operator freely picks)

**After operator picks a color (e.g., 🟩):**

```text
🤖 Session approved: 🟩 Worker ✓
```

**After denial:**

```text
🤖 Session denied: Worker ✗
```

**Reconnect variant:**

```text
🤖 Session reconnecting: Worker
Pick a color to approve, or deny:
```

### Color semantics reference

The agent should pick its preferred color based on the documented palette meanings (see `docs/multi-session.md`):

| Emoji | Suggested Role |
| --- | --- |
| 🟦 | Coordinator / overseer |
| 🟩 | Builder / worker |
| 🟨 | Reviewer / QA |
| 🟧 | Research / exploration |
| 🟥 | Ops / deployment |
| 🟪 | Specialist / one-off |

The `session_start` tool description should reference these meanings so agents pick meaningful colors. But the operator has final say via the approval buttons.

### Future: circles for differentiation

If two agents want the same color, circles (🔵 🟢 🟡 🟠 🔴 🟣) can differentiate them. Not in scope now — focus on squares only.

### Callback data encoding

Use `approve_🟦`, `approve_🟩`, etc. for color buttons. Parse the emoji from the callback data to determine which color was selected. Keep `approve_no` for deny.

### Implementation steps

1. Export `getAvailableColors(hint?: string): string[]` from `session-manager.ts` — returns available colors from `COLOR_PALETTE` not in use, with hint first if available
2. Update `requestApproval` signature: `requestApproval(chatId, name, reconnect, colorHint?)` → returns `{ approved: boolean, color?: string }`
3. Build inline keyboard dynamically: one button per available color + Deny button
4. Parse callback data to extract chosen color
5. Edit message after decision to show outcome with color
6. Pass chosen color to `createSession(name, chosenColor)` — guaranteed match since operator picked it
7. Update `buildIntro` to include the operator-chosen color in the intro message
8. Update `session_start` tool `color` param description to reference the palette meanings so agents choose meaningfully

### Color availability

- If 0 colors are taken → show all 6
- If 5 are taken → show 1 available
- If all 6 are taken → show all 6 (allow duplicates — operator's choice)
- Circles (🔵 🟢 🟡 🟠 🔴 🟣) are reserved for future expansion if 6+ agents run simultaneously

## Acceptance criteria

- [ ] Approval prompt shows available color buttons + Deny
- [ ] Tapping a color approves AND assigns that color
- [ ] Already-taken colors are excluded from buttons (unless all taken)
- [ ] Agent's preferred color hint is shown first / highlighted
- [ ] Post-decision edit shows chosen color + name
- [ ] Reconnect variant uses same color-picker flow
- [ ] First session (no approval gate) is unchanged
- [ ] `createSession` receives the operator-chosen color
- [ ] Existing tests pass
