/**
 * Text-to-speech synthesis module.
 *
 * Provider:  OpenAI TTS API (native fetch — no extra packages required)
 * Output:    OGG/Opus container — natively supported by Telegram sendVoice
 *
 * Env vars:
 *   TTS_PROVIDER  = openai            (required to enable TTS; "openai" is the only supported value)
 *   TTS_VOICE     = alloy             (default: "alloy"; options: alloy, echo, fable, onyx, nova, shimmer)
 *   TTS_MODEL     = tts-1             (default: "tts-1"; use "tts-1-hd" for higher quality)
 *   OPENAI_API_KEY                    (required when TTS_PROVIDER=openai)
 *
 * Usage flow in send_message:
 *   1. stripForTts(originalText) → plain text (no markdown/HTML)
 *   2. synthesizeToOgg(plainText) → Buffer (OGG/Opus)
 *   3. new InputFile(buffer, "voice.ogg") → pass to grammy sendVoice
 */

/** Maximum characters accepted by OpenAI TTS per request (same as Telegram text limit). */
export const TTS_LIMIT = 4096;

/** Returns true when TTS delivery is globally configured via env vars. */
export function isTtsEnabled(): boolean {
  return process.env.TTS_PROVIDER?.toLowerCase() === "openai";
}

/**
 * Strips Markdown / MarkdownV2 / HTML formatting to plain text suitable for TTS synthesis.
 *
 * Rules applied in order:
 *   - Fenced code blocks: replaced with their content
 *   - Inline code: backticks removed, content kept
 *   - Bold, italic, underline, strikethrough markers removed
 *   - Links: display text kept, URL discarded
 *   - Headings (#, ##, …): prefix stripped
 *   - Blockquote markers (>) stripped
 *   - HTML tags (b, i, u, s, code, pre, a): unwrapped to content
 *   - MarkdownV2 escape sequences (\. \! etc.) unescaped
 */
export function stripForTts(text: string): string {
  return (
    text
      // Fenced code blocks — keep inner content, strip fence lines
      .replace(/```[\w]*\n?([\s\S]*?)```/g, "$1")
      // Inline code — remove backtick delimiters
      .replace(/`([^`]+)`/g, "$1")
      // Bold (**text** and *text*)
      .replace(/\*\*(.+?)\*\*/gs, "$1")
      .replace(/\*(.+?)\*/gs, "$1")
      // Underline (__text__) before italic (_text_)
      .replace(/__(.+?)__/gs, "$1")
      // Italic / MarkdownV2 italic
      .replace(/_(.+?)_/gs, "$1")
      // Strikethrough (~~text~~ and MarkdownV2 ~text~)
      .replace(/~~(.+?)~~/gs, "$1")
      .replace(/~(.+?)~/gs, "$1")
      // Links — keep display text, discard URL
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Headings — strip leading # markers
      .replace(/^#{1,6}\s+/gm, "")
      // Blockquotes — strip leading > marker
      .replace(/^>\s*/gm, "")
      // HTML: inline tags — unwrap to content
      .replace(/<b[^>]*>(.*?)<\/b>/gis, "$1")
      .replace(/<strong[^>]*>(.*?)<\/strong>/gis, "$1")
      .replace(/<i[^>]*>(.*?)<\/i>/gis, "$1")
      .replace(/<em[^>]*>(.*?)<\/em>/gis, "$1")
      .replace(/<u[^>]*>(.*?)<\/u>/gis, "$1")
      .replace(/<ins[^>]*>(.*?)<\/ins>/gis, "$1")
      .replace(/<s[^>]*>(.*?)<\/s>/gis, "$1")
      .replace(/<del[^>]*>(.*?)<\/del>/gis, "$1")
      .replace(/<code[^>]*>(.*?)<\/code>/gis, "$1")
      .replace(/<pre[^>]*>(.*?)<\/pre>/gis, "$1")
      .replace(/<a[^>]*>(.*?)<\/a>/gis, "$1")
      // Strip any remaining HTML tags
      .replace(/<[^>]+>/g, "")
      // MarkdownV2 escaped special chars — unescape
      .replace(/\\([_*[\]()~`>#+=|{}.!-])/g, "$1")
      .trim()
  );
}

/**
 * Synthesizes plain text to an OGG/Opus audio buffer via the OpenAI TTS API.
 *
 * - Requires `TTS_PROVIDER=openai` and `OPENAI_API_KEY` env vars.
 * - Input `text` should already be stripped of formatting (call `stripForTts` first).
 * - Input length must be ≤ `TTS_LIMIT` (4096) characters.
 * - Returns a raw Buffer containing the OGG/Opus audio — pass directly to grammy
 *   `sendVoice` via `new InputFile(buffer, "voice.ogg")`.
 *
 * @throws If the API key is missing, input is empty/oversized, or the API call fails.
 */
export async function synthesizeToOgg(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("TTS_PROVIDER=openai requires the OPENAI_API_KEY environment variable to be set.");
  }

  if (!text || text.trim().length === 0) {
    throw new Error("TTS input text must not be empty.");
  }

  if (text.length > TTS_LIMIT) {
    throw new Error(`TTS input too long (${text.length} chars, limit ${TTS_LIMIT}). Split the text first.`);
  }

  const voice = process.env.TTS_VOICE ?? "alloy";
  const model = process.env.TTS_MODEL ?? "tts-1";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: "opus", // OGG container with Opus codec — Telegram-native
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`OpenAI TTS API error ${res.status}: ${body}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
