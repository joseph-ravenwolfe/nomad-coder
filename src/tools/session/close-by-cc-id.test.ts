import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ───────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  findSessionsByCcId: vi.fn((_id: string) => [] as number[]),
  closeSessionById: vi.fn((sid: number) => ({ closed: true, sid })),
  refreshGovernorCommand: vi.fn(() => undefined),
}));

vi.mock("../../session-manager.js", () => ({
  findSessionsByCcId: (id: string) => mocks.findSessionsByCcId(id),
}));
vi.mock("../../session-teardown.js", () => ({
  closeSessionById: (sid: number) => mocks.closeSessionById(sid),
}));
vi.mock("../../built-in-commands.js", () => ({
  refreshGovernorCommand: () => { mocks.refreshGovernorCommand(); },
}));

import { handleCloseSessionByCcId } from "./close-by-cc-id.js";

/** Pull the JSON payload out of the MCP tool-result envelope. */
function parseResult(res: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

describe("session/close-by-cc-id", () => {
  beforeEach(() => {
    mocks.findSessionsByCcId.mockReset().mockReturnValue([]);
    mocks.closeSessionById.mockReset().mockImplementation((sid: number) => ({ closed: true, sid }));
    mocks.refreshGovernorCommand.mockReset();
  });

  it("errors when cc_session_id is missing", () => {
    const res = handleCloseSessionByCcId({}) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      code: "MISSING_CC_SESSION_ID",
    });
    expect(mocks.findSessionsByCcId).not.toHaveBeenCalled();
  });

  it("errors when cc_session_id is empty string", () => {
    const res = handleCloseSessionByCcId({ cc_session_id: "" }) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      code: "MISSING_CC_SESSION_ID",
    });
  });

  it("returns not_found when no session matches", () => {
    mocks.findSessionsByCcId.mockReturnValue([]);
    const res = handleCloseSessionByCcId({ cc_session_id: "abc-123" }) as { content: { text: string }[] };
    const body = parseResult(res);
    expect(body).toMatchObject({
      closed: false,
      reason: "not_found",
      cc_session_id: "abc-123",
    });
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("closes the single matching session and reports closed: true", () => {
    mocks.findSessionsByCcId.mockReturnValue([7]);
    const res = handleCloseSessionByCcId({ cc_session_id: "abc-123" }) as { content: { text: string }[] };
    const body = parseResult(res);
    expect(body.closed).toBe(true);
    expect(body.cc_session_id).toBe("abc-123");
    expect(body.sessions).toEqual([{ sid: 7, closed: true }]);
    expect(mocks.closeSessionById).toHaveBeenCalledTimes(1);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(7);
    expect(mocks.refreshGovernorCommand).toHaveBeenCalledTimes(1);
  });

  it("closes every session bound to the same cc_session_id (multi-match)", () => {
    mocks.findSessionsByCcId.mockReturnValue([2, 5, 8]);
    const res = handleCloseSessionByCcId({ cc_session_id: "abc-123" }) as { content: { text: string }[] };
    const body = parseResult(res);
    expect(body.closed).toBe(true);
    expect(body.sessions).toEqual([
      { sid: 2, closed: true },
      { sid: 5, closed: true },
      { sid: 8, closed: true },
    ]);
    expect(mocks.closeSessionById).toHaveBeenCalledTimes(3);
  });

  it("aggregates closed: true if any sub-close succeeded", () => {
    mocks.findSessionsByCcId.mockReturnValue([2, 5]);
    mocks.closeSessionById.mockImplementation((sid: number) => ({
      closed: sid === 2, // sid 5 missed (already gone)
      sid,
    }));
    const res = handleCloseSessionByCcId({ cc_session_id: "abc-123" }) as { content: { text: string }[] };
    const body = parseResult(res);
    expect(body.closed).toBe(true);
    expect(body.sessions).toEqual([
      { sid: 2, closed: true },
      { sid: 5, closed: false },
    ]);
  });

  it("aggregates closed: false when every sub-close missed", () => {
    mocks.findSessionsByCcId.mockReturnValue([9]);
    mocks.closeSessionById.mockReturnValue({ closed: false, sid: 9 });
    const res = handleCloseSessionByCcId({ cc_session_id: "abc-123" }) as { content: { text: string }[] };
    const body = parseResult(res);
    expect(body.closed).toBe(false);
  });
});
