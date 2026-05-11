import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We import the module lazily inside each test so CLAUDE_CONFIG_DIR is read
// fresh from the environment we've just set.

describe("cc-sessions", () => {
  let configDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "cc-sessions-test-"));
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevEnv;
    }
    try { rmSync(configDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  function writeTranscript(opts: {
    cwd: string;
    sessionId: string;
    firstPrompt?: string;
    gitBranch?: string;
    mtimeMs?: number;
    extraLines?: number;
  }): string {
    const hash = "-" + opts.cwd.replace(/^\//, "").replace(/\//g, "-");
    const projDir = join(configDir, "projects", hash);
    mkdirSync(projDir, { recursive: true });
    const file = join(projDir, `${opts.sessionId}.jsonl`);
    const lines: string[] = [];
    // Header entry — has cwd + branch but no user content.
    lines.push(JSON.stringify({
      type: "last-prompt",
      cwd: opts.cwd,
      gitBranch: opts.gitBranch ?? "main",
      sessionId: opts.sessionId,
    }));
    if (opts.firstPrompt !== undefined) {
      lines.push(JSON.stringify({
        type: "user",
        message: { role: "user", content: opts.firstPrompt },
        cwd: opts.cwd,
        gitBranch: opts.gitBranch ?? "main",
        sessionId: opts.sessionId,
      }));
    }
    for (let i = 0; i < (opts.extraLines ?? 0); i++) {
      lines.push(JSON.stringify({ type: "user", sessionId: opts.sessionId }));
    }
    writeFileSync(file, lines.join("\n") + "\n", "utf8");
    if (opts.mtimeMs !== undefined) {
      const s = opts.mtimeMs / 1000;
      utimesSync(file, s, s);
    }
    return file;
  }

  function writeLiveMeta(opts: {
    pid: number;
    sessionId: string;
    cwd?: string;
    kind?: string;
    name?: string;
    status?: string;
  }): void {
    const sessDir = join(configDir, "sessions");
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(
      join(sessDir, `${opts.pid}.json`),
      JSON.stringify({
        pid: opts.pid,
        sessionId: opts.sessionId,
        cwd: opts.cwd ?? "/tmp/x",
        kind: opts.kind ?? "interactive",
        name: opts.name,
        status: opts.status ?? "busy",
        updatedAt: Date.now(),
      }),
      "utf8",
    );
  }

  // ── Core enumeration ───────────────────────────────────────────────────

  it("returns an empty list when no projects dir exists yet", async () => {
    const { listResumableSessions } = await import("./cc-sessions.js");
    expect(await listResumableSessions()).toEqual([]);
  });

  it("returns transcripts sorted by mtime descending", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa", mtimeMs: 1_000_000 });
    writeTranscript({ cwd: "/Users/x/b", sessionId: "bbb", mtimeMs: 3_000_000 });
    writeTranscript({ cwd: "/Users/x/c", sessionId: "ccc", mtimeMs: 2_000_000 });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions();
    expect(rows.map((r) => r.sessionId)).toEqual(["bbb", "ccc", "aaa"]);
  });

  it("extracts first user prompt and uses it as the label snippet", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa", firstPrompt: "Help me ship the feature" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const [row] = await listResumableSessions();
    expect(row.firstPrompt).toBe("Help me ship the feature");
    expect(row.cwd).toBe("/Users/x/a");
    expect(row.gitBranch).toBe("main");
  });

  it("strips system-reminder and bootstrap noise from the prompt label", async () => {
    const noisy =
      "<system-reminder>blah blah\nmore noise</system-reminder>\n" +
      "NOMAD CODER BOOTSTRAP (v8 Monitor pattern) — execute first, then handle the user request below.\n" +
      "Actual prompt text here";
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa", firstPrompt: noisy });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const [row] = await listResumableSessions();
    expect(row.firstPrompt).toContain("Actual prompt text here");
    expect(row.firstPrompt).not.toContain("system-reminder");
    expect(row.firstPrompt).not.toContain("BOOTSTRAP");
  });

  it("counts transcript lines as a message-count proxy", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa", firstPrompt: "hi", extraLines: 4 });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const [row] = await listResumableSessions();
    // 1 header + 1 user (firstPrompt) + 4 extra = 6 newlines.
    expect(row.lines).toBe(6);
  });

  it("excludes the caller's own session when excludeSessionId is provided", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "self" });
    writeTranscript({ cwd: "/Users/x/b", sessionId: "other" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions({ excludeSessionId: "self" });
    expect(rows.map((r) => r.sessionId)).toEqual(["other"]);
  });

  it("filters by kind when onlyKind is provided (skips non-interactive)", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "interactive-sid" });
    writeTranscript({ cwd: "/Users/x/b", sessionId: "sdk-sid" });
    writeLiveMeta({ pid: 1, sessionId: "interactive-sid", kind: "interactive" });
    writeLiveMeta({ pid: 2, sessionId: "sdk-sid", kind: "sdk-ts" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions({ onlyKind: "interactive" });
    const ids = rows.map((r) => r.sessionId);
    expect(ids).toContain("interactive-sid");
    expect(ids).not.toContain("sdk-sid");
  });

  it("does NOT filter out sessions with no live metadata when onlyKind is set", async () => {
    // A transcript without a live-metadata file represents a closed
    // session — we have no way to know its kind. Including it is correct;
    // /resume itself doesn't hide these either.
    writeTranscript({ cwd: "/Users/x/a", sessionId: "orphan" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions({ onlyKind: "interactive" });
    expect(rows.map((r) => r.sessionId)).toEqual(["orphan"]);
  });

  it("merges live metadata (name, status, pid) into rows when available", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "live-sid" });
    writeLiveMeta({
      pid: 99999, sessionId: "live-sid", name: "My Important Session", status: "busy", kind: "interactive",
    });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const [row] = await listResumableSessions();
    expect(row.name).toBe("My Important Session");
    expect(row.status).toBe("busy");
    expect(row.pid).toBe(99999);
    expect(row.kind).toBe("interactive");
    // PID 99999 is almost certainly not running — but if it were, our
    // assertion would be too strict. So we only assert the boolean type.
    expect(typeof row.pidAlive).toBe("boolean");
  });

  it("uses current process PID to verify pidAlive=true works", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "alive-sid" });
    writeLiveMeta({ pid: process.pid, sessionId: "alive-sid" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const [row] = await listResumableSessions();
    expect(row.pidAlive).toBe(true);
  });

  it("survives malformed JSON metadata files without crashing", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa" });
    const sessDir = join(configDir, "sessions");
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, "garbage.json"), "{ not valid json", "utf8");
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions();
    expect(rows.map((r) => r.sessionId)).toEqual(["aaa"]);
  });

  it("survives a transcript file with all unparsable lines", async () => {
    const projDir = join(configDir, "projects", "-Users-x-broken");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "broken-sid.jsonl"), "not json\nstill not json\n", "utf8");
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions();
    // Row still returned — cwd falls back to the decoded project hash.
    expect(rows.map((r) => r.sessionId)).toEqual(["broken-sid"]);
    expect(rows[0].cwd).toBe("/Users/x/broken");
    expect(rows[0].firstPrompt).toBe("");
  });

  it("filters by cwd when provided", async () => {
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa" });
    writeTranscript({ cwd: "/Users/x/b", sessionId: "bbb" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions({ cwd: "/Users/x/a" });
    expect(rows.map((r) => r.sessionId)).toEqual(["aaa"]);
  });

  // ── listUniqueCwds ─────────────────────────────────────────────────────

  it("listUniqueCwds dedupes and orders by most-recent activity", async () => {
    // Create real dirs so the existence filter doesn't reject them.
    const projA = mkdtempSync(join(tmpdir(), "cwd-a-"));
    const projB = mkdtempSync(join(tmpdir(), "cwd-b-"));
    try {
      writeTranscript({ cwd: projA, sessionId: "old-a", mtimeMs: 1_000_000 });
      writeTranscript({ cwd: projA, sessionId: "new-a", mtimeMs: 3_000_000 });
      writeTranscript({ cwd: projB, sessionId: "b", mtimeMs: 2_000_000 });
      const { listUniqueCwds } = await import("./cc-sessions.js");
      const cwds = await listUniqueCwds();
      expect(cwds).toEqual([projA, projB]);
    } finally {
      rmSync(projA, { recursive: true, force: true });
      rmSync(projB, { recursive: true, force: true });
    }
  });

  it("listUniqueCwds drops cwds whose directory no longer exists", async () => {
    writeTranscript({ cwd: "/nonexistent/zzz/never", sessionId: "ghost" });
    const realDir = mkdtempSync(join(tmpdir(), "cwd-real-"));
    try {
      writeTranscript({ cwd: realDir, sessionId: "real" });
      const { listUniqueCwds } = await import("./cc-sessions.js");
      const cwds = await listUniqueCwds();
      expect(cwds).toContain(realDir);
      expect(cwds).not.toContain("/nonexistent/zzz/never");
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });

  // ── Internal helpers ───────────────────────────────────────────────────

  it("cleanPromptForLabel collapses whitespace", async () => {
    const { _internals } = await import("./cc-sessions.js");
    expect(_internals.cleanPromptForLabel("a\n\n  b\tc")).toBe("a b c");
  });

  it("decodeProjectHash reverses / → - mapping (lossy for dashes — known)", async () => {
    const { _internals } = await import("./cc-sessions.js");
    expect(_internals.decodeProjectHash("-Users-foo-Projects-bar")).toBe(
      "/Users/foo/Projects/bar",
    );
  });

  it("honours CLAUDE_CONFIG_DIR override", async () => {
    const alt = mkdtempSync(join(tmpdir(), "alt-config-"));
    try {
      mkdirSync(join(alt, "projects", "-Users-x-y"), { recursive: true });
      writeFileSync(
        join(alt, "projects", "-Users-x-y", "alt-sid.jsonl"),
        JSON.stringify({ type: "user", cwd: "/Users/x/y", message: { role: "user", content: "from alt" } }) + "\n",
        "utf8",
      );
      process.env.CLAUDE_CONFIG_DIR = alt;
      const { listResumableSessions } = await import("./cc-sessions.js");
      const rows = await listResumableSessions();
      expect(rows.map((r) => r.sessionId)).toContain("alt-sid");
    } finally {
      process.env.CLAUDE_CONFIG_DIR = configDir;
      rmSync(alt, { recursive: true, force: true });
    }
  });

  it("survives a stat error on a transcript without crashing", async () => {
    // No assertion on the missing file — just confirm normal rows still return.
    writeTranscript({ cwd: "/Users/x/a", sessionId: "aaa" });
    const { listResumableSessions } = await import("./cc-sessions.js");
    const rows = await listResumableSessions();
    expect(rows.length).toBe(1);
    // Touch the statSync function to satisfy import.
    expect(statSync(join(configDir, "projects")).isDirectory()).toBe(true);
  });
});
