import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

// ── dump_session_record (V3 — uses message-store) ───────────────────────

const storeMocks = vi.hoisted(() => ({
  dumpTimeline: vi.fn(() => []),
  timelineSize: vi.fn(() => 0),
  storeSize: vi.fn(() => 0),
}));

vi.mock("../message-store.js", () => storeMocks);

import { register as registerDump } from "./dump_session_record.js";

describe("dump_session_record tool (V3)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const parseJson = (result: unknown) => {
    const text = (result as { content: { text: string }[] }).content[0].text;
    return JSON.parse(text);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.dumpTimeline.mockReturnValue([]);
    storeMocks.timelineSize.mockReturnValue(0);
    storeMocks.storeSize.mockReturnValue(0);
    const server = createMockServer();
    registerDump(server);
    call = server.getHandler("dump_session_record");
  });

  it("returns JSON with summary and timeline", async () => {
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseJson(result);
    expect(data).toHaveProperty("summary");
    expect(data).toHaveProperty("timeline");
  });

  it("includes timeline_events, unique_messages, returned, truncated in summary", async () => {
    storeMocks.timelineSize.mockReturnValue(5);
    storeMocks.storeSize.mockReturnValue(3);
    const data = parseJson(await call({}));
    expect(data.summary.timeline_events).toBe(5);
    expect(data.summary.unique_messages).toBe(3);
    expect(data.summary.returned).toBe(0);
    expect(data.summary.truncated).toBe(false);
  });

  it("returns empty timeline when store is empty", async () => {
    const data = parseJson(await call({}));
    expect(data.timeline).toEqual([]);
  });

  it("returns timeline events from dumpTimeline", async () => {
    const events = [
      { ts: 1000, event: "message", direction: "inbound", id: 1, content: { type: "text", text: "hi" } },
      { ts: 1001, event: "message", direction: "outbound", id: 2, content: { type: "text", text: "hello" } },
    ];
    storeMocks.dumpTimeline.mockReturnValue(events);
    storeMocks.timelineSize.mockReturnValue(2);
    const data = parseJson(await call({}));
    expect(data.timeline).toHaveLength(2);
    expect(data.timeline[0].content.text).toBe("hi");
    expect(data.timeline[1].content.text).toBe("hello");
  });

  it("respects limit parameter and truncates", async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, event: "message", from: "user",
      content: { type: "text", text: `msg${i}` },
    }));
    storeMocks.dumpTimeline.mockReturnValue(events);
    storeMocks.timelineSize.mockReturnValue(5);
    const data = parseJson(await call({ limit: 2 }));
    expect(data.timeline).toHaveLength(2);
    expect(data.summary.truncated).toBe(true);
    expect(data.summary.returned).toBe(2);
    // Returns the LAST 2 (most recent)
    expect(data.timeline[0].id).toBe(4);
    expect(data.timeline[1].id).toBe(5);
  });

  it("default limit still works with no params", async () => {
    const result = await call({});
    expect(isError(result)).toBe(false);
  });
});
