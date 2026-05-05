import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, statSync } from "node:fs";
import {
  createSession,
  getSession,
  closeSession,
  validateSession,
  listSessions,
  resetSessions,
  activeSessionCount,
  setActiveSession,
  getActiveSession,
  touchSession,
  markUnhealthy,
  isHealthy,
  getUnhealthySessions,
  getAvailableColors,
  COLOR_PALETTE,
  setDequeueIdle,
  getIdleSessions,
  getOrInitHintsSeen,
  setHasCompacted,
  clearHasCompacted,
  getHasCompacted,
  getWatchFilePath,
  unlinkWatchFile,
  findSessionsByHttpId,
} from "./session-manager.js";

interface SessionWithoutSuffix {
  suffix?: unknown;
}

beforeEach(() => {
  resetSessions();
});

describe("createSession", () => {
  it("returns incrementing session IDs starting at 1", () => {
    const a = createSession();
    const b = createSession();
    const c = createSession();
    expect(a.sid).toBe(1);
    expect(b.sid).toBe(2);
    expect(c.sid).toBe(3);
  });

  it("generates a 6-digit numeric token suffix", () => {
    const s = createSession();
    expect(s.suffix).toBeGreaterThanOrEqual(100_000);
    expect(s.suffix).toBeLessThanOrEqual(999_999);
  });

  it("generates unique token suffixes across sessions", () => {
    const suffixes = new Set<number>();
    for (let i = 0; i < 20; i++) {
      suffixes.add(createSession().suffix);
    }
    // With 900k possible suffixes, 20 should all be unique
    expect(suffixes.size).toBe(20);
  });

  it("stores an optional session name", () => {
    const s = createSession("my-agent");
    expect(s.name).toBe("my-agent");
  });

  it("defaults name to empty string when omitted", () => {
    const s = createSession();
    expect(s.name).toBe("");
  });

  it("returns the active session count", () => {
    const a = createSession();
    expect(a.sessionsActive).toBe(1);
    const b = createSession();
    expect(b.sessionsActive).toBe(2);
  });

  it("never assigns the same token suffix to two concurrent sessions", () => {
    // Create many sessions and verify no two share a suffix
    const suffixes = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const s = createSession();
      expect(suffixes.has(s.suffix)).toBe(false);
      suffixes.add(s.suffix);
    }
  });
});

describe("voice assignment on createSession", () => {
  it("auto-assigns the curated voice list, deterministically by name", async () => {
    const config = await import("./config.js");
    const { getSessionVoiceFor, resetVoiceStateForTest } = await import("./voice-state.js");
    resetVoiceStateForTest();
    const spy = vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
      { name: "VID_A", description: "Jessica" },
      { name: "VID_B", description: "Rachel" },
    ]);

    const a = createSession("Scout");
    const b = createSession("Worker");
    const c = createSession("Primary");

    // Each session got a voice from the curated list (we don't assert exact
    // mappings — the hash output isn't user-meaningful).
    expect(["VID_A", "VID_B"]).toContain(getSessionVoiceFor(a.sid));
    expect(["VID_A", "VID_B"]).toContain(getSessionVoiceFor(b.sid));
    expect(["VID_A", "VID_B"]).toContain(getSessionVoiceFor(c.sid));

    // Determinism across runs: re-creating with the same name yields the same voice.
    const aVoice = getSessionVoiceFor(a.sid);
    resetVoiceStateForTest();
    resetSessions();
    const a2 = createSession("Scout");
    expect(getSessionVoiceFor(a2.sid)).toBe(aVoice);

    spy.mockRestore();
    resetVoiceStateForTest();
  });

  it("does not assign a voice when the curated voices list is empty", async () => {
    const config = await import("./config.js");
    const { getSessionVoiceFor, resetVoiceStateForTest } = await import("./voice-state.js");
    resetVoiceStateForTest();
    const spy = vi.spyOn(config, "getConfiguredVoices").mockReturnValue([]);

    const s = createSession("Scout");
    expect(getSessionVoiceFor(s.sid)).toBeNull();

    spy.mockRestore();
    resetVoiceStateForTest();
  });
});

describe("color assignment (session-tag emoji pool)", () => {
  // Since v8: hash(name) → starting index in a 20-emoji pool, then linear
  // probe forward to skip in-use entries. Same name → same starting tag
  // across runs. Tests assert pool membership, determinism, and
  // collision-free behaviour rather than exact emoji values.
  const POOL = COLOR_PALETTE; // alias kept for backward-compat exports

  it("auto-assigned tag is always a member of the active pool", () => {
    const s1 = createSession("A");
    const s2 = createSession("B");
    const s3 = createSession("C");
    expect(POOL).toContain(s1.color);
    expect(POOL).toContain(s2.color);
    expect(POOL).toContain(s3.color);
  });

  it("does not assign duplicate tags across active sessions while pool size > active count", () => {
    const tags = new Set<string>();
    for (let i = 0; i < 5; i++) {
      tags.add(createSession(`S${i}`).color);
    }
    expect(tags.size).toBe(5); // 5 unique
  });

  it("accepts a valid unoccupied tag hint", () => {
    const hint = POOL[7];
    const s = createSession("A", hint);
    expect(s.color).toBe(hint);
  });

  it("falls back to a deterministic unused tag when requested hint is already taken", () => {
    const hint = POOL[0];
    createSession("A", hint); // takes hint
    const s2 = createSession("B", hint); // hint taken → fall back via hash(name)
    expect(s2.color).not.toBe(hint);
    expect(POOL).toContain(s2.color);
  });

  it("same name maps to the same starting tag across runs", async () => {
    const sa = createSession("Scout");
    const tagA = sa.color;
    // Re-create from a clean slate; same name should land on the same tag.
    resetSessions();
    const sb = createSession("Scout");
    expect(sb.color).toBe(tagA);
  });

  it("falls back when requested hint is not in the pool", () => {
    const s = createSession("A", "🔵"); // not in pool
    expect(POOL).toContain(s.color);
  });

  it("wraps with collision tolerance when all pool entries are in use", () => {
    // Take every entry in the pool.
    for (let i = 0; i < POOL.length; i++) createSession(`S${i}`);
    const overflow = createSession("OVERFLOW");
    // Overflow session still gets a valid tag from the pool — just shared.
    expect(POOL).toContain(overflow.color);
  });

  it("forceColor=true assigns the requested tag even when already in use", () => {
    const tag = POOL[0];
    createSession("A", tag); // tag now in use
    const s2 = createSession("B", tag, true); // force
    expect(s2.color).toBe(tag);
  });

  it("forceColor=false (default) falls back when requested tag is in use", () => {
    const tag = POOL[0];
    createSession("A", tag);
    const s2 = createSession("B", tag);
    expect(s2.color).not.toBe(tag);
  });

  it("listSessions includes a pool tag for each session", () => {
    createSession("A");
    createSession("B");
    const list = listSessions();
    expect(POOL).toContain(list[0].color);
    expect(POOL).toContain(list[1].color);
    expect(list[0].color).not.toBe(list[1].color);
  });

  it("getSession includes a pool tag", () => {
    const s = createSession("A");
    expect(POOL).toContain(getSession(s.sid)?.color);
  });
});

describe("getSession", () => {
  it("returns the session object by ID", () => {
    const created = createSession("worker");
    const got = getSession(created.sid);
    expect(got).toBeDefined();
    expect(got!.sid).toBe(created.sid);
    expect(got!.suffix).toBe(created.suffix);
    expect(got!.name).toBe("worker");
  });

  it("returns undefined for nonexistent session", () => {
    expect(getSession(999)).toBeUndefined();
  });

  it("returns undefined for a closed session", () => {
    const s = createSession();
    closeSession(s.sid);
    expect(getSession(s.sid)).toBeUndefined();
  });
});

describe("validateSession", () => {
  it("returns true for valid sid + suffix", () => {
    const s = createSession();
    expect(validateSession(s.sid, s.suffix)).toBe(true);
  });

  it("returns false for wrong suffix", () => {
    const s = createSession();
    expect(validateSession(s.sid, s.suffix + 1)).toBe(false);
  });

  it("returns false for nonexistent session", () => {
    expect(validateSession(42, 123456)).toBe(false);
  });

  it("returns false for closed session", () => {
    const s = createSession();
    closeSession(s.sid);
    expect(validateSession(s.sid, s.suffix)).toBe(false);
  });
});

describe("closeSession", () => {
  it("removes the session from the active list", () => {
    const s = createSession();
    expect(activeSessionCount()).toBe(1);
    closeSession(s.sid);
    expect(activeSessionCount()).toBe(0);
  });

  it("returns true when the session existed", () => {
    const s = createSession();
    expect(closeSession(s.sid)).toBe(true);
  });

  it("returns false for nonexistent session", () => {
    expect(closeSession(999)).toBe(false);
  });

  it("does not affect other sessions", () => {
    const a = createSession("a");
    const b = createSession("b");
    closeSession(a.sid);
    expect(getSession(b.sid)).toBeDefined();
    expect(activeSessionCount()).toBe(1);
  });

  it("does not reset the ID counter after closure", () => {
    createSession();
    const b = createSession();
    closeSession(b.sid);
    const c = createSession();
    expect(c.sid).toBe(3);
  });
});

describe("listSessions", () => {
  it("returns empty array when no sessions exist", () => {
    expect(listSessions()).toEqual([]);
  });

  it("returns all active sessions", () => {
    createSession("alpha");
    createSession("beta");
    const list = listSessions();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("alpha");
    expect(list[1].name).toBe("beta");
  });

  it("excludes closed sessions", () => {
    const a = createSession("alpha");
    createSession("beta");
    closeSession(a.sid);
    const list = listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("beta");
  });

  it("does not expose token suffix", () => {
    createSession();
    const list = listSessions();
    const first = list[0] as unknown as SessionWithoutSuffix;
    expect(first.suffix).toBeUndefined();
  });
});

describe("activeSessionCount", () => {
  it("returns 0 when no sessions exist", () => {
    expect(activeSessionCount()).toBe(0);
  });

  it("tracks create and close", () => {
    const a = createSession();
    expect(activeSessionCount()).toBe(1);
    createSession();
    expect(activeSessionCount()).toBe(2);
    closeSession(a.sid);
    expect(activeSessionCount()).toBe(1);
  });
});

describe("resetSessions", () => {
  it("clears all sessions and resets the counter", () => {
    createSession();
    createSession();
    resetSessions();
    expect(activeSessionCount()).toBe(0);
    const fresh = createSession();
    expect(fresh.sid).toBe(1);
  });
});

describe("active session context", () => {
  it("defaults to 0 (no session)", () => {
    expect(getActiveSession()).toBe(0);
  });

  it("set and get round-trip", () => {
    setActiveSession(3);
    expect(getActiveSession()).toBe(3);
  });

  it("resets to 0 on resetSessions", () => {
    setActiveSession(5);
    resetSessions();
    expect(getActiveSession()).toBe(0);
  });
});

describe("health tracking", () => {
  it("new sessions start healthy with no lastPollAt", () => {
    const s = createSession("alpha");
    expect(isHealthy(s.sid)).toBe(true);
    const raw = getSession(s.sid);
    expect(raw?.lastPollAt).toBeUndefined();
  });

  describe("touchSession", () => {
    it("records lastPollAt and keeps session healthy", () => {
      const before = Date.now();
      const s = createSession("alpha");
      touchSession(s.sid);
      const raw = getSession(s.sid);
      expect(raw?.lastPollAt).toBeGreaterThanOrEqual(before);
      expect(isHealthy(s.sid)).toBe(true);
    });

    it("restores healthy flag after markUnhealthy", () => {
      const s = createSession("alpha");
      markUnhealthy(s.sid);
      expect(isHealthy(s.sid)).toBe(false);
      touchSession(s.sid);
      expect(isHealthy(s.sid)).toBe(true);
    });

    it("is a no-op for unknown sid", () => {
      expect(() => { touchSession(999); }).not.toThrow();
    });
  });

  describe("markUnhealthy / isHealthy", () => {
    it("markUnhealthy makes isHealthy return false", () => {
      const s = createSession("alpha");
      markUnhealthy(s.sid);
      expect(isHealthy(s.sid)).toBe(false);
    });

    it("isHealthy returns false for unknown sid", () => {
      expect(isHealthy(999)).toBe(false);
    });

    it("markUnhealthy is a no-op for unknown sid", () => {
      expect(() => { markUnhealthy(999); }).not.toThrow();
    });
  });

  describe("getUnhealthySessions", () => {
    it("excludes sessions that have never polled", () => {
      createSession("alpha");
      expect(getUnhealthySessions(0)).toHaveLength(0);
    });

    it("returns sessions whose lastPollAt is before the cutoff", () => {
      vi.useFakeTimers();
      const s = createSession("alpha");
      touchSession(s.sid);
      // Advance past threshold
      vi.advanceTimersByTime(400_000);
      const unhealthy = getUnhealthySessions(360_000);
      expect(unhealthy).toHaveLength(1);
      expect(unhealthy[0].sid).toBe(s.sid);
      vi.useRealTimers();
    });

    it("excludes sessions that polled recently", () => {
      vi.useFakeTimers();
      const s = createSession("alpha");
      touchSession(s.sid);
      vi.advanceTimersByTime(100_000); // well within threshold
      expect(getUnhealthySessions(360_000)).toHaveLength(0);
      vi.useRealTimers();
    });

    it("does not expose token suffix", () => {
      vi.useFakeTimers();
      const s = createSession("alpha");
      touchSession(s.sid);
      vi.advanceTimersByTime(400_000);
      const result = getUnhealthySessions(360_000);
      const first = result[0] as unknown as SessionWithoutSuffix;
      expect(first.suffix).toBeUndefined();
      vi.useRealTimers();
    });

    it("only returns sessions that exceed the threshold", () => {
      vi.useFakeTimers();
      const a = createSession("alpha");
      const b = createSession("beta");
      touchSession(a.sid);
      vi.advanceTimersByTime(200_000);
      touchSession(b.sid); // beta just polled
      vi.advanceTimersByTime(200_000); // alpha is now 400s old, beta 200s
      const unhealthy = getUnhealthySessions(360_000);
      expect(unhealthy).toHaveLength(1);
      expect(unhealthy[0].sid).toBe(a.sid);
      vi.useRealTimers();
    });
  });
});

describe("getAvailableColors", () => {
  // The function still exists for legacy callers (rename, approve_agent).
  // Semantics: returns the full pool with currently-unused entries first,
  // currently-in-use last. A valid hint is promoted to index 0.
  const POOL = COLOR_PALETTE;

  it("returns the full pool when no sessions exist", () => {
    const tags = getAvailableColors();
    expect(tags).toEqual([...POOL]);
  });

  it("unused entries appear before in-use entries", () => {
    const inUseTag = POOL[3];
    createSession("A", inUseTag);
    const tags = getAvailableColors();
    expect(tags).toHaveLength(POOL.length);
    const inUseIdx = tags.indexOf(inUseTag);
    // every other pool entry should appear before the in-use one
    for (const c of POOL) {
      if (c !== inUseTag) {
        expect(tags.indexOf(c)).toBeLessThan(inUseIdx);
      }
    }
  });

  it("returns the full pool when all entries are taken", () => {
    for (let i = 0; i < POOL.length; i++) createSession(`S${i}`);
    const tags = getAvailableColors();
    expect(tags).toHaveLength(POOL.length);
    expect(new Set(tags)).toEqual(new Set(POOL));
  });

  it("a valid hint is promoted to index 0 (unused)", () => {
    const tags = getAvailableColors(POOL[5]);
    expect(tags[0]).toBe(POOL[5]);
    expect(tags).toHaveLength(POOL.length);
  });

  it("a valid in-use hint is still promoted to index 0", () => {
    const tag = POOL[2];
    createSession("A", tag);
    const tags = getAvailableColors(tag);
    expect(tags[0]).toBe(tag);
  });

  it("hint not in the pool is ignored", () => {
    const tags = getAvailableColors("🔵");
    expect(tags).toEqual([...POOL]);
  });
});

// ---------------------------------------------------------------------------
// setDequeueIdle / getIdleSessions
// ---------------------------------------------------------------------------

describe("getOrInitHintsSeen", () => {
  it("returns null for nonexistent SID", () => {
    expect(getOrInitHintsSeen(9999)).toBeNull();
  });

  it("returns a Set for valid SID", () => {
    const { sid } = createSession("test");
    const seen = getOrInitHintsSeen(sid);
    expect(seen).toBeInstanceOf(Set);
  });

  it("returns the SAME Set instance on repeated calls", () => {
    const { sid } = createSession("test");
    const first = getOrInitHintsSeen(sid);
    const second = getOrInitHintsSeen(sid);
    expect(first).toBe(second);
  });

  it("mutations to the returned Set are visible on next call", () => {
    const { sid } = createSession("test");
    const seen = getOrInitHintsSeen(sid);
    seen!.add("send:choice");
    const again = getOrInitHintsSeen(sid);
    expect(again!.has("send:choice")).toBe(true);
  });
});

describe("setDequeueIdle / getIdleSessions", () => {
  it("getIdleSessions returns empty when no sessions are idle", () => {
    createSession("A");
    expect(getIdleSessions()).toEqual([]);
  });

  it("marks a session idle and getIdleSessions returns it with idle_since_ms >= 0", () => {
    const s = createSession("A");
    setDequeueIdle(s.sid, true);
    const idle = getIdleSessions();
    expect(idle).toHaveLength(1);
    expect(idle[0].sid).toBe(s.sid);
    expect(idle[0].idle_since_ms).toBeGreaterThanOrEqual(0);
  });

  it("clearing idle removes the session from getIdleSessions", () => {
    const s = createSession("A");
    setDequeueIdle(s.sid, true);
    setDequeueIdle(s.sid, false);
    expect(getIdleSessions()).toEqual([]);
  });

  it("no-ops silently when sid is not found", () => {
    expect(() => {
      setDequeueIdle(9999, true);
    }).not.toThrow();
    expect(getIdleSessions()).toEqual([]);
  });

  it("only idle sessions appear in getIdleSessions when multiple sessions exist", () => {
    const a = createSession("A");
    const b = createSession("B");
    setDequeueIdle(a.sid, true);
    const idle = getIdleSessions();
    expect(idle).toHaveLength(1);
    expect(idle[0].sid).toBe(a.sid);
    void b;
  });
});

// ── hasCompacted helpers ───────────────────────────────────────────────────

describe("hasCompacted helpers", () => {
  it("getHasCompacted returns false for a fresh session", () => {
    const { sid } = createSession("Agent");
    expect(getHasCompacted(sid)).toBe(false);
  });

  it("setHasCompacted makes getHasCompacted return true", () => {
    const { sid } = createSession("Agent");
    setHasCompacted(sid);
    expect(getHasCompacted(sid)).toBe(true);
  });

  it("clearHasCompacted makes getHasCompacted return false after set", () => {
    const { sid } = createSession("Agent");
    setHasCompacted(sid);
    clearHasCompacted(sid);
    expect(getHasCompacted(sid)).toBe(false);
  });

  it("getHasCompacted returns false for an unknown sid", () => {
    expect(getHasCompacted(9999)).toBe(false);
  });

  it("setHasCompacted and clearHasCompacted are no-ops for unknown sid", () => {
    expect(() => { setHasCompacted(9999); }).not.toThrow();
    expect(() => { clearHasCompacted(9999); }).not.toThrow();
    expect(getHasCompacted(9999)).toBe(false);
  });

  it("hasCompacted flag is scoped per session", () => {
    const a = createSession("A");
    const b = createSession("B");
    setHasCompacted(a.sid);
    expect(getHasCompacted(a.sid)).toBe(true);
    expect(getHasCompacted(b.sid)).toBe(false);
  });
});

// ── v8 watch-file behavior ─────────────────────────────────

describe("watch file (v8 heartbeat)", () => {
  it("getWatchFilePath returns a path under the cache dir", () => {
    const path = getWatchFilePath(42);
    // Should end with the conventional suffix, regardless of XDG settings
    expect(path).toMatch(/telegram-bridge-mcp\/sessions\/42\.events$/);
  });

  it("createSession populates session.watchFile and creates the file empty", () => {
    const result = createSession("Worker");
    expect(result.watchFile).toBeDefined();
    const session = getSession(result.sid);
    expect(session?.watchFile).toBe(result.watchFile);
    expect(existsSync(result.watchFile!)).toBe(true);
    expect(statSync(result.watchFile!).size).toBe(0);
    // cleanup
    unlinkWatchFile(result.watchFile);
  });

  it("createSession stores httpSessionId when provided", () => {
    const result = createSession("Worker", undefined, false, "http-uuid-123");
    expect(getSession(result.sid)?.httpSessionId).toBe("http-uuid-123");
    unlinkWatchFile(result.watchFile);
  });

  it("createSession accepts undefined httpSessionId (stdio transport)", () => {
    const result = createSession("Worker");
    expect(getSession(result.sid)?.httpSessionId).toBeUndefined();
    unlinkWatchFile(result.watchFile);
  });

  it("unlinkWatchFile is idempotent — second call after file is gone is fine", () => {
    const result = createSession("Worker");
    unlinkWatchFile(result.watchFile);
    expect(existsSync(result.watchFile!)).toBe(false);
    // Second call must not throw
    expect(() => unlinkWatchFile(result.watchFile)).not.toThrow();
  });

  it("unlinkWatchFile is a no-op for undefined", () => {
    expect(() => unlinkWatchFile(undefined)).not.toThrow();
  });

  it("findSessionsByHttpId returns SIDs of all sessions bound to the given HTTP UUID", () => {
    const a = createSession("A", undefined, false, "http-1");
    const b = createSession("B", undefined, false, "http-1");
    const c = createSession("C", undefined, false, "http-2");
    const d = createSession("D"); // no httpSessionId

    const matches = findSessionsByHttpId("http-1").sort();
    expect(matches).toEqual([a.sid, b.sid].sort());
    expect(findSessionsByHttpId("http-2")).toEqual([c.sid]);
    expect(findSessionsByHttpId("http-nonexistent")).toEqual([]);

    [a, b, c, d].forEach(s => unlinkWatchFile(s.watchFile));
  });
});

