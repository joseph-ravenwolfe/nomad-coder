import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSessionVoice,
  setSessionVoice,
  clearSessionVoice,
  getSessionVoiceFor,
  setSessionVoiceForSid,
  pickRotationVoice,
  resetVoiceStateForTest,
} from "./voice-state.js";
import { runInSessionContext } from "./session-context.js";
import * as config from "./config.js";

describe("voice-state", () => {
  beforeEach(() => { resetVoiceStateForTest(); });

  describe("getSessionVoice / setSessionVoice / clearSessionVoice", () => {
    it("returns null initially", () => {
      expect(getSessionVoice()).toBeNull();
    });

    it("sets and gets a voice", () => {
      runInSessionContext(1, () => {
        setSessionVoice("alloy");
        expect(getSessionVoice()).toBe("alloy");
      });
    });

    it("trims whitespace when setting", () => {
      runInSessionContext(1, () => {
        setSessionVoice("  nova  ");
        expect(getSessionVoice()).toBe("nova");
      });
    });

    it("treats empty string as null", () => {
      runInSessionContext(1, () => {
        setSessionVoice("alloy");
        setSessionVoice("");
        expect(getSessionVoice()).toBeNull();
      });
    });

    it("clears the voice", () => {
      runInSessionContext(1, () => {
        setSessionVoice("echo");
        clearSessionVoice();
        expect(getSessionVoice()).toBeNull();
      });
    });
  });

  describe("per-session isolation", () => {
    it("sessions do not share voice state", () => {
      runInSessionContext(1, () => { setSessionVoice("alloy"); });
      runInSessionContext(2, () => { setSessionVoice("nova"); });
      runInSessionContext(1, () => { expect(getSessionVoice()).toBe("alloy"); });
      runInSessionContext(2, () => { expect(getSessionVoice()).toBe("nova"); });
    });

    it("clearing one session does not affect another", () => {
      runInSessionContext(1, () => { setSessionVoice("alloy"); });
      runInSessionContext(2, () => { setSessionVoice("echo"); });
      runInSessionContext(1, () => { clearSessionVoice(); });
      runInSessionContext(1, () => { expect(getSessionVoice()).toBeNull(); });
      runInSessionContext(2, () => { expect(getSessionVoice()).toBe("echo"); });
    });
  });

  describe("getSessionVoiceFor", () => {
    it("returns voice for the given SID", () => {
      runInSessionContext(5, () => { setSessionVoice("fable"); });
      expect(getSessionVoiceFor(5)).toBe("fable");
    });

    it("returns null for unknown SID", () => {
      expect(getSessionVoiceFor(99)).toBeNull();
    });
  });

  describe("setSessionVoiceForSid", () => {
    it("sets voice for the given SID without needing a session context", () => {
      setSessionVoiceForSid(7, "Rachel");
      expect(getSessionVoiceFor(7)).toBe("Rachel");
    });

    it("trims whitespace and treats empty string as null", () => {
      setSessionVoiceForSid(7, "   ");
      expect(getSessionVoiceFor(7)).toBeNull();
    });
  });

  describe("pickRotationVoice", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("returns null when no curated voices are configured", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([]);
      expect(pickRotationVoice("Scout")).toBeNull();
      expect(pickRotationVoice("Anything")).toBeNull();
    });

    it("returns the only voice for every name when one voice is configured", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
        { name: "VOICE_A", description: "Jessica" },
      ]);
      expect(pickRotationVoice("Scout")).toBe("VOICE_A");
      expect(pickRotationVoice("Worker")).toBe("VOICE_A");
      expect(pickRotationVoice("Primary")).toBe("VOICE_A");
    });

    it("hashes deterministically — same name always maps to the same voice", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
        { name: "VID_A" },
        { name: "VID_B" },
        { name: "VID_C" },
      ]);
      // We don't assert exact mappings (FNV-1a output isn't user-meaningful),
      // but the same name must map to the same voice every call.
      const v1 = pickRotationVoice("Scout");
      const v2 = pickRotationVoice("Scout");
      const v3 = pickRotationVoice("Scout");
      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
      // And the result must come from the configured list.
      expect(["VID_A", "VID_B", "VID_C"]).toContain(v1);
    });

    it("normalizes case + whitespace before hashing", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
        { name: "VID_A" },
        { name: "VID_B" },
        { name: "VID_C" },
      ]);
      // "Scout", " scout ", "SCOUT" all hash to the same voice.
      expect(pickRotationVoice("Scout")).toBe(pickRotationVoice(" scout "));
      expect(pickRotationVoice("Scout")).toBe(pickRotationVoice("SCOUT"));
    });

    it("distributes different names across the configured pool", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
        { name: "VID_A" },
        { name: "VID_B" },
        { name: "VID_C" },
      ]);
      // Across many distinct names we expect to see at least 2 distinct voices —
      // FNV-1a is not perfectly uniform on tiny inputs, but across 26 names it
      // should hit more than one bucket.
      const seen = new Set<string | null>();
      const names = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      for (const n of names) seen.add(pickRotationVoice(n));
      expect(seen.size).toBeGreaterThanOrEqual(2);
    });
  });
});
