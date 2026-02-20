import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendChatAction: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "99" };
});

import { register } from "./start_typing.js";

describe("start_typing tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("start_typing");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns started:true and fires sendChatAction immediately", async () => {
    mocks.sendChatAction.mockResolvedValue({});
    const result = await call({ timeout_seconds: 10 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.started).toBe(true);
    expect(data.timeout_seconds).toBe(10);
    expect(mocks.sendChatAction).toHaveBeenCalledWith("99", "typing");
  });

  it("re-sends typing after 4 seconds", async () => {
    mocks.sendChatAction.mockResolvedValue({});
    await call({ timeout_seconds: 30 });
    expect(mocks.sendChatAction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.sendChatAction).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.sendChatAction).toHaveBeenCalledTimes(3);
  });

  it("stops sending after timeout expires", async () => {
    mocks.sendChatAction.mockResolvedValue({});
    await call({ timeout_seconds: 8 });
    await vi.advanceTimersByTimeAsync(12000);
    // Should have fired: t=0, t=4, t=8 — then stopped
    expect(mocks.sendChatAction.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
