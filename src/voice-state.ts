/**
 * Per-session singleton for the active voice override.
 *
 * **Purpose:** When multiple sessions are active, `set_voice` lets each session
 * use a different TTS voice — so you can tell which agent is speaking.
 *
 * **Scope:** Per-session, keyed by SID via `getCallerSid()`. In single-session
 * mode (SID 0) the map has a single entry — behaviour is identical to the old
 * global singleton.
 */

import { getCallerSid } from "./session-context.js";
import { getConfiguredVoices } from "./config.js";
import { hashNameToIndex } from "./name-hash.js";

const _voices = new Map<number, string | null>();
const _speeds = new Map<number, number | null>();

export function getSessionVoice(): string | null {
  return _voices.get(getCallerSid()) ?? null;
}

/**
 * Set the active voice override for the current session. Pass an empty string to clear.
 */
export function setSessionVoice(voice: string): void {
  _voices.set(getCallerSid(), voice.trim() || null);
}

export function clearSessionVoice(): void {
  _voices.delete(getCallerSid());
}

/**
 * Direct SID lookup — used by outbound proxy and tests to read another session's voice.
 */
export function getSessionVoiceFor(sid: number): string | null {
  return _voices.get(sid) ?? null;
}

export function getSessionSpeed(): number | null {
  return _speeds.get(getCallerSid()) ?? null;
}

export function setSessionSpeed(speed: number): void {
  _speeds.set(getCallerSid(), speed);
}

export function clearSessionSpeed(): void {
  _speeds.delete(getCallerSid());
}

/**
 * Direct SID lookup — used by save_profile to read another session's speed.
 */
export function getSessionSpeedFor(sid: number): number | null {
  return _speeds.get(sid) ?? null;
}

// ---------------------------------------------------------------------------
// Auto-rotation for new sessions
// ---------------------------------------------------------------------------

/**
 * Direct sid setter — bypasses `getCallerSid()` AsyncLocalStorage so the
 * caller can assign a voice to a brand-new session that has not yet entered a
 * request context. Used by `createSession()` to seed the rotated voice.
 */
export function setSessionVoiceForSid(sid: number, voice: string): void {
  const trimmed = voice.trim();
  _voices.set(sid, trimmed.length > 0 ? trimmed : null);
}

/**
 * Pick a voice from the operator's curated `voices` list (mcp-config.json)
 * deterministically by session name:
 *
 *   voice index = hash(normalize(name)) modulo voices.length
 *
 * Same name always maps to the same voice across runs and machines, so
 * "Scout" sounds like Scout every time. Collisions across different names
 * are tolerated — multiple sessions can share a voice (the operator picks
 * tag emojis to disambiguate visually anyway).
 *
 * Returns `null` when no curated voices are configured — the resolution
 * chain then falls through to `getDefaultVoice()` and the provider default.
 */
export function pickRotationVoice(name: string): string | null {
  const voices = getConfiguredVoices();
  if (voices.length === 0) return null;
  const idx = hashNameToIndex(name, voices.length);
  const entry = voices[idx];
  return entry?.name ?? null;
}

/** For testing only: resets all voice state so env is clean between tests. */
export function resetVoiceStateForTest(): void {
  _voices.clear();
  _speeds.clear();
}
