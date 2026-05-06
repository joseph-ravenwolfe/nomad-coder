/**
 * Persistent list of recent project paths used by `/cc` to populate the
 * launch panel's quick-pick keyboard.
 *
 * Storage: `~/.cache/nomad-coder/recent-paths.json` (JSON array of
 * strings). Best-effort I/O — read/write failures degrade silently to "no
 * recents", and the operator can always type a path manually.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_RECENT = 10;

function getStorePath(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "nomad-coder", "recent-paths.json");
}

function readStore(): string[] {
  const path = getStorePath();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // ENOENT / parse errors → empty list.
    return [];
  }
}

function writeStore(paths: string[]): void {
  const file = getStorePath();
  try {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(paths, null, 2), "utf8");
  } catch (err) {
    process.stderr.write(
      `[recent-paths] write failed file=${file} err=${(err as Error).message}\n`,
    );
  }
}

/**
 * Returns the recent paths in MRU order (most-recently-used first), capped
 * at the storage limit (10).
 */
export function getRecentPaths(): string[] {
  return readStore().slice(0, MAX_RECENT);
}

/**
 * Records `path` as the most-recently-used. De-dupes case-sensitively (paths
 * are case-sensitive on macOS by default). Caps the list at 10 — older
 * entries fall off the end.
 *
 * No-op on empty / whitespace-only inputs.
 */
export function addRecentPath(path: string): void {
  const trimmed = path.trim();
  if (trimmed.length === 0) return;
  const current = readStore();
  const filtered = current.filter((p) => p !== trimmed);
  const next = [trimmed, ...filtered].slice(0, MAX_RECENT);
  writeStore(next);
}

/** For tests: clear the on-disk store. */
export function _resetRecentPathsForTest(): void {
  writeStore([]);
}
