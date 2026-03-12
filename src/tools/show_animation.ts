import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { startAnimation } from "../animation-state.js";

export function register(server: McpServer) {
  server.registerTool(
    "show_animation",
    {
      description:
        "Start a server-managed cycling visual placeholder message. The animation " +
        "auto-cancels after timeout seconds of inactivity. One frame = static placeholder. " +
        "Multiple frames = cycling animation (min 1500ms interval). " +
        "Only one animation at a time — starting a new one cancels the previous. " +
        "Cancel with cancel_animation, or let it auto-clean on timeout.",
      inputSchema: {
        frames: z
          .array(z.string())
          .default(["⏳", "⌛"])
          .describe("Animation frames. Single frame = static placeholder. Default: [\"⏳\", \"⌛\"]"),
        interval: z
          .number()
          .int()
          .min(1500)
          .max(10000)
          .default(2000)
          .describe("Milliseconds between frames (min 1500, default 2000). Ignored if single frame."),
        timeout: z
          .number()
          .int()
          .min(5)
          .max(600)
          .default(30)
          .describe("Seconds of inactivity before auto-cleanup (default 30, max 600)"),
      },
    },
    async ({ frames, interval, timeout }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      try {
        const message_id = await startAnimation(frames, interval, timeout);
        return toResult({ message_id });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
