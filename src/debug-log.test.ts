import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  dlog,
  getDebugLog,
  debugLogSize,
  clearDebugLog,
  isDebugEnabled,
  setDebugEnabled,
  resetDebugLogForTest,
} from "./debug-log.js";

beforeEach(() => {
  resetDebugLogForTest();
});

describe("debug-log", () => {
  it("is disabled by default (in test env)", () => {
    expect(isDebugEnabled()).toBe(false);
  });

  it("no-ops when disabled", () => {
    dlog("session", "should not appear");
    expect(debugLogSize()).toBe(0);
  });

  it("logs entries when enabled", () => {
    setDebugEnabled(true);
    dlog("session", "created", { sid: 1 });
    dlog("route", "targeted");
    expect(debugLogSize()).toBe(2);
    const entries = getDebugLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].cat).toBe("session");
    expect(entries[0].msg).toBe("created");
    expect(entries[0].data).toEqual({ sid: 1 });
    expect(entries[1].cat).toBe("route");
  });

  it("writes to stderr when enabled", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDebugEnabled(true);
    dlog("queue", "enqueue test");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[dbg:queue] enqueue test"));
    spy.mockRestore();
  });

  it("filters by category", () => {
    setDebugEnabled(true);
    dlog("session", "a");
    dlog("route", "b");
    dlog("session", "c");
    const filtered = getDebugLog(50, "session");
    expect(filtered).toHaveLength(2);
    expect(filtered.every(e => e.cat === "session")).toBe(true);
  });

  it("respects count limit", () => {
    setDebugEnabled(true);
    for (let i = 0; i < 10; i++) dlog("session", `entry ${i}`);
    const limited = getDebugLog(3);
    expect(limited).toHaveLength(3);
    expect(limited[0].msg).toBe("entry 7");
  });

  it("clears the buffer", () => {
    setDebugEnabled(true);
    dlog("session", "test");
    clearDebugLog();
    expect(debugLogSize()).toBe(0);
    expect(getDebugLog()).toHaveLength(0);
  });

  it("toggles enabled state", () => {
    expect(setDebugEnabled(true)).toBe(true);
    expect(isDebugEnabled()).toBe(true);
    expect(setDebugEnabled(false)).toBe(false);
    expect(isDebugEnabled()).toBe(false);
  });

  it("enforces max buffer size", () => {
    setDebugEnabled(true);
    // Write more than MAX_ENTRIES (2000)
    for (let i = 0; i < 2050; i++) dlog("session", `e${i}`);
    expect(debugLogSize()).toBe(2000);
    // Oldest entries should be trimmed
    const entries = getDebugLog(1);
    expect(entries[0].msg).toBe("e2049");
  });
});
