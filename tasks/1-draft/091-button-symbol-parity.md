# 091 — Button Symbol Parity Enforcement

**Priority:** 091
**Status:** Draft
**Created:** 2026-03-18

## Problem

The documentation mandates "all-or-nothing" for emoji/symbols in button labels — if any button has an emoji, all must. The server validates label LENGTH but not symbol parity.

## Proposed change

In `choose.ts` and `confirm.ts`, before sending the inline keyboard:

1. Detect which labels contain emoji/unicode symbols (regex: Unicode emoji ranges)
2. If some labels have symbols and others don't, return `BUTTON_SYMBOL_PARITY` error
3. Agent adjusts labels and retries

## Implementation

Add a shared helper (e.g., in `markdown.ts` or a new `button-validation.ts`):

```typescript
function hasEmoji(text: string): boolean {
  return /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(text);
}

function validateButtonSymbolParity(labels: string[]): boolean {
  const emojiFlags = labels.map(hasEmoji);
  return emojiFlags.every(Boolean) || emojiFlags.every(f => !f);
}
```

Apply in `choose.ts` and `confirm.ts` before building the inline keyboard.

## Feasibility

High — straightforward regex check, minimal code addition.
