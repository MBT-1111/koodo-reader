import { describe, expect, it, vi } from "vitest";
vi.mock("@capacitor/core", () => ({ Capacitor: {}, registerPlugin: () => ({}) }));
import { speechFromVisible } from "./speech";

describe("native speech text", () => {
  it("begins at the current visible text and retains the rest of the chapter", () => {
    expect(speechFromVisible(["Previous page", "Hidden prefix. Visible paragraph.", "Next page"], ["", "Visible paragraph."]))
      .toEqual(["Visible paragraph.", "Next page"]);
  });
  it("preserves the engine queue when visible text cannot be matched", () => {
    expect(speechFromVisible(["", "PDF extracted text"], ["Different OCR text"])).toEqual(["PDF extracted text"]);
    expect(speechFromVisible(["Text"], [])).toEqual(["Text"]);
  });
});
