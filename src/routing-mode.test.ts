import { describe, it, expect, beforeEach } from "vitest";
import {
  getRoutingMode,
  setRoutingMode,
  getGovernorSid,
  resetRoutingModeForTest,
} from "./routing-mode.js";

describe("routing-mode", () => {
  beforeEach(() => {
    resetRoutingModeForTest();
  });

  it("defaults to load_balance", () => {
    expect(getRoutingMode()).toBe("load_balance");
  });

  it("sets and gets routing mode", () => {
    setRoutingMode("cascade");
    expect(getRoutingMode()).toBe("cascade");
  });

  it("tracks governor SID when in governor mode", () => {
    setRoutingMode("governor", 3);
    expect(getRoutingMode()).toBe("governor");
    expect(getGovernorSid()).toBe(3);
  });

  it("clears governor SID when switching away from governor", () => {
    setRoutingMode("governor", 3);
    setRoutingMode("load_balance");
    expect(getGovernorSid()).toBe(0);
  });

  it("ignores governor SID for non-governor modes", () => {
    setRoutingMode("cascade", 5);
    expect(getGovernorSid()).toBe(0);
  });

  it("resets to defaults", () => {
    setRoutingMode("governor", 2);
    resetRoutingModeForTest();
    expect(getRoutingMode()).toBe("load_balance");
    expect(getGovernorSid()).toBe(0);
  });
});
