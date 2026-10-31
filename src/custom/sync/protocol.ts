import type { Checkpoint, Conflict, Counter, Envelope, Item, Json, Kind, Revision, Snapshot } from "./types";
import { validEntity, validPayload } from "./contract";

const kinds: Kind[] = ["book", "note", "bookmark", "progress", "shelf", "shelfName", "favorite", "trash", "recent", "tag", "time", "daily"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reserved = new Set(["__proto__", "constructor", "prototype"]);
export const stable = (value: unknown): string => {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
};
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const json = (value: unknown, depth = 0): value is Json => {
  if (depth > 16) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 1000000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 100000 && value.every((v) => json(v, depth + 1));
  return object(value) && Object.entries(value).every(([k, v]) => !reserved.has(k) && json(v, depth + 1));
};
const isCounter = (kind: Kind) => kind === "time" || kind === "daily";
const validCounter = (value: unknown): value is Counter => object(value) && Object.keys(value).every((key) => ["baseline", "devices"].includes(key)) && typeof value.baseline === "number" && Number.isFinite(value.baseline) && value.baseline >= 0 && value.baseline <= Number.MAX_SAFE_INTEGER && object(value.devices) && Object.entries(value.devices).every(([id, n]) => uuid.test(id) && typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER);

export function validateEnvelope(input: unknown): Envelope {
  if (!object(input) || input.format !== "koodo-reader-custom" || input.version !== 1) throw new Error("CUSTOM_PROTOCOL_VERSION");
  if (!Object.keys(input).every((key) => ["format", "version", "deviceId", "sequence", "entries", "observed", "mappings", "context"].includes(key))) throw new Error("CUSTOM_INVALID_DOCUMENT");
  if (typeof input.deviceId !== "string" || !uuid.test(input.deviceId) || !Number.isSafeInteger(input.sequence) || Number(input.sequence) < 0 || !object(input.entries) || Object.keys(input.entries).length > 100000) throw new Error("CUSTOM_INVALID_DOCUMENT");
  for (const [id, revisions] of Object.entries(input.entries)) {
    if (id.length > 1200 || !Array.isArray(revisions) || !revisions.length || revisions.length > 128) throw new Error("CUSTOM_INVALID_DOCUMENT");
    for (const r of revisions) {
      if (!object(r) || typeof r.id !== "string" || !uuid.test(r.id) || !kinds.includes(r.kind as Kind) || typeof r.deleted !== "boolean" || !json(r.value) || !object(r.clock) || !Object.keys(r.clock).length || Object.keys(r.clock).length > 1024) throw new Error("CUSTOM_INVALID_DOCUMENT");
      if (!Object.keys(r).every((key) => ["id", "clock", "deleted", "kind", "value"].includes(key))) throw new Error("CUSTOM_INVALID_DOCUMENT");
      if (!Object.entries(r.clock).every(([device, count]) => uuid.test(device) && Number.isSafeInteger(count) && Number(count) > 0)) throw new Error("CUSTOM_INVALID_DOCUMENT");
      if (isCounter(r.kind as Kind) && r.deleted) throw new Error("CUSTOM_INVALID_COUNTER");
      if (isCounter(r.kind as Kind) && !r.deleted && !validCounter(r.value)) throw new Error("CUSTOM_INVALID_COUNTER");
      if (!validEntity(id, r.kind as Kind) || (r.deleted ? r.value !== null : !validPayload(r.kind as Kind, r.value as Json))) throw new Error("CUSTOM_INVALID_DOCUMENT");
    }
  }
  return copy(input) as unknown as Envelope;
}

export function freshCheckpoint(deviceId = crypto.randomUUID()): Checkpoint {
  return { format: "koodo-reader-custom", version: 1, deviceId, sequence: 0, entries: {}, observed: {}, mappings: { books: {}, notes: {}, bookmarks: {} }, context: {} };
}

const dominates = (a: Revision, b: Revision) => {
  const devices = new Set([...Object.keys(a.clock), ...Object.keys(b.clock)]);
  return [...devices].every((d) => (a.clock[d] || 0) >= (b.clock[d] || 0)) && [...devices].some((d) => (a.clock[d] || 0) > (b.clock[d] || 0));
};
function heads(revisions: Revision[]): Revision[] {
  const byId = new Map<string, Revision>();
  for (const r of revisions) {
    const old = byId.get(r.id);
    if (old && stable(old) !== stable(r)) throw new Error("CUSTOM_REVISION_COLLISION");
    byId.set(r.id, r);
  }
  const unique = [...byId.values()];
  if (new Set(unique.map((r) => r.kind)).size > 1) throw new Error("CUSTOM_INVALID_DOCUMENT");
  return unique.filter((r) => !unique.some((other) => dominates(other, r))).sort((a, b) => a.id.localeCompare(b.id));
}
export function mergedCounter(revisions: Revision[]): Counter {
  const result: Counter = { baseline: 0, devices: {} };
  for (const r of revisions) {
    if (r.deleted || !validCounter(r.value)) continue;
    result.baseline = Math.max(result.baseline, r.value.baseline);
    for (const [device, n] of Object.entries(r.value.devices)) result.devices[device] = Math.max(result.devices[device] || 0, n);
  }
  return result;
}
const total = (counter: Counter) => {
  const result = counter.baseline + Object.values(counter.devices).reduce((a, b) => a + b, 0);
  if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER) throw new Error("CUSTOM_INVALID_COUNTER");
  return result;
};
export const winner = (revisions: Revision[]): Revision => [...revisions].sort((a, b) => Number(b.deleted) - Number(a.deleted) || b.id.localeCompare(a.id))[0];

export function materialize(entries: Envelope["entries"]): Snapshot {
  const snapshot: Snapshot = {};
  for (const [id, revisions] of Object.entries(entries)) {
    const selected = winner(revisions);
    if (isCounter(selected.kind)) snapshot[id] = { kind: selected.kind, value: total(mergedCounter(revisions)) };
    else if (!selected.deleted) snapshot[id] = { kind: selected.kind, value: copy(selected.value) };
  }
  return snapshot;
}
export function conflicts(entries: Envelope["entries"]): Conflict[] {
  return Object.entries(entries).filter(([, rs]) => rs.length > 1 && !isCounter(rs[0].kind) && new Set(rs.map((r) => stable({ deleted: r.deleted, value: r.value }))).size > 1).map(([entity, versions]) => ({ entity, kind: versions[0].kind, versions: copy(versions), selected: winner(versions).id }));
}

// Observe local edits before merging remote heads, so independent edits remain concurrent.
export function mergeDocuments(documents: unknown[]): Envelope["entries"] {
  const entries: Envelope["entries"] = {};
  for (const input of documents) for (const [id, revisions] of Object.entries(validateEnvelope(input).entries)) entries[id] = heads([...(entries[id] || []), ...revisions]);
  return entries;
}

export function reconcile(checkpoint: Checkpoint, local: Snapshot, documents: unknown[], resolutions: Record<string, string> = {}): Checkpoint {
  validateEnvelope(checkpoint);
  const state = copy(checkpoint);
  const remote = documents.map(validateEnvelope);
  const remoteEntries = mergeDocuments(remote);
  // Existing identical data on a newly enrolled device is a shared baseline,
  // not an independent edit that should later conflict with a real rename.
  for (const [id, item] of Object.entries(local)) {
    const revisions = remoteEntries[id];
    if (!state.entries[id] && !state.observed[id] && revisions?.length && !isCounter(item.kind) && revisions.every((r) => !r.deleted && r.kind === item.kind && stable(r.value) === stable(item.value))) {
      state.entries[id] = copy(revisions);
      state.observed[id] = copy(item);
      const context: Record<string, number> = {};
      for (const r of revisions) for (const [device, count] of Object.entries(r.clock)) context[device] = Math.max(context[device] || 0, count);
      state.context[id] = context;
    }
  }
  const documentsAndState = [state, ...remote];
  state.sequence = documentsAndState.reduce((max, doc) => {
    let result = doc.deviceId === state.deviceId ? Math.max(max, doc.sequence) : max;
    for (const rs of Object.values(doc.entries)) for (const r of rs) result = Math.max(result, r.clock[state.deviceId] || 0);
    return result;
  }, state.sequence) + 1;
  const mutate = (id: string, item: Item | undefined, previous: Revision[], resolving = false) => {
    const clock: Record<string, number> = { ...(state.context[id] || {}) };
    if (resolving) for (const r of previous) for (const [d, n] of Object.entries(r.clock)) clock[d] = Math.max(clock[d] || 0, n);
    clock[state.deviceId] = state.sequence;
    const revision = { id: crypto.randomUUID(), clock, kind: item?.kind || previous[0].kind, deleted: !item, value: item?.value ?? null };
    state.entries[id] = heads([...previous, revision]);
    state.context[id] = copy(clock);
  };
  for (const id of new Set([...Object.keys(state.observed), ...Object.keys(local)])) {
    const item = local[id], before = state.observed[id];
    if (stable(item) === stable(before)) continue;
    const previous = state.entries[id] || [];
    const kind = item?.kind || before.kind;
    if (isCounter(kind)) {
      if (!item || typeof item.value !== "number" || item.value < 0 || !Number.isFinite(item.value)) continue;
      const counter = mergedCounter(previous);
      if (!before) counter.baseline = Math.max(counter.baseline, item.value);
      else counter.devices[state.deviceId] = (counter.devices[state.deviceId] || 0) + Math.max(0, item.value - Number(before.value));
      mutate(id, { kind, value: counter as unknown as Json }, previous);
    } else if (item || (previous.length && kind !== "book")) mutate(id, item, previous);
  }
  for (const [id, revisions] of Object.entries(remoteEntries)) state.entries[id] = heads([...(state.entries[id] || []), ...revisions]);
  for (const [id, revisionId] of Object.entries(resolutions)) {
    const versions = state.entries[id];
    const selected = versions?.find((r) => r.id === revisionId);
    if (!selected) throw new Error("CUSTOM_CONFLICT_CHANGED");
    mutate(id, selected.deleted ? undefined : { kind: selected.kind, value: selected.value }, versions, true);
  }
  state.observed = copy(local);
  validateEnvelope(state);
  return state;
}

// Only a completed local application acknowledges incoming causal history.
export function acknowledge(state: Checkpoint, actual: Snapshot): Checkpoint {
  const previous = state.observed;
  state.observed = copy(actual);
  for (const [id, revisions] of Object.entries(state.entries)) {
    if (!actual[id] && !previous[id]) continue;
    const clock: Record<string, number> = {};
    for (const r of revisions) for (const [device, count] of Object.entries(r.clock)) clock[device] = Math.max(clock[device] || 0, count);
    state.context[id] = clock;
  }
  return state;
}

export function envelope(state: Checkpoint): Envelope {
  return { format: state.format, version: state.version, deviceId: state.deviceId, sequence: state.sequence, entries: copy(state.entries) };
}
