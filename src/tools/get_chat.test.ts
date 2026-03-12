import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getChat: vi.fn(),
  pollButtonPress: vi.fn(),
  ackAndEditSelection: vi.fn(),
  editWithTimedOut: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      getChat: mocks.getChat,
    }),
    resolveChat: () => 99,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./button-helpers.js")>();
  return {
    ...actual,
    pollButtonPress: (...args: unknown[]) => mocks.pollButtonPress(...args),
    ackAndEditSelection: (...args: unknown[]) => mocks.ackAndEditSelection(...args),
    editWithTimedOut: (...args: unknown[]) => mocks.editWithTimedOut(...args),
  };
});

import { register } from "./get_chat.js";

describe("get_chat tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue({ message_id: 1 });
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithTimedOut.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("get_chat");
  });

  it("returns chat info when user approves", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q1", data: "get_chat_yes", message_id: 1,
    });
    mocks.getChat.mockResolvedValue({ id: 99, type: "group", title: "Dev Chat" });
    const result = await call({});
    expect(isError(result)).toBe(false);
    expect(parseResult(result)).toEqual({
      id: 99, type: "group", title: "Dev Chat",
      username: undefined, first_name: undefined, last_name: undefined, description: undefined,
    });
  });

  it("sends confirmation prompt with Allow/Deny buttons", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q1", data: "get_chat_yes", message_id: 1,
    });
    mocks.getChat.mockResolvedValue({ id: 99, type: "private" });
    await call({});
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      99,
      expect.any(String),
      expect.objectContaining({
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Allow", callback_data: "get_chat_yes" },
            { text: "❌ Deny", callback_data: "get_chat_no" },
          ]],
        },
      }),
    );
  });

  it("returns error when user denies", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q2", data: "get_chat_no", message_id: 1,
    });
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(mocks.getChat).not.toHaveBeenCalled();
  });

  it("returns error on timeout", async () => {
    mocks.pollButtonPress.mockResolvedValue(null);
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(mocks.editWithTimedOut).toHaveBeenCalled();
    expect(mocks.getChat).not.toHaveBeenCalled();
  });

  it("returns error when getChat API fails", async () => {
    mocks.pollButtonPress.mockResolvedValue({
      kind: "button", callback_query_id: "q1", data: "get_chat_yes", message_id: 1,
    });
    const { GrammyError } = await import("grammy");
    mocks.getChat.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "getChat", {}),
    );
    const result = await call({});
    expect(isError(result)).toBe(true);
  });
});
