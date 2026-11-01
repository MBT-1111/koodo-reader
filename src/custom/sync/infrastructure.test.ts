import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "./types";
import { envelope, freshCheckpoint, reconcile } from "./protocol";

const require = createRequire(import.meta.url);
const { FolderProvider, MegaProvider, documentName } = require("../../utils/main/custom/providers.js") as typeof import("../../utils/main/custom/providers.js");
const { configureRuntime, assertOfficialUpdateAllowed, isInside, assertTestPath } = require("../../utils/main/custom/runtime.js") as typeof import("../../utils/main/custom/runtime.js");
const { createCustomSync } = require("../../utils/main/custom/sync.js") as typeof import("../../utils/main/custom/sync.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-infra-"));
afterAll(() => { if (isInside(os.tmpdir(), root) && path.basename(root).startsWith("krc-unit-infra-")) fs.rmSync(root, { recursive: true, force: true }); });
const config = { productName: "Koodo Reader Custom", profileName: "koodo-reader-custom", allowOfficialUpdates: false };
const fakeApp = () => {
  const paths = new Map<string, string>([["appData", path.join(root, "app-data")]]);
  return { getPath: (name: string) => paths.get(name)!, setPath: (name: string, value: string) => { paths.set(name, value); }, setName: () => undefined };
};

describe("isolated runtime", () => {
  it("sets every persistence/cache path before modules load and never uses the official profile", () => {
    const app = fakeApp(), directory = path.join(root, "krc-test-clean");
    const runtime = configureRuntime(app, config, directory);
    expect(runtime.testing).toBe(true);
    for (const name of ["appData", "userData", "sessionData", "temp", "logs", "crashDumps"]) expect(isInside(directory, app.getPath(name))).toBe(true);
    expect(() => configureRuntime(fakeApp(), config, path.join(root, "existing-library"))).toThrow("CUSTOM_UNSAFE_TEST_PROFILE");
    expect(() => assertOfficialUpdateAllowed(config)).toThrow("CUSTOM_OFFICIAL_UPDATE_DISABLED");
    expect(() => assertTestPath(runtime, path.join(root, "official-library", "book.epub"))).toThrow("CUSTOM_TEST_PATH_ESCAPE");
  });
  it("refuses a nonempty existing directory even when its name resembles a test profile", () => {
    const directory = path.join(root, "krc-test-existing"); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, "book.epub"), "preserve");
    expect(() => configureRuntime(fakeApp(), config, directory)).toThrow("CUSTOM_TEST_PROFILE_NOT_EMPTY");
    expect(fs.readFileSync(path.join(directory, "book.epub"), "utf8")).toBe("preserve");
  });
});
describe("immutable folder provider", () => {
  it("reads latest per-device snapshots, keeps history, and rejects corrupted latest files", async () => {
    const provider = new FolderProvider(root, "test");
    const first = reconcile(freshCheckpoint(), { [`progress/${"a".repeat(64)}`]: { kind: "progress", value: { text: "one" } } }, []);
    await provider.append(envelope(first));
    const next = reconcile(first, { [`progress/${"a".repeat(64)}`]: { kind: "progress", value: { text: "two" } } }, []);
    await provider.append(envelope(next)); await provider.append(envelope(next));
    expect(fs.readdirSync(provider.root).filter((f) => f.endsWith(".json"))).toHaveLength(2);
    expect(await provider.read()).toEqual([envelope(next)]);
    const filename = documentName(envelope(next), JSON.stringify(envelope(next)));
    fs.writeFileSync(path.join(provider.root, filename), "corrupt");
    await expect(provider.read()).rejects.toThrow("CUSTOM_CORRUPT_DOCUMENT");
  });
  it("rejects path traversal in the namespace at the IPC boundary and releases stale-owner sessions", async () => {
    const app = fakeApp(), testRoot = path.join(root, "krc-test-transport");
    const runtime = configureRuntime(app, config, testRoot), folder = path.join(testRoot, "remote"); fs.mkdirSync(folder);
    const sync = createCustomSync({ app, runtime, hasReaders: () => false,
      safeStorage: { isEncryptionAvailable: () => false }, dialog: {}, shell: { openPath: async () => "" },
    });
    const event = { sender: { id: 1 } }, other = { sender: { id: 2 } };
    await expect(sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "../escape", autoMinutes: 0 })).rejects.toThrow("CUSTOM_INVALID_SETTINGS");
    await sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "test", autoMinutes: 0 });
    const begun = await sync.handle(event, { action: "begin", storagePath: path.join(testRoot, "profile", "uploads", "data") }) as { token: string };
    await expect(sync.handle(other, { action: "abort", token: begun.token })).rejects.toThrow("CUSTOM_SESSION_EXPIRED");
    await expect(sync.handle(event, { action: "fingerprints", token: begun.token, books: [{ key: "book", path: path.join(root, "outside.epub") }] })).rejects.toThrow("CUSTOM_TEST_PATH_ESCAPE");
    await sync.handle(event, { action: "abort", token: begun.token });
    expect(sync.busy()).toBe(false);
    await expect(sync.handle(event, { action: "configure", provider: "mega", email: "demo@example.com", password: "synthetic", namespace: "test", autoMinutes: 0 })).rejects.toThrow("CUSTOM_TEST_NETWORK_BLOCKED");
  });
  it("bounds verified per-device history while preserving the latest three complete generations", async () => {
    const provider = new FolderProvider(root, "retention");
    let state = freshCheckpoint();
    for (let i = 0; i < 6; i++) { state = reconcile(state, {}, []); await provider.append(envelope(state)); }
    expect(fs.readdirSync(provider.root).filter((name) => name.endsWith(".json"))).toHaveLength(3);
    expect(await provider.read()).toEqual([envelope(state)]);
  });
  it("refuses to begin while a reader can still change progress or statistics", async () => {
    const app = fakeApp(), testRoot = path.join(root, "krc-test-reader");
    const runtime = configureRuntime(app, config, testRoot), folder = path.join(testRoot, "remote"); fs.mkdirSync(folder);
    const sync = createCustomSync({ app, runtime, hasReaders: () => true, safeStorage: {}, dialog: {}, shell: {} });
    const event = { sender: { id: 3 } };
    await sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "test", autoMinutes: 0 });
    await expect(sync.handle(event, { action: "begin", storagePath: path.join(testRoot, "profile", "uploads", "data") })).rejects.toThrow("CUSTOM_CLOSE_READERS");
  });
  it("blocks automatic continuation after a renderer disappears during local application", async () => {
    const app = fakeApp(), testRoot = path.join(root, "krc-test-crash");
    const runtime = configureRuntime(app, config, testRoot), folder = path.join(testRoot, "remote"); fs.mkdirSync(folder);
    const sync = createCustomSync({ app, runtime, hasReaders: () => false, safeStorage: {}, dialog: {}, shell: {} });
    const sender = Object.assign(new EventEmitter(), { id: 8 }), event = { sender };
    await sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "test", autoMinutes: 5 });
    const storagePath = path.join(testRoot, "profile", "uploads", "data");
    const begun = await sync.handle(event, { action: "begin", storagePath }) as { token: string };
    const state = reconcile(freshCheckpoint(), {}, []), backup = { tables: { books: [], notes: [], bookmarks: [] }, config: {} };
    await sync.handle(event, { action: "stage", token: begun.token, checkpoint: state, document: envelope(state), backup });
    await sync.handle(event, { action: "applying", token: begun.token });
    sender.emit("destroyed");
    expect(sync.busy()).toBe(false);
    await expect(sync.handle(event, { action: "begin", storagePath })).rejects.toThrow("CUSTOM_RECOVERY_REQUIRED");
    expect(sync.status().autoMinutes).toBe(0);
    const recovery = await sync.handle(event, { action: "begin-restore", storagePath }) as { token: string; backup: unknown };
    expect(recovery.backup).toEqual(backup);
    await sync.handle(event, { action: "stage-restore", token: recovery.token, backup });
    await sync.handle(event, { action: "applying", token: recovery.token });
    await sync.handle(event, { action: "finish-restore", token: recovery.token });
    expect(sync.busy()).toBe(false);
  });
});

describe("MEGA adapter public API contract", () => {
  it("migrates the saved session, keeps both connections, selects explicitly, and uses the supplied network transport", async () => {
    const profile = path.join(root, "multi-profile"), folder = path.join(root, "multi-remote"), storagePath = path.join(root, "library-on-another-drive");
    fs.mkdirSync(path.join(profile, "custom-sync"), { recursive: true }); fs.mkdirSync(folder);
    const settingsFile = path.join(profile, "custom-sync", "settings.json");
    const session = Buffer.from(JSON.stringify({ options: { email: "fixture@example.invalid" } })).toString("base64");
    fs.writeFileSync(settingsFile, JSON.stringify({ provider: "mega", namespace: "saved-mega", autoMinutes: 5, session, account: "synthetic-account" }));
    const network = vi.fn(async () => new Response("[]")), openPath = vi.fn(async () => "");
    const sync = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: false, root }, hasReaders: () => false,
      safeStorage: { isEncryptionAvailable: () => true, decryptString: (value: Buffer) => value.toString() }, dialog: {}, shell: { openPath }, fetch: network });
    const event = { sender: { id: 21 } };
    expect(sync.status().connections[0]).toMatchObject({ provider: "mega", email: "fixture@example.invalid", namespace: "saved-mega" });
    expect(JSON.stringify(sync.status())).not.toContain(session);
    const { Storage } = require("megajs") as typeof import("megajs");
    let failure = "";
    const restored = vi.spyOn(Storage, "fromJSON").mockImplementation((data) => ({
      ready: Promise.resolve(), root: { children: [] },
      reload: async () => {
        if (failure) throw new Error(failure);
        await data.options.fetch!("https://synthetic.invalid/mega", { method: "POST", body: "[]" });
      }, close: async () => undefined,
    }) as unknown as InstanceType<typeof Storage>);
    try {
      const saved = await sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "saved-folder", autoMinutes: 0 }) as SyncStatus;
      expect(saved.connections).toHaveLength(2);
      expect(saved.busy).toBe(false);
      const disk = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      expect(disk.connections.mega.session).toBe(session);
      const restarted = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: false, root }, hasReaders: () => false, safeStorage: {}, dialog: {}, shell: {} });
      expect(restarted.status().connections.map((item) => item.provider)).toEqual(["mega", "folder"]);
      // No provider means the last saved connection; an explicit target never uses that default.
      const local = await sync.handle(event, { action: "begin", storagePath }) as { token: string };
      expect(network).not.toHaveBeenCalled();
      await sync.handle(event, { action: "abort", token: local.token });
      const remote = await sync.handle(event, { action: "begin", storagePath, provider: "mega" }) as { token: string };
      expect(network).toHaveBeenCalledWith("https://synthetic.invalid/mega", expect.objectContaining({ signal: expect.any(AbortSignal) }));
      await sync.handle(event, { action: "abort", token: remote.token });
      failure = "ESID (-15): Invalid or expired user session, please relogin";
      await expect(sync.handle(event, { action: "test", provider: "mega" })).rejects.toThrow("CUSTOM_MEGA_AUTH_FAILED");
      expect(sync.busy()).toBe(false);
      // Enabling automatic sync on the folder switches off MEGA, while retaining the account.
      await sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "saved-folder", autoMinutes: 15 });
      expect(sync.status("mega").autoMinutes).toBe(0);
      failure = "";
      const sender = Object.assign(new EventEmitter(), { id: 23 }), recoveryEvent = { sender };
      const begun = await sync.handle(recoveryEvent, { action: "begin", storagePath, provider: "mega" }) as { token: string };
      expect(sync.status().provider).toBe("mega");
      expect(sync.status("folder").autoMinutes).toBe(15); // Manual selection leaves the automatic target intact.
      const state = reconcile(freshCheckpoint(), {}, []), backup = { tables: { books: [], notes: [], bookmarks: [] }, config: {} };
      await sync.handle(recoveryEvent, { action: "stage", token: begun.token, checkpoint: state, document: envelope(state), backup, publish: false });
      await sync.handle(recoveryEvent, { action: "applying", token: begun.token });
      sender.emit("destroyed");
      await expect(sync.handle(event, { action: "begin", storagePath, provider: "folder" })).rejects.toThrow("CUSTOM_RECOVERY_REQUIRED");
      expect(sync.status().connections.every((item) => item.autoMinutes === 0)).toBe(true);
      const recovery = await sync.handle(event, { action: "begin-restore", storagePath, provider: "mega" }) as { token: string };
      await sync.handle(event, { action: "stage-restore", token: recovery.token, backup });
      await sync.handle(event, { action: "applying", token: recovery.token });
      await sync.handle(event, { action: "finish-restore", token: recovery.token });
      await sync.handle(event, { action: "open-folder", provider: "folder" });
      expect(openPath).toHaveBeenLastCalledWith(path.join(folder, "KoodoReaderCustom-v1-saved-folder"));
      await sync.handle(event, { action: "backups", storagePath });
      expect(openPath).toHaveBeenLastCalledWith(path.join(storagePath, "sync-backups"));
      openPath.mockResolvedValueOnce("Synthetic shell failure");
      await expect(sync.handle(event, { action: "backups", storagePath })).rejects.toThrow("CUSTOM_OPEN_FOLDER_FAILED");
      const remaining = await sync.handle(event, { action: "disconnect", provider: "folder" }) as SyncStatus;
      expect(remaining.connections.map((item) => item.provider)).toEqual(["mega"]);
      expect(JSON.parse(fs.readFileSync(settingsFile, "utf8")).connections.mega.session).toBe(session);
      const reopened = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: false, root }, hasReaders: () => false, safeStorage: {}, dialog: {}, shell: {} });
      expect(reopened.status().connections[0].namespace).toBe("saved-mega");
    } finally { restored.mockRestore(); }
  });
  it("reports folder access failures without labelling them as cloud/network errors", async () => {
    const profile = path.join(root, "folder-error-profile"), folder = path.join(root, "folder-error-remote"); fs.mkdirSync(folder);
    const sync = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: true, root }, hasReaders: () => false, safeStorage: {}, dialog: {}, shell: {} });
    const event = { sender: { id: 22 } };
    await expect(sync.handle(event, { action: "configure", provider: "folder", folder: path.join(root, "missing"), namespace: "default", autoMinutes: 0 })).rejects.toThrow("CUSTOM_FOLDER_ACCESS_FAILED");
    await sync.handle(event, { action: "configure", provider: "folder", folder, namespace: "default", autoMinutes: 0 });
    const target = path.join(folder, "KoodoReaderCustom-v1-default");
    const readdir = vi.spyOn(fs, "readdirSync").mockImplementationOnce(() => { throw Object.assign(new Error("Synthetic access denial"), { code: "EACCES" }); });
    try {
      await expect(sync.handle(event, { action: "begin", provider: "folder", storagePath: path.join(root, "folder-error-library") })).rejects.toThrow("CUSTOM_FOLDER_ACCESS_FAILED");
      expect(fs.existsSync(target)).toBe(true);
      expect(sync.busy()).toBe(false);
    } finally { readdir.mockRestore(); }
  });
  it("works through root.mkdir after session restoration and verifies uploaded bytes", async () => {
    interface RemoteFile { name: string; directory: boolean; size: number; downloadBuffer: () => Promise<Buffer>; delete: () => Promise<void> }
    const files: RemoteFile[] = [];
    const folder = { name: "KoodoReaderCustom-v1-mega", nodeId: "node", directory: true, children: files,
      upload: (options: { name: string }, buffer: Buffer, done: (error: null, file: RemoteFile) => void) => {
        const file: RemoteFile = { name: options.name, directory: false, size: buffer.length, downloadBuffer: async () => buffer, delete: async () => { files.splice(files.indexOf(file), 1); } };
        files.push(file); queueMicrotask(() => done(null, file)); return new EventEmitter();
      },
    };
    const storage = { status: "closed", root: { children: [] as typeof folder[], mkdir: async () => { storage.root.children.push(folder); return folder; } }, mkdir: () => { throw new Error("Storage convenience methods require ready status"); }, close: async () => undefined };
    const provider = new MegaProvider(storage, "mega");
    const state = reconcile(freshCheckpoint(), {}, []);
    await provider.append(envelope(state));
    expect(await provider.read()).toEqual([envelope(state)]);
    await provider.close();
  });
});
