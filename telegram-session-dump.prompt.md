---
name: telegram-session-dump
description: Capture the current telegram session state and dump it to a file for later analysis. Useful for debugging and record-keeping.
agent: agent
---

Spin off a sub-agent and ask it to do the following:

Using the Telegram Bridge MCP tools, capture the current Telegram session state and dump it to a file for later analysis by calling the `dump_session_record` tool with `clean: true`. This will capture a clean snapshot of the session without interrupting any work.

The tool will return the contents of the session record. Save this information to a folder under logs/telegram/[YYYYMM]/[hhmmss]/session.txt for later review.

Then summarize the session into a summary.md file in the same folder.

If there wasn't a session recording already in progress, then obviously don't create a log, but start one with `start_session_recording(1000)`.

