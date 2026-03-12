import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toError } from "../telegram.js";
import { dumpTimeline, timelineSize, storeSize } from "../message-store.js";

export function register(server: McpServer) {
  server.registerTool(
    "dump_session_record",
    {
      description:
        "Returns the message-store timeline as compact JSON. Always-on — no recording " +
        "needs to be started. The timeline contains all inbound and outbound events " +
        "since server start (rolling limit of 1000 events). Use limit to control output size.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Max events to return (most recent). Default 100."),
      },
    },
    async ({ limit }) => {
      try {
        const full = dumpTimeline();
        const timeline = full.length > limit ? full.slice(-limit) : full;
        const summary = {
          timeline_events: timelineSize(),
          unique_messages: storeSize(),
          returned: timeline.length,
          truncated: full.length > limit,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ summary, timeline }) }],
        };
      } catch (err) {
        return toError(err);
      }
    }
  );
}
