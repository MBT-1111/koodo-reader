import { describe, expect, it, vi } from "vitest";
vi.mock("@capacitor/core", () => ({ Capacitor: {}, registerPlugin: () => ({}) }));
import { speechFromVisible } from "./speech";

describe("native speech text", () => {
  it("starts at the selected sentence and excludes earlier text, even when the same sentence appeared on a previous page", () => {
    expect(speechFromVisible(["重复句。旧页。", "当前页。重复句。余下句。", "下一段。"], ["当前页。"], "重复句。"))
      .toEqual(["重复句。余下句。", "下一段。"]);
    expect(speechFromVisible(["前文。选中句。后文。", "末段。"], [], "选中句。"))
      .toEqual(["选中句。后文。", "末段。"]);
  });
  it("does not silently start at a different position when the selected text is unavailable", () => {
    expect(() => speechFromVisible(["当前章节。"], ["当前章节。"], "另一本书的句子。")).toThrow("ANDROID_SPEECH_SELECTION");
  });
  it("begins at the current visible text and retains the rest of the chapter", () => {
    expect(speechFromVisible(["Previous page", "Hidden prefix. Visible paragraph.", "Next page"], ["", "Visible paragraph."]))
      .toEqual(["Visible paragraph.", "Next page"]);
  });
  it("preserves the engine queue when visible text cannot be matched", () => {
    expect(speechFromVisible(["", "PDF extracted text"], ["Different OCR text"])).toEqual(["PDF extracted text"]);
    expect(speechFromVisible(["Text"], [])).toEqual(["Text"]);
  });
});
