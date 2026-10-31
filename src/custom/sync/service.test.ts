import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Change, RawData, Row, Table } from "./types";

interface Client { id: number; raw: RawData; storagePath: string; handle: (event: { sender: { id: number } }, request: Record<string, unknown>) => Promise<unknown> }
const fixture = vi.hoisted(() => ({ current: null as Client | null, failTable: "" as string, editAfterStage: false }));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: {
  getItem: (key: string) => fixture.current!.raw.config[key],
  setItem: (key: string, value: string) => { fixture.current!.raw.config[key] = value; },
  removeItem: (key: string) => { delete fixture.current!.raw.config[key]; },
  getReaderConfig: () => "",
} }));
vi.mock("../../utils/common", () => ({ getStorageLocation: () => fixture.current!.storagePath }));
vi.mock("../../utils/file/bookUtil", () => ({ default: { getBookPath: (book: Row) => String(book.path || "") } }));
vi.mock("../../utils/storage/databaseService", () => ({ default: { getAllRecords: async (table: Table) => JSON.parse(JSON.stringify(fixture.current!.raw.tables[table])) as Row[] } }));
vi.mock("../../store/useAppStore", () => ({ useAppStore: { getState: () => ({ handleFetchBooks: async () => undefined, handleFetchNotes: async () => undefined, handleFetchBookmarks: async () => undefined }) } }));
import { restoreSyncBackup, runCustomSync } from "./service";
import { copy, stable } from "./protocol";

const require = createRequire(import.meta.url);
const { createCustomSync } = require("../../utils/main/custom/sync.js") as typeof import("../../utils/main/custom/sync.js");
const { isInside } = require("../../utils/main/custom/runtime.js") as typeof import("../../utils/main/custom/runtime.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-service-"));
const remote = path.join(root, "remote"); fs.mkdirSync(remote);
beforeAll(() => {
  vi.stubGlobal("window", { electronAPI: { invoke: async (channel: string, request: Record<string, unknown>) => {
    const client = fixture.current!;
    if (channel === "custom-sync") {
      const result = await client.handle({ sender: { id: client.id } }, request);
      if (request.action === "stage" && fixture.editAfterStage) { fixture.editAfterStage = false; client.raw.tables.notes[0].text = "Edited during upload"; }
      return result;
    }
    if (channel !== "database-command" || request.statement !== "customSyncBatch") throw new Error("Unexpected IPC");
    const table = request.dbName as Table;
    if (fixture.failTable === table) { fixture.failTable = ""; throw new Error("Synthetic database failure"); }
    const data = request.data as Change[];
    const next = copy(client.raw.tables[table]);
    for (const change of data) if (stable(next.find((row) => row.key === change.key) || null) !== stable(change.before)) throw new Error("CUSTOM_LOCAL_CHANGED");
    for (const change of data) {
      const index = next.findIndex((row) => row.key === change.key);
      if (index >= 0) next.splice(index, 1);
      if (change.value) next.push(copy(change.value));
    }
    client.raw.tables[table] = next;
    return { applied: data.length };
  } } });
});
afterAll(() => { vi.unstubAllGlobals(); if (isInside(os.tmpdir(), root) && path.basename(root).startsWith("krc-unit-service-")) fs.rmSync(root, { recursive: true, force: true }); });
async function client(id: number, namespace: string): Promise<Client> {
  const profile = path.join(root, `client-${id}`); fs.mkdirSync(profile);
  const bookPath = path.join(profile, "synthetic.epub"); fs.writeFileSync(bookPath, "Identical book contents on separate devices");
  const key = `${id}-book`;
  const transport = createCustomSync({ app: { getPath: () => profile }, safeStorage: {}, dialog: {}, shell: {}, runtime: { testing: true, root }, hasReaders: () => false });
  const result: Client = { id, storagePath: path.join(profile, "uploads", "data"), handle: transport.handle,
    raw: { tables: { books: [{ key, name: "Book", format: "EPUB", path: bookPath, cover: "local-cover" }], notes: [], bookmarks: [] }, config: { readingTime: JSON.stringify({ [key]: 100 }), readingStats: JSON.stringify({ "2026-10-31": [`${key}-100`] }) } },
  };
  await result.handle({ sender: { id } }, { action: "configure", provider: "folder", folder: remote, namespace, autoMinutes: 0 });
  return result;
}
async function sync(client: Client) { fixture.current = client; return runCustomSync(); }

describe("full personal-sync lifecycle with separate device profiles", () => {
  it("does not publish new generations for unchanged data, and publishes actual edits", async () => {
    const a = await client(40, "unchanged");
    await sync(a);
    const directory = path.join(remote, "KoodoReaderCustom-v1-unchanged");
    const before = fs.readdirSync(directory).filter(name => name.endsWith(".json"));
    for (let index = 0; index < 4; index++) expect((await sync(a)).unchanged).toBe(true);
    expect(fs.readdirSync(directory).filter(name => name.endsWith(".json"))).toEqual(before);
    a.raw.tables.books[0].name = "Actually changed";
    expect((await sync(a)).unchanged).toBe(false);
    expect(fs.readdirSync(directory).filter(name => name.endsWith(".json"))).toHaveLength(2);
  });
  it("converges notes and per-device time increments across retries without touching local book files", async () => {
    const a = await client(1, "devices"), b = await client(2, "devices");
    a.raw.tables.notes = [{ key: "same-timestamp", bookKey: "1-book", text: "Device A" }];
    b.raw.tables.notes = [{ key: "same-timestamp", bookKey: "2-book", text: "Device B" }];
    await sync(a); await sync(b); await sync(a);
    expect(a.raw.tables.notes).toHaveLength(2); expect(b.raw.tables.notes).toHaveLength(2);
    a.raw.config.readingTime = JSON.stringify({ "1-book": 110 }); a.raw.config.readingStats = JSON.stringify({ "2026-10-31": ["1-book-110"] });
    b.raw.config.readingTime = JSON.stringify({ "2-book": 120 }); b.raw.config.readingStats = JSON.stringify({ "2026-10-31": ["2-book-120"] });
    await sync(a); await sync(b); await sync(a); await sync(b);
    expect(JSON.parse(a.raw.config.readingTime!)["1-book"]).toBe(130);
    expect(JSON.parse(b.raw.config.readingTime!)["2-book"]).toBe(130);
    expect(JSON.parse(a.raw.config.readingStats!)["2026-10-31"]).toEqual(["1-book-130"]);
    expect(a.raw.tables.books[0].cover).toBe("local-cover");
    expect(fs.readFileSync(String(a.raw.tables.books[0].path), "utf8")).toBe("Identical book contents on separate devices");
    const folder = path.join(remote, "KoodoReaderCustom-v1-devices");
    for (const file of fs.readdirSync(folder)) expect(fs.readFileSync(path.join(folder, file), "utf8")).not.toContain(String(a.raw.tables.books[0].path));
    a.raw.tables.notes = a.raw.tables.notes.filter((row) => row.text !== "Device B");
    await sync(a); await sync(b);
    expect(b.raw.tables.notes.map((row) => row.text)).toEqual(["Device A"]);
  });
  it("preserves edits made during an upload and leaves a usable backup and retry checkpoint", async () => {
    const a = await client(3, "stale"), b = await client(4, "stale");
    a.raw.tables.notes = [{ key: "note", bookKey: "3-book", text: "Initial" }];
    await sync(a); await sync(b);
    b.raw.tables.notes[0].text = "Remote edit"; await sync(b);
    fixture.current = a; fixture.editAfterStage = true;
    await expect(runCustomSync()).rejects.toThrow("CUSTOM_LOCAL_CHANGED");
    expect(a.raw.tables.notes[0].text).toBe("Edited during upload");
    const result = await sync(a);
    expect(result.conflicts.some((conflict) => conflict.kind === "note")).toBe(true);
    const backups = path.join(root, "client-3", "custom-sync", "backups");
    expect(fs.readdirSync(backups)).not.toHaveLength(0);
  });
  it("rolls back an earlier table when a later table fails, then retries safely", async () => {
    const a = await client(5, "rollback"), b = await client(6, "rollback");
    a.raw.tables.notes = [{ key: "note", bookKey: "5-book", text: "Note" }];
    await sync(a); await sync(b);
    a.raw.tables.books[0].name = "Renamed"; a.raw.tables.notes[0].text = "Updated"; await sync(a);
    fixture.current = b; fixture.failTable = "notes";
    await expect(runCustomSync()).rejects.toThrow("Synthetic database failure");
    expect(b.raw.tables.books[0].name).toBe("Book"); expect(b.raw.tables.notes[0].text).toBe("Note");
    await sync(b);
    expect(b.raw.tables.books[0].name).toBe("Renamed"); expect(b.raw.tables.notes[0].text).toBe("Updated");
    // Recovery is local and must work without contacting the sync provider.
    const remoteDirectory = path.join(remote, "KoodoReaderCustom-v1-rollback"), unavailable = path.join(remote, "offline-rollback");
    if (!isInside(root, remoteDirectory) || !isInside(root, unavailable)) throw new Error("Unsafe fixture move");
    fs.renameSync(remoteDirectory, unavailable);
    await restoreSyncBackup();
    expect(b.raw.tables.books[0].name).toBe("Book"); expect(b.raw.tables.notes[0].text).toBe("Note");
    const status = await b.handle({ sender: { id: b.id } }, { action: "status" }) as { autoMinutes: number };
    expect(status.autoMinutes).toBe(0);
    fs.renameSync(unavailable, remoteDirectory);
  });
  it("restores missing configuration as absent keys rather than the JSON string null", async () => {
    const a = await client(7, "missing-config");
    await sync(a);
    expect(a.raw.config.recordLocation).toBe("{}");
    await restoreSyncBackup();
    expect(a.raw.config.recordLocation).toBeUndefined();
    expect(a.raw.config.noteTags).toBeUndefined();
  });
});
