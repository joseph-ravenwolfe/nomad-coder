import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

/**
 * Starts a background typing indicator that repeats every 4 s until either
 * the timeout expires or the process sends a real message.
 *
 * The Telegram "typing" action expires after ~5 s, so 4 s gives a small
 * overlap to keep it seamless.
 *
 * Returns immediately — fire and forget.
 */
export function register(server: McpServer) {
  server.tool(
    "start_typing",
    "Starts a background typing indicator that keeps refreshing (~every 4 s) until the timeout expires or a message is sent. Call this before any long-running work so the user sees the bot is active. Returns immediately — fire and forget.",
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(60)
        .describe("How long to keep the typing indicator alive (1–300 s, default 60)"),
    },
    async ({ timeout_seconds }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);

      try {
        // Send immediately so there's no visible delay
        await getApi().sendChatAction(chatId, "typing");

        const interval = 4_000;
        const deadline = Date.now() + timeout_seconds * 1000;

        const timer = setInterval(async () => {
          if (Date.now() >= deadline) {
            clearInterval(timer);
            return;
          }
          try {
            await getApi().sendChatAction(chatId, "typing");
          } catch {
            // Best-effort — if it fails, just stop
            clearInterval(timer);
          }
        }, interval);

        // Safety: always stop at deadline even if no message is sent
        setTimeout(() => clearInterval(timer), timeout_seconds * 1000);

        return toResult({ started: true, timeout_seconds });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
