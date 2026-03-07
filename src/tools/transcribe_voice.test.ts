import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  transcribeWithIndicator: vi.fn(),
}));

vi.mock("../transcribe.js", () => ({
  transcribeWithIndicator: mocks.transcribeWithIndicator,
}));

import { register } from "./transcribe_voice.js";

describe("transcribe_voice tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("transcribe_voice");
  });

  it("returns transcribed text for a file_id", async () => {
    mocks.transcribeWithIndicator.mockResolvedValue("hello world");
    const result = await call({ file_id: "abc123" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe("hello world");
    expect(mocks.transcribeWithIndicator).toHaveBeenCalledWith("abc123", undefined);
  });

  it("passes message_id to transcribeWithIndicator when provided", async () => {
    mocks.transcribeWithIndicator.mockResolvedValue("ok");
    await call({ file_id: "abc", message_id: 42 });
    expect(mocks.transcribeWithIndicator).toHaveBeenCalledWith("abc", 42);
  });

  it("returns an error result if transcription throws", async () => {
    mocks.transcribeWithIndicator.mockRejectedValue(new Error("model not found"));
    const result = await call({ file_id: "bad" });
    expect(isError(result)).toBe(true);
  });
});
