import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    getApi: () => mocks,
  };
});

import { ackAndEditSelection, editWithTimedOut, editWithSkipped } from "./button-helpers.js";

describe("button-helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ackAndEditSelection", () => {
    it("edits message with chosen label and removes buttons", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageText.mockResolvedValue(true);
      await ackAndEditSelection("42", 1, "Question?", "Yes", "cq1");
      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        "42", 1,
        expect.stringContaining("Yes"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("skips answerCallbackQuery when callbackQueryId is undefined", async () => {
      mocks.editMessageText.mockResolvedValue(true);
      await ackAndEditSelection("42", 1, "Question?", "Yes", undefined);
      expect(mocks.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it("swallows answerCallbackQuery errors (already answered, etc.)", async () => {
      mocks.answerCallbackQuery.mockRejectedValue(new Error("Already answered"));
      mocks.editMessageText.mockResolvedValue(true);
      await expect(ackAndEditSelection("42", 1, "Question?", "Yes", "cq1")).resolves.toBeUndefined();
    });

    it("swallows editMessageText errors silently", async () => {
      mocks.answerCallbackQuery.mockResolvedValue(true);
      mocks.editMessageText.mockRejectedValue(new Error("Message not modified"));
      await expect(ackAndEditSelection("42", 1, "Question?", "Yes", "cq1")).resolves.toBeUndefined();
    });
  });

  describe("editWithTimedOut", () => {
    it("edits message to show timed-out indicator and removes buttons", async () => {
      mocks.editMessageText.mockResolvedValue(true);
      await editWithTimedOut("42", 1, "Question?");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        "42", 1,
        expect.stringContaining("Timed out"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("swallows editMessageText errors silently", async () => {
      mocks.editMessageText.mockRejectedValue(new Error("Message not modified"));
      await expect(editWithTimedOut("42", 1, "Question?")).resolves.toBeUndefined();
    });
  });

  describe("editWithSkipped", () => {
    it("edits message to show skipped indicator and removes buttons", async () => {
      mocks.editMessageText.mockResolvedValue(true);
      await editWithSkipped("42", 1, "Question?");
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        "42", 1,
        expect.stringContaining("Skipped"),
        expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
      );
    });

    it("swallows editMessageText errors silently", async () => {
      mocks.editMessageText.mockRejectedValue(new Error("Message not modified"));
      await expect(editWithSkipped("42", 1, "Question?")).resolves.toBeUndefined();
    });
  });
});
