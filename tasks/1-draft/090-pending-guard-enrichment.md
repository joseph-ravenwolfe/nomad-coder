# 090 — Pending Guard Enrichment: Include Summary in Error

**Priority:** 090
**Status:** Draft
**Created:** 2026-03-18

## Problem

When `confirm`, `ask`, or `choose` rejects with `PENDING_UPDATES`, the error only includes a count:

```json
{ "code": "PENDING_UPDATES", "message": "1 unread update(s)...", "pending": 1 }
```

The agent must make an extra `dequeue_update(timeout: 0)` call to learn WHAT is pending, adding latency and a round-trip.

## Proposed change

Include a summary of pending items in the error response:

```json
{
  "code": "PENDING_UPDATES",
  "pending": 2,
  "items": [
    { "type": "text", "preview": "Check my code for bugs" },
    { "type": "reaction", "emoji": "👍", "target": 9645 }
  ]
}
```

## Implementation

The pending guard logic lives in `confirm.ts`, `ask.ts`, `choose.ts`. Session queues store full `TimelineEvent` objects. Serialize a preview of each pending item (type, first ~50 chars of text, emoji, target message ID) into the error payload.

## Feasibility

High — message-store already has the timeline data. This is a data enrichment change, not a structural one.
