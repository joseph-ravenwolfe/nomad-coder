import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  activateAutoApproveOne,
  activateAutoApproveTimed,
  cancelAutoApprove,
  checkAndConsumeAutoApprove,
  getAutoApproveState,
  isPersistentAutoApproveEnabled,
} from "./auto-approve.js";

describe("auto-approve", () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    // Reset state before each test
    cancelAutoApprove();
    vi.useFakeTimers();
    prevEnv = process.env.AUTO_APPROVE_AGENTS;
    delete process.env.AUTO_APPROVE_AGENTS;
  });

  afterEach(() => {
    cancelAutoApprove();
    vi.useRealTimers();
    if (prevEnv === undefined) delete process.env.AUTO_APPROVE_AGENTS;
    else process.env.AUTO_APPROVE_AGENTS = prevEnv;
  });

  describe("initial state", () => {
    it("starts with mode none", () => {
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("checkAndConsumeAutoApprove returns false when mode is none", () => {
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });
  });

  describe("activateAutoApproveOne", () => {
    it("sets mode to one", () => {
      activateAutoApproveOne();
      expect(getAutoApproveState().mode).toBe("one");
    });

    it("checkAndConsumeAutoApprove returns true on first call", () => {
      activateAutoApproveOne();
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("consumes the token — second call returns false", () => {
      activateAutoApproveOne();
      checkAndConsumeAutoApprove(); // consume
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });

    it("mode resets to none after consumption", () => {
      activateAutoApproveOne();
      checkAndConsumeAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });
  });

  describe("activateAutoApproveTimed", () => {
    it("sets mode to timed", () => {
      activateAutoApproveTimed(60_000);
      expect(getAutoApproveState().mode).toBe("timed");
    });

    it("sets expiresAt in the future", () => {
      const before = Date.now();
      activateAutoApproveTimed(60_000);
      const state = getAutoApproveState();
      expect(state.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    });

    it("checkAndConsumeAutoApprove returns true during window", () => {
      activateAutoApproveTimed(60_000);
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("does not consume token — multiple calls return true during window", () => {
      activateAutoApproveTimed(60_000);
      expect(checkAndConsumeAutoApprove()).toBe(true);
      expect(checkAndConsumeAutoApprove()).toBe(true);
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("returns false after expiry via timer", () => {
      activateAutoApproveTimed(5_000);
      expect(checkAndConsumeAutoApprove()).toBe(true);

      vi.advanceTimersByTime(5_001);

      expect(getAutoApproveState().mode).toBe("none");
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });

    it("returns false when checked after expiry time (expiresAt guard)", () => {
      activateAutoApproveTimed(1_000);
      // advance time past expiry without firing timer
      vi.setSystemTime(Date.now() + 2_000);
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });
  });

  describe("cancelAutoApprove", () => {
    it("resets mode to none from one", () => {
      activateAutoApproveOne();
      cancelAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("resets mode to none from timed", () => {
      activateAutoApproveTimed(60_000);
      cancelAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("clears the timed timer so it does not fire later", () => {
      activateAutoApproveTimed(5_000);
      cancelAutoApprove();
      // If timer was not cleared, advancing past expiry would be a no-op on
      // already-reset state — but we confirm state stays none after time passes
      vi.advanceTimersByTime(10_000);
      expect(getAutoApproveState().mode).toBe("none");
    });

    it("is idempotent — calling cancel when already none is safe", () => {
      cancelAutoApprove();
      cancelAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });
  });

  describe("activateAutoApproveOne while timed is active", () => {
    it("cancels the timed timer and switches to one", () => {
      activateAutoApproveTimed(60_000);
      expect(getAutoApproveState().mode).toBe("timed");

      activateAutoApproveOne();
      expect(getAutoApproveState().mode).toBe("one");

      // Confirm timed timer was cleared — advancing time should not reset to none
      vi.advanceTimersByTime(70_000);
      // state is "one" until consumed (timer was cancelled, not fired again)
      // The state may have changed to none if activateAutoApproveOne's cancel
      // properly cleaned up. It should remain "one" since no new timer was set.
      expect(getAutoApproveState().mode).toBe("one");
    });

    it("consuming the one token leaves mode none, not timed", () => {
      activateAutoApproveTimed(60_000);
      activateAutoApproveOne();
      checkAndConsumeAutoApprove();
      expect(getAutoApproveState().mode).toBe("none");
    });
  });

  describe("getAutoApproveState", () => {
    it("reflects none initially", () => {
      expect(getAutoApproveState()).toEqual({ mode: "none" });
    });

    it("reflects one after activateAutoApproveOne", () => {
      activateAutoApproveOne();
      expect(getAutoApproveState()).toEqual({ mode: "one" });
    });

    it("reflects timed with expiresAt after activateAutoApproveTimed", () => {
      const now = Date.now();
      activateAutoApproveTimed(30_000);
      const state = getAutoApproveState();
      expect(state.mode).toBe("timed");
      expect(state.expiresAt).toBeGreaterThanOrEqual(now + 30_000);
    });
  });

  describe("AUTO_APPROVE_AGENTS env override", () => {
    it("isPersistentAutoApproveEnabled returns false when env is unset", () => {
      delete process.env.AUTO_APPROVE_AGENTS;
      expect(isPersistentAutoApproveEnabled()).toBe(false);
    });

    it.each([["1"], ["true"], ["TRUE"], ["yes"], ["on"], ["  true  "]])(
      "isPersistentAutoApproveEnabled returns true for %j",
      (value) => {
        process.env.AUTO_APPROVE_AGENTS = value;
        expect(isPersistentAutoApproveEnabled()).toBe(true);
      },
    );

    it.each([["0"], ["false"], ["no"], ["off"], [""], ["  "]])(
      "isPersistentAutoApproveEnabled returns false for %j",
      (value) => {
        process.env.AUTO_APPROVE_AGENTS = value;
        expect(isPersistentAutoApproveEnabled()).toBe(false);
      },
    );

    it("checkAndConsumeAutoApprove returns true when env is set, even with mode none", () => {
      process.env.AUTO_APPROVE_AGENTS = "1";
      expect(getAutoApproveState().mode).toBe("none");
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });

    it("env override does NOT consume the per-request 'one' token", () => {
      process.env.AUTO_APPROVE_AGENTS = "1";
      activateAutoApproveOne();
      expect(getAutoApproveState().mode).toBe("one");
      expect(checkAndConsumeAutoApprove()).toBe(true);
      // 'one' token should still be intact since the env override took
      // precedence — operator can disable env later and the token survives.
      expect(getAutoApproveState().mode).toBe("one");
    });

    it("env override is read fresh each call (config can be flipped at runtime)", () => {
      delete process.env.AUTO_APPROVE_AGENTS;
      expect(checkAndConsumeAutoApprove()).toBe(false);
      process.env.AUTO_APPROVE_AGENTS = "true";
      expect(checkAndConsumeAutoApprove()).toBe(true);
      delete process.env.AUTO_APPROVE_AGENTS;
      expect(checkAndConsumeAutoApprove()).toBe(false);
    });

    it("env override survives expiry of a previously-active timed window", () => {
      process.env.AUTO_APPROVE_AGENTS = "1";
      activateAutoApproveTimed(1_000);
      vi.setSystemTime(Date.now() + 2_000);
      // Timed window has expired, but env override keeps approving.
      expect(checkAndConsumeAutoApprove()).toBe(true);
    });
  });
});
