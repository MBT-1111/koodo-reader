import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../../utils/storage/databaseService";
import BookUtil from "../../utils/file/bookUtil";
import Book from "../../models/Book";
import { getStorageLocation } from "../../utils/common";
import { useAppStore } from "../../store/useAppStore";
import { changes, configKeys, plan, snapshot, tables } from "./data";
import { acknowledge, conflicts, copy, envelope, freshCheckpoint, materialize, mergeDocuments, reconcile, stable, validateEnvelope } from "./protocol";
import { personalMode } from "../personal";
import type { Change, Checkpoint, Conflict, RawData, Row, SyncProvider, SyncStatus, Table } from "./types";

export const customSyncIPC = <T>(action: string, data: Record<string, unknown> = {}): Promise<T> => window.electronAPI.invoke<T>("custom-sync", { ...data, action });
const safeKey = (key: unknown): key is string => typeof key === "string" && /^[\w-]{1,256}$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key);
function checkpoint(input: Checkpoint | null): Checkpoint {
  if (!input) return freshCheckpoint();
  validateEnvelope(input);
  if (!input.observed || typeof input.observed !== "object" || !input.context || typeof input.context !== "object" || !input.mappings || !["books", "notes", "bookmarks"].every((table) => {
    const map = input.mappings[table as keyof Checkpoint["mappings"]];
    return map && typeof map === "object" && !Array.isArray(map) && Object.entries(map).every(([key, id]) => safeKey(key) && typeof id === "string" && (table === "books" ? /^[a-f0-9]{64}$/.test(id) : /^[a-f0-9-]{36}$/.test(id)));
  })) throw new Error("CUSTOM_LOCAL_STATE_CORRUPT");
  return copy(input);
}

async function collect(): Promise<RawData> {
  const rows = await Promise.all(tables.map((table) => DatabaseService.getAllRecords(table) as Promise<unknown>));
  for (const data of rows) if (!Array.isArray(data) || !data.every((row: unknown) => row && typeof row === "object" && safeKey((row as Record<string, unknown>).key)) || new Set(data.map((row: Row) => row.key)).size !== data.length) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
  return {
    tables: Object.fromEntries(tables.map((table, index) => [table, (rows[index] as Row[]).sort((a, b) => a.key.localeCompare(b.key))])) as RawData["tables"],
    config: Object.fromEntries(configKeys.map((key) => [key, ConfigService.getItem(key) || null])),
  };
}
const currentConfig = () => Object.fromEntries(configKeys.map((key) => [key, ConfigService.getItem(key) || null]));

async function apply(expected: RawData, next: RawData, token: string): Promise<void> {
  const applied: { table: Table; changes: Change[] }[] = [];
  const written: string[] = [];
  let started = false;
  const batch = (table: Table, data: Change[]) => window.electronAPI.invoke("database-command", { statement: "customSyncBatch", dbName: table, storagePath: getStorageLocation(), data, customSyncToken: token });
  try {
    if (stable(currentConfig()) !== stable(expected.config)) throw new Error("CUSTOM_LOCAL_CHANGED");
    await customSyncIPC("applying", { token });
    started = true;
    if (stable(currentConfig()) !== stable(expected.config)) throw new Error("CUSTOM_LOCAL_CHANGED");
    for (const table of tables) {
      const data = changes(expected.tables[table], next.tables[table]);
      if (data.length) { await batch(table, data); applied.push({ table, changes: data }); }
    }
    if (stable(currentConfig()) !== stable(expected.config)) throw new Error("CUSTOM_LOCAL_CHANGED");
    for (const key of configKeys) if (expected.config[key] !== next.config[key]) {
      if (next.config[key] === null) ConfigService.removeItem(key);
      else ConfigService.setItem(key, next.config[key]);
      written.push(key);
    }
  } catch (error) {
    let failed = false;
    for (const key of written.reverse()) {
      if ((ConfigService.getItem(key) || null) !== next.config[key]) { failed = true; continue; }
      try { if (expected.config[key] === null) ConfigService.removeItem(key); else ConfigService.setItem(key, expected.config[key]); } catch { failed = true; }
    }
    for (const entry of applied.reverse()) {
      try { await batch(entry.table, entry.changes.map((change) => ({ key: change.key, before: change.value, value: change.before }))); }
      catch { failed = true; }
    }
    if (failed) throw new Error("CUSTOM_RECOVERY_REQUIRED");
    if (started) await customSyncIPC("rollback-complete", { token });
    throw error;
  }
}

let running = false;
export interface SyncResult { conflicts: Conflict[]; pendingBooks: number; skippedBooks: number; unchanged: boolean }
function describeConflicts(state: Checkpoint): Conflict[] {
  const values = materialize(state.entries);
  return conflicts(state.entries).map((conflict) => {
    const value = conflict.versions.find((revision) => !revision.deleted)?.value;
    const book = value && typeof value === "object" && !Array.isArray(value) && typeof value.book === "string" ? value.book : conflict.entity.split("/").at(-1);
    const metadata = values[`book/${book}`]?.value;
    const bookTitle = metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.name === "string" ? metadata.name : undefined;
    return { ...conflict, bookTitle };
  });
}
export async function runCustomSync(resolutions: Record<string, string> = {}, provider?: SyncProvider): Promise<SyncResult> {
  if (running) throw new Error("CUSTOM_SYNC_BUSY");
  if (!personalMode && (ConfigService.getItem("defaultSyncOption") || ConfigService.getReaderConfig("isEnableKoodoSync") === "yes")) throw new Error("CUSTOM_OTHER_SYNC_ENABLED");
  running = true;
  let token: string | undefined;
  try {
    const session = await customSyncIPC<{ token: string; checkpoint: Checkpoint | null; documents: unknown[] }>("begin", { storagePath: getStorageLocation(), provider });
    token = session.token;
    const state = checkpoint(session.checkpoint), raw = await collect();
    const fingerprints = await customSyncIPC<Record<string, string>>("fingerprints", { token, books: raw.tables.books.map((book) => ({ key: book.key, path: BookUtil.getBookPath(book as unknown as Book) })) });
    Object.assign(state.mappings.books, fingerprints);
    const identities = raw.tables.books.map((book) => state.mappings.books[book.key]).filter(Boolean);
    if (new Set(identities).size !== identities.length) throw new Error("CUSTOM_DUPLICATE_BOOK");
    const local = snapshot(raw, state.mappings);
    const merged = reconcile(state, local, session.documents, resolutions);
    const next = plan(raw, merged);
    const publish = stable(merged.entries) !== stable(mergeDocuments(session.documents));
    // No upload or local write after a stale capture.
    if (stable(await collect()) !== stable(raw)) throw new Error("CUSTOM_LOCAL_CHANGED");
    await customSyncIPC("stage", { token, document: envelope(merged), checkpoint: merged, backup: raw, publish });
    // A large upload may take time; recheck before applying any incoming data.
    if (stable(await collect()) !== stable(raw)) throw new Error("CUSTOM_LOCAL_CHANGED");
    await apply(raw, next, token);
    acknowledge(merged, snapshot(await collect(), merged.mappings));
    await customSyncIPC("complete", { token, checkpoint: merged });
    token = undefined;
    const store = useAppStore.getState();
    await Promise.all([store.handleFetchBooks(), store.handleFetchNotes(), store.handleFetchBookmarks()]);
    const known = new Set(Object.values(merged.mappings.books));
    return {
      unchanged: !publish && stable(raw) === stable(next),
      conflicts: describeConflicts(merged),
      pendingBooks: Object.entries(merged.entries).filter(([id, revisions]) => revisions[0].kind === "book" && !known.has(id.slice(5))).length,
      skippedBooks: raw.tables.books.filter((book) => !merged.mappings.books[book.key]).length,
    };
  } catch (error) {
    if (token && syncErrorKey(error).endsWith("CUSTOM_RECOVERY_REQUIRED")) await customSyncIPC("recovery-needed", { token }).catch(() => undefined);
    throw error;
  } finally {
    if (token) await customSyncIPC("abort", { token }).catch(() => undefined);
    running = false;
  }
}

export async function restoreSyncBackup(provider?: SyncProvider): Promise<void> {
  if (running) throw new Error("CUSTOM_SYNC_BUSY");
  running = true;
  let token: string | undefined;
  try {
    const session = await customSyncIPC<{ token: string; backup: RawData }>("begin-restore", { storagePath: getStorageLocation(), provider });
    token = session.token;
    const before = await collect(), backup = session.backup;
    if (!backup || !tables.every((table) => Array.isArray(backup.tables?.[table]) && backup.tables[table].every((row) => row && safeKey(row.key)) && new Set(backup.tables[table].map((row) => row.key)).size === backup.tables[table].length) || !backup.config || !configKeys.every((key) => backup.config[key] === null || typeof backup.config[key] === "string")) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
    snapshot(backup, { books: {}, notes: {}, bookmarks: {} });
    await customSyncIPC("stage-restore", { token, backup: before });
    await apply(before, backup, token);
    await customSyncIPC("finish-restore", { token });
    token = undefined;
    const store = useAppStore.getState();
    await Promise.all([store.handleFetchBooks(), store.handleFetchNotes(), store.handleFetchBookmarks()]);
  } catch (error) {
    if (token && syncErrorKey(error).endsWith("CUSTOM_RECOVERY_REQUIRED")) await customSyncIPC("recovery-needed", { token }).catch(() => undefined);
    throw error;
  } finally {
    if (token) await customSyncIPC("abort", { token }).catch(() => undefined);
    running = false;
  }
}

export async function inspectConflicts(provider?: SyncProvider): Promise<Conflict[]> {
  const saved = await customSyncIPC<Checkpoint | null>("inspect", { storagePath: getStorageLocation(), provider });
  return saved ? describeConflicts(checkpoint(saved)) : [];
}
export const syncErrorKey = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\bCUSTOM_[A-Z_]+\b/);
  return `custom.sync.error.${match?.[0] || "CUSTOM_PROVIDER_FAILED"}`;
};

// Mounted by the manager only; reader windows never own a sync scheduler.
export function scheduleCustomSync(onResult: (result: SyncResult) => void, onError: (key: string) => void): () => void {
  let stopped = false, nextAttempt = 0, failures = 0;
  const tick = async () => {
    if (stopped || running || Date.now() < nextAttempt) return;
    try {
      const status = await customSyncIPC<SyncStatus>("status");
      const automatic = status.connections.find((connection) => connection.autoMinutes > 0);
      if (stopped || !automatic || status.busy) return;
      const result = await runCustomSync({}, automatic.provider);
      failures = 0;
      nextAttempt = Date.now() + automatic.autoMinutes * 60000;
      if (!stopped) onResult(result);
    } catch (error) {
      const key = syncErrorKey(error);
      if (key.endsWith("CUSTOM_CLOSE_READERS") || key.endsWith("CUSTOM_SYNC_BUSY")) return;
      nextAttempt = Date.now() + Math.min(60, 2 ** Math.min(++failures, 6)) * 60000;
      if (!stopped && failures === 1) onError(key);
    }
  };
  const timer = window.setInterval(tick, 60000);
  void tick();
  return () => { stopped = true; window.clearInterval(timer); };
}
