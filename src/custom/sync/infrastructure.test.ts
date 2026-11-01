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
const restoredStorage = (root: unknown, load: () => Promise<void>) => {
  const api = { gateway: "https://synthetic.invalid/", sid: "fixture", close: () => undefined, emit: () => true,
    fetch: async () => new Response('{"w":"https://synthetic.invalid/wait"}'),
    request: (_command: unknown, callback?: (error: null, reply: { f: unknown[]; sn: string }) => void) => {
      const reply = { f: [], sn: "fixture-sequence" }; callback?.(null, reply); return Promise.resolve(reply);
    },
  };
  return { ready: Promise.resolve(), root, api, reload: async () => {
    await load(); await new Promise<void>((resolve) => api.request({ a: "f", c: 1 }, () => resolve()));
  } } as unknown as InstanceType<typeof import("megajs").Storage>;
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
    const restored = vi.spyOn(Storage, "fromJSON").mockImplementation((data) => restoredStorage({ children: [] }, async () => {
        if (failure) throw new Error(failure);
        await data.options.fetch!("https://synthetic.invalid/mega", { method: "POST", body: "[]" });
      }));
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
  it("allows a sync directory beside app-profile while rejecting sync files inside the live profile", async () => {
    const library = path.join(root, "combined-library"), profile = path.join(library, "app-profile");
    fs.mkdirSync(profile, { recursive: true });
    const sync = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: true, root }, hasReaders: () => false, safeStorage: {}, shell: {}, dialog: {} });
    const event = { sender: { id: 31 } };
    await sync.handle(event, { action: "configure", provider: "folder", folder: library, namespace: "default", autoMinutes: 0 });
    expect(fs.existsSync(path.join(library, "KoodoReaderCustom-v1-default"))).toBe(true);
    await expect(sync.handle(event, { action: "configure", provider: "folder", folder: profile, namespace: "default", autoMinutes: 0 })).rejects.toThrow("CUSTOM_UNSAFE_FOLDER");
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
    const storage = { status: "closed", root: { children: [] as typeof folder[], mkdir: async () => { storage.root.children.push(folder); return folder; } }, mkdir: () => { throw new Error("Storage convenience methods require ready status"); }, api: { close: () => undefined } };
    const provider = new MegaProvider(storage, "mega");
    const state = reconcile(freshCheckpoint(), {}, []);
    await provider.append(envelope(state));
    expect(await provider.read()).toEqual([envelope(state)]);
    await provider.close();
  });
  it("reuses an actual SDK session across provider cleanup without sending a logout command", async () => {
    const profile = path.join(root, "mega-session-profile"); fs.mkdirSync(path.join(profile, "custom-sync"), { recursive: true });
    const session = { key: Buffer.alloc(16, 1).toString("base64url"), sid: "synthetic-session", name: "Fixture", user: "fixture", options: { email: "fixture@example.invalid", keepalive: false } };
    fs.writeFileSync(path.join(profile, "custom-sync", "settings.json"), JSON.stringify({ provider: "mega", account: "fixture", namespace: "default", autoMinutes: 0, session: Buffer.from(JSON.stringify(session)).toString("base64") }));
    const commands: string[] = [];
    let validSession = true;
    const network: typeof globalThis.fetch = async (_url, options) => {
      if (String(_url).includes("/sc?")) { commands.push("sc"); return new Response('{"w":"https://synthetic.invalid/wait"}'); }
      const command = (JSON.parse(String(options?.body)) as { a: string }[])[0].a; commands.push(command);
      if (command === "sml") validSession = false;
      return new Response(JSON.stringify([validSession ? { ok: [], sn: "fixture-sequence", f: [{ h: "root", t: 2, ts: 0 }] } : -15]));
    };
    const create = () => createCustomSync({ app: { getPath: () => profile }, runtime: { testing: false, root }, hasReaders: () => false,
      safeStorage: { isEncryptionAvailable: () => true, decryptString: (value: Buffer) => value.toString() }, shell: {}, dialog: {}, fetch: network });
    const event = { sender: { id: 32 } };
    await create().handle(event, { action: "test", provider: "mega" });
    await create().handle(event, { action: "test", provider: "mega" });
    expect(commands).toEqual(["f", "sc", "f", "sc"]);
    expect(validSession).toBe(true);
  });
  it.each([["lower", "content-length"], ["mixed", "Content-Length"], ["upper", "CONTENT-LENGTH"]])("lets the Electron transport derive upload length (%s)", async (suffix, header) => {
    const profile = path.join(root, `mega-content-length-${suffix}`); fs.mkdirSync(path.join(profile, "custom-sync"), { recursive: true });
    fs.writeFileSync(path.join(profile, "custom-sync", "settings.json"), JSON.stringify({ provider: "mega", account: "fixture", namespace: "default", autoMinutes: 0, session: Buffer.from(JSON.stringify({ options: {} })).toString("base64") }));
    const body = Buffer.from("Synthetic encrypted upload chunk"), headers = { [header]: body.length, "Content-Type": "application/octet-stream" };
    const network = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      if (new Headers(options?.headers).has("content-length")) throw new Error("net::ERR_INVALID_ARGUMENT");
      expect(new Headers(options?.headers).get("content-type")).toBe("application/octet-stream");
      expect(options?.body).toBe(body); expect(options?.signal).toBeInstanceOf(AbortSignal);
      return new Response("[]");
    });
    const { Storage } = require("megajs") as typeof import("megajs");
    const restored = vi.spyOn(Storage, "fromJSON").mockImplementation((data) => restoredStorage({ children: [] }, async () => {
      await (data.options.fetch! as typeof globalThis.fetch)("https://synthetic.invalid/upload", { method: "POST", headers: headers as unknown as HeadersInit, body });
    }));
    try {
      const sync = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: false, root }, hasReaders: () => false,
        safeStorage: { isEncryptionAvailable: () => true, decryptString: (value: Buffer) => value.toString() }, shell: {}, dialog: {}, fetch: network });
      await expect(sync.handle({ sender: { id: 34 } }, { action: "test", provider: "mega" })).resolves.toBe(true);
      expect(network).toHaveBeenCalledTimes(1); expect(headers[header]).toBe(body.length);
    } finally { restored.mockRestore(); }
  });
  it.each([false, true])("handles slow MEGA requests and cancels stalled transfers (stalled=%s)", async (stalled) => {
    vi.useFakeTimers();
    const profile = path.join(root, `mega-deadline-${stalled}`); fs.mkdirSync(path.join(profile, "custom-sync"), { recursive: true });
    const credentials = { options: { email: "fixture@example.invalid" } };
    fs.writeFileSync(path.join(profile, "custom-sync", "settings.json"), JSON.stringify({ provider: "mega", account: "fixture", namespace: "default", autoMinutes: 0, session: Buffer.from(JSON.stringify(credentials)).toString("base64") }));
    let cancelled = false;
    const network = vi.fn<typeof globalThis.fetch>(async (url, options) => {
      if (stalled && String(url).endsWith("/body")) return new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => { cancelled = true; reject(options!.signal!.reason); }, { once: true });
      });
      if (!stalled) await new Promise((resolve) => setTimeout(resolve, 25000));
      return new Response("[]");
    });
    const { Storage } = require("megajs") as typeof import("megajs");
    let fetchAgain: typeof globalThis.fetch | undefined;
    const state = envelope(reconcile(freshCheckpoint(), {}, [])), buffer = Buffer.from(JSON.stringify(state));
    const restored = vi.spyOn(Storage, "fromJSON").mockImplementation((data) => {
      const fetch = data.options.fetch! as typeof globalThis.fetch; fetchAgain = fetch;
      const file = { name: documentName(state, buffer.toString()), directory: false, size: buffer.length, downloadBuffer: async () => {
        await fetch("https://synthetic.invalid/body");
        if (!stalled) await fetch("https://synthetic.invalid/verify");
        return buffer;
      } };
      return restoredStorage({ children: [{ name: "KoodoReaderCustom-v1-default", nodeId: "folder", directory: true, children: [file] }] }, async () => { await fetch("https://synthetic.invalid/tree"); });
    });
    try {
      const sync = createCustomSync({ app: { getPath: () => profile }, runtime: { testing: false, root }, hasReaders: () => false,
        safeStorage: { isEncryptionAvailable: () => true, decryptString: (value: Buffer) => value.toString() }, shell: {}, dialog: {}, fetch: network });
      const event = { sender: { id: 33 } };
      const pending = sync.handle(event, { action: "begin", provider: "mega", storagePath: path.join(root, "deadline-library") }) as Promise<{ token: string; documents: unknown[] }>;
      const completed = pending.then((value) => ({ value, error: null }), (error: Error) => ({ value: null, error }));
      await vi.advanceTimersByTimeAsync(stalled ? 60001 : 75001);
      const result = await completed;
      if (stalled) {
        expect(result.error?.message).toBe("CUSTOM_PROVIDER_TIMEOUT"); expect(cancelled).toBe(true);
        await expect(fetchAgain!("https://synthetic.invalid/late-retry")).rejects.toThrow("CUSTOM_PROVIDER_TIMEOUT");
        expect(network).toHaveBeenCalledTimes(2);
      } else {
        expect(result.error).toBeNull(); expect(result.value?.documents).toEqual([state]);
        await sync.handle(event, { action: "abort", token: result.value!.token });
      }
      expect(sync.busy()).toBe(false);
    } finally { restored.mockRestore(); vi.useRealTimers(); }
  });
});
