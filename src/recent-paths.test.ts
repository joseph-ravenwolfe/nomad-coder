import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We import lazily inside each test so XDG_CACHE_HOME is read fresh.

describe("recent-paths", () => {
  let cacheDir: string;
  let prevXdg: string | undefined;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "recent-paths-test-"));
    prevXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cacheDir;
  });

  afterEach(() => {
    if (prevXdg === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = prevXdg;
    }
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns an empty list when no store file exists yet", async () => {
    const { getRecentPaths } = await import("./recent-paths.js");
    expect(getRecentPaths()).toEqual([]);
  });

  it("addRecentPath persists and surfaces the path on the next read", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    addRecentPath("/Users/me/projA");
    expect(getRecentPaths()).toEqual(["/Users/me/projA"]);
  });

  it("orders entries most-recent-first", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    addRecentPath("/a");
    addRecentPath("/b");
    addRecentPath("/c");
    expect(getRecentPaths()).toEqual(["/c", "/b", "/a"]);
  });

  it("dedupes case-sensitively — re-adding moves to front, no duplicates", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    addRecentPath("/a");
    addRecentPath("/b");
    addRecentPath("/a"); // bump
    expect(getRecentPaths()).toEqual(["/a", "/b"]);
  });

  it("treats different cases as distinct entries", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    addRecentPath("/Foo");
    addRecentPath("/foo");
    expect(getRecentPaths()).toEqual(["/foo", "/Foo"]);
  });

  it("trims whitespace before storing", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    addRecentPath("   /a/b   ");
    expect(getRecentPaths()).toEqual(["/a/b"]);
  });

  it("ignores empty / whitespace-only inputs", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    addRecentPath("");
    addRecentPath("   ");
    expect(getRecentPaths()).toEqual([]);
  });

  it("caps the list at 10 — older entries fall off the end", async () => {
    const { getRecentPaths, addRecentPath } = await import("./recent-paths.js");
    for (let i = 1; i <= 12; i++) addRecentPath(`/p${i}`);
    const list = getRecentPaths();
    expect(list).toHaveLength(10);
    // Most-recent first; oldest two should have fallen off.
    expect(list[0]).toBe("/p12");
    expect(list[9]).toBe("/p3");
    expect(list).not.toContain("/p1");
    expect(list).not.toContain("/p2");
  });

  it("survives a corrupt store file by returning empty", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = join(cacheDir, "telegram-bridge-mcp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "recent-paths.json"), "{ not json", "utf8");
    const { getRecentPaths } = await import("./recent-paths.js");
    expect(getRecentPaths()).toEqual([]);
  });

  it("survives a non-array JSON payload by returning empty", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = join(cacheDir, "telegram-bridge-mcp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "recent-paths.json"), '{"foo":"bar"}', "utf8");
    const { getRecentPaths } = await import("./recent-paths.js");
    expect(getRecentPaths()).toEqual([]);
  });

  it("filters out non-string array entries", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = join(cacheDir, "telegram-bridge-mcp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "recent-paths.json"), '["/a", 42, "/b", null]', "utf8");
    const { getRecentPaths } = await import("./recent-paths.js");
    expect(getRecentPaths()).toEqual(["/a", "/b"]);
  });
});
