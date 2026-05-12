import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Hoisted mocks ───────────────────────────────────────────

const sessionMocks = vi.hoisted(() => ({
  listSessions: vi.fn(() => [] as Array<{ sid: number; name: string; color: string; createdAt: string }>),
  getSession: vi.fn(
    (_sid: number) =>
      undefined as
        | undefined
        | {
            sid: number;
            name: string;
            createdAt: string;
            watchFile?: string;
            lastPollAt?: number;
          },
  ),
}));

vi.mock("./session-manager.js", () => ({
  listSessions: () => sessionMocks.listSessions(),
  getSession: (sid: number) => sessionMocks.getSession(sid),
}));

import {
  runLivenessPingNow,
  startLivenessPings,
  stopLivenessPings,
  _isLivenessPingerRunning,
  LIVENESS_PING_AFTER_QUIET_MS,
} from "./session-liveness.js";

describe("session-liveness", () => {
  let scratchDir: string;
  /** Returns an absolute path to an empty file inside the scratch dir. */
  function makeWatchFile(name: string): string {
    const f = join(scratchDir, name);
    // Empty-file create.
    writeFileSync(f, "");
    return f;
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "session-liveness-test-"));
    sessionMocks.listSessions.mockReset().mockReturnValue([]);
    sessionMocks.getSession.mockReset().mockReturnValue(undefined);
  });

  afterEach(() => {
    stopLivenessPings();
    try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── runLivenessPingNow ─────────────────────────────────────

  it("writes a tick to a session whose lastPollAt is past the quiet cutoff", () => {
    const watchFile = makeWatchFile("a.events");
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "A", color: "🔵", createdAt: new Date(now - 5 * 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation((sid: number) => {
      if (sid !== 1) return undefined;
      return {
        sid: 1, name: "A", createdAt: new Date(now - 5 * 60_000).toISOString(),
        watchFile,
        lastPollAt: now - LIVENESS_PING_AFTER_QUIET_MS - 10_000, // stale by 100s
      };
    });
    runLivenessPingNow(now);
    expect(readFileSync(watchFile, "utf8")).toBe("tick\n");
  });

  it("does NOT write a tick to a session that recently dequeued (lastPollAt fresh)", () => {
    const watchFile = makeWatchFile("b.events");
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "B", color: "🔵", createdAt: new Date(now - 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation(() => ({
      sid: 1, name: "B", createdAt: new Date(now - 60_000).toISOString(),
      watchFile,
      lastPollAt: now - 1_000, // touched 1s ago — fresh
    }));
    runLivenessPingNow(now);
    expect(statSync(watchFile).size).toBe(0);
  });

  it("uses createdAt as the fallback freshness signal when lastPollAt is undefined", () => {
    const watchFile = makeWatchFile("c.events");
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "C", color: "🔵", createdAt: new Date(now - 5 * 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation(() => ({
      sid: 1, name: "C", createdAt: new Date(now - 5 * 60_000).toISOString(),
      watchFile,
      // lastPollAt undefined — session never polled
    }));
    runLivenessPingNow(now);
    // Created 5 min ago, never polled → past quiet cutoff → tick written.
    expect(readFileSync(watchFile, "utf8")).toBe("tick\n");
  });

  it("does NOT tick a just-created session (createdAt fallback within cutoff)", () => {
    const watchFile = makeWatchFile("d.events");
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "D", color: "🔵", createdAt: new Date(now - 5_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation(() => ({
      sid: 1, name: "D", createdAt: new Date(now - 5_000).toISOString(),
      watchFile,
    }));
    runLivenessPingNow(now);
    expect(statSync(watchFile).size).toBe(0);
  });

  it("skips a session whose watchFile is missing (no crash)", () => {
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "E", color: "🔵", createdAt: new Date(now - 5 * 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation(() => ({
      sid: 1, name: "E", createdAt: new Date(now - 5 * 60_000).toISOString(),
      // watchFile undefined
      lastPollAt: now - 5 * 60_000,
    }));
    expect(() => { runLivenessPingNow(now); }).not.toThrow();
  });

  it("walks every session and pings only the quiet ones", () => {
    const stale = makeWatchFile("stale.events");
    const fresh = makeWatchFile("fresh.events");
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "stale", color: "🔵", createdAt: new Date(now - 10 * 60_000).toISOString() },
      { sid: 2, name: "fresh", color: "🟢", createdAt: new Date(now - 10 * 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation((sid: number) => {
      if (sid === 1) {
        return {
          sid: 1, name: "stale", createdAt: new Date(now - 10 * 60_000).toISOString(),
          watchFile: stale, lastPollAt: now - 5 * 60_000,
        };
      }
      if (sid === 2) {
        return {
          sid: 2, name: "fresh", createdAt: new Date(now - 10 * 60_000).toISOString(),
          watchFile: fresh, lastPollAt: now - 1_000,
        };
      }
      return undefined;
    });
    runLivenessPingNow(now);
    expect(readFileSync(stale, "utf8")).toBe("tick\n");
    expect(statSync(fresh).size).toBe(0);
  });

  it("appends to an existing watch file rather than overwriting", () => {
    const watchFile = makeWatchFile("append.events");
    writeFileSync(watchFile, "existing\n");
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "A", color: "🔵", createdAt: new Date(now - 5 * 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation(() => ({
      sid: 1, name: "A", createdAt: new Date(now - 5 * 60_000).toISOString(),
      watchFile, lastPollAt: now - 5 * 60_000,
    }));
    runLivenessPingNow(now);
    expect(readFileSync(watchFile, "utf8")).toBe("existing\ntick\n");
  });

  it("survives a write failure (e.g. permission denied) without crashing", () => {
    const watchFile = "/nonexistent/dir/does/not/exist.events";
    const now = Date.now();
    sessionMocks.listSessions.mockReturnValue([
      { sid: 1, name: "A", color: "🔵", createdAt: new Date(now - 5 * 60_000).toISOString() },
    ]);
    sessionMocks.getSession.mockImplementation(() => ({
      sid: 1, name: "A", createdAt: new Date(now - 5 * 60_000).toISOString(),
      watchFile, lastPollAt: now - 5 * 60_000,
    }));
    // Capture stderr to confirm the failure is logged but not thrown.
    const logged: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      logged.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    try {
      expect(() => { runLivenessPingNow(now); }).not.toThrow();
      expect(logged.some((l) => l.includes("[liveness] write failed"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  // ── start/stop ──────────────────────────────────────────────

  it("startLivenessPings arms a timer and stopLivenessPings clears it", () => {
    expect(_isLivenessPingerRunning()).toBe(false);
    startLivenessPings(60_000);
    expect(_isLivenessPingerRunning()).toBe(true);
    stopLivenessPings();
    expect(_isLivenessPingerRunning()).toBe(false);
  });

  it("calling startLivenessPings twice replaces the existing timer (no leak)", () => {
    startLivenessPings(60_000);
    startLivenessPings(60_000);
    expect(_isLivenessPingerRunning()).toBe(true);
    stopLivenessPings();
    expect(_isLivenessPingerRunning()).toBe(false);
  });
});
