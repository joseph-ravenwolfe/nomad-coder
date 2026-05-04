import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { getSessionVoice, setSessionVoice, clearSessionVoice, getSessionSpeed, setSessionSpeed, clearSessionSpeed } from "../../voice-state.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";

const DESCRIPTION =
  "Sets a per-session TTS voice override. The accepted format depends on the " +
  "active provider: ElevenLabs takes a 22-char voice_id (e.g. " +
  "\"21m00Tcm4TlvDq8ikWAM\"), OpenAI/Kokoro take a voice name (e.g. \"alloy\", " +
  "\"nova\", \"af_heart\"). Overrides the global default for this session only — " +
  "other sessions are unaffected. Pass an empty string to clear the override " +
  "and revert to the global default. Use list_voices (if available) or the " +
  "operator's /voice Telegram panel to discover supported voices.";

export function handleSetVoice({ voice, speed, token }: { voice: string; speed?: number; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const previous = getSessionVoice();
  const previousSpeed = getSessionSpeed();
  if (voice.trim() === "") {
    clearSessionVoice();
    clearSessionSpeed();
    return toResult({ voice: null, speed: null, previous, previousSpeed, cleared: true });
  }
  setSessionVoice(voice);
  if (speed !== undefined) {
    setSessionSpeed(speed);
  }
  return toResult({ voice: getSessionVoice(), speed: getSessionSpeed(), previous, previousSpeed, set: true });
}

export function register(server: McpServer) {
  server.registerTool(
    "set_voice",
    {
      description: DESCRIPTION,
      inputSchema: {
        voice: z
          .string()
          .max(64)
          .describe("Voice identifier for this session. ElevenLabs: 22-char voice_id. OpenAI/Kokoro: voice name. Empty string clears."),
        speed: z
          .number()
          .min(0.25)
          .max(4.0)
          .optional()
          .describe("TTS speed multiplier (0.25–4.0, default 1.0). ElevenLabs clamps to [0.7, 1.2]. Omit to leave speed unchanged."),
        token: TOKEN_SCHEMA,
      },
    },
    handleSetVoice,
  );
}
