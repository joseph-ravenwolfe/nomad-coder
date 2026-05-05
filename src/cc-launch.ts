/**
 * Launches a `cc` (Claude Code) session in a new Ghostty tab via the
 * operator-supplied AppleScript at `$CC_LAUNCH_SCRIPT`. Used by the `/cc`
 * Telegram command to spawn sessions remotely from the operator's phone.
 *
 * Operator-only by construction: the bridge already gates inbound updates
 * to ALLOWED_USER_ID before any /cc handling runs (see filterAllowedUpdates).
 *
 * Configuration: set `CC_LAUNCH_SCRIPT` to an absolute path of an
 * AppleScript that accepts a single positional `target-dir` argument. If
 * unset, `isCcLaunchConfigured()` returns false and the /cc command
 * surfaces a config error.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";

export type CcLaunchError =
  | { code: "NOT_CONFIGURED"; message: string }
  | { code: "PATH_NOT_FOUND"; message: string }
  | { code: "PATH_NOT_DIR"; message: string }
  | { code: "SCRIPT_FAILED"; message: string };

/** Returns true iff `CC_LAUNCH_SCRIPT` is set in the environment. */
export function isCcLaunchConfigured(): boolean {
  const s = process.env.CC_LAUNCH_SCRIPT;
  return typeof s === "string" && s.trim().length > 0;
}

/** Returns the configured launch-script path (may be unset). */
export function getCcLaunchScript(): string | undefined {
  const s = process.env.CC_LAUNCH_SCRIPT;
  return s && s.trim().length > 0 ? s.trim() : undefined;
}

/**
 * Validates `targetDir` (must exist + be a directory) and runs
 * `osascript $CC_LAUNCH_SCRIPT <targetDir>`. Resolves on script exit code 0,
 * rejects with a `CcLaunchError` otherwise.
 *
 * The spawn is NOT awaited for completion in the path-validation step —
 * we only block on stat. The AppleScript itself runs detached so the bridge
 * doesn't get tied to its lifetime; it just needs to launch successfully.
 */
export async function launchCcInGhostty(targetDir: string): Promise<void> {
  const script = getCcLaunchScript();
  if (!script) {
    throw {
      code: "NOT_CONFIGURED",
      message:
        "CC_LAUNCH_SCRIPT is not set. Configure the path to your launch " +
        "AppleScript in the bridge environment to enable /cc.",
    } satisfies CcLaunchError;
  }

  const trimmed = targetDir.trim();
  if (!existsSync(trimmed)) {
    throw {
      code: "PATH_NOT_FOUND",
      message: `Path does not exist: ${trimmed}`,
    } satisfies CcLaunchError;
  }
  let st;
  try {
    st = statSync(trimmed);
  } catch (err) {
    throw {
      code: "PATH_NOT_FOUND",
      message: `Cannot stat path: ${(err as Error).message}`,
    } satisfies CcLaunchError;
  }
  if (!st.isDirectory()) {
    throw {
      code: "PATH_NOT_DIR",
      message: `Not a directory: ${trimmed}`,
    } satisfies CcLaunchError;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("osascript", [script, trimmed], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      reject({
        code: "SCRIPT_FAILED",
        message: `Failed to spawn osascript: ${err.message}`,
      } satisfies CcLaunchError);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject({
          code: "SCRIPT_FAILED",
          message: `osascript exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
        } satisfies CcLaunchError);
      }
    });
    child.unref();
  });
}
