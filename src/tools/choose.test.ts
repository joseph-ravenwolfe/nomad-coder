import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import type { ButtonResult, TextResult, VoiceResult, ButtonOrTextResult } from "./button-helpers.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  pollButtonOrTextOrVoice: vi.fn(),
  ackAndEditSelection: vi.fn(),
  editWithSkipped: vi.fn(),
  editWithTimedOut: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => ({
      sendMessage: mocks.sendMessage,
      answerCallbackQuery: mocks.answerCallbackQuery,
      editMessageText: mocks.editMessageText,
    }),
    resolveChat: () => 42,
  };
});

vi.mock("../message-store.js", () => ({
  recordOutgoing: vi.fn(),
}));

vi.mock("./button-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./button-helpers.js")>();
  return {
    ...actual,
    pollButtonOrTextOrVoice: (...args: unknown[]) => mocks.pollButtonOrTextOrVoice(...args),
    ackAndEditSelection: (...args: unknown[]) => mocks.ackAndEditSelection(...args),
    editWithSkipped: (...args: unknown[]) => mocks.editWithSkipped(...args),
    editWithTimedOut: (...args: unknown[]) => mocks.editWithTimedOut(...args),
  };
});

import { register } from "./choose.js";

const SENT_MSG = { message_id: 7, chat: { id: 42 }, date: 0 };

function makeButtonResult(data: string): ButtonResult {
  return { kind: "button", callback_query_id: "cq1", data, message_id: 7 };
}

function makeTextResult(messageId: number, text: string): TextResult {
  return { kind: "text", message_id: messageId, text };
}

function makeVoiceResult(messageId: number, text: string): VoiceResult {
  return { kind: "voice", message_id: messageId, text };
}

describe("choose tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const OPTIONS = [
    { label: "Option A", value: "opt_a" },
    { label: "Option B", value: "opt_b" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ackAndEditSelection.mockResolvedValue(undefined);
    mocks.editWithSkipped.mockResolvedValue(undefined);
    mocks.editWithTimedOut.mockResolvedValue(undefined);
    const server = createMockServer();
    register(server);
    call = server.getHandler("choose");
  });

  it("returns chosen label and value", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_a"));
    const result = await call({ question: "Pick one", options: OPTIONS });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.timed_out).toBe(false);
    expect(data.value).toBe("opt_a");
    expect(data.label).toBe("Option A");
  });

  it("calls ackAndEditSelection with callback_query_id", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_b"));
    await call({ question: "Pick", options: OPTIONS });
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 7, "Pick", "Option B", "cq1",
    );
  });

  it("edits message to show chosen option via ackAndEditSelection", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeButtonResult("opt_a"));
    await call({ question: "Pick one", options: OPTIONS });
    expect(mocks.ackAndEditSelection).toHaveBeenCalledWith(
      42, 7, "Pick one", "Option A", "cq1",
    );
  });

  it("edits message on timeout to remove dead buttons", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    expect(mocks.editWithTimedOut).toHaveBeenCalledTimes(1);
  });

  it("returns timed_out when no button is pressed", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    expect((parseResult(result)).timed_out).toBe(true);
  });

  it("validates question text", async () => {
    const result = await call({ question: "", options: OPTIONS });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("EMPTY_MESSAGE");
  });

  it("rejects callback_data over 64 bytes", async () => {
    const badOptions = [
      { label: "A", value: "a".repeat(65) },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: badOptions });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CALLBACK_DATA_TOO_LONG");
  });

  it("rejects label over 20 chars for 2-column layout", async () => {
    const longOptions = [
      { label: "A very long label text", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: longOptions, columns: 2 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("BUTTON_LABEL_TOO_LONG");
  });

  it("allows label up to 35 chars for single-column layout", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const longOptions = [
      { label: "A somewhat longer label text ok", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await call({ question: "Pick", options: longOptions, columns: 1, timeout_seconds: 1 });
    expect(isError(result)).toBe(false);
  });

  it("builds keyboard rows with correct column count", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(null);
    const threeOptions = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
      { label: "C", value: "c" },
    ];
    await call({ question: "Pick", options: threeOptions, columns: 3, timeout_seconds: 1 });
    const [, , opts] = mocks.sendMessage.mock.calls[0];
    // All 3 options in a single row when columns=3
    expect(opts.reply_markup.inline_keyboard[0]).toHaveLength(3);
  });

  it("returns skipped with text when user types instead of pressing button", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeTextResult(20, "hello"));
    const result = await call({ question: "Pick", options: OPTIONS, timeout_seconds: 1 });
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.text_response).toBe("hello");
    expect(data.text_message_id).toBe(20);
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 7, "Pick");
  });

  it("returns skipped with voice transcription when user sends a voice message", async () => {
    mocks.sendMessage.mockResolvedValue(SENT_MSG);
    mocks.pollButtonOrTextOrVoice.mockResolvedValue(makeVoiceResult(20, "transcribed text"));
    const result = await call({ question: "Pick", options: OPTIONS });
    const data = parseResult(result);
    expect(data.skipped).toBe(true);
    expect(data.voice).toBe(true);
    expect(data.text_response).toBe("transcribed text");
    expect(mocks.editWithSkipped).toHaveBeenCalledWith(42, 7, "Pick");
  });

  it("returns error when sendMessage throws", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("Network error"));
    const result = await call({ question: "Pick", options: OPTIONS });
    expect(isError(result)).toBe(true);
  });
});
