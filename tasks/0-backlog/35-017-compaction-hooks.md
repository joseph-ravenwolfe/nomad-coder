# Task 017 — Pre/Post-Compaction Hooks (Spike)

**Type:** Spike / Research
**Priority:** 35 (medium)

## Description

Investigate mechanisms to help agent sessions survive context compaction (summarization). When an LLM's context window fills and the provider compacts/summarizes, the agent loses its loop state and may not re-engage the `dequeue_update` loop.

## Problem

After compaction:
- Agent forgets it was in a loop
- No automatic signal to re-engage
- Operator sees a hung session
- Manual intervention required

## Research Areas

1. **VS Code API hooks**: Does VS Code or the Copilot extension expose pre/post-compaction events? Could an extension fire a callback?
2. **MCP-level heartbeat**: The MCP server could expose a `heartbeat` tool. If a session misses heartbeats, the server pings or notifies the operator.
3. **Prompt-level mitigation**: System prompt instructions that survive compaction (e.g., in `copilot-instructions.md`) telling the agent "if you see this and you're not in a loop, call `dequeue_update`."
4. **Session keepalive**: The MCP server detects stale sessions and sends a "wake up" service message.

## Deliverable

Research findings + recommendation for the most practical approach. May lead to implementation tasks.

## Notes

- Backlog. Not blocking anything currently.
- Related to session persistence (#016) — persistent sessions would make recovery easier.
- The instructions in `.github/copilot-instructions.md` are always loaded into context, which is our best current vector for post-compaction recovery.
