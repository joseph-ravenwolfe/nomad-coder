/**
 * Safe `git pull --ff-only` for a target directory, invoked by `/cc` before
 * a fresh Claude Code launch so the operator picks up whatever has been
 * merged on their tracking branch since their last session.
 *
 * Design constraints:
 *
 *   * Never block the launch on a pull failure. If anything goes wrong
 *     (no remote, conflict, network down), we report and move on — `cc`
 *     still starts.
 *   * Never modify the operator's working tree. We refuse to pull when
 *     there are uncommitted changes. The operator would not thank us for
 *     auto-merging into their WIP.
 *   * Never do anything other than fast-forward. `--ff-only` guarantees
 *     no merge commits, no rewrites; if the local branch has diverged
 *     from upstream, we abort and let the operator handle it.
 *   * Stay fast. We cap each git call at a short timeout so a hung
 *     remote doesn't make /cc feel broken on Telegram.
 *
 * Skipped on resume launches. Resumed sessions may have stashed work or
 * be mid-rebase; a surprise pull would be hostile.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Hard cap on any single `git` invocation. */
const GIT_TIMEOUT_MS = 30_000;

export type GitSyncOutcome =
  | "not-a-repo"
  | "dirty"
  | "detached"
  | "no-upstream"
  | "up-to-date"
  | "pulled"
  | "fetch-failed"
  | "pull-failed";

export interface GitSyncReport {
  outcome: GitSyncOutcome;
  /** Current branch name (when known). */
  branch?: string;
  /** Number of commits the upstream is ahead of us, when pulled / up-to-date. */
  pulledCommits?: number;
  /** A one-line summary suitable for a Telegram notification. */
  detail: string;
}

/** Run a git subcommand in `cwd`, time-bounded. Returns stdout trimmed. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    // Cap stdout to avoid a runaway diff/log call eating memory.
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout.trim();
}

/** Like `git()` but swallows errors and returns the error message instead. */
async function tryGit(cwd: string, args: string[]): Promise<{ ok: true; out: string } | { ok: false; err: string }> {
  try {
    const out = await git(cwd, args);
    return { ok: true, out };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    // Prefer git's stderr when present (more actionable than the wrapper's
    // generic "Command failed: ..." text); fall back to the JS Error message.
    const stderr = e.stderr?.trim();
    const detail = stderr && stderr.length > 0 ? stderr : e.message;
    return { ok: false, err: detail };
  }
}

/**
 * Inspect `cwd` and (when safe) pull the tracking branch fast-forward only.
 *
 * Decision tree:
 *
 *   1. Not a git repo                                 → not-a-repo
 *   2. Has uncommitted changes (git status --porcelain) → dirty
 *   3. Detached HEAD                                   → detached
 *   4. No upstream tracking branch                    → no-upstream
 *   5. `git fetch` fails                              → fetch-failed
 *   6. Already at upstream                            → up-to-date
 *   7. `git merge --ff-only @{upstream}` succeeds     → pulled
 *   8. Merge would not fast-forward                   → pull-failed
 *
 * Always resolves (never throws). The caller logs `report.detail` and
 * proceeds to launch regardless of outcome.
 */
export async function syncGitRepoIfSafe(cwd: string): Promise<GitSyncReport> {
  // 1. Repo check.
  const isRepo = await tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo.ok || isRepo.out !== "true") {
    return { outcome: "not-a-repo", detail: "Not a git repo — skipping pull." };
  }

  // 2. Dirty check. --porcelain emits one line per change; empty → clean.
  const status = await tryGit(cwd, ["status", "--porcelain"]);
  if (status.ok && status.out.length > 0) {
    return { outcome: "dirty", detail: "Working tree has uncommitted changes — skipping pull." };
  }

  // 3. Current branch — `HEAD` literal means detached.
  const branchRes = await tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchRes.ok) {
    return { outcome: "not-a-repo", detail: "Could not read branch — skipping pull." };
  }
  const branch = branchRes.out;
  if (branch === "HEAD") {
    return { outcome: "detached", branch, detail: "Detached HEAD — skipping pull." };
  }

  // 4. Upstream check.
  const upstream = await tryGit(cwd, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
  if (!upstream.ok) {
    return { outcome: "no-upstream", branch, detail: `Branch \`${branch}\` has no upstream — skipping pull.` };
  }

  // 5. Fetch the upstream branch only — cheaper and less noisy than
  // fetching all refs. The upstream string is `<remote>/<branch>`.
  const slash = upstream.out.indexOf("/");
  const remote = slash > 0 ? upstream.out.slice(0, slash) : "origin";
  const remoteBranch = slash > 0 ? upstream.out.slice(slash + 1) : branch;
  const fetchRes = await tryGit(cwd, ["fetch", "--quiet", remote, remoteBranch]);
  if (!fetchRes.ok) {
    return { outcome: "fetch-failed", branch, detail: `Fetch failed: ${truncate(fetchRes.err, 120)}` };
  }

  // 6. Count commits we're behind.
  const behindRes = await tryGit(cwd, ["rev-list", "--count", `HEAD..${upstream.out}`]);
  if (!behindRes.ok) {
    return { outcome: "fetch-failed", branch, detail: `Could not compare with upstream: ${truncate(behindRes.err, 120)}` };
  }
  const behindBy = Number.parseInt(behindRes.out, 10);
  if (!Number.isFinite(behindBy) || behindBy <= 0) {
    return { outcome: "up-to-date", branch, pulledCommits: 0, detail: `Already up to date on \`${branch}\`.` };
  }

  // 7. Fast-forward pull.
  const mergeRes = await tryGit(cwd, ["merge", "--ff-only", upstream.out]);
  if (!mergeRes.ok) {
    return {
      outcome: "pull-failed",
      branch,
      detail: `Pull failed (not a fast-forward?): ${truncate(mergeRes.err, 120)}`,
    };
  }
  return {
    outcome: "pulled",
    branch,
    pulledCommits: behindBy,
    detail: `Pulled ${behindBy} commit${behindBy === 1 ? "" : "s"} on \`${branch}\`.`,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
