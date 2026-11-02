import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme } from "./launchUtil";
import StyleUtil from "./styleUtil";
import { applyThemeColor } from "./themeUtil";

const { settings, invoke } = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  invoke: vi.fn(),
}));
vi.mock("react-device-detect", () => ({
  isElectron: true,
  osName: "Windows",
  osVersion: "test",
  browserName: "Electron",
  browserVersion: "test",
}));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: {
  getReaderConfig: (key: string) => settings.get(key) || "",
  setReaderConfig: (key: string, value: string) => settings.set(key, value),
  setItem: () => undefined,
} }));
vi.mock("../file/backgroundUtil", () => ({ default: {} }));
vi.mock("../file/fontUtil", () => ({ default: {} }));
vi.mock("./docUtil", () => ({ getOuterDoc: () => null }));
vi.mock("../../assets/lib/kookit.min", () => ({ StyleHelper: { getDefaultCss: () => "saved-book-css" } }));
vi.mock("./themeUtil", () => ({ applyThemeColor: vi.fn(), removeThemeColor: vi.fn() }));

beforeEach(() => {
  settings.clear();
  vi.clearAllMocks();
  vi.stubGlobal("document", {
    createElement: () => ({}),
    documentElement: { dataset: {} },
    head: { appendChild() {} },
  });
  vi.stubGlobal("window", { electronAPI: { invoke, sendSync: () => true } });
});
afterEach(() => vi.unstubAllGlobals());

describe("E-ink application theme", () => {
  it("applies monochrome styling inside the book and restores the saved book CSS when disabled", () => {
    settings.set("isEinkMode", "yes");
    settings.set("textColor", "saved-text-color");
    expect(StyleUtil.getDefaultCss("fixture")).toContain("filter: grayscale(1)");
    expect(StyleUtil.getDefaultCss("fixture")).toContain("background: #fff !important");
    expect(settings.get("textColor")).toBe("saved-text-color");
    settings.set("isEinkMode", "no");
    expect(StyleUtil.getDefaultCss("fixture")).toBe("saved-book-css");
  });
  it("uses a light black-and-white interface while preserving saved theme and book colors", () => {
    settings.set("appSkin", "night");
    settings.set("themeColor", "#0179CA");
    settings.set("backgroundColor", "saved-book-background");
    settings.set("isEinkMode", "yes");
    initTheme();
    StyleUtil.applyTheme();
    expect(document.documentElement.dataset).toEqual({ theme: "light", eink: "true" });
    expect(invoke).toHaveBeenCalledWith("set-native-theme-source", "light");
    expect(applyThemeColor).toHaveBeenCalledWith("#000000");
    expect(settings.get("appSkin")).toBe("night");
    expect(settings.get("themeColor")).toBe("#0179CA");
    expect(settings.get("backgroundColor")).toBe("saved-book-background");

    settings.set("isEinkMode", "no");
    initTheme();
    StyleUtil.applyTheme();
    expect(document.documentElement.dataset).toEqual({ theme: "dark", eink: "false" });
    expect(invoke).toHaveBeenLastCalledWith("set-native-theme-source", "night");
    expect(applyThemeColor).toHaveBeenLastCalledWith("#0179CA");
  });

  it("overrides a dark system theme only while E-ink is enabled", () => {
    settings.set("appSkin", "system");
    settings.set("isEinkMode", "yes");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    settings.set("isEinkMode", "no");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(invoke).toHaveBeenLastCalledWith("set-native-theme-source", "system");
  });
});
