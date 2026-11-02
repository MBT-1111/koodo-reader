import JSZip from "jszip";
import { NATIVE_TABLES } from "./migration";
import type { FileGroup } from "./storage";

export const BACKUP_GROUPS: FileGroup[] = ["book", "cover", "font", "background"];
const MANIFEST = "koodo-android-backup.json";
type Tables = Record<(typeof NATIVE_TABLES)[number], Record<string, unknown>[]>;
interface FileName { group: FileGroup; name: string }
export interface BackupFile extends FileName { size: number; sha256: string }
export interface BackupManifest {
  type: "koodo-reader-android-backup";
  schema: 1;
  createdAt: string;
  tables: Tables;
  preferences: Record<string, string>;
  files: BackupFile[];
}
export interface BackupSource {
  tables: Tables;
  preferences: Record<string, string>;
  files: FileName[];
  read(file: FileName): Promise<ArrayBuffer | null>;
}
export interface PreparedBackup { manifest: BackupManifest; read(file: BackupFile): Promise<ArrayBuffer> }
export type BackupProgress = (done: number, total: number) => void;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const name = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 255 &&
  ![".", "..", "__proto__", "constructor", "prototype"].includes(value) && !/[\\/\x00-\x1f\x7f]/.test(value) && !/\.(bak|new)$/.test(value);
const path = (file: FileName) => `${file.group}/${file.name}`;
export const backupHash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
function invalid(): never { throw new Error("ANDROID_BACKUP_INVALID"); }

function validate(value: unknown): asserts value is BackupManifest {
  if (!record(value) || value.type !== "koodo-reader-android-backup" || value.schema !== 1 ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !record(value.tables) ||
    Object.keys(value.tables).length !== NATIVE_TABLES.length || !record(value.preferences) || !Array.isArray(value.files)) invalid();
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!record(file) || !BACKUP_GROUPS.includes(file.group as FileGroup) || !name(file.name) ||
      !Number.isSafeInteger(file.size) || (file.size as number) < 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) invalid();
    const key = `${file.group}/${file.name}`;
    if (paths.has(key)) invalid();
    paths.add(key);
  }
  for (const table of NATIVE_TABLES) {
    const rows = value.tables[table];
    if (!Array.isArray(rows)) invalid();
    const keys = new Set<string>();
    for (const row of rows) {
      if (!record(row) || !name(row.key) || keys.has(row.key)) invalid();
      keys.add(row.key);
      if (table === "books" && (typeof row.name !== "string" || typeof row.format !== "string" || !/^[a-z0-9]{1,12}$/i.test(row.format) || !paths.has(`book/${row.key}.${row.format.toLowerCase()}`))) invalid();
      if ((table === "notes" || table === "bookmarks" || table === "words") && typeof row.bookKey !== "string") invalid();
      if (table === "notes" && (typeof row.text !== "string" || typeof row.notes !== "string" || !Array.isArray(row.tag) || !row.tag.every((tag) => typeof tag === "string"))) invalid();
    }
  }
  for (const [key, text] of Object.entries(value.preferences)) {
    if (typeof text !== "string" || key.startsWith("__koodo_native_") || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
    if (["readerConfig", "recordLocation", "shelfList", "customFonts", "customBackgrounds"].includes(key) && !record(JSON.parse(text))) invalid();
    if (["recentBooks", "favoriteBooks", "deletedBooks", "noteTags", "fontList", "backgroundList"].includes(key) && !Array.isArray(JSON.parse(text))) invalid();
  }
  for (const [key, group, extension] of [["customFonts", "font", "type"], ["customBackgrounds", "background", "extension"]] as const) {
    const text = value.preferences[key];
    const metadata: unknown = JSON.parse(typeof text === "string" ? text : "{}");
    if (!record(metadata)) invalid();
    for (const [id, entry] of Object.entries(metadata)) {
      if (!record(entry) || typeof entry[extension] !== "string" || !paths.has(`${group}/${id}.${entry[extension]}`)) invalid();
    }
  }
}

export async function createBackupArchive(source: BackupSource, progress?: BackupProgress): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const zip = new JSZip();
  const manifest: BackupManifest = {
    type: "koodo-reader-android-backup", schema: 1, createdAt: new Date().toISOString(), tables: source.tables,
    preferences: Object.fromEntries(Object.entries(source.preferences).filter(([key]) => !key.startsWith("__koodo_native_"))), files: [],
  };
  for (const file of source.files) {
    if (!BACKUP_GROUPS.includes(file.group) || !name(file.name)) invalid();
    const bytes = await source.read(file);
    if (!bytes) throw new Error("ANDROID_BACKUP_MISSING_FILE");
    manifest.files.push({ ...file, size: bytes.byteLength, sha256: await backupHash(bytes) });
    zip.file(path(file), bytes, { createFolders: false });
    progress?.(manifest.files.length, source.files.length);
  }
  validate(manifest);
  zip.file(MANIFEST, JSON.stringify(manifest), { createFolders: false });
  return { manifest, blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } }) };
}

export async function prepareBackupArchive(bytes: ArrayBuffer, progress?: BackupProgress): Promise<PreparedBackup> {
  const zip = await JSZip.loadAsync(bytes);
  const metadata = zip.file(MANIFEST);
  if (!metadata) invalid();
  const manifest: unknown = JSON.parse(await metadata.async("string"));
  validate(manifest);
  const allowed = new Set([MANIFEST, ...manifest.files.map(path)]);
  for (const file of Object.values(zip.files)) {
    if ((file.unsafeOriginalName && file.unsafeOriginalName !== file.name) || (file.dir ? !BACKUP_GROUPS.some((group) => file.name === `${group}/`) : !allowed.has(file.name))) invalid();
  }
  const read = async (file: BackupFile) => {
    const entry = zip.file(path(file));
    if (!entry) return invalid();
    const data = await entry.async("arraybuffer");
    if (data.byteLength !== file.size || await backupHash(data) !== file.sha256) invalid();
    return data;
  };
  for (let index = 0; index < manifest.files.length; index++) {
    await read(manifest.files[index]);
    progress?.(index + 1, manifest.files.length);
  }
  return { manifest, read };
}
