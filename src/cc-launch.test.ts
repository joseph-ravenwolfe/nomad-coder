import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

// Hoisted spawn mock so the SUT calls our fake instead of forking osascript.
const spawnSpy = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("node:child_process");
  return { ...actual, spawn: spawnSpy };
});

interface FakeChild extends EventEmitter {
  stderr: Readable | null;
  unref: () => void;
}

function makeFakeChild(opts: { exitCode?: number; stderrData?: string; emitError?: Error } = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stderr = new EventEmitter() as unknown as Readable;
  child.stderr = stderr;
  child.unref = () => undefined;

  // Defer event emission so the SUT can attach listeners first.
  void Promise.resolve().then(() => {
    if (opts.emitError) {
      child.emit("error", opts.emitError);
      return;
    }
    if (opts.stderrData !== undefined) {
      stderr.emit("data", Buffer.from(opts.stderrData, "utf8"));
    }
    child.emit("exit", opts.exitCode ?? 0);
  });

  return child;
}

describe("cc-launch", () => {
  let prevScript: string | undefined;
  let workDir: string;

  beforeEach(() => {
    prevScript = process.env.CC_LAUNCH_SCRIPT;
    workDir = mkdtempSync(join(tmpdir(), "cc-launch-test-"));
    spawnSpy.mockReset();
  });

  afterEach(() => {
    if (prevScript === undefined) delete process.env.CC_LAUNCH_SCRIPT;
    else process.env.CC_LAUNCH_SCRIPT = prevScript;
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe("isCcLaunchConfigured", () => {
    it("returns false when CC_LAUNCH_SCRIPT is unset", async () => {
      delete process.env.CC_LAUNCH_SCRIPT;
      const { isCcLaunchConfigured } = await import("./cc-launch.js");
      expect(isCcLaunchConfigured()).toBe(false);
    });

    it("returns false when CC_LAUNCH_SCRIPT is whitespace-only", async () => {
      process.env.CC_LAUNCH_SCRIPT = "   ";
      const { isCcLaunchConfigured } = await import("./cc-launch.js");
      expect(isCcLaunchConfigured()).toBe(false);
    });

    it("returns true when CC_LAUNCH_SCRIPT is set to a non-empty path", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/some/script.applescript";
      const { isCcLaunchConfigured } = await import("./cc-launch.js");
      expect(isCcLaunchConfigured()).toBe(true);
    });
  });

  describe("launchCcInGhostty", () => {
    it("rejects with NOT_CONFIGURED when CC_LAUNCH_SCRIPT is unset", async () => {
      delete process.env.CC_LAUNCH_SCRIPT;
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await expect(launchCcInGhostty(workDir)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("rejects with PATH_NOT_FOUND when target directory does not exist", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/some/script.applescript";
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await expect(launchCcInGhostty(join(workDir, "missing"))).rejects.toMatchObject({ code: "PATH_NOT_FOUND" });
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("rejects with PATH_NOT_DIR when target is a regular file", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/some/script.applescript";
      const filePath = join(workDir, "file.txt");
      writeFileSync(filePath, "x", "utf8");
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await expect(launchCcInGhostty(filePath)).rejects.toMatchObject({ code: "PATH_NOT_DIR" });
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("spawns osascript with the script + dir args and resolves on exit code 0", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      spawnSpy.mockImplementation(() => makeFakeChild({ exitCode: 0 }));
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await expect(launchCcInGhostty(workDir)).resolves.toBeUndefined();
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnSpy.mock.calls[0] as [string, string[], Record<string, unknown>];
      expect(cmd).toBe("osascript");
      expect(args).toEqual(["/launch.applescript", workDir]);
      expect(opts.detached).toBe(true);
    });

    it("trims whitespace from the target dir before stat + spawn", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      spawnSpy.mockImplementation(() => makeFakeChild({ exitCode: 0 }));
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await launchCcInGhostty(`   ${workDir}   `);
      const args = spawnSpy.mock.calls[0]![1] as string[];
      expect(args[1]).toBe(workDir);
    });

    it("rejects with SCRIPT_FAILED on a non-zero exit code, including captured stderr", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      spawnSpy.mockImplementation(() => makeFakeChild({ exitCode: 1, stderrData: "boom" }));
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await expect(launchCcInGhostty(workDir)).rejects.toMatchObject({
        code: "SCRIPT_FAILED",
        message: expect.stringContaining("boom") as unknown as string,
      });
    });

    it("rejects with SCRIPT_FAILED when spawn emits an error event", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      spawnSpy.mockImplementation(() => makeFakeChild({ emitError: new Error("ENOENT osascript") }));
      const { launchCcInGhostty } = await import("./cc-launch.js");
      await expect(launchCcInGhostty(workDir)).rejects.toMatchObject({
        code: "SCRIPT_FAILED",
        message: expect.stringContaining("ENOENT osascript") as unknown as string,
      });
    });
  });

  describe("resolveCcTargetDir", () => {
    it("leaves absolute paths unchanged", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("/Users/me/proj")).toBe("/Users/me/proj");
      expect(resolveCcTargetDir("/")).toBe("/");
    });

    it("expands a bare ~ to $HOME", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("~")).toBe(homedir());
    });

    it("expands ~/foo to $HOME/foo", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("~/Projects/foo")).toBe(join(homedir(), "Projects/foo"));
    });

    it("anchors a bare relative path at $HOME", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("Projects/foo")).toBe(join(homedir(), "Projects/foo"));
    });

    it("anchors a single-segment relative path at $HOME", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("Documents")).toBe(join(homedir(), "Documents"));
    });

    it("trims surrounding whitespace before resolving", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("  Projects/foo  ")).toBe(join(homedir(), "Projects/foo"));
      expect(resolveCcTargetDir("  /abs/path  ")).toBe("/abs/path");
    });

    it("returns the empty string when input is empty / whitespace-only", async () => {
      const { resolveCcTargetDir } = await import("./cc-launch.js");
      expect(resolveCcTargetDir("")).toBe("");
      expect(resolveCcTargetDir("   ")).toBe("");
    });
  });

  describe("launchCcInGhostty home-dir relative paths", () => {
    it("launches against $HOME/<rel> when input has no leading slash", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      // Create a real subdir of $HOME so the existence check passes.
      const sub = `cc-launch-test-${Date.now()}`;
      const abs = join(homedir(), sub);
      mkdirSync(abs, { recursive: true });
      try {
        spawnSpy.mockImplementation(() => makeFakeChild({ exitCode: 0 }));
        const { launchCcInGhostty } = await import("./cc-launch.js");
        await launchCcInGhostty(sub);
        const args = spawnSpy.mock.calls[0]![1] as string[];
        expect(args[1]).toBe(abs);
      } finally {
        rmSync(abs, { recursive: true, force: true });
      }
    });

    it("expands ~/sub to $HOME/sub before spawning", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      const sub = `cc-launch-test-tilde-${Date.now()}`;
      const abs = join(homedir(), sub);
      mkdirSync(abs, { recursive: true });
      try {
        spawnSpy.mockImplementation(() => makeFakeChild({ exitCode: 0 }));
        const { launchCcInGhostty } = await import("./cc-launch.js");
        await launchCcInGhostty(`~/${sub}`);
        const args = spawnSpy.mock.calls[0]![1] as string[];
        expect(args[1]).toBe(abs);
      } finally {
        rmSync(abs, { recursive: true, force: true });
      }
    });

    it("rejects PATH_NOT_FOUND for a relative path that doesn't exist under $HOME", async () => {
      process.env.CC_LAUNCH_SCRIPT = "/launch.applescript";
      const { launchCcInGhostty } = await import("./cc-launch.js");
      // Use a name that almost certainly doesn't exist under $HOME.
      await expect(launchCcInGhostty("__definitely-not-a-real-cc-launch-dir__"))
        .rejects.toMatchObject({ code: "PATH_NOT_FOUND" });
      expect(spawnSpy).not.toHaveBeenCalled();
    });
  });
});
