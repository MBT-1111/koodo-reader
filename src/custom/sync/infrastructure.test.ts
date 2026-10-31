import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterAll, describe, expect, it } from "vitest";
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
