import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dlog } from "./debug-log.js";
import { recordNonToolEvent } from "./trace-log.js";
import { pickRotationVoice, setSessionVoiceForSid } from "./voice-state.js";
import { getSessionEmojis } from "./config.js";

// ── Watch file (heartbeat) location ────────────────────────
//
// Each session gets a per-session "watch file" the bridge appends to whenever
// a new event lands in that session's queue. Agents follow this file via
// `tail -F` (Claude Code's Monitor tool) and call dequeue({max_wait:0}) on
// each new line, replacing the old long-poll dequeue pattern.

function getCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "telegram-bridge-mcp", "sessions");
}

/** Absolute path to the heartbeat file for a given session ID. */
export function getWatchFilePath(sid: number): string {
  return join(getCacheDir(), `${sid}.events`);
}

// ── Types ──────────────────────────────────────────────────

/**
 * Pool of emojis automatically assigned to sessions as visual identity tags.
 * The `color` field on Session was originally a 6-color rainbow palette
 * (🟦🟩🟨🟧🟥🟪); since v8 it holds any emoji from this 20-entry pool —
 * picked randomly from currently-unused entries on session creation. The
 * field name "color" is kept for backward compatibility with tool responses.
 *
 * The default pool can be overridden via mcp-config.json `sessionEmojis`
 * (string[]). Pool size > 6 means collisions are rare in normal usage.
 */
const DEFAULT_EMOJI_POOL: readonly string[] = [
  "🦄", "🐺", "👻", "🐶", "🐅", "🐦‍🔥", "🐊", "🦋", "🌸", "🦞",
  "🏆", "🔮", "🚄", "🏎️", "🛩️", "🚀", "🪐", "☄️", "⚔️", "🧬",
];

/** Returns the active session-tag pool — config override or hardcoded default. */
function getSessionEmojiPool(): readonly string[] {
  const override = getSessionEmojis();
  return override.length > 0 ? override : DEFAULT_EMOJI_POOL;
}

/**
 * @deprecated Kept for backward compatibility. The export now points to the
 * full session-tag pool, not the 6-color rainbow. Use `getSessionEmojiPool()`
 * for current behavior. Used by some legacy validation paths.
 */
export const COLOR_PALETTE = DEFAULT_EMOJI_POOL;
export type SessionColor = string;

export interface Session {
  sid: number;
  suffix: number;
  name: string;
  color: string;
  createdAt: string;
  lastPollAt: number | undefined;
  healthy: boolean;
  announcementMsgId?: number;
  dequeueDefault?: number; // per-session timeout default, undefined = use server default (300)
  dequeueIdleAt?: number; // timestamp when session entered dequeue blocking wait; undefined = not idle
  pendingEnvelopeHint?: string;
  silenceThresholdS?: number;
  firstUseHintsSeen?: Set<string>;
  nametag_emoji?: string;
  /**
   * Connection token assigned at session/start. Used for duplicate-session
   * detection: if two callers present the same SID/suffix but different
   * connection tokens, the bridge alerts the governor (Option A).
   */
  connectionToken: string;
  /**
   * Set when a `compacted` event fires for this session.
   * Cleared after the recovering animation is replaced with a persistent
   * "compacted" notify (one-shot per compaction cycle).
   */
  hasCompacted?: boolean;
  /**
   * Absolute path to the per-session heartbeat file. The bridge appends a
   * single newline per inbound event so an agent watching the file via
   * `tail -F` (Claude Code's Monitor tool) can wake up only when there's
   * something to drain. Populated by `createSession`; unlinked by
   * `closeSession` callers in `session-teardown`.
   */
  watchFile?: string;
  /**
   * MCP HTTP transport session ID this bridge session is bound to.
   * When the streamable-http transport closes (Claude Code exits), the
   * onclose handler in `index.ts` looks up bridge sessions by this field
   * and closes them automatically. See `closeSessionsByHttpId`.
   */
  httpSessionId?: string;
}

/** Public view returned by `listSessions` — no token suffix. */
export interface SessionInfo {
  sid: number;
  name: string;
  color: string;
  createdAt: string;
}

/** Value returned from `createSession`. */
export interface SessionCreateResult {
  sid: number;
  suffix: number;
  name: string;
  color: string;
  sessionsActive: number;
  connectionToken: string;
  /**
   * Absolute path to the per-session heartbeat file. Surface this in the
   * `session/start` MCP response so agents can wire `Monitor` (Claude Code's
   * file-watcher tool) to wake on new events instead of long-polling
   * `dequeue`. May be undefined if file-system allocation failed; agents
   * should fall back to dequeue long-poll in that case.
   */
  watchFile?: string;
}

// ── State ──────────────────────────────────────────────────

const SUFFIX_MIN = 100_000;
const SUFFIX_MAX = 999_999;

let _nextId = 1;
const _sessions = new Map<number, Session>();

// ── Helpers ────────────────────────────────────────────────

function generateSuffix(): number {
  return randomInt(SUFFIX_MIN, SUFFIX_MAX + 1);
}

/** Pick a uniformly random element from a non-empty array. */
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick a session-tag emoji.
 *
 * - `force = true` (legacy operator explicit tap): use `requested` unconditionally,
 *   even if another session already holds it. Retained for the rare case where
 *   an external caller needs to force a specific tag.
 * - `force = false` (default): if `requested` is in the pool and unused, use it.
 *   Otherwise pick a uniformly random unused emoji from the pool. If every
 *   pool entry is in use (>20 active sessions), pick uniformly random from
 *   the full pool — collisions are tolerated, the operator just sees two
 *   sessions sharing an emoji until one closes.
 */
function assignColor(requested?: string, force = false): string {
  const pool = getSessionEmojiPool();
  const usedTags = new Set([..._sessions.values()].map((s) => s.color));

  if (requested) {
    if (force) return requested;
    if ((pool as readonly string[]).includes(requested) && !usedTags.has(requested)) {
      return requested;
    }
    // Hint not in pool, or in pool but already taken — fall through to random.
  }

  const free = pool.filter((c) => !usedTags.has(c));
  return free.length > 0 ? pickRandom(free) : pickRandom(pool);
}

// ── Public API ─────────────────────────────────────────────

/**
 * Returns all session-tag emojis sorted so that **currently unused entries
 * appear first** and **currently in-use entries appear last**. If `hint` is a
 * valid pool entry, it is always promoted to index 0.
 *
 * Used historically by the approval dialog (color picker keyboard); since
 * v8 the picker is gone (auto-assignment), so this remains primarily for
 * legacy `approve_agent` paths and tests.
 */
export function getAvailableColors(hint?: string): string[] {
  const pool = getSessionEmojiPool();
  const usedTags = new Set([..._sessions.values()].map((s) => s.color));

  const sorted = [
    ...pool.filter((c) => !usedTags.has(c)),
    ...pool.filter((c) => usedTags.has(c)),
  ];

  if (hint && (pool as readonly string[]).includes(hint)) {
    return [hint, ...sorted.filter((c) => c !== hint)];
  }
  return sorted;
}

export function createSession(
  name = "",
  colorHint?: string,
  forceColor = false,
  httpSessionId?: string,
): SessionCreateResult {
  const sid = _nextId++;
  const usedSuffixes = new Set([..._sessions.values()].map((s) => s.suffix));
  let suffix: number;
  const MAX_SUFFIX_ATTEMPTS = 10;
  let attempt = 0;
  do {
    suffix = generateSuffix();
    attempt++;
  } while (usedSuffixes.has(suffix) && attempt < MAX_SUFFIX_ATTEMPTS);
  if (usedSuffixes.has(suffix)) {
    throw new Error(
      `[session-manager] Failed to generate a unique token suffix after ${MAX_SUFFIX_ATTEMPTS} attempts.`,
    );
  }
  const color = assignColor(colorHint, forceColor);
  const connectionToken = randomUUID();

  // Allocate the per-session heartbeat file.
  // Cache dir is created idempotently; file is truncated to handle the case
  // where a previous run died with stale content for this SID.
  const watchFile = getWatchFilePath(sid);
  try {
    mkdirSync(getCacheDir(), { recursive: true });
    writeFileSync(watchFile, "", { flag: "w" });
  } catch (err) {
    // Watch-file allocation failure is non-fatal: the session can still
    // operate via dequeue long-poll. Log and continue.
    process.stderr.write(
      `[session-manager] watch file alloc failed sid=${sid} file=${watchFile} err=${(err as Error).message}\n`,
    );
  }

  const session: Session = {
    sid,
    suffix,
    name,
    color,
    createdAt: new Date().toISOString(),
    lastPollAt: undefined,
    healthy: true,
    connectionToken,
    watchFile,
    httpSessionId,
  };
  _sessions.set(sid, session);

  // Auto-rotate the operator's curated voice list (mcp-config.json `voices`)
  // across newly-created sessions. No-op when the voices array is empty —
  // the resolution chain then falls through to defaultVoice + provider default.
  const rotated = pickRotationVoice(sid);
  if (rotated) {
    setSessionVoiceForSid(sid, rotated);
    dlog("session", `voice rotation sid=${sid} → ${rotated}`);
  }

  dlog("session", `created sid=${sid} name=${JSON.stringify(name)} color=${color} total=${_sessions.size}`);
  recordNonToolEvent("session_create", sid, name);
  return {
    sid,
    suffix,
    name,
    color,
    sessionsActive: _sessions.size,
    connectionToken,
    watchFile: session.watchFile,
  };
}

/**
 * Best-effort delete of a session's watch file. Called from
 * `closeSessionById` in `session-teardown.ts`. Idempotent — ENOENT is fine.
 */
export function unlinkWatchFile(watchFile: string | undefined): void {
  if (!watchFile) return;
  try {
    unlinkSync(watchFile);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      process.stderr.write(
        `[session-manager] watch file unlink failed file=${watchFile} err=${(err as Error).message}\n`,
      );
    }
  }
}

/**
 * Return the SIDs of every session bound to the given MCP HTTP transport.
 * Used by the streamable-http transport's `onclose` handler in `index.ts`
 * to auto-close bridge sessions when the underlying MCP connection drops
 * (e.g., the Claude Code process exits).
 */
export function findSessionsByHttpId(httpSessionId: string): number[] {
  return [..._sessions.values()]
    .filter(s => s.httpSessionId === httpSessionId)
    .map(s => s.sid);
}

export function getSession(sid: number): Session | undefined {
  return _sessions.get(sid);
}

export function validateSession(sid: number, suffix: number): boolean {
  const session = _sessions.get(sid);
  return session !== undefined && session.suffix === suffix;
}

/**
 * Return the connection token for a session, or undefined if the session
 * does not exist. Connection tokens are assigned at session/start and used
 * for duplicate-session detection (Option A).
 */
export function getConnectionToken(sid: number): string | undefined {
  return _sessions.get(sid)?.connectionToken;
}

/**
 * Check whether a presented connection token matches the one stored for the
 * given session. Returns:
 *   - "match"    — token matches; this is the expected caller
 *   - "mismatch" — token present but does not match; duplicate session detected
 *   - "absent"   — no token presented; legacy caller or caller that did not
 *                  save their connection token (non-fatal; allow through)
 *
 * Open design question: should we also issue a mismatch alert when the caller
 * presents a token but the session has no stored token (e.g. after a reconnect
 * that does not regenerate the token)? Currently treated as "match" to avoid
 * false positives.
 */
export function checkConnectionToken(
  sid: number,
  presented: string | undefined,
): "match" | "mismatch" | "absent" {
  if (presented === undefined) return "absent";
  const stored = _sessions.get(sid)?.connectionToken;
  if (!stored) return "match"; // no stored token → cannot verify, allow through
  return presented === stored ? "match" : "mismatch";
}

export function closeSession(sid: number): boolean {
  const session = _sessions.get(sid);
  const deleted = _sessions.delete(sid);
  if (deleted) {
    dlog("session", `closed sid=${sid} remaining=${_sessions.size}`);
    recordNonToolEvent("session_close", sid, session?.name ?? "");
  }
  return deleted;
}

export function listSessions(): SessionInfo[] {
  return [..._sessions.values()].map(({ sid, name, color, createdAt }) => ({
    sid,
    name,
    color,
    createdAt,
  }));
}

export function activeSessionCount(): number {
  return _sessions.size;
}

/** Record a heartbeat for a session — called by dequeue on every poll. */
export function touchSession(sid: number): void {
  const s = _sessions.get(sid);
  if (!s) return;
  s.lastPollAt = Date.now();
  s.healthy = true;
}

/** Mark a session as unhealthy (called by the health-check timer). */
export function markUnhealthy(sid: number): void {
  const s = _sessions.get(sid);
  if (s) s.healthy = false;
}

/** Return true if the session is tracked as healthy. */
export function isHealthy(sid: number): boolean {
  return _sessions.get(sid)?.healthy ?? false;
}

/**
 * Return sessions whose last poll was older than `thresholdMs` ago.
 * Sessions that have never polled (lastPollAt === undefined) are excluded —
 * they may legitimately be starting up.
 */
export function getUnhealthySessions(thresholdMs: number): SessionInfo[] {
  const cutoff = Date.now() - thresholdMs;
  return [..._sessions.values()]
    .filter(s => s.lastPollAt !== undefined && s.lastPollAt < cutoff)
    .map(({ sid, name, color, createdAt }) => ({ sid, name, color, createdAt }));
}

// ── Silence Detection ─────────────────────────────────────

const SILENCE_THRESHOLD_DEFAULT_S = 30;
const SILENCE_THRESHOLD_FLOOR_S = 15;

// ── Dequeue Default ───────────────────────────────────────

const DEFAULT_DEQUEUE_TIMEOUT = 300;

/**
 * Return the per-session dequeue timeout default for a session.
 * Returns the server default (300 s) if no per-session default has been set
 * or the session does not exist.
 */
export function getDequeueDefault(sid: number): number {
  return _sessions.get(sid)?.dequeueDefault ?? DEFAULT_DEQUEUE_TIMEOUT;
}

/**
 * Set the per-session dequeue timeout default.
 * Scoped to the session lifetime — cleared when the session closes.
 * No-op if the session does not exist.
 */
export function setDequeueDefault(sid: number, timeout: number): void {
  const session = _sessions.get(sid);
  if (session) session.dequeueDefault = timeout;
}

/** Set a pending envelope hint to be included on the next dequeue response for this session. */
export function setSilenceHint(sid: number, hint: string): void {
  const s = _sessions.get(sid);
  if (s) s.pendingEnvelopeHint = hint;
}

/**
 * Consume and return the pending envelope hint for this session (if any).
 * Clears the hint so it is only included once.
 */
export function takeSilenceHint(sid: number): string | undefined {
  const s = _sessions.get(sid);
  if (!s) return undefined;
  const hint = s.pendingEnvelopeHint;
  s.pendingEnvelopeHint = undefined;
  return hint;
}

/**
 * Return the per-session silence-detection threshold in seconds.
 * Returns the session default (30 s) if none has been set or session doesn't exist.
 */
export function getSilenceThreshold(sid: number): number {
  return _sessions.get(sid)?.silenceThresholdS ?? SILENCE_THRESHOLD_DEFAULT_S;
}

/**
 * Set the per-session silence-detection threshold.
 * Clamped to a minimum of 15 s (SILENCE_THRESHOLD_FLOOR_S).
 * No-op if the session does not exist.
 */
export function setSilenceThreshold(sid: number, seconds: number): void {
  const s = _sessions.get(sid);
  if (s) s.silenceThresholdS = Math.max(SILENCE_THRESHOLD_FLOOR_S, Math.floor(seconds));
}

// ── Active Session Context ─────────────────────────────────

/**
 * The session ID of the currently-executing tool call.
 * 0 = no session (single-session backward compat / bootstrap tools).
 *
 * Safe for stdio (one tool call at a time). For HTTP transport with
 * concurrent sessions, replace with AsyncLocalStorage.
 */
let _activeSessionId = 0;

export function setActiveSession(sid: number): void {
  const prev = _activeSessionId;
  _activeSessionId = sid;
  if (prev !== sid) dlog("session", `active ${prev} → ${sid}`);
}

export function getActiveSession(): number {
  return _activeSessionId;
}

/** Clear all sessions and reset the ID counter. Test-only. */
export function resetSessions(): void {
  _sessions.clear();
  _nextId = 1;
  _activeSessionId = 0;
}

/** Store the message ID of the session's online announcement for later unpin. */
export function setSessionAnnouncementMessage(sid: number, msgId: number): void {
  const s = _sessions.get(sid);
  if (s) s.announcementMsgId = msgId;
}

/** Return the stored announcement message ID for a session, if any. */
export function getSessionAnnouncementMessage(sid: number): number | undefined {
  return _sessions.get(sid)?.announcementMsgId;
}


/** Mark a session as idle (entering dequeue blocking wait) or active (returning from it). */
export function setDequeueIdle(sid: number, idle: boolean): void {
  const s = _sessions.get(sid);
  if (!s) return;
  s.dequeueIdleAt = idle ? Date.now() : undefined;
}

/** Return sessions currently in a blocking dequeue wait, with idle duration in ms. */
export function getIdleSessions(): Array<SessionInfo & { idle_since_ms: number }> {
  const now = Date.now();
  return [..._sessions.values()]
    .map((s) => {
      if (s.dequeueIdleAt === undefined) return undefined;
      return {
        sid: s.sid,
        name: s.name,
        color: s.color,
        createdAt: s.createdAt,
        idle_since_ms: now - s.dequeueIdleAt,
      };
    })
    .filter((s): s is SessionInfo & { idle_since_ms: number } => s !== undefined);
}

// ── Snapshot Restore ───────────────────────────────────────

/**
 * Rename a session. Sets the name unconditionally — callers are responsible
 * for uniqueness validation before calling (see `rename_session.ts` tool for
 * the case-insensitive collision guard). Returns `{ old_name, new_name }` on
 * success or `null` if the session does not exist.
 */
export function renameSession(
  sid: number,
  newName: string,
): { old_name: string; new_name: string } | null {
  const session = _sessions.get(sid);
  if (!session) return null;
  const old_name = session.name;
  session.name = newName;
  dlog("session", `renamed sid=${sid} "${old_name}" → "${newName}"`);
  return { old_name, new_name: newName };
}

/**
 * Update a session's tag emoji. Returns the assigned value on success or
 * `null` if the session does not exist or the value is not in the active
 * session-tag pool.
 */
export function setSessionColor(sid: number, color: string): string | null {
  const pool = getSessionEmojiPool();
  if (!(pool as readonly string[]).includes(color)) return null;
  const session = _sessions.get(sid);
  if (!session) return null;
  session.color = color;
  dlog("session", `color sid=${sid} → ${color}`);
  return color;
}


// ── First-Use Hints ────────────────────────────────────────

export function getOrInitHintsSeen(sid: number): Set<string> | null {
  const session = _sessions.get(sid);
  if (!session) return null;
  if (!session.firstUseHintsSeen) session.firstUseHintsSeen = new Set();
  return session.firstUseHintsSeen;
}

// ── Compaction Recovery ────────────────────────────────────

/** Mark that a `compacted` event has fired for this session. */
export function setHasCompacted(sid: number): void {
  const session = _sessions.get(sid);
  if (session) session.hasCompacted = true;
}

/** Clear the compacted flag (called after the one-shot recovery notify fires). */
export function clearHasCompacted(sid: number): void {
  const session = _sessions.get(sid);
  if (session) session.hasCompacted = false;
}

/** Return true if a `compacted` event has fired and the notify hasn't fired yet. */
export function getHasCompacted(sid: number): boolean {
  return !!_sessions.get(sid)?.hasCompacted;
}
