import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getUpdates: vi.fn() }));
const offsetMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  reset: vi.fn(),
  get: vi.fn(() => 0),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: offsetMocks.get,
    advanceOffset: offsetMocks.advance,
    resetOffset: offsetMocks.reset,
  };
});

vi.mock("../transcribe.js", () => ({
  transcribeWithIndicator: vi.fn().mockResolvedValue("transcribed text"),
}));

import { register } from "./get_updates.js";

describe("get_updates tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    offsetMocks.get.mockReturnValue(0);
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("get_updates");
  });

  it("returns text updates and advances offset", async () => {
    const updates = [{ update_id: 1, message: { message_id: 1, text: "hi", chat: { id: 42 } } }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any[];
    expect(data[0].type).toBe("message");
    expect(data[0].content_type).toBe("text");
    expect(data[0].text).toBe("hi");
    expect(offsetMocks.advance).toHaveBeenCalledWith(updates);
  });

  it("returns document messages with content_type=document", async () => {
    const updates = [{
      update_id: 2,
      message: {
        message_id: 2,
        document: { file_id: "f1", file_unique_id: "u1", file_name: "test.pdf", mime_type: "application/pdf", file_size: 1234 },
        caption: "Here",
        chat: { id: 42 },
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("document");
    expect(data[0].file_id).toBe("f1");
    expect(data[0].file_name).toBe("test.pdf");
    expect(data[0].caption).toBe("Here");
  });

  it("returns photo messages with content_type=photo using largest size", async () => {
    const updates = [{
      update_id: 3,
      message: {
        message_id: 3,
        photo: [
          { file_id: "small", file_unique_id: "s1", width: 100, height: 100 },
          { file_id: "large", file_unique_id: "l1", width: 800, height: 600 },
        ],
        chat: { id: 42 },
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("photo");
    expect(data[0].file_id).toBe("large");
    expect(data[0].width).toBe(800);
  });

  it("calls resetOffset when reset_offset is true", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 10, timeout_seconds: 0, reset_offset: true });
    expect(offsetMocks.reset).toHaveBeenCalled();
  });

  it("passes limit and timeout to API", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 5, timeout_seconds: 10 });
    const [opts] = mocks.getUpdates.mock.calls[0];
    expect(opts.limit).toBe(5);
    expect(opts.timeout).toBe(10);
  });

  it("filters by allowed_updates when provided", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    await call({ limit: 10, timeout_seconds: 0, allowed_updates: ["message"] });
    const [opts] = mocks.getUpdates.mock.calls[0];
    expect(opts.allowed_updates).toEqual(["message"]);
  });

  it("returns voice messages with transcribed text", async () => {
    const updates = [{
      update_id: 10,
      message: { message_id: 10, voice: { file_id: "v1" }, chat: { id: 42 } },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("voice");
    expect(data[0].text).toBe("transcribed text");
    expect(data[0].file_id).toBe("v1");
    expect(data[0].voice).toBe(true);
  });

  it("returns audio messages with content_type=audio", async () => {
    const updates = [{
      update_id: 11,
      message: {
        message_id: 11,
        audio: { file_id: "a1", file_unique_id: "au1", title: "Track", performer: "Artist", duration: 180, mime_type: "audio/mpeg", file_size: 5000 },
        chat: { id: 42 },
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("audio");
    expect(data[0].file_id).toBe("a1");
    expect(data[0].title).toBe("Track");
    expect(data[0].duration).toBe(180);
  });

  it("returns video messages with content_type=video", async () => {
    const updates = [{
      update_id: 12,
      message: {
        message_id: 12,
        video: { file_id: "vid1", file_unique_id: "vu1", width: 1920, height: 1080, duration: 60, mime_type: "video/mp4", file_size: 10000 },
        chat: { id: 42 },
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("video");
    expect(data[0].file_id).toBe("vid1");
    expect(data[0].width).toBe(1920);
  });

  it("returns callback_query updates", async () => {
    const updates = [{
      update_id: 20,
      callback_query: { id: "cq1", data: "action:ok", message: { message_id: 5 } },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].type).toBe("callback_query");
    expect(data[0].callback_query_id).toBe("cq1");
    expect(data[0].data).toBe("action:ok");
    expect(data[0].message_id).toBe(5);
  });

  it("returns message_reaction updates", async () => {
    const updates = [{
      update_id: 21,
      message_reaction: {
        message_id: 7,
        user: { id: 99, first_name: "Alice", last_name: "Smith", username: "alice" },
        new_reaction: [{ type: "emoji", emoji: "👍" }],
        old_reaction: [],
      },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].type).toBe("message_reaction");
    expect(data[0].emoji_added).toEqual(["👍"]);
    expect(data[0].emoji_removed).toEqual([]);
    expect(data[0].user.name).toBe("Alice Smith");
  });

  it("returns unknown message type with content_keys hint", async () => {
    const updates = [{
      update_id: 30,
      message: { message_id: 30, some_new_field: "value", chat: { id: 42 } },
    }];
    mocks.getUpdates.mockResolvedValue(updates);
    const result = await call({ limit: 10, timeout_seconds: 0 });
    const data = parseResult(result) as any[];
    expect(data[0].content_type).toBe("unknown");
    expect(data[0].content_keys).toContain("some_new_field");
  });

  it("returns error result if getUpdates throws", async () => {
    mocks.getUpdates.mockRejectedValue(new Error("network error"));
    const result = await call({ limit: 10, timeout_seconds: 0 });
    expect(isError(result)).toBe(true);
  });
});
