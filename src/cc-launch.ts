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
import { homedir } from "node:os";
import { join } from "node:path";

export type CcLaunchError =
  | { code: "NOT_CONFIGURED"; message: string }
  | { code: "PATH_NOT_FOUND"; message: string }
  | { code: "PATH_NOT_DIR"; message: string }
  | { code: "SCRIPT_FAILED"; message: string };

/**
 * Normalize the operator-supplied path so casual entry "just works":
 *
 *   /Users/me/proj  → /Users/me/proj      (absolute — leave as-is)
 *   ~               → $HOME
 *   ~/proj          → $HOME/proj
 *   proj            → $HOME/proj          (bare relative — assume home)
 *   Projects/foo    → $HOME/Projects/foo  (relative — assume home)
 *
 * Whitespace is trimmed first. Empty strings are left untouched (the
 * caller's existence check will reject them with PATH_NOT_FOUND).
 *
 * We do NOT cwd-relative resolve (`process.cwd()`) because the bridge runs
 * as a launchd-managed daemon — its cwd is `/`, which is rarely what an
 * operator means by "Projects/foo". Home is the sensible default.
 */
export function resolveCcTargetDir(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  // Bare or relative — anchor at home.
  return join(homedir(), trimmed);
}

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
 * The CLI command the operator uses to start Claude Code in their terminal
 * — `cc`, `claude`, or any custom alias they've set up. Read from
 * `CC_CLI_COMMAND` in the env (set by the launchd plist at install time);
 * defaults to `cc` if unset. Passed as the second argument to the launch
 * AppleScript so the script can run `cd <dir> && <cli> <kickstart>`.
 */
export function getCcCliCommand(): string {
  const s = process.env.CC_CLI_COMMAND;
  return s && s.trim().length > 0 ? s.trim() : "cc";
}

/** Options for `launchCcInGhostty`. */
export interface LaunchCcOptions {
  /**
   * If set, the bundled AppleScript will invoke `cc --resume <sessionId>`
   * instead of `cc "<kickstart-prompt>"`. The session ID is the UUID found
   * in `~/.claude/sessions/*.json` and as the basename of the transcript
   * files under `~/.claude/projects/`. Forwarded to the launch script as
   * its third positional argument; scripts updated 2026-05 accept it,
   * older operator-supplied scripts will silently ignore the extra arg
   * (degrading to a fresh launch).
   */
  resumeSessionId?: string;
}

/**
 * Validates `targetDir` (must exist + be a directory) and runs
 * `osascript $CC_LAUNCH_SCRIPT <targetDir> <cli> [<resume-session-id>]`.
 * Resolves on script exit code 0, rejects with a `CcLaunchError` otherwise.
 *
 * The spawn is NOT awaited for completion in the path-validation step —
 * we only block on stat. The AppleScript itself runs detached so the bridge
 * doesn't get tied to its lifetime; it just needs to launch successfully.
 *
 * Backwards-compat: the `resumeSessionId` argument is appended only when
 * present, so operator-supplied launch scripts written against the original
 * two-arg contract continue to work for fresh launches.
 */
export async function launchCcInGhostty(
  targetDir: string,
  opts: LaunchCcOptions = {},
): Promise<void> {
  const script = getCcLaunchScript();
  if (!script) {
    throw {
      code: "NOT_CONFIGURED",
      message:
        "CC_LAUNCH_SCRIPT is not set. Configure the path to your launch " +
        "AppleScript in the bridge environment to enable /cc.",
    } satisfies CcLaunchError;
  }

  const resolved = resolveCcTargetDir(targetDir);
  if (resolved.length === 0 || !existsSync(resolved)) {
    throw {
      code: "PATH_NOT_FOUND",
      message: `Path does not exist: ${resolved || targetDir}`,
    } satisfies CcLaunchError;
  }
  let st;
  try {
    st = statSync(resolved);
  } catch (err) {
    throw {
      code: "PATH_NOT_FOUND",
      message: `Cannot stat path: ${(err as Error).message}`,
    } satisfies CcLaunchError;
  }
  if (!st.isDirectory()) {
    throw {
      code: "PATH_NOT_DIR",
      message: `Not a directory: ${resolved}`,
    } satisfies CcLaunchError;
  }

  const cli = getCcCliCommand();
  // Build the positional arg list: <target> <cli> [<resume-sid>].
  // The session ID is only forwarded when set; this keeps two-arg-only
  // operator scripts working for fresh launches.
  const argv = [script, resolved, cli];
  const sid = opts.resumeSessionId?.trim();
  if (sid && sid.length > 0) {
    argv.push(sid);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("osascript", argv, {
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
