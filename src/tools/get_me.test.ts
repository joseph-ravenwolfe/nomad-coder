import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getMe: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

vi.mock("module", async (importActual) => {
  const actual = await importActual<typeof import("module")>();
  return {
    ...actual,
    createRequire: () => (_path: string) => ({ version: "0.0.0-test" }),
  };
});

import { register } from "./get_me.js";

describe("get_me tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("get_me");
  });

  it("returns bot info with mcp_version", async () => {
    const bot = { id: 1, is_bot: true, first_name: "Bot", username: "test_bot" };
    mocks.getMe.mockResolvedValue(bot);
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toEqual({ mcp_version: "0.0.0-test", ...bot });
  });

  it("returns error on API failure", async () => {
    const { GrammyError } = await import("grammy");
    mocks.getMe.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 401, description: "Unauthorized" }, "getMe", {})
    );
    const result = await call({});
    expect(isError(result)).toBe(true);
  });
});
