import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * These tests run real git in temp directories. They're hermetic — every
 * test gets its own bare "remote" repo and a fresh clone — so they don't
 * touch the user's gitconfig in a meaningful way (we set `user.email` /
 * `user.name` locally for each repo) and can run in parallel.
 */
describe("git-sync", () => {
  let work: string;

  // Helper: run git in a specific dir and capture output. Throws on failure.
  async function git(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileP("git", args, { cwd, encoding: "utf8" });
    return stdout.trim();
  }

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "git-sync-test-"));
  });

  afterEach(() => {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Create a bare "remote" repo with one initial commit and return its path. */
  async function createRemoteRepo(): Promise<string> {
    const remote = join(work, "remote.git");
    mkdirSync(remote);
    await git(remote, "init", "--bare");

    // Seed with one commit via an independent init+push (we can't clone an
    // empty bare repo with `-b main` because the branch doesn't exist yet).
    const seed = join(work, "seed");
    mkdirSync(seed);
    await git(seed, "init", "--initial-branch=main");
    await git(seed, "config", "user.email", "test@test");
    await git(seed, "config", "user.name", "Test");
    writeFileSync(join(seed, "README.md"), "hello\n", "utf8");
    await git(seed, "add", "README.md");
    await git(seed, "commit", "-m", "initial");
    await git(seed, "remote", "add", "origin", remote);
    await git(seed, "push", "-u", "origin", "main");
    return remote;
  }

  /** Clone the remote into a fresh local working tree, on `main` tracking origin/main. */
  async function cloneRepo(remote: string, name = "clone"): Promise<string> {
    const local = join(work, name);
    await git(work, "clone", "-b", "main", remote, local);
    await git(local, "config", "user.email", "test@test");
    await git(local, "config", "user.name", "Test");
    return local;
  }

  /** Add a commit on `main` in the remote (via a side clone) so our local goes behind. */
  async function addRemoteCommit(remote: string, content = "v2\n"): Promise<void> {
    const side = mkdtempSync(join(work, "side-"));
    await git(work, "clone", "-b", "main", remote, side);
    await git(side, "config", "user.email", "test@test");
    await git(side, "config", "user.name", "Test");
    writeFileSync(join(side, "README.md"), content, "utf8");
    await git(side, "add", "README.md");
    await git(side, "commit", "-m", "remote update");
    await git(side, "push", "origin", "main");
  }

  // ── Outcomes ─────────────────────────────────────────────────────────────

  it("returns not-a-repo for a plain directory", async () => {
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(work);
    expect(r.outcome).toBe("not-a-repo");
    expect(r.detail).toMatch(/Not a git repo/i);
  });

  it("returns not-a-repo for a nonexistent path (no crash)", async () => {
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(join(work, "does-not-exist"));
    expect(r.outcome).toBe("not-a-repo");
  });

  it("returns up-to-date when the local clone is already at upstream", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("up-to-date");
    expect(r.branch).toBe("main");
    expect(r.pulledCommits).toBe(0);
  });

  it("returns pulled with commit count when upstream is ahead", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    await addRemoteCommit(remote, "first remote update\n");
    await addRemoteCommit(remote, "second remote update\n");
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("pulled");
    expect(r.branch).toBe("main");
    expect(r.pulledCommits).toBe(2);
    expect(r.detail).toMatch(/Pulled 2 commits/);
    // After the pull, the README should reflect the latest remote content.
    const readme = await git(local, "show", "HEAD:README.md");
    expect(readme).toMatch(/second remote update/);
  });

  it("uses singular 'commit' in detail when exactly 1 commit was pulled", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    await addRemoteCommit(remote);
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.detail).toMatch(/Pulled 1 commit\b/);
    expect(r.detail).not.toMatch(/Pulled 1 commits/);
  });

  it("returns dirty and does NOT pull when the working tree has uncommitted changes", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    await addRemoteCommit(remote);
    // Make a local change without committing.
    writeFileSync(join(local, "README.md"), "operator's WIP\n", "utf8");
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("dirty");
    // README still has the operator's WIP — pull did not happen.
    const readme = await execFileP("cat", [join(local, "README.md")]);
    expect(readme.stdout.trim()).toBe("operator's WIP");
  });

  it("returns dirty when there's an untracked file (status --porcelain is non-empty)", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    writeFileSync(join(local, "scratch.txt"), "tmp", "utf8");
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("dirty");
  });

  it("returns detached when HEAD is detached", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    // Detach by checking out the commit hash directly.
    const sha = await git(local, "rev-parse", "HEAD");
    await git(local, "checkout", "--detach", sha);
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("detached");
  });

  it("returns no-upstream when the current branch has no tracking branch", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    await git(local, "checkout", "-b", "local-only");
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("no-upstream");
    expect(r.branch).toBe("local-only");
    expect(r.detail).toMatch(/no upstream/i);
  });

  it("returns pull-failed when local has diverged (not a fast-forward)", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    // Remote moves ahead.
    await addRemoteCommit(remote);
    // Local also moves ahead, creating a divergence the FF can't resolve.
    writeFileSync(join(local, "local.txt"), "local-only commit\n", "utf8");
    await git(local, "add", "local.txt");
    await git(local, "commit", "-m", "local commit");
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("pull-failed");
    expect(r.branch).toBe("main");
  });

  it("returns fetch-failed when the remote URL is unreachable", async () => {
    const remote = await createRemoteRepo();
    const local = await cloneRepo(remote);
    // Replace the remote with a bogus URL so fetch fails.
    await git(local, "remote", "set-url", "origin", "file:///nonexistent/repo.git");
    const { syncGitRepoIfSafe } = await import("./git-sync.js");
    const r = await syncGitRepoIfSafe(local);
    expect(r.outcome).toBe("fetch-failed");
    expect(r.detail).toMatch(/[Ff]etch failed/);
  });
});
