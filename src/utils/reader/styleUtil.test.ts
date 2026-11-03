import { beforeEach, describe, expect, it, vi } from "vitest";
import StyleUtil from "./styleUtil";

const { settings, platform } = vi.hoisted(() => ({ settings: new Map<string, string>(), platform: { android: true } }));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: { getReaderConfig: (key: string) => settings.get(key) || "" } }));
vi.mock("../../assets/lib/kookit.min", () => ({ StyleHelper: { getDefaultCss: () => "/* saved book layout */" } }));
vi.mock("../platform", () => ({ get isAndroid() { return platform.android; } }));
vi.mock("../file/fontUtil", () => ({ default: {} }));
vi.mock("./docUtil", () => ({ getOuterDoc: () => null }));

beforeEach(() => { settings.clear(); platform.android = true; });

describe("Android e-ink book appearance", () => {
  it("overrides colored backgrounds without changing saved preferences", () => {
    settings.set("isEinkMode", "yes");
    settings.set("backgroundColor", "saved-color");
    settings.set("textColor", "saved-text");
    settings.set("readerBackgroundImage", "saved-image");
    const before = new Map(settings), css = StyleUtil.getDefaultCss("book");
    expect(css).toContain("/* saved book layout */");
    expect(css).toContain("background: #fff !important");
    expect(css).not.toContain("html, body { background: transparent");
    expect(settings).toEqual(before);
  });

  it("restores transparent book backgrounds when disabled", () => {
    settings.set("isEinkMode", "no"); settings.set("readerBackgroundImage", "saved-image");
    expect(StyleUtil.getDefaultCss("book")).toContain("html, body { background: transparent !important; }");
  });

  it("retains desktop book styling while its existing e-ink interface is enabled", () => {
    platform.android = false; settings.set("isEinkMode", "yes");
    expect(StyleUtil.getDefaultCss("book")).toBe("/* saved book layout */");
  });
});
