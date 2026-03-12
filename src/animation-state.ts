/**
 * Animation state — server-managed cycling placeholder messages.
 *
 * The animation system supports the "segmented streaming" pattern:
 *   1. Agent calls show_animation → creates a cycling placeholder
 *   2. Agent sends content via send_text/notify/etc.
 *   3. Server edits animation → real content, sends NEW animation below
 *   4. Agent calls cancel_animation → trailing animation removed
 *
 * The agent sees none of step 3's mechanics — just show, send, cancel.
 */

import { getApi, resolveChat } from "./telegram.js";
import { resolveParseMode } from "./markdown.js";
import { recordOutgoing } from "./message-store.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AnimationState {
  chatId: number;
  messageId: number;
  frames: string[];
  intervalMs: number;
  timeoutMs: number;
  frameIndex: number;
  cycleTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

let _state: AnimationState | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrefTimer(t: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && "unref" in t) t.unref();
}

function clearTimers(): void {
  if (_state?.cycleTimer) {
    clearInterval(_state.cycleTimer);
    _state.cycleTimer = null;
  }
  if (_state?.timeoutTimer) {
    clearTimeout(_state.timeoutTimer);
    _state.timeoutTimer = null;
  }
}

function startTimeoutTimer(): void {
  if (!_state) return;
  if (_state.timeoutTimer) clearTimeout(_state.timeoutTimer);
  _state.timeoutTimer = setTimeout(() => void cancelAnimation(), _state.timeoutMs);
  unrefTimer(_state.timeoutTimer);
}

async function cycleFrame(): Promise<void> {
  if (!_state) return;
  _state.frameIndex = (_state.frameIndex + 1) % _state.frames.length;
  const text = _state.frames[_state.frameIndex];
  try {
    await getApi().editMessageText(_state.chatId, _state.messageId, text);
  } catch {
    // Best-effort — animation is cosmetic; swallow failures
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start (or replace) a cycling animation message.
 * Returns the message_id of the animation placeholder.
 */
export async function startAnimation(
  frames: string[] = ["⏳", "⌛"],
  intervalMs = 2000,
  timeoutSeconds = 30,
): Promise<number> {
  // Cancel any existing animation
  await cancelAnimation();

  const chatId = resolveChat();
  if (typeof chatId !== "number") throw new Error("ALLOWED_CHAT_ID not configured");

  const firstFrame = frames[0] ?? "⏳";
  const msg = await getApi().sendMessage(chatId, firstFrame);

  _state = {
    chatId,
    messageId: msg.message_id,
    frames,
    intervalMs: Math.max(intervalMs, 1500), // Telegram rate limit floor
    timeoutMs: Math.min(timeoutSeconds, 600) * 1000,
    frameIndex: 0,
    cycleTimer: null,
    timeoutTimer: null,
  };

  // Start cycling if multiple frames
  if (frames.length > 1) {
    _state.cycleTimer = setInterval(() => void cycleFrame(), _state.intervalMs);
    unrefTimer(_state.cycleTimer);
  }

  // Start inactivity timeout
  startTimeoutTimer();

  return msg.message_id;
}

/**
 * Cancel the active animation. Optionally replace with real text.
 * Returns { cancelled, message_id? }.
 */
export async function cancelAnimation(
  text?: string,
  parseMode?: "Markdown" | "HTML" | "MarkdownV2",
): Promise<{ cancelled: boolean; message_id?: number }> {
  if (!_state) return { cancelled: false };

  const { chatId, messageId } = _state;
  clearTimers();
  _state = null;

  if (text) {
    // Replace animation with real content — message becomes permanent
    try {
      const resolved = resolveParseMode(text, parseMode ?? "Markdown");
      await getApi().editMessageText(chatId, messageId, resolved.text, {
        parse_mode: resolved.parse_mode,
      });
      // Now it's a real message — record it
      recordOutgoing(messageId, "text", text);
      return { cancelled: true, message_id: messageId };
    } catch {
      // If edit fails (message deleted?), just clean up
      return { cancelled: true };
    }
  }

  // No replacement — delete the ephemeral message
  try {
    await getApi().deleteMessage(chatId, messageId);
  } catch {
    // Already deleted or expired — cosmetic only
  }
  return { cancelled: true };
}

/**
 * Reset the animation inactivity timeout. Called by outbound tools.
 * In V3 full implementation, this would also do the juggle (edit→send).
 * For now, it just resets the timeout timer.
 */
export function resetAnimationTimeout(): void {
  if (!_state) return;
  startTimeoutTimer();
}

/**
 * Returns the current animation message_id, or null if no animation is active.
 */
export function getAnimationMessageId(): number | null {
  return _state?.messageId ?? null;
}

/** Returns true if an animation is currently active. */
export function isAnimationActive(): boolean {
  return _state !== null;
}

/** For testing only: resets animation state without API calls. */
export function resetAnimationForTest(): void {
  clearTimers();
  _state = null;
}
