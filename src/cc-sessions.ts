/**
 * Enumerates Claude Code sessions on disk for the `/cc` Telegram command's
 * "Resume" picker.
 *
 * Data sources (all read-only, best-effort):
 *
 *   ~/.claude/sessions/<pid>.json       — Live session metadata. One JSON
 *                                         object per file: pid, sessionId,
 *                                         cwd, name, status, updatedAt, kind.
 *                                         Used for liveness + display name.
 *
 *   ~/.claude/projects/<hash>/<sid>.jsonl
 *                                       — Transcript history (one JSON
 *                                         object per line). Source of truth
 *                                         for "what sessions exist at all".
 *                                         We sample the first ~32 lines to
 *                                         extract cwd, gitBranch, and the
 *                                         first user prompt for the label.
 *
 * The `<hash>` is the cwd path with `/` replaced by `-` (e.g.
 * `/Users/foo/proj` → `-Users-foo-proj`). The reverse decode is lossy when
 * a real directory contains a dash — we don't trust it, and prefer the
 * `cwd` field from inside each transcript entry instead.
 *
 * The Claude Code config dir may be relocated via `CLAUDE_CONFIG_DIR`; we
 * honour that env var.
 *
 * No officially supported API exists for this — the on-disk format is an
 * implementation detail. We tolerate missing fields and parse errors
 * gracefully so a schema change doesn't crash the bridge.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { join } from "node:path";

/** A session that could be passed to `claude --resume <sessionId>`. */
export interface ResumableSession {
  /** UUID. The only stable key — `pid` is not unique across reboots. */
  sessionId: string;
  /** Where the session was last working (from transcript, then metadata). */
  cwd: string;
  /** Git branch at last activity, if recorded. */
  gitBranch: string;
  /** Approximate message count (raw line count of the JSONL). */
  lines: number;
  /** mtime of the transcript file (ms since epoch). */
  mtimeMs: number;
  /** Operator-set name (e.g. `Groundspark Logo Generation`) if any. */
  name: string;
  /** Last known status field from live metadata: busy/waiting/etc. Empty if no live metadata. */
  status: string;
  /** Live PID from metadata (0 if no metadata file matches sessionId). */
  pid: number;
  /** Whether the PID is currently alive on this machine. */
  pidAlive: boolean;
  /** kind from live metadata: interactive | sdk-ts | sdk-node | …. Empty if no live metadata. */
  kind: string;
  /** First user-typed prompt as a one-line display snippet (best-effort). */
  firstPrompt: string;
}

interface LiveMeta {
  pid: number;
  sessionId: string;
  cwd?: string;
  name?: string;
  status?: string;
  updatedAt?: number;
  kind?: string;
}

/** Where Claude Code stores per-machine state. Honours `CLAUDE_CONFIG_DIR`. */
function getClaudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim().length > 0) return override.trim();
  return join(homedir(), ".claude");
}

/** Returns whether the given PID is currently a running process on this machine. */
function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    // Signal 0 = no-op; throws ESRCH if process is gone, EPERM if alive-but-foreign.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Read the live-session metadata files. Bad/unreadable files are skipped. */
function readLiveMetadata(configDir: string): Map<string, LiveMeta> {
  const out = new Map<string, LiveMeta>();
  const sessDir = join(configDir, "sessions");
  if (!existsSync(sessDir)) return out;
  let entries: string[];
  try {
    entries = readdirSync(sessDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const file = join(sessDir, name);
    try {
      const raw = readFileSync(file, "utf8");
      const obj = JSON.parse(raw) as Partial<LiveMeta>;
      if (typeof obj.sessionId === "string" && obj.sessionId.length > 0) {
        out.set(obj.sessionId, {
          pid: typeof obj.pid === "number" ? obj.pid : 0,
          sessionId: obj.sessionId,
          cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
          name: typeof obj.name === "string" ? obj.name : undefined,
          status: typeof obj.status === "string" ? obj.status : undefined,
          updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : undefined,
          kind: typeof obj.kind === "string" ? obj.kind : undefined,
        });
      }
    } catch {
      // ignore parse / IO errors
    }
  }
  return out;
}

/**
 * Strip noisy preambles from a first-user prompt so the button label is
 * meaningful. Removes `<system-reminder>` and `<local-command-caveat>`
 * blocks, common BOOTSTRAP banners, and command markup wrappers.
 *
 * Returns a single-line string, collapsed whitespace, trimmed.
 */
function cleanPromptForLabel(raw: string): string {
  let s = raw;
  // Drop XML-ish wrapper blocks the harness injects.
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");
  s = s.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, " ");
  s = s.replace(/<command-name>[\s\S]*?<\/command-name>/g, " ");
  s = s.replace(/<command-message>[\s\S]*?<\/command-message>/g, " ");
  s = s.replace(/<command-args>[\s\S]*?<\/command-args>/g, " ");
  // Drop common bootstrap banners — repeated session-start chrome.
  s = s.replace(/(?:NOMAD CODER|TELEGRAM) BOOTSTRAP[\s\S]*?\.(?:\s|$)/gi, " ");
  s = s.replace(/Run your SessionStart bootstrap directive\.?[^\n]*/g, " ");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Sample the first N lines of a transcript to extract cwd, branch, and the
 * first textual user prompt. We do NOT read the whole file — large
 * transcripts can be MBs and we only need header signals. Line count is
 * counted separately on-demand (streaming, cheap).
 */
async function sampleTranscriptHeader(
  file: string,
  maxLines = 32,
): Promise<{ cwd: string; gitBranch: string; firstPrompt: string }> {
  let cwd = "";
  let gitBranch = "";
  let firstPrompt = "";
  let seen = 0;

  return await new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      seen++;
      if (seen > maxLines && cwd && firstPrompt) {
        rl.close();
        return;
      }
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (!cwd && typeof obj.cwd === "string") cwd = obj.cwd;
        if (!gitBranch && typeof obj.gitBranch === "string") gitBranch = obj.gitBranch;
        if (!firstPrompt && obj.type === "user") {
          const msg = obj.message as { content?: unknown } | undefined;
          const content = msg?.content;
          if (typeof content === "string" && content.trim().length > 0) {
            firstPrompt = cleanPromptForLabel(content);
          }
        }
      } catch {
        // ignore unparsable line
      }
      if (seen >= maxLines) rl.close();
    });
    rl.on("close", () => { resolve({ cwd, gitBranch, firstPrompt }); });
    rl.on("error", () => { resolve({ cwd, gitBranch, firstPrompt }); });
  });
}

/** Cheap line counter (byte-level newline count, streaming). */
async function countLines(file: string): Promise<number> {
  return await new Promise((resolve) => {
    let n = 0;
    const stream = createReadStream(file);
    stream.on("data", (chunk: Buffer | string) => {
      if (typeof chunk === "string") {
        for (let i = 0; i < chunk.length; i++) if (chunk.charCodeAt(i) === 10) n++;
      } else {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) n++;
      }
    });
    stream.on("end", () => { resolve(n); });
    stream.on("error", () => { resolve(n); });
  });
}

/** Reverse the `/` → `-` project-hash encoding. Lossy for dirs containing dashes. */
function decodeProjectHash(hash: string): string {
  // Hashes start with `-` (since cwd is absolute). Replace all `-` with `/`.
  return hash.replace(/-/g, "/");
}

export interface ListResumableOptions {
  /**
   * If set, exclude sessions matching the given sessionId (typically the
   * caller's own session, since Claude Code refuses to resume the active
   * one).
   */
  excludeSessionId?: string;
  /**
   * If set, only return sessions whose `kind` is this value (typically
   * "interactive"). When omitted, returns all kinds.
   */
  onlyKind?: string;
  /**
   * If set, only return sessions whose `cwd` matches this directory.
   */
  cwd?: string;
}

/**
 * Returns all on-disk sessions, sorted by transcript mtime descending
 * (most-recently-active first).
 *
 * Implementation note: this reads every transcript header in the projects
 * dir, which is N file opens (one per session). On a developer machine
 * with hundreds of historical sessions this completes in well under 100ms
 * — the headers are small and the OS caches them. We accept this cost
 * to avoid relying on the live-metadata files alone, which only cover
 * sessions for which a Claude Code CLI is (or recently was) running.
 */
export async function listResumableSessions(
  opts: ListResumableOptions = {},
): Promise<ResumableSession[]> {
  const configDir = getClaudeConfigDir();
  const projDir = join(configDir, "projects");
  if (!existsSync(projDir)) return [];

  const live = readLiveMetadata(configDir);

  const rows: ResumableSession[] = [];

  let projectEntries: string[];
  try {
    projectEntries = readdirSync(projDir);
  } catch {
    return [];
  }

  for (const proj of projectEntries) {
    const projPath = join(projDir, proj);
    let isDir = false;
    try {
      isDir = statSync(projPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    let files: string[];
    try {
      files = readdirSync(projPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const sessionId = f.slice(0, -".jsonl".length);
      if (opts.excludeSessionId && sessionId === opts.excludeSessionId) continue;
      const jsonl = join(projPath, f);
      let st;
      try {
        st = statSync(jsonl);
      } catch {
        continue;
      }
      const meta = live.get(sessionId);
      if (opts.onlyKind && meta && meta.kind && meta.kind !== opts.onlyKind) continue;

      const [{ cwd, gitBranch, firstPrompt }, lines] = await Promise.all([
        sampleTranscriptHeader(jsonl),
        countLines(jsonl),
      ]);
      const effectiveCwd = cwd || meta?.cwd || decodeProjectHash(proj);
      if (opts.cwd && effectiveCwd !== opts.cwd) continue;

      rows.push({
        sessionId,
        cwd: effectiveCwd,
        gitBranch,
        lines,
        mtimeMs: st.mtimeMs,
        name: meta?.name ?? "",
        status: meta?.status ?? "",
        pid: meta?.pid ?? 0,
        pidAlive: meta ? isPidAlive(meta.pid) : false,
        kind: meta?.kind ?? "",
        firstPrompt,
      });
    }
  }

  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows;
}

/**
 * Returns unique cwds across all known sessions, ordered by most-recent
 * activity (the cwd's most recent transcript wins). Useful for the `/cc`
 * launch panel to surface project directories beyond the `recent-paths`
 * store (which only tracks paths the operator has already launched via
 * `/cc` itself).
 *
 * Cwds known not to exist on disk anymore are filtered out — a stale
 * transcript for a directory the operator deleted shouldn't pollute the
 * picker. The check is best-effort: a missing-perms error doesn't filter.
 */
export async function listUniqueCwds(limit = 20): Promise<string[]> {
  const all = await listResumableSessions();
  const firstSeen = new Map<string, number>();
  for (const r of all) {
    if (!r.cwd) continue;
    const prev = firstSeen.get(r.cwd);
    if (prev === undefined || r.mtimeMs > prev) {
      firstSeen.set(r.cwd, r.mtimeMs);
    }
  }
  const sorted = [...firstSeen.entries()]
    .filter(([cwd]) => {
      try {
        return statSync(cwd).isDirectory();
      } catch (err) {
        // Only filter on ENOENT (path doesn't exist). For anything else
        // (EACCES, etc.) keep the entry — better a possibly-stale option
        // than an empty list.
        return (err as NodeJS.ErrnoException).code !== "ENOENT";
      }
    })
    .sort((a, b) => b[1] - a[1])
    .map(([cwd]) => cwd);
  return sorted.slice(0, limit);
}

/** Internal — exposed for tests so we can stub the config dir. */
export const _internals = {
  getClaudeConfigDir,
  cleanPromptForLabel,
  decodeProjectHash,
};
