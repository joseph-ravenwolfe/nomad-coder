# 093 — Voice Transcription Failure Service Message

**Priority:** 093
**Status:** Queued
**Created:** 2026-03-18

## Problem

When voice transcription fails (service down, corrupted audio, timeout), the poller sets an error reaction but doesn't notify the agent via a service message. The agent may not realize the voice message was never transcribed.

## Proposed change

Deliver a service message to the target session when transcription fails:

```json
{
  "event": "service_message",
  "content": {
    "type": "voice_transcription_failed",
    "message_id": 9645,
    "reason": "service_timeout",
    "details": "Transcription service did not respond within 30s"
  }
}
```

## Implementation

1. In `poller.ts`, the transcription pipeline has a failure path that currently:
   - Sets an error text in the voice event content (e.g., `[transcription failed]`)
   - Sets an error reaction (❌ or 😴)
2. Add a `deliverServiceMessage` call in the failure path
3. Include the failure reason and original message ID so the agent can ask the operator to resend

## Acceptance criteria

- [ ] On transcription failure, a `voice_transcription_failed` service message is delivered to the target session queue
- [ ] The service message includes: message_id, reason, human-readable details
- [ ] Existing voice event content still includes error text (backwards compatible)
- [ ] Agent docs updated to describe the new service message type
