import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Conf = require("conf") as typeof import("conf").default;
const atomically = require("atomically") as typeof import("atomically");
const { persistWindowState } = require("./window-state.js") as typeof import("./window-state.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-window-state-"));
const preferences = { aiModelConfig: "synthetic-model", proxy: "synthetic-proxy", storageLocation: "synthetic-library" };
const bounds = { mainWinWidth: 1050, mainWinHeight: 660, mainWinX: 10, mainWinY: 20 };
let sequence = 0;
const createStore = () => {
  const store = new Conf({ cwd: root, projectName: "krc-unit-window-state", configName: `config-${sequence++}` });
  store.set({ ...bounds, rendererPreferences: preferences });
  return store;
};
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("krc-unit-window-state-")) fs.rmSync(root, { recursive: true, force: true });
});

describe("window placement persistence on close", () => {
  it("does not rewrite the configuration when window placement has not changed", () => {
    const store = createStore(), write = vi.spyOn(atomically, "writeFileSync"), report = vi.fn();
    expect(persistWindowState(store, bounds, report)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
  it("saves changed placement while retaining preferences", () => {
    const store = createStore(), report = vi.fn();
    expect(persistWindowState(store, { ...bounds, mainWinWidth: 1100 }, report)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(store.path, "utf8"));
    expect(saved.mainWinWidth).toBe(1100);
    expect(saved.rendererPreferences).toEqual(preferences);
    expect(report).not.toHaveBeenCalled();
  });
  it.each(["EPERM", "EACCES", "EBUSY"])("allows the close handler to continue after %s without modifying the saved configuration", (code) => {
    const store = createStore(), before = fs.readFileSync(store.path), report = vi.fn();
    vi.spyOn(atomically, "writeFileSync").mockImplementation(() => { throw Object.assign(new Error("Private configuration path and token"), { code }); });
    expect(persistWindowState(store, { ...bounds, mainWinWidth: 1200 }, report)).toBe(false);
    expect(fs.readFileSync(store.path)).toEqual(before);
    expect(report.mock.calls).toEqual([[code]]);
    expect(store.get("rendererPreferences")).toEqual(preferences);
  });
  it("also handles an unreadable configuration during close", () => {
    const store = createStore(), report = vi.fn(), write = vi.spyOn(store, "set");
    vi.spyOn(store, "get").mockImplementation(() => { throw Object.assign(new Error("Private path"), { code: "EACCES" }); });
    expect(persistWindowState(store, bounds, report)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(report.mock.calls).toEqual([["EACCES"]]);
  });
});
