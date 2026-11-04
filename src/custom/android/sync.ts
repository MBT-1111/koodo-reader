import { useAppStore } from "../../store/useAppStore";
import { DATA_STATE_KEY, rawData, readDataState } from "../backup/dataBackup";
import { freshCheckpoint, envelope, stable } from "../sync/protocol";
import { describeConflicts, finishSync, prepareSync, sharedIdentityState } from "../sync/workflow";
import { commit, fingerprints, snapshotJob, type NativeSnapshot } from "./backup";
import { androidSyncConnection, configureAndroidMega, disconnectAndroidSync, isConnectingMega, withAndroidMega } from "./mega";
import type { Conflict, RawData } from "../sync/types";
import { flushSpeechReadingPositions } from "./speechPosition";

let running = false;
export const isAndroidSyncBusy = () => running || isConnectingMega();
const stateKey = (scope: string) => `customSyncCheckpoint-${scope}`;
const lastKey = (scope: string) => `customSyncLast-${scope}`;
const capture = (source: NativeSnapshot): RawData => {
  const tables = { books: source.tables.books, notes: source.tables.notes, bookmarks: source.tables.bookmarks };
  for (const rows of Object.values(tables)) rows.sort((a, b) => a.key.localeCompare(b.key));
  const raw = rawData(tables, source.preferences.values);
  raw.config[DATA_STATE_KEY] = source.preferences.values[DATA_STATE_KEY] || null;
  return raw;
};
const userData = (raw: RawData) => ({
  tables: Object.fromEntries(Object.entries(raw.tables).map(([table, rows]) => [table, [...rows].sort((a, b) => a.key.localeCompare(b.key))])),
  config: Object.fromEntries(Object.entries(raw.config).filter(([key]) => key !== DATA_STATE_KEY)),
});

export async function configureAndroidSync(input: Parameters<typeof configureAndroidMega>[0]) {
  if (isAndroidSyncBusy()) throw new Error("CUSTOM_SYNC_BUSY");
  return configureAndroidMega({ ...input, autoMinutes: 0 });
}
export async function disconnectSync() {
  if (isAndroidSyncBusy()) throw new Error("CUSTOM_SYNC_BUSY");
  return disconnectAndroidSync();
}
export async function inspectAndroidConflicts(): Promise<Conflict[]> {
  const connection = await androidSyncConnection();
  if (!connection) return [];
  const state = readDataState(localStorage.getItem(stateKey(connection.scope)));
  return describeConflicts(state);
}
export async function runAndroidSync(resolutions: Record<string, string> = {}) {
  if (isAndroidSyncBusy()) throw new Error("CUSTOM_SYNC_BUSY");
  running = true;
  try {
    await flushSpeechReadingPositions();
    const connection = await androidSyncConnection();
    if (!connection) throw new Error("CUSTOM_NOT_CONFIGURED");
    const result = await withAndroidMega(connection, async (transport) => {
      const documents = await transport.read();
      const prepared = await snapshotJob(async (source, token) => {
        const before = capture(source), saved = source.preferences.values[stateKey(connection.scope)];
        const job = prepareSync(before, await fingerprints(source), saved ? readDataState(saved) : freshCheckpoint(), documents, resolutions);
        const registry = sharedIdentityState(before.config[DATA_STATE_KEY], job.state);
        // Persist outgoing revisions before upload. Reopening the app after a
        // failed request retries the same edits and does not count time twice.
        await commit(before.tables, { ...source.preferences.values, [stateKey(connection.scope)]: JSON.stringify(job.state), [DATA_STATE_KEY]: registry }, token);
        const expected = { ...before, config: { ...before.config, [DATA_STATE_KEY]: registry } };
        return { ...job, before, expected, registry };
      });
      if (prepared.publish) await transport.append(envelope(prepared.state));
      return snapshotJob(async (source, token) => {
        const current = await androidSyncConnection();
        if (!current || current.scope !== connection.scope) throw new Error("CUSTOM_NOT_CONFIGURED");
        if (stable(capture(source)) !== stable(prepared.expected)) throw new Error("CUSTOM_LOCAL_CHANGED");
        const result = finishSync(prepared.state, prepared.next);
        const values = { ...source.preferences.values };
        for (const [key, value] of Object.entries(prepared.next.config)) {
          if (value === null) delete values[key]; else values[key] = value;
        }
        values[DATA_STATE_KEY] = prepared.registry;
        values[stateKey(connection.scope)] = JSON.stringify(prepared.state);
        values[lastKey(connection.scope)] = String(Date.now());
        await commit(prepared.next.tables, values, token);
        return { ...result, unchanged: !prepared.publish && stable(userData(prepared.before)) === stable(userData(prepared.next)) };
      });
    });
    const store = useAppStore.getState();
    await Promise.all([store.handleFetchBooks(), store.handleFetchNotes(), store.handleFetchBookmarks()]);
    return result;
  } finally { running = false; }
}
