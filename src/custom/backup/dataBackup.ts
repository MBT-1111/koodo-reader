import { configKeys, plan, snapshot } from "../sync/data";
import { acknowledge, copy, envelope, freshCheckpoint, materialize, reconcile, stable, validateEnvelope } from "../sync/protocol";
import type { Checkpoint, Envelope, RawData } from "../sync/types";

// Shared by Windows and Android. Local keys, paths, covers and credentials never
// enter this document. Book identity is the SHA-256 of the complete source file.
export const DATA_STATE_KEY = "customDataCheckpoint";
export const readerSettingKeys = [
  "lang", "appSkin", "themeColor", "fontSize", "lineHeight", "letterSpacing",
  "wordSpacing", "paragraphSpacing", "paragraphIndent", "textAlign", "fontWeight",
  "fontStyle", "fontFamily", "textColor", "backgroundColor", "readerMode",
  "animation", "convertChinese", "bookLayout", "textOrientation", "isBold",
  "isItalic", "isIndent", "isHyphenation", "isShowPageNumber", "isShowHeader",
  "isShowFooter", "isHideShelfBook", "isShowShelfBookCount", "isMergeWord",
  "subFontFamily", "paraSpacing", "margin", "pageGap", "scale", "codeHighlight",
  "isUnderline", "isShadow", "isInvert", "isOrphanWidow", "isKeepPDFBackground",
  "isShowTotalPage", "isStartFromEven", "revertDirection", "isHideBackground",
  "isHideHeader", "isHideFooter", "isShowPageBorder", "readingRulerLineHeight",
  "readingRulerBackgroundOpacity", "speedReadingSpeed", "autoScrollRate",
] as const;
type Settings = Record<string, string>;
export interface DataBackup {
  format: "koodo-reader-custom-data-backup";
  version: 1;
  createdAt: string;
  document: Envelope;
  settings: Settings;
  checksum: string;
}
export const sha256 = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join("");
const digest = (value: unknown) => sha256(new TextEncoder().encode(stable(value)).buffer);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const localEntityId = (key: string) => key.startsWith("krc-") && uuid.test(key.slice(4)) ? key.slice(4) : undefined;
const safeKey = (key: string) => /^[\w-]{1,256}$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key);

export function readDataState(text: string | null | undefined): Checkpoint {
  if (!text) return freshCheckpoint();
  const value = JSON.parse(text) as Checkpoint;
  validateEnvelope(value);
  if (!object(value.observed) || !object(value.context) || !object(value.mappings) || !["books", "notes", "bookmarks"].every((table) => {
    const map = value.mappings[table as keyof Checkpoint["mappings"]];
    return object(map) && Object.entries(map).every(([key, id]) => safeKey(key) && typeof id === "string" && (table === "books" ? /^[a-f0-9]{64}$/.test(id) : uuid.test(id)));
  })) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
  return copy(value);
}

export function rawData(tables: RawData["tables"], values: Record<string, string>): RawData {
  return { tables, config: Object.fromEntries(configKeys.map((key) => [key, values[key] || null])) };
}

function prepareState(raw: RawData, hashes: Record<string, string>, text?: string | null) {
  const state = readDataState(text);
  // A missing/unreadable original must never silently inherit a stale fingerprint.
  state.mappings.books = {};
  for (const book of raw.tables.books) {
    const hash = hashes[book.key];
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("CUSTOM_INVALID_BOOK");
    state.mappings.books[book.key] = hash;
  }
  for (const table of ["notes", "bookmarks"] as const) for (const row of raw.tables[table]) {
    const id = localEntityId(row.key);
    if (id) state.mappings[table][row.key] ||= id;
  }
  return state;
}

function pickSettings(text: string | undefined): Settings {
  const config: unknown = JSON.parse(text || "{}");
  if (!object(config)) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
  return Object.fromEntries(readerSettingKeys.filter((key) => key !== "readerMode" && typeof config[key] === "string").map((key) => [key, config[key] as string]));
}

export async function createDataBackup(raw: RawData, values: Record<string, string>, hashes: Record<string, string>) {
  const state = prepareState(raw, hashes, values[DATA_STATE_KEY]);
  const next = reconcile(state, snapshot(raw, state.mappings), []);
  acknowledge(next, snapshot(raw, next.mappings));
  const payload = { format: "koodo-reader-custom-data-backup" as const, version: 1 as const, createdAt: new Date().toISOString(), document: envelope(next), settings: pickSettings(values.readerConfig) };
  validateEnvelope(payload.document);
  const backup: DataBackup = { ...payload, checksum: await digest(payload) };
  return { backup, state: next, blob: new Blob([JSON.stringify(backup)], { type: "application/json" }) };
}

export async function parseDataBackup(text: string): Promise<DataBackup> {
  if (text.length > 100 * 1024 * 1024) throw new Error("CUSTOM_INVALID_DOCUMENT");
  const value: unknown = JSON.parse(text);
  if (!object(value) || value.format !== "koodo-reader-custom-data-backup" || value.version !== 1 ||
      !Object.keys(value).every((key) => ["format", "version", "createdAt", "document", "settings", "checksum"].includes(key)) ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !object(value.settings) ||
      !Object.entries(value.settings).every(([key, setting]) => readerSettingKeys.includes(key as typeof readerSettingKeys[number]) && typeof setting === "string" && setting.length <= 10000)) throw new Error("CUSTOM_INVALID_DOCUMENT");
  validateEnvelope(value.document);
  // Checkpoints contain machine-local mappings; only public envelopes are portable.
  if (stable(envelope(value.document as unknown as Checkpoint)) !== stable(value.document)) throw new Error("CUSTOM_INVALID_DOCUMENT");
  const { checksum, ...payload } = value;
  if (checksum !== await digest(payload)) throw new Error("CUSTOM_INVALID_DOCUMENT");
  return value as unknown as DataBackup;
}

export function planDataRestore(backup: DataBackup, raw: RawData, values: Record<string, string>, hashes: Record<string, string>) {
  const state = prepareState(raw, hashes, values[DATA_STATE_KEY]);
  // An independently imported note may already exist under a different local
  // key. Match identical content once before assigning a portable UUID.
  const local = snapshot(raw, state.mappings);
  const incoming = materialize(backup.document.entries);
  for (const [table, kind] of [["notes", "note"], ["bookmarks", "bookmark"]] as const) {
    const used = new Set<string>();
    for (const [entity, item] of Object.entries(incoming)) {
      if (item.kind !== kind) continue;
      const id = entity.slice(kind.length + 1);
      const known = Object.entries(state.mappings[table]).find(([, mapped]) => mapped === id)?.[0];
      const matching = known || raw.tables[table].find((row) => !used.has(row.key) && stable(local[`${kind}/${state.mappings[table][row.key]}`]?.value) === stable(item.value))?.key;
      if (matching) {
        const previous = state.mappings[table][matching];
        state.mappings[table][matching] = id; used.add(matching);
        if (previous !== id && !Object.values(state.mappings[table]).includes(previous)) {
          delete state.entries[`${kind}/${previous}`];
          delete state.observed[`${kind}/${previous}`];
          delete state.context[`${kind}/${previous}`];
        }
      }
    }
  }
  // This is an explicit snapshot restore. Incoming values replace corresponding
  // entities; unrelated local books and records remain in place.
  Object.assign(state.entries, copy(backup.document.entries));
  const next = plan(raw, state);
  for (const book of next.tables.books) book.format = raw.tables.books.find((local) => local.key === book.key)!.format;
  acknowledge(state, snapshot(next, state.mappings));
  const readerConfig: unknown = JSON.parse(values.readerConfig || "{}");
  if (!object(readerConfig)) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
  // Accept earlier v1 documents containing readerMode, but keep each device's
  // layout (a desktop spread must not force two columns onto a phone).
  const settings = Object.fromEntries(Object.entries(backup.settings).filter(([key]) => key !== "readerMode"));
  const preferences: Record<string, string> = { ...values, ...Object.fromEntries(Object.entries(next.config).filter((entry): entry is [string, string] => entry[1] !== null)), readerConfig: JSON.stringify({ ...readerConfig, ...settings }), [DATA_STATE_KEY]: JSON.stringify(state) };
  const known = new Set(Object.values(hashes));
  const pendingBooks = Object.keys(materialize(backup.document.entries)).filter((key) => key.startsWith("book/") && !known.has(key.slice(5))).length;
  return { next, preferences, pendingBooks };
}

export function backupSummary(backup: DataBackup) {
  const items = Object.values(materialize(backup.document.entries));
  return { books: items.filter((item) => item.kind === "book").length, notes: items.filter((item) => item.kind === "note" || item.kind === "bookmark").length };
}
