import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, RawData } from "../sync/types";
import { createDataBackup, DATA_STATE_KEY, rawData } from "../backup/dataBackup";
import { materialize, mergeDocuments } from "../sync/protocol";

interface Client { tables: RawData["tables"]; values: Record<string, string>; hashes: Record<string, string> }
const fixture = vi.hoisted(() => ({ current: null as Client | null, documents: [] as Envelope[], failUpload: false, duringUpload: null as (() => void) | null, uploads: 0 }));
vi.mock("./mega", () => ({
  androidSyncConnection: async () => ({ email: "fixture@example.invalid", namespace: "unit", autoMinutes: 0, scope: "a".repeat(64) }),
  isConnectingMega: () => false,
  configureAndroidMega: vi.fn(), disconnectAndroidSync: vi.fn(),
  withAndroidMega: async (_connection: unknown, action: (transport: { read(): Promise<Envelope[]>; append(document: Envelope): Promise<void> }) => Promise<unknown>) => action({
    read: async () => structuredClone(fixture.documents),
    append: async (document) => {
      if (fixture.failUpload) throw new Error("CUSTOM_MEGA_NETWORK_FAILED");
      fixture.documents.push(structuredClone(document)); fixture.uploads++;
      fixture.duringUpload?.(); fixture.duringUpload = null;
    },
  }),
}));
vi.mock("./backup", () => ({
  fingerprints: async () => fixture.current!.hashes,
  snapshotJob: async (task: (source: { tables: RawData["tables"]; preferences: { values: Record<string, string> } }, token: string) => Promise<unknown>) => task({ tables: structuredClone(fixture.current!.tables), preferences: { values: { ...fixture.current!.values } } }, crypto.randomUUID()),
  commit: async (tables: RawData["tables"], values: Record<string, string>) => { fixture.current!.tables = structuredClone(tables); fixture.current!.values = { ...values }; },
}));
vi.mock("./speechPosition", () => ({ flushSpeechReadingPositions: async () => {} }));
vi.mock("../../store/useAppStore", () => ({ useAppStore: { getState: () => ({ manager: { isSettingOpen: false }, handleFetchBooks: async () => {}, handleFetchNotes: async () => {}, handleFetchBookmarks: async () => {} }) } }));
import { runAndroidSync } from "./sync";

const bookHash = "d".repeat(64);
const client = (key: string): Client => ({
  tables: { books: [{ key, path: `content://fixture/${key}`, format: "EPUB", name: "Shared book" }], notes: [], bookmarks: [] },
  values: { readingTime: JSON.stringify({ [key]: 100 }), readingStats: JSON.stringify({ "2026-11-03": [`${key}-100`] }) }, hashes: { [key]: bookHash },
});
const sync = async (source: Client) => { fixture.current = source; return runAndroidSync(); };
beforeEach(() => {
  fixture.documents = []; fixture.failUpload = false; fixture.uploads = 0; fixture.duringUpload = null;
  vi.stubGlobal("localStorage", { getItem: (key: string) => fixture.current!.values[key] || null });
});

describe("Android shared sync workflow", () => {
  it("keeps a full desktop library when the phone only imports two books", async () => {
    const desktop = client("desktop-a"), phone = client("phone-a");
    for (const [target, prefix, count] of [[desktop, "desktop", 3], [phone, "phone", 2]] as const) {
      target.tables.books = Array.from({ length: count }, (_, index) => ({ key: `${prefix}-${index}`, format: "TXT", name: `Book ${index}`, path: `content://fixture/${prefix}-${index}` }));
      target.hashes = Object.fromEntries(target.tables.books.map((row, index) => [row.key, String(index + 1).repeat(64)]));
      target.values = { readingTime: JSON.stringify(Object.fromEntries(target.tables.books.map(row => [row.key, 100]))) };
    }
    desktop.tables.notes = desktop.tables.books.map((row, index) => ({ key: `note-${index}`, bookKey: row.key, text: `Note ${index}` }));
    desktop.values.recordLocation = JSON.stringify(Object.fromEntries(desktop.tables.books.map(row => [row.key, { percentage: 0.2 }])));
    desktop.values.shelfList = JSON.stringify({ Shared: desktop.tables.books.map(row => row.key) });
    desktop.values.favoriteBooks = JSON.stringify(desktop.tables.books.map(row => row.key));
    await sync(desktop); await sync(phone);
    expect(phone.tables.books).toHaveLength(2); expect(phone.tables.notes).toHaveLength(2);
    expect(Object.keys(JSON.parse(phone.values.readingTime))).toHaveLength(2);
    expect(JSON.parse(phone.values.shelfList).Shared).toHaveLength(2);
    phone.values.readingTime = JSON.stringify({ "phone-0": 110, "phone-1": 100 });
    phone.values.recordLocation = JSON.stringify({ "phone-0": { percentage: 0.4 }, "phone-1": { percentage: 0.2 } });
    await sync(phone); await sync(desktop); await sync(phone);
    expect(desktop.tables.books).toHaveLength(3); expect(desktop.tables.notes).toHaveLength(3);
    expect(JSON.parse(desktop.values.readingTime)).toEqual({ "desktop-0": 110, "desktop-1": 100, "desktop-2": 100 });
    expect(JSON.parse(desktop.values.recordLocation)["desktop-2"]).toEqual({ percentage: 0.2 });
    const cloud = materialize(mergeDocuments(fixture.documents));
    expect(Object.keys(cloud).filter(key => key.startsWith("book/"))).toHaveLength(3);
    expect(Object.keys(cloud).filter(key => key.startsWith("trash/"))).toHaveLength(0);
    expect((await sync(phone)).unchanged).toBe(true);
  });
  it("shares progress and annotations across local book keys, preserving file mappings and stable backup identities", async () => {
    const a = client("phone-a"), b = client("phone-b");
    a.tables.notes = [{ key: "note-a", bookKey: "phone-a", notes: "A note", text: "Quote" }];
    a.tables.bookmarks = [{ key: "bookmark-a", bookKey: "phone-a", cfi: "chapter-2" }];
    a.values.recordLocation = '{"phone-a":{"percentage":0.42}}';
    const backup = await createDataBackup(rawData(a.tables, a.values), a.values, a.hashes);
    a.values[DATA_STATE_KEY] = JSON.stringify(backup.state);
    await sync(a); await sync(b);
    const remote = materialize(mergeDocuments(fixture.documents));
    for (const kind of ["note", "bookmark"]) expect(Object.keys(remote).filter((key) => key.startsWith(`${kind}/`))).toEqual(Object.keys(backup.backup.document.entries).filter((key) => key.startsWith(`${kind}/`)));
    expect(b.tables.notes).toHaveLength(1); expect(b.tables.bookmarks).toHaveLength(1);
    expect(b.tables.notes[0].bookKey).toBe("phone-b");
    expect(b.tables.books[0].path).toBe("content://fixture/phone-b");
    expect(JSON.parse(b.values.recordLocation)["phone-b"].percentage).toBe(0.42);
    expect(JSON.stringify(fixture.documents).includes("content://")).toBe(false);
    await sync(a); const uploads = fixture.uploads; expect((await sync(b)).unchanged).toBe(true);
    expect(fixture.uploads).toBe(uploads); expect(b.tables.notes).toHaveLength(1);
  });
  it("retains pending revisions after a broken upload and retries without duplicating notes or reading time", async () => {
    const a = client("phone-a"), b = client("phone-b");
    await sync(a); await sync(b);
    a.tables.notes = [{ key: "offline-note", bookKey: "phone-a", text: "Offline edit" }];
    a.values.readingTime = '{"phone-a":130}';
    fixture.failUpload = true; await expect(sync(a)).rejects.toThrow("CUSTOM_MEGA_NETWORK_FAILED");
    expect(a.tables.notes[0].text).toBe("Offline edit"); expect(JSON.parse(a.values.readingTime)["phone-a"]).toBe(130);
    fixture.failUpload = false; await sync(a);
    b.values.readingTime = '{"phone-b":150}'; await sync(b); await sync(a); await sync(b);
    expect(JSON.parse(a.values.readingTime)["phone-a"]).toBe(180);
    expect(JSON.parse(b.values.readingTime)["phone-b"]).toBe(180);
    expect(a.tables.notes).toHaveLength(1); expect(b.tables.notes).toHaveLength(1);
  });
  it("joins an existing cloud identity when the same annotation first arrived through a backup", async () => {
    const desktop = client("desktop"), phone = client("phone");
    desktop.tables.notes = [{ key: "desktop-note", bookKey: "desktop", text: "Same copied annotation" }];
    phone.tables.notes = [{ key: "phone-note", bookKey: "phone", text: "Same copied annotation" }];
    await sync(desktop);
    const cloudId = Object.keys(materialize(mergeDocuments(fixture.documents))).find((key) => key.startsWith("note/"));
    const backup = await createDataBackup(rawData(phone.tables, phone.values), phone.values, phone.hashes);
    phone.values[DATA_STATE_KEY] = JSON.stringify(backup.state);
    await sync(phone);
    expect(phone.tables.notes).toHaveLength(1);
    expect(Object.keys(materialize(mergeDocuments(fixture.documents))).filter((key) => key.startsWith("note/"))).toEqual([cloudId]);
    const exported = await createDataBackup(rawData(phone.tables, phone.values), phone.values, phone.hashes);
    expect(Object.keys(exported.backup.document.entries).filter((key) => key.startsWith("note/"))).toEqual([cloudId]);
  });
  it("refuses to overwrite an edit made during upload and incorporates it on the next attempt", async () => {
    const a = client("phone-a"); a.values.recordLocation = '{"phone-a":{"percentage":0.1}}';
    fixture.duringUpload = () => { a.values.recordLocation = '{"phone-a":{"percentage":0.7}}'; };
    await expect(sync(a)).rejects.toThrow("CUSTOM_LOCAL_CHANGED");
    expect(JSON.parse(a.values.recordLocation)["phone-a"].percentage).toBe(0.7);
    await sync(a);
    expect(materialize(mergeDocuments(fixture.documents))[`progress/${bookHash}`].value).toEqual({ percentage: 0.7 });
  });
  it("retains remote data until its original is linked locally", async () => {
    const a = client("phone-a"), b = client("phone-b");
    a.tables.notes = [{ key: "note", bookKey: "phone-a", text: "Pending" }];
    await sync(a); b.tables.books = []; b.hashes = {};
    expect((await sync(b)).pendingBooks).toBe(1); expect(b.tables.notes).toHaveLength(0);
    b.tables.books = [{ key: "phone-b", name: "Shared book", format: "EPUB", path: "content://fixture/phone-b" }]; b.hashes["phone-b"] = bookHash;
    expect((await sync(b)).pendingBooks).toBe(0); expect(b.tables.notes).toHaveLength(1);
  });
});
