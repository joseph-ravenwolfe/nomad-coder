import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
});
