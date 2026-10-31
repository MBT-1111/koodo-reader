import { describe, expect, it, vi } from "vitest";
import { getPageTranslationTexts } from "./pageTranslation";

describe("current page translation scope", () => {
  it("excludes the chapter remainder and preserves complete crossing paragraphs", async () => {
    const rendition = {
      visibleText: vi.fn().mockResolvedValue(["Visible paragraph.", "Visible fragment.", "Visible paragraph."]),
      audioText: vi.fn().mockResolvedValue(["Visible paragraph.", "Before. Visible fragment. After.", "Unseen chapter remainder."]),
      getBatchTransTexts: vi.fn(() => { throw new Error("Must not use chapter batches"); }),
    };
    expect(await getPageTranslationTexts(rendition)).toEqual(["Visible paragraph.", "Before. Visible fragment. After."]);
    expect(rendition.getBatchTransTexts).not.toHaveBeenCalled();
  });
  it("does not fall back to chapter text when no text is visible", async () => {
    const rendition = { visibleText: vi.fn().mockResolvedValue([]), audioText: vi.fn() };
    expect(await getPageTranslationTexts(rendition)).toEqual([]);
    expect(rendition.audioText).not.toHaveBeenCalled();
  });
  it("reuses one paragraph when multiple visible fragments belong to it", async () => {
    const rendition = {
      visibleText: vi.fn().mockResolvedValue(["First sentence.", "Second sentence."]),
      audioText: vi.fn().mockResolvedValue(["First sentence. Second sentence.", "Off screen."]),
    };
    expect(await getPageTranslationTexts(rendition)).toEqual(["First sentence. Second sentence."]);
  });
  it("refuses an oversized visible paragraph before any model request", async () => {
    const rendition = {
      visibleText: vi.fn().mockResolvedValue(["Visible."]),
      audioText: vi.fn().mockResolvedValue(["Visible." + "x".repeat(6000)]),
    };
    await expect(getPageTranslationTexts(rendition)).rejects.toThrow("CUSTOM_AI_TEXT_TOO_LONG");
  });
});
