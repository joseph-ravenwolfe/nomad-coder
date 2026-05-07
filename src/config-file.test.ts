import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCanonicalConfigPath,
  loadCanonicalConfig,
  writeCanonicalConfig,
} from "./config-file.js";

describe("config-file", () => {
  const PRESERVED_ENV_KEYS = [
    "BOT_TOKEN",
    "ALLOWED_USER_ID",
    "CHAT_ID",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "ELEVENLABS_MODEL_ID",
    "ELEVENLABS_DEFAULT_SPEED",
    "AUTO_APPROVE_AGENTS",
    "CC_LAUNCH_SCRIPT",
    "XDG_CONFIG_HOME",
  ];

  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nomad-config-test-"));
    savedEnv = {};
    for (const k of PRESERVED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    // Point the canonical loader at our tmp dir.
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    for (const k of PRESERVED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  describe("getCanonicalConfigPath", () => {
    it("uses XDG_CONFIG_HOME when set", () => {
      expect(getCanonicalConfigPath()).toBe(join(tmpDir, "nomad-coder", "config.json"));
    });

    it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
      delete process.env.XDG_CONFIG_HOME;
      const path = getCanonicalConfigPath();
      expect(path).toMatch(/\.config\/nomad-coder\/config\.json$/);
    });

    it("treats empty XDG_CONFIG_HOME as unset", () => {
      process.env.XDG_CONFIG_HOME = "";
      const path = getCanonicalConfigPath();
      expect(path).toMatch(/\.config\/nomad-coder\/config\.json$/);
    });
  });

  describe("loadCanonicalConfig — file absent", () => {
    it("returns empty config and applies nothing when file does not exist", () => {
      const result = loadCanonicalConfig();
      expect(result.config).toEqual({});
      expect(result.appliedKeys).toEqual([]);
      expect(result.path).toBe(join(tmpDir, "nomad-coder", "config.json"));
    });
  });

  describe("loadCanonicalConfig — file present", () => {
    function writeRaw(content: string): void {
      const dir = join(tmpDir, "nomad-coder");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "config.json"), content);
    }

    it("populates process.env from telegram, elevenlabs, and behavior sections", () => {
      writeRaw(JSON.stringify({
        telegram: { bot_token: "tok", allowed_user_id: 123, chat_id: 456 },
        elevenlabs: { api_key: "sk_x", voice_id: "Vid", model_id: "eleven_multilingual_v2", default_speed: 1.2 },
        behavior: { auto_approve_agents: true, cc_launch_script: "/usr/local/bin/launcher.sh" },
      }));
      const result = loadCanonicalConfig();
      expect(process.env.BOT_TOKEN).toBe("tok");
      expect(process.env.ALLOWED_USER_ID).toBe("123");
      expect(process.env.CHAT_ID).toBe("456");
      expect(process.env.ELEVENLABS_API_KEY).toBe("sk_x");
      expect(process.env.ELEVENLABS_VOICE_ID).toBe("Vid");
      expect(process.env.ELEVENLABS_MODEL_ID).toBe("eleven_multilingual_v2");
      expect(process.env.ELEVENLABS_DEFAULT_SPEED).toBe("1.2");
      expect(process.env.AUTO_APPROVE_AGENTS).toBe("true");
      expect(process.env.CC_LAUNCH_SCRIPT).toBe("/usr/local/bin/launcher.sh");
      expect(result.appliedKeys.sort()).toEqual([
        "ALLOWED_USER_ID",
        "AUTO_APPROVE_AGENTS",
        "BOT_TOKEN",
        "CC_LAUNCH_SCRIPT",
        "CHAT_ID",
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_DEFAULT_SPEED",
        "ELEVENLABS_MODEL_ID",
        "ELEVENLABS_VOICE_ID",
      ]);
    });

    it("does NOT overwrite existing process.env values", () => {
      writeRaw(JSON.stringify({ telegram: { bot_token: "from-config" } }));
      process.env.BOT_TOKEN = "from-shell";
      const result = loadCanonicalConfig();
      expect(process.env.BOT_TOKEN).toBe("from-shell");
      expect(result.appliedKeys).not.toContain("BOT_TOKEN");
    });

    it("populates only keys that have values in config.json", () => {
      writeRaw(JSON.stringify({ telegram: { bot_token: "tok" } }));
      const result = loadCanonicalConfig();
      expect(process.env.BOT_TOKEN).toBe("tok");
      expect(process.env.ALLOWED_USER_ID).toBeUndefined();
      expect(result.appliedKeys).toEqual(["BOT_TOKEN"]);
    });

    it("survives malformed JSON gracefully (logs and returns empty)", () => {
      writeRaw("{ this is not json");
      const result = loadCanonicalConfig();
      expect(result.config).toEqual({});
      expect(result.appliedKeys).toEqual([]);
      expect(process.env.BOT_TOKEN).toBeUndefined();
    });

    it("ignores non-object values at expected paths", () => {
      writeRaw(JSON.stringify({ telegram: "not an object" }));
      const result = loadCanonicalConfig();
      expect(result.appliedKeys).toEqual([]);
    });

    it("treats null leaf values as absent", () => {
      writeRaw(JSON.stringify({ telegram: { bot_token: null } }));
      const result = loadCanonicalConfig();
      expect(result.appliedKeys).toEqual([]);
      expect(process.env.BOT_TOKEN).toBeUndefined();
    });
  });

  describe("writeCanonicalConfig", () => {
    it("creates the file when none exists", () => {
      const path = join(tmpDir, "nomad-coder", "config.json");
      const { merged } = writeCanonicalConfig({ telegram: { bot_token: "new-tok" } }, { path });
      const onDisk = JSON.parse(readFileSync(path, "utf8")) as { telegram?: { bot_token?: string } };
      expect(onDisk.telegram?.bot_token).toBe("new-tok");
      expect(merged.telegram?.bot_token).toBe("new-tok");
    });

    it("merges into existing file rather than clobbering", () => {
      const path = join(tmpDir, "nomad-coder", "config.json");
      writeCanonicalConfig({
        telegram: { bot_token: "tok", allowed_user_id: 1 },
        elevenlabs: { api_key: "old-key" },
      }, { path });
      writeCanonicalConfig({
        telegram: { bot_token: "tok2" },  // overwrites
        behavior: { auto_approve_agents: true },  // adds
      }, { path });

      const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown>>;
      expect(onDisk.telegram?.bot_token).toBe("tok2");
      expect(onDisk.telegram?.allowed_user_id).toBe(1);
      expect(onDisk.elevenlabs?.api_key).toBe("old-key");
      expect(onDisk.behavior?.auto_approve_agents).toBe(true);
    });

    it("writes file with mode 0o600 (secrets-only)", () => {
      const path = join(tmpDir, "nomad-coder", "config.json");
      writeCanonicalConfig({ telegram: { bot_token: "secret" } }, { path });
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("creates parent directory when missing", () => {
      const deepPath = join(tmpDir, "a", "b", "c", "config.json");
      writeCanonicalConfig({ telegram: { bot_token: "x" } }, { path: deepPath });
      expect(readFileSync(deepPath, "utf8")).toContain("\"x\"");
    });

    it("strips empty sections rather than emitting empty objects", () => {
      const path = join(tmpDir, "nomad-coder", "config.json");
      writeCanonicalConfig({ telegram: { bot_token: "tok" } }, { path });
      const raw = readFileSync(path, "utf8");
      expect(raw).not.toContain('"elevenlabs"');
      expect(raw).not.toContain('"behavior"');
    });
  });

  describe("end-to-end: write then load", () => {
    it("written config round-trips into process.env on next load", () => {
      const path = join(tmpDir, "nomad-coder", "config.json");
      writeCanonicalConfig({
        telegram: { bot_token: "round-trip-tok" },
        behavior: { auto_approve_agents: true },
      }, { path });
      const result = loadCanonicalConfig();
      expect(process.env.BOT_TOKEN).toBe("round-trip-tok");
      expect(process.env.AUTO_APPROVE_AGENTS).toBe("true");
      expect(result.appliedKeys.sort()).toEqual(["AUTO_APPROVE_AGENTS", "BOT_TOKEN"]);
    });
  });
});
