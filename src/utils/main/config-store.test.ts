import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Conf = require("conf") as typeof import("conf").default;
const atomically = require("atomically") as typeof import("atomically");
const { createConfigStore } = require("./config-store.js") as typeof import("./config-store.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-config-store-"));
const original = { rendererPreferences: { recordLocation: "old-position", aiModelConfig: "synthetic-key" }, proxyConfig: { enabled: false }, mainWinWidth: 1100 };
let sequence = 0;
const setup = () => {
  const directory = path.join(root, String(sequence++));
  const store = createConfigStore(Conf, directory, "win32") as InstanceType<typeof Conf>;
  store.set(original);
  return { store, directory };
};
const denyRename = (destination: string, code = "EPERM") => vi.spyOn(atomically, "writeFileSync").mockImplementation(() => {
  throw Object.assign(new Error("Synthetic Windows rename lock"), { code, syscall: "rename", dest: destination });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("krc-unit-config-store-")) fs.rmSync(root, { recursive: true, force: true });
});

describe("Windows config rename recovery", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("saves through %s rename denial and retains a last-good copy", (code) => {
    const { store, directory } = setup();
    denyRename(store.path, code);
    store.set("rendererPreferences.recordLocation", "next-position");
    expect(JSON.parse(fs.readFileSync(store.path, "utf8"))).toEqual({ ...original, rendererPreferences: { ...original.rendererPreferences, recordLocation: "next-position" } });
    expect(JSON.parse(fs.readFileSync(store.path + ".recovery", "utf8"))).toEqual(original);
    expect(new Conf({ cwd: directory }).get("rendererPreferences.recordLocation")).toBe("next-position");
  });
  it("keeps normal atomic writes and never rolls back a valid newer configuration", () => {
    const { store, directory } = setup();
    fs.writeFileSync(store.path + ".recovery", JSON.stringify(original));
    store.set("mainWinWidth", 1200);
    expect(createConfigStore(Conf, directory).get("mainWinWidth")).toBe(1200);
  });
  it.each(["", '{"incomplete":'])("recovers the last-good copy after an interrupted overwrite", (partial) => {
    const { store, directory } = setup();
    fs.writeFileSync(store.path + ".recovery", JSON.stringify(original));
    fs.writeFileSync(store.path, partial);
    expect(createConfigStore(Conf, directory).store).toEqual(original);
  });
  it("does not overwrite the current config when backup creation fails", () => {
    const { store } = setup(); const before = fs.readFileSync(store.path);
    denyRename(store.path);
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((filename, flags, mode) => {
      if (filename === store.path + ".recovery") throw Object.assign(new Error("Backup not writable"), { code: "EACCES" });
      return open(filename, flags, mode);
    });
    expect(() => store.set("mainWinWidth", 1200)).toThrow("Backup not writable");
    expect(fs.readFileSync(store.path)).toEqual(before);
  });
  it("reports failed primary writes and retains a valid recovery file", () => {
    const { store } = setup();
    denyRename(store.path);
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((filename, flags, mode) => {
      if (filename === store.path && flags === "w") throw Object.assign(new Error("Config not writable"), { code: "EACCES" });
      return open(filename, flags, mode);
    });
    expect(() => store.set("mainWinWidth", 1200)).toThrow("Config not writable");
    expect(JSON.parse(fs.readFileSync(store.path + ".recovery", "utf8"))).toEqual(original);
    expect(JSON.parse(fs.readFileSync(store.path, "utf8"))).toEqual(original);
  });
  it("does not use the fallback for unrelated I/O errors or a different rename target", () => {
    const { store } = setup(); const before = fs.readFileSync(store.path);
    const write = denyRename(store.path, "ENOSPC");
    expect(() => store.set("mainWinWidth", 1200)).toThrow("Synthetic Windows rename lock");
    write.mockRestore(); denyRename(path.join(root, "other.json"));
    expect(() => store.set("mainWinWidth", 1200)).toThrow("Synthetic Windows rename lock");
    expect(fs.readFileSync(store.path)).toEqual(before);
    expect(fs.existsSync(store.path + ".recovery")).toBe(false);
  });
});
