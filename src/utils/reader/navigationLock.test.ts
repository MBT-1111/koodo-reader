import { describe, expect, it, vi } from "vitest";
import {
  beginNavigationComposition,
  clearLegacyNavigationLock,
  endNavigationComposition,
  isNavigationComposing,
} from "./navigationLock";

describe("navigation input locks", () => {
  it.each(["yes", "no"])("recovers a persisted IME lock with pin=%s", (pin) => {
    const values: Record<string, string> = {
      isNavLocked: pin, isTempLocked: "yes", textColor: "saved-color",
    };
    const config = {
      getReaderConfig: (key: string) => values[key] || "",
      setReaderConfig: vi.fn((key: string, value: string) => { values[key] = value; }),
    };
    clearLegacyNavigationLock(config);
    expect(values).toEqual({ isNavLocked: "no", isTempLocked: "", textColor: "saved-color" });
    config.setReaderConfig.mockClear();
    clearLegacyNavigationLock(config);
    expect(config.setReaderConfig).not.toHaveBeenCalled();
  });

  it("preserves an intentional navigation pin", () => {
    const config = {
      getReaderConfig: (key: string) => key === "isNavLocked" ? "yes" : "",
      setReaderConfig: vi.fn(),
    };
    clearLegacyNavigationLock(config);
    expect(config.getReaderConfig("isNavLocked")).toBe("yes");
    expect(config.setReaderConfig).not.toHaveBeenCalled();
  });

  it("protects only the focused composing input and releases on completion", () => {
    const input = {} as HTMLInputElement;
    beginNavigationComposition(input);
    expect(isNavigationComposing(input)).toBe(true);
    expect(isNavigationComposing(null)).toBe(false);
    expect(isNavigationComposing({} as HTMLInputElement)).toBe(false);
    endNavigationComposition(input);
    expect(isNavigationComposing(input)).toBe(false);
  });
});
