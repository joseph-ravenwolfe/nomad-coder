import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  trySetMessageReaction: vi.fn(),
  setTempReaction: vi.fn(),
  recordBotReaction: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, resolveChat: () => 42, trySetMessageReaction: mocks.trySetMessageReaction };
});

vi.mock("../temp-reaction.js", () => ({
  setTempReaction: mocks.setTempReaction,
}));

vi.mock("../message-store.js", async (importActual) => {
  const actual = await importActual<typeof import("../message-store.js")>();
  return { ...actual, recordBotReaction: mocks.recordBotReaction };
});

import { register } from "./set_temporary_reaction.js";

describe("set_temporary_reaction tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_temporary_reaction");
    mocks.setTempReaction.mockResolvedValue(true);
  });

  it("sets temp reaction and returns ok", async () => {
    const result = await call({ message_id: 100, emoji: "👀" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.emoji).toBe("👀");
    expect(data.restore_emoji).toBeNull();
    expect(data.timeout_seconds).toBeNull();
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", undefined, undefined);
  });

  it("resolves alias 'reading' → 👀", async () => {
    await call({ message_id: 100, emoji: "reading" });
    expect(mocks.setTempReaction).toHaveBeenCalledWith(100, "👀", undefined, undefined);
  });

  it("passes restore_emoji and timeout_seconds through", async () => {
    const result = await call({ message_id: 55, emoji: "👀", restore_emoji: "🫡", timeout_seconds: 300 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.restore_emoji).toBe("🫡");
    expect(data.timeout_seconds).toBe(300);
    expect(mocks.setTempReaction).toHaveBeenCalledWith(55, "👀", "🫡", 300);
  });

  it("resolves restore_emoji alias 'salute' → 🫡", async () => {
    await call({ message_id: 55, emoji: "👀", restore_emoji: "salute" });
    expect(mocks.setTempReaction).toHaveBeenCalledWith(55, "👀", "🫡", undefined);
  });

  it("returns error for invalid emoji", async () => {
    const result = await call({ message_id: 100, emoji: "notanemoji" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
  });

  it("returns error for invalid restore_emoji", async () => {
    const result = await call({ message_id: 100, emoji: "👀", restore_emoji: "notanemoji" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("REACTION_EMOJI_INVALID");
  });

  it("returns error when setTempReaction fails", async () => {
    mocks.setTempReaction.mockResolvedValue(false);
    const result = await call({ message_id: 100, emoji: "👀" });
    expect(isError(result)).toBe(true);
  });
});
