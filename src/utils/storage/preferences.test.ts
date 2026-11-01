import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { persistPreferences } from "./preferences";

const require = createRequire(import.meta.url);
const Conf = require("conf");
const { createPreferences } = require("../main/custom/preferences.js") as typeof import("../main/custom/preferences.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-preferences-"));
const defaultLocation = path.join(root, "default-library");
const runtime = { testing: true, root };
const disk = () => new Conf({ cwd: root, configName: "preferences", projectName: "krc-unit-preferences" });
const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
  };
};

let engine: typeof import("../../assets/lib/kookit-extra-browser.min.js");
let originalSet: typeof engine.ConfigService.setItem;
let originalRemove: typeof engine.ConfigService.removeItem;
const launch = (storage = memoryStorage()) => {
  vi.stubGlobal("localStorage", storage);
  engine.ConfigService.setItem = originalSet;
  engine.ConfigService.removeItem = originalRemove;
  const preferences = createPreferences(disk(), runtime, defaultLocation);
  persistPreferences(engine.ConfigService, storage, (request) => ({ ok: true, value: preferences.handle(request) }));
  return preferences;
};

beforeAll(async () => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("document", { hidden: false, visibilityState: "visible", addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("addEventListener", () => undefined);
  vi.stubGlobal("removeEventListener", () => undefined);
  // Exercise the public API without inspecting engine source.
  engine = await import("../../assets/lib/kookit-extra-browser.min.js");
  originalSet = engine.ConfigService.setItem;
  originalRemove = engine.ConfigService.removeItem;
});
beforeEach(() => { disk().clear(); });
afterAll(() => {
  engine.ConfigService.setItem = originalSet;
  engine.ConfigService.removeItem = originalRemove;
  vi.unstubAllGlobals();
  if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("krc-unit-preferences-")) fs.rmSync(root, { recursive: true, force: true });
});

describe("desktop preference persistence", () => {
  it("migrates existing preferences, then restores AI, Discord, E-ink and the library before startup reads", () => {
    const library = path.join(root, "relocated-library");
    launch(memoryStorage({ storageLocation: library, readerConfig: JSON.stringify({ lang: "zhCN", appSkin: "night" }) }));
    const config = engine.ConfigService;
    config.setObjectConfig("synthetic-model", { apiKey: "synthetic-key", model: "synthetic-model" }, "aiModelConfig");
    config.setReaderConfig("aiService", "synthetic-model");
    config.setReaderConfig("isEnableDiscordRPC", "yes");
    config.setReaderConfig("isEinkMode", "yes");
    config.setItem("customAzureStyles", JSON.stringify({ voice: "sad" }));
    const proxyConfig = { enabled: true, type: "http", host: "127.0.0.1", port: 7890 };
    disk().set("proxyConfig", proxyConfig);

    // A new disk-store instance and an empty Chromium origin model a cold restart.
    const restarted = launch();
    expect(restarted.storageLocation()).toBe(library);
    expect(config.getItem("storageLocation")).toBe(library);
    expect(config.getReaderConfig("lang")).toBe("zhCN");
    expect(config.getReaderConfig("appSkin")).toBe("night");
    expect(config.getReaderConfig("aiService")).toBe("synthetic-model");
    expect(config.getObjectConfig("synthetic-model", "aiModelConfig").apiKey).toBe("synthetic-key");
    expect(config.getReaderConfig("isEnableDiscordRPC")).toBe("yes");
    expect(config.getReaderConfig("isEinkMode")).toBe("yes");
    expect(JSON.parse(config.getItem("customAzureStyles") || "{}")).toEqual({ voice: "sad" });
    expect(disk().get("proxyConfig")).toEqual(proxyConfig);
  });

  it("persists removals and never resurrects stale browser settings on restart", () => {
    launch(memoryStorage({ obsolete: "stale", readerConfig: "{}" }));
    engine.ConfigService.removeItem("obsolete");
    engine.ConfigService.setObjectConfig("removed", { apiKey: "synthetic-key" }, "aiModelConfig");
    engine.ConfigService.deleteObjectConfig("removed", "aiModelConfig");
    launch(memoryStorage({ obsolete: "stale", readerConfig: '{"isEnableDiscordRPC":"yes"}' }));
    expect(engine.ConfigService.getItem("obsolete")).toBeFalsy();
    expect(engine.ConfigService.getReaderConfig("isEnableDiscordRPC")).toBeFalsy();
    expect(engine.ConfigService.getAllObjectConfig("aiModelConfig")).toEqual({});
  });

  it("does not report a successful browser save when the disk write fails", () => {
    const storage = memoryStorage();
    const setItem = vi.fn<(key: string, value: unknown) => void>();
    const config = { setItem, removeItem: vi.fn() };
    persistPreferences(config, storage, (request) => request.action === "set"
      ? { ok: false, value: null, error: "DISK_WRITE_FAILED" }
      : { ok: true, value: {} });
    expect(() => config.setItem("aiModelConfig", "{}")).toThrow("DISK_WRITE_FAILED");
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem("aiModelConfig")).toBeNull();
  });

  it("validates IPC input and keeps the test profile inside its sandbox", () => {
    const preferences = createPreferences(disk(), runtime, defaultLocation);
    expect(() => preferences.handle({ action: "set", key: "storageLocation", value: "relative" })).toThrow("CUSTOM_INVALID_STORAGE");
    expect(() => preferences.handle({ action: "set", key: "storageLocation", value: path.dirname(root) })).toThrow("CUSTOM_TEST_PATH_ESCAPE");
    expect(() => preferences.handle({ action: "initialize", values: { readerConfig: {} } })).toThrow("CUSTOM_INVALID_PREFERENCE");
    expect(() => preferences.handle({ action: "set", key: "__proto__", value: "{}" })).toThrow("CUSTOM_INVALID_PREFERENCE");
    expect(preferences.handle({ action: "load" })).toBeNull();
    expect(preferences.storageLocation()).toBe(defaultLocation);
  });

  it("does not restore preferences after the application clears all data", () => {
    launch(memoryStorage({ readerConfig: '{"isEinkMode":"yes"}' }));
    localStorage.clear();
    disk().clear();
    launch();
    expect(engine.ConfigService.getReaderConfig("isEinkMode")).toBeFalsy();
  });
});
