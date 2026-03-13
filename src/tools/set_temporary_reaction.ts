import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveChat, toResult, toError, type ReactionEmoji } from "../telegram.js";
import { recordBotReaction } from "../message-store.js";
import { setTempReaction } from "../temp-reaction.js";

/**
 * Allowed emoji reactions from the Telegram Bot API.
 * Kept in sync with set_reaction.ts.
 */
const ALLOWED_EMOJI = [
  "👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢",
  "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳",
  "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓",
  "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈",
  "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿",
  "🚀", "⏳", "✅", "⛔", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡",
] as const;

const REACTION_ALIASES: Record<string, string> = {
  thinking: "🤔", working: "⏳", processing: "⏳", busy: "⏳",
  done: "✅", complete: "✅", finished: "✅", error: "⛔", failed: "⛔",
  stop: "⛔", blocked: "⛔", approve: "👍", yes: "👍", good: "👍",
  ok: "👌", okay: "👌", salute: "🫡", acknowledged: "🫡", understood: "🫡",
  heart: "❤", love: "❤", reject: "👎", no: "👎", bad: "👎",
  reading: "👀", looking: "👀", watching: "👀",
  fire: "🔥", hot: "🔥", rocket: "🚀", launch: "🚀",
  tada: "🎉", celebrate: "🎉", party: "🎉",
};

function resolveEmoji(input: string): string {
  return REACTION_ALIASES[input.toLowerCase()] ?? input;
}

function validateEmoji(raw: string): { emoji: ReactionEmoji } | { error: string } {
  const resolved = resolveEmoji(raw);
  if (!(ALLOWED_EMOJI as readonly string[]).includes(resolved))
    return { error: `"${raw}" → "${resolved}" is not an allowed reaction emoji.` };
  return { emoji: resolved as ReactionEmoji };
}

const DESCRIPTION =
  "Sets a temporary emoji reaction that auto-reverts on the next outbound action " +
  "(any send, edit, or file transfer) or after an optional timeout. " +
  "Use for fire-and-forget 👀 signals: set 'reading' while processing a voice " +
  "message and it snaps back to 'salute' (or disappears) automatically when you " +
  "respond — no manual restore needed. Only one temp reaction is active at a time; " +
  "setting a new one cancels the previous without restoring it.";

export function register(server: McpServer) {
  server.registerTool(
    "set_temporary_reaction",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z.number().int().describe("ID of the message to react to"),
        emoji: z
          .string()
          .describe(
            "Temporary reaction emoji or alias (e.g. 'reading' = 👀, 'thinking' = 🤔). " +
            "Shown until the next outbound action or timeout.",
          ),
        restore_emoji: z
          .string()
          .optional()
          .describe(
            "Emoji or alias to set when the temporary reaction clears. " +
            "Omit to remove the reaction entirely on restore.",
          ),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Fallback deadline in seconds (e.g. 300 = 5 min). " +
            "The reaction reverts on whichever comes first: next outbound action or this timeout.",
          ),
      },
    },
    async ({ message_id, emoji, restore_emoji, timeout_seconds }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const resolved = validateEmoji(emoji);
      if ("error" in resolved) return toError({ code: "REACTION_EMOJI_INVALID" as const, message: resolved.error });

      let restoreResolved: ReactionEmoji | undefined;
      if (restore_emoji) {
        const r = validateEmoji(restore_emoji);
        if ("error" in r) return toError({ code: "REACTION_EMOJI_INVALID" as const, message: r.error });
        restoreResolved = r.emoji;
      }

      const ok = await setTempReaction(message_id, resolved.emoji, restoreResolved, timeout_seconds);
      if (!ok) return toError({ code: "UNKNOWN" as const, message: "Failed to set reaction — message may be too old or unavailable." });

      recordBotReaction(message_id, resolved.emoji);
      return toResult({
        ok: true,
        message_id,
        emoji: resolved.emoji,
        restore_emoji: restoreResolved ?? null,
        timeout_seconds: timeout_seconds ?? null,
      });
    },
  );
}
