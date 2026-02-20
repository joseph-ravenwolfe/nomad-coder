import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "delete_message",
    "Deletes a message. The bot can only delete messages it sent, or any message if it is an admin.",
    {
      message_id: z.number().int().describe("ID of the message to delete"),
    },
    async ({ message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const ok = await getApi().deleteMessage(chatId, message_id);
        return toResult({ ok });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
