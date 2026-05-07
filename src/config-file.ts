/**
 * Canonical configuration file for Nomad Coder.
 *
 * Stored at `$XDG_CONFIG_HOME/nomad-coder/config.json` (default:
 * `~/.config/nomad-coder/config.json`). XDG conventions match our existing
 * cache path under `~/.cache/nomad-coder/`, so a single rule answers "where
 * does this app keep state?" — under `~/.{config,cache}/nomad-coder/`.
 *
 * Precedence at startup, highest first:
 *   1. `process.env` set by launchd plist or shell — always wins.
 *   2. Values from `config.json` loaded by `loadCanonicalConfig()` — populates
 *      `process.env` for unset keys.
 *   3. Values from `.env` loaded by dotenv — populates still-unset keys.
 *
 * `loadCanonicalConfig()` runs at the very top of `src/index.ts`, before the
 * manual `dotenv.config()` call, so canonical settings beat `.env`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface NomadCoderConfig {
  telegram?: {
    bot_token?: string;
    allowed_user_id?: number | string;
    chat_id?: number | string;
  };
  elevenlabs?: {
    api_key?: string;
    voice_id?: string;
    model_id?: string;
    default_speed?: number;
  };
  behavior?: {
    auto_approve_agents?: boolean | string | number;
    cc_launch_script?: string;
  };
}

/** Tuple of (env var name, dotted JSON path) for each canonical config key. */
const KEY_MAP: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["BOT_TOKEN", ["telegram", "bot_token"]],
  ["ALLOWED_USER_ID", ["telegram", "allowed_user_id"]],
  ["CHAT_ID", ["telegram", "chat_id"]],
  ["ELEVENLABS_API_KEY", ["elevenlabs", "api_key"]],
  ["ELEVENLABS_VOICE_ID", ["elevenlabs", "voice_id"]],
  ["ELEVENLABS_MODEL_ID", ["elevenlabs", "model_id"]],
  ["ELEVENLABS_DEFAULT_SPEED", ["elevenlabs", "default_speed"]],
  ["AUTO_APPROVE_AGENTS", ["behavior", "auto_approve_agents"]],
  ["CC_LAUNCH_SCRIPT", ["behavior", "cc_launch_script"]],
];

/** Returns the canonical config path, respecting `XDG_CONFIG_HOME`. */
export function getCanonicalConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "nomad-coder", "config.json");
}

function readConfigFile(path: string): NomadCoderConfig | undefined {
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(`[nomad-coder] config.json read failed at ${path}: ${String(err)}\n`);
    return undefined;
  }
  try {
    return JSON.parse(raw) as NomadCoderConfig;
  } catch {
    process.stderr.write(`[nomad-coder] config.json at ${path} is malformed JSON — skipping\n`);
    return undefined;
  }
}

function pluck(config: NomadCoderConfig, jsonPath: readonly string[]): unknown {
  let val: unknown = config;
  for (const seg of jsonPath) {
    if (val === undefined || val === null || typeof val !== "object") return undefined;
    val = (val as Record<string, unknown>)[seg];
  }
  return val;
}

/**
 * Reads the canonical config file and populates `process.env` for any keys
 * that aren't already set. Existing `process.env` values (from launchd plist
 * or shell) are never overwritten.
 *
 * Returns the parsed config (or `{}` if no file), the path inspected, and
 * the env keys that were applied. Useful for startup diagnostics.
 */
export function loadCanonicalConfig(): { config: NomadCoderConfig; path: string; appliedKeys: string[] } {
  const path = getCanonicalConfigPath();
  const config = readConfigFile(path) ?? {};
  const appliedKeys: string[] = [];

  for (const [envKey, jsonPath] of KEY_MAP) {
    if (process.env[envKey] !== undefined) continue;
    const val = pluck(config, jsonPath);
    if (val !== undefined && val !== null) {
      process.env[envKey] = String(val);
      appliedKeys.push(envKey);
    }
  }

  return { config, path, appliedKeys };
}

/**
 * Merges `partial` into the existing config file (or creates it) and writes
 * the result to the canonical path. File mode is 0o600 — bot token lives
 * here. Returns the path written and the merged result.
 *
 * Caller can pass `opts.path` to write to a different location (used by
 * tests).
 */
export function writeCanonicalConfig(
  partial: NomadCoderConfig,
  opts?: { path?: string },
): { path: string; merged: NomadCoderConfig } {
  const path = opts?.path ?? getCanonicalConfigPath();
  const existing = readConfigFile(path) ?? {};
  const merged: NomadCoderConfig = {};

  const tg = { ...existing.telegram, ...partial.telegram };
  if (Object.keys(tg).length > 0) merged.telegram = tg;

  const el = { ...existing.elevenlabs, ...partial.elevenlabs };
  if (Object.keys(el).length > 0) merged.elevenlabs = el;

  const bh = { ...existing.behavior, ...partial.behavior };
  if (Object.keys(bh).length > 0) merged.behavior = bh;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  return { path, merged };
}
