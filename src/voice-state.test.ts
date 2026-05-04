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
      expect(pickRotationVoice(1)).toBeNull();
      expect(pickRotationVoice(99)).toBeNull();
    });

    it("returns the only voice for every sid when one voice is configured", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
        { name: "VOICE_A", description: "Jessica" },
      ]);
      expect(pickRotationVoice(1)).toBe("VOICE_A");
      expect(pickRotationVoice(2)).toBe("VOICE_A");
      expect(pickRotationVoice(42)).toBe("VOICE_A");
    });

    it("rotates deterministically across multiple voices keyed by sid", () => {
      vi.spyOn(config, "getConfiguredVoices").mockReturnValue([
        { name: "VID_A" },
        { name: "VID_B" },
        { name: "VID_C" },
      ]);
      // sid=1 → idx 0; sid=2 → idx 1; sid=3 → idx 2; sid=4 → idx 0 (wraps)
      expect(pickRotationVoice(1)).toBe("VID_A");
      expect(pickRotationVoice(2)).toBe("VID_B");
      expect(pickRotationVoice(3)).toBe("VID_C");
      expect(pickRotationVoice(4)).toBe("VID_A");
      expect(pickRotationVoice(5)).toBe("VID_B");
    });
  });
});
