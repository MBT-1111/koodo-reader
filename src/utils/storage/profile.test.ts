import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { configureRuntime, isInside } = require("../main/custom/runtime.js") as typeof import("../main/custom/runtime.js");
const { activateProfile, stageStorage, cancelStorage, clearLibrary, PROFILE, BOOTSTRAP } = require("../main/custom/profile.js") as typeof import("../main/custom/profile.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-profile-"));
afterAll(() => { if (isInside(os.tmpdir(), root) && path.basename(root).startsWith("krc-unit-profile-")) fs.rmSync(root, { recursive: true, force: true }); });
const build = { productName: "Koodo Reader Custom", profileName: "koodo-reader-custom", allowOfficialUpdates: false };
const write = (filename: string, value: unknown) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, JSON.stringify(value)); };
const read = (filename: string) => JSON.parse(fs.readFileSync(filename, "utf8"));
const empty = (directory: string) => { fs.mkdirSync(directory, { recursive: true }); return directory; };
const appFor = () => {
  const paths = new Map([["appData", path.join(root, "fake-app-data")]]);
  return { getPath: (name: string) => paths.get(name)!, setPath: (name: string, value: string) => { paths.set(name, value); }, setName() {} };
};
const launch = (testRoot: string) => {
  const app = appFor(), runtime = { ...configureRuntime(app, build, testRoot), storagePath: "", cleanupPending: false };
  activateProfile(app, runtime);
  return { app, runtime };
};
const fixture = (name: string, external = true) => {
  const testRoot = path.join(root, `krc-test-${name}`), app = appFor(), runtime = { ...configureRuntime(app, build, testRoot), storagePath: "", cleanupPending: false };
  const library = empty(external ? path.join(testRoot, "library") : path.join(runtime.profile, "uploads", "data"));
  write(path.join(library, "config", "books.db"), { key: "stable-book", notes: "Preserve existing data" });
  write(path.join(library, "book", "fixture.epub"), "Synthetic book contents");
  const preferences = { storageLocation: library, readerConfig: '{"isEnableDiscordRPC":"yes","isEinkMode":"yes"}', aiModelConfig: '{"fixture":{"apiKey":"synthetic-key"}}' };
  write(path.join(runtime.profile, "config.json"), { rendererPreferences: preferences, proxyConfig: { enabled: true, host: "127.0.0.1", port: 7890 } });
  write(path.join(runtime.profile, "Local State"), { syntheticEncryptedKey: "fixture" });
  write(path.join(runtime.profile, "Cache", "data"), "Synthetic cache");
  return { testRoot, app, runtime, library, preferences };
};

describe("application profile follows the library storage location", () => {
  it("moves an existing external-library profile and restores settings before startup", () => {
    const f = fixture("existing");
    const bootstrap = f.runtime.profile;
    write(path.join(bootstrap, "custom-sync", "settings.json"), { provider: "mega", session: "synthetic-encrypted-session", account: "fixture", namespace: "default", autoMinutes: 0 });
    activateProfile(f.app, f.runtime);
    expect(f.app.getPath("userData")).toBe(path.join(f.library, PROFILE));
    expect(read(path.join(f.runtime.profile, "config.json")).rendererPreferences).toEqual(f.preferences);
    expect(read(path.join(f.runtime.profile, "config.json")).proxyConfig.port).toBe(7890);
    expect(read(path.join(f.runtime.profile, "custom-sync", "settings.json")).session).toBe("synthetic-encrypted-session");
    expect(fs.existsSync(path.join(f.runtime.profile, "Cache", "data"))).toBe(true);
    expect(fs.readdirSync(bootstrap)).toEqual([BOOTSTRAP]);
    expect(Object.keys(read(path.join(bootstrap, BOOTSTRAP))).sort()).toEqual(["profile", "storage", "version"]);
    const restarted = launch(f.testRoot);
    expect(restarted.runtime.profile).toBe(f.runtime.profile);
    expect(restarted.runtime.storagePath).toBe(f.library);
    for (const name of ["userData", "sessionData", "logs", "temp", "crashDumps"]) expect(isInside(f.library, restarted.app.getPath(name))).toBe(true);
  });

  it("moves a library and its profile after restart, preserving sync identities, backups and a folder connection inside it", () => {
    const f = fixture("move"); activateProfile(f.app, f.runtime);
    const originalProfile = f.runtime.profile, destination = empty(path.join(f.testRoot, "new-library"));
    const account = crypto.createHash("sha256").update(f.library).digest("hex");
    const connection = { provider: "folder", folder: f.library, account, namespace: "default", autoMinutes: 15 };
    const scope = (storage: string, owner: string) => crypto.createHash("sha256").update(JSON.stringify([storage, "folder", owner, "default"])).digest("hex");
    const oldScope = scope(f.library, account);
    write(path.join(originalProfile, "custom-sync", "settings.json"), { activeProvider: "folder", connections: { folder: connection } });
    write(path.join(originalProfile, "custom-sync", `${oldScope}.json`), { deviceId: "stable-device", sequence: 8 });
    write(path.join(originalProfile, "custom-sync", `${oldScope}.recovery.json`), { phase: "prepared" });
    write(path.join(f.library, "sync-backups", oldScope, "backup.json"), { before: "fixture" });
    stageStorage(f.runtime, destination, "move");
    expect(fs.readdirSync(destination)).toHaveLength(0);
    expect(fs.existsSync(originalProfile)).toBe(true);
    const restarted = launch(f.testRoot), profile = restarted.runtime.profile;
    expect(profile).toBe(path.join(destination, PROFILE));
    expect(fs.existsSync(f.library)).toBe(false);
    expect(read(path.join(destination, "config", "books.db")).key).toBe("stable-book");
    expect(read(path.join(profile, "config.json")).rendererPreferences).toEqual({ ...f.preferences, storageLocation: destination });
    const saved = read(path.join(profile, "custom-sync", "settings.json")).connections.folder;
    expect(saved.folder).toBe(destination);
    const newScope = scope(destination, saved.account);
    expect(read(path.join(profile, "custom-sync", `${newScope}.json`))).toEqual({ deviceId: "stable-device", sequence: 8 });
    expect(read(path.join(profile, "custom-sync", `${newScope}.recovery.json`))).toEqual({ phase: "prepared" });
    expect(read(path.join(destination, "sync-backups", newScope, "backup.json"))).toEqual({ before: "fixture" });
    expect(launch(f.testRoot).runtime.storagePath).toBe(destination);
  });

  it("moves the original nested default library without copying it a second time into app-profile", () => {
    const f = fixture("default", false); activateProfile(f.app, f.runtime);
    const bootstrap = f.runtime.profile, destination = empty(path.join(f.testRoot, "relocated"));
    stageStorage(f.runtime, destination, "move");
    const restarted = launch(f.testRoot);
    expect(fs.existsSync(path.join(destination, "book", "fixture.epub"))).toBe(true);
    expect(fs.existsSync(path.join(restarted.runtime.profile, "uploads", "data"))).toBe(false);
    expect(fs.readdirSync(bootstrap)).toEqual([BOOTSTRAP]);
  });

  it("keeps each library's profile when switching back and forth", () => {
    const f = fixture("switch"); activateProfile(f.app, f.runtime);
    const second = empty(path.join(f.testRoot, "second-library")); write(path.join(second, "config", "books.db"), { key: "other" });
    write(path.join(second, "config", "config.json"), { shelfList: '{"Other shelf":["other"]}', storageLocation: "obsolete-path" });
    stageStorage(f.runtime, second, "switch");
    const switched = launch(f.testRoot);
    const config = read(path.join(switched.runtime.profile, "config.json")); config.rendererPreferences.readerConfig = '{"isEinkMode":"no"}';
    expect(config.rendererPreferences.shelfList).toBe('{"Other shelf":["other"]}');
    expect(config.rendererPreferences.storageLocation).toBe(second);
    write(path.join(switched.runtime.profile, "config.json"), config);
    stageStorage(switched.runtime, f.library, "switch");
    const original = launch(f.testRoot);
    expect(read(path.join(original.runtime.profile, "config.json")).rendererPreferences.readerConfig).toBe(f.preferences.readerConfig);
    expect(read(path.join(second, PROFILE, "config.json")).rendererPreferences.readerConfig).toBe('{"isEinkMode":"no"}');
  });
  it("preserves the original default library when switching to a different library", () => {
    const f = fixture("switch-default", false); activateProfile(f.app, f.runtime);
    const second = empty(path.join(f.testRoot, "second-library")); write(path.join(second, "config", "books.db"), { key: "other" });
    stageStorage(f.runtime, second, "switch");
    expect(launch(f.testRoot).runtime.storagePath).toBe(second);
    expect(read(path.join(f.library, "config", "books.db")).key).toBe("stable-book");
    expect(fs.existsSync(path.join(second, PROFILE, "uploads", "data"))).toBe(false);
  });

  it("preserves the source and bootstrap when copying fails", () => {
    const f = fixture("copy-failure"); activateProfile(f.app, f.runtime);
    const destination = empty(path.join(f.testRoot, "destination")); stageStorage(f.runtime, destination, "move");
    const before = read(path.join(f.runtime.bootstrapProfile, BOOTSTRAP));
    const copy = vi.spyOn(fs, "copyFileSync").mockImplementationOnce(() => { throw Object.assign(new Error("Synthetic disk full"), { code: "ENOSPC" }); });
    try { expect(() => launch(f.testRoot)).toThrow("Synthetic disk full"); } finally { copy.mockRestore(); }
    expect(fs.existsSync(path.join(f.library, "book", "fixture.epub"))).toBe(true);
    expect(read(path.join(f.runtime.bootstrapProfile, BOOTSTRAP))).toEqual(before);
    expect(fs.readdirSync(destination)).toHaveLength(0);
    cancelStorage(f.runtime);
    expect(launch(f.testRoot).runtime.storagePath).toBe(f.library);
  });

  it("resumes after publishing verified files if committing the bootstrap was interrupted", () => {
    const f = fixture("interrupted"); activateProfile(f.app, f.runtime);
    const destination = empty(path.join(f.testRoot, "destination")); stageStorage(f.runtime, destination, "move");
    const rename = fs.renameSync;
    const interrupted = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === path.join(f.runtime.bootstrapProfile, BOOTSTRAP)) throw new Error("Synthetic pointer interruption");
      return rename(from, to);
    });
    try { expect(() => launch(f.testRoot)).toThrow("Synthetic pointer interruption"); } finally { interrupted.mockRestore(); }
    expect(fs.existsSync(path.join(destination, PROFILE, "config.json"))).toBe(true);
    expect(fs.existsSync(f.library)).toBe(true);
    expect(launch(f.testRoot).runtime.storagePath).toBe(destination);
    expect(fs.existsSync(f.library)).toBe(false);
  });

  it("refuses unavailable profiles rather than silently creating empty settings on the bootstrap drive", () => {
    const f = fixture("unavailable"); activateProfile(f.app, f.runtime);
    const hidden = path.join(f.testRoot, "disconnected-library");
    if (!isInside(root, f.library) || !isInside(root, hidden)) throw new Error("Unsafe fixture move");
    fs.renameSync(f.library, hidden);
    expect(() => launch(f.testRoot)).toThrow("CUSTOM_PROFILE_UNAVAILABLE");
    expect(fs.existsSync(path.join(f.runtime.bootstrapProfile, "config.json"))).toBe(false);
    expect(fs.existsSync(path.join(hidden, PROFILE, "config.json"))).toBe(true);
  });

  it("rejects nonempty, overlapping and unrecognized destinations without altering their data", () => {
    const f = fixture("validation"); activateProfile(f.app, f.runtime);
    const nonempty = empty(path.join(f.testRoot, "nonempty")); write(path.join(nonempty, "keep.json"), "preserve");
    expect(() => stageStorage(f.runtime, nonempty, "move")).toThrow("CUSTOM_PROFILE_FOLDER_NOT_EMPTY");
    expect(() => stageStorage(f.runtime, empty(path.join(f.library, "nested")), "move")).toThrow("CUSTOM_PROFILE_INVALID_PATH");
    expect(() => stageStorage(f.runtime, path.dirname(root), "move")).toThrow("CUSTOM_TEST_PATH_ESCAPE");
    empty(path.join(nonempty, "config")); empty(path.join(nonempty, PROFILE));
    expect(() => stageStorage(f.runtime, nonempty, "switch")).toThrow("CUSTOM_PROFILE_CONFLICT");
    expect(read(path.join(nonempty, "keep.json"))).toBe("preserve");
  });
  it("clears library and sync state without deleting the live profile or its startup pointer", () => {
    const f = fixture("clear"); activateProfile(f.app, f.runtime);
    write(path.join(f.runtime.profile, "custom-sync", "settings.json"), { session: "synthetic" });
    clearLibrary(f.runtime, f.library);
    expect(fs.existsSync(path.join(f.library, "book"))).toBe(false);
    expect(fs.existsSync(path.join(f.library, "config"))).toBe(false);
    expect(fs.existsSync(path.join(f.runtime.profile, "Local State"))).toBe(true);
    expect(fs.existsSync(path.join(f.runtime.profile, "config.json"))).toBe(true);
    expect(fs.readdirSync(path.join(f.runtime.profile, "custom-sync"))).toHaveLength(0);
    expect(read(path.join(f.runtime.bootstrapProfile, BOOTSTRAP)).storage).toBe(f.library);
  });
});
