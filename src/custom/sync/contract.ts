import type { Json, Kind } from "./types";

export const fields = {
  book: ["name", "author", "description", "md5", "format", "publisher", "size", "page", "charset", "published", "modified", "identifier", "language", "subject", "rights", "isbn", "layout"],
  note: ["date", "chapter", "chapterIndex", "text", "cfi", "range", "notes", "percentage", "color", "tag"],
  bookmark: ["cfi", "label", "percentage", "chapter"],
  progress: ["text", "count", "chapterTitle", "chapterDocIndex", "chapterHref", "percentage", "cfi", "page", "xpath", "chapterIndex", "sectionIndex", "location", "scroll"],
};
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object = (value: Json): value is Record<string, Json> => !!value && typeof value === "object" && !Array.isArray(value);
export function validEntity(id: string, kind: Kind): boolean {
  const key = id.slice(id.indexOf("/") + 1);
  if (id.split("/")[0] !== kind) return false;
  if (kind === "note" || kind === "bookmark") return uuid.test(key);
  if (kind === "shelfName" || kind === "tag") return /^[a-f0-9]{2,1024}$/.test(key) && key.length % 2 === 0;
  if (kind === "shelf") return /^[a-f0-9]{2,1024}\/[a-f0-9]{64}$/.test(key);
  if (kind === "daily") return /^\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}$/.test(key);
  return hash.test(key);
}
export function validPayload(kind: Kind, value: Json): boolean {
  if (kind === "time" || kind === "daily") return true; // Counter schema is checked separately.
  if (kind === "favorite" || kind === "trash") return value === true;
  if (kind === "recent") return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (kind === "tag") return typeof value === "string" && value.length > 0 && value.length <= 256;
  if (!object(value)) return false;
  if (kind === "shelfName" || kind === "shelf") return Object.keys(value).every((k) => ["name", ...(kind === "shelf" ? ["book"] : [])].includes(k)) && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 256 && !["New", "__proto__", "constructor", "prototype"].includes(value.name) && (kind === "shelfName" || (typeof value.book === "string" && hash.test(value.book)));
  const keys = fields[kind];
  if (!keys || !Object.keys(value).every((k) => keys.includes(k) || ((kind === "note" || kind === "bookmark") && k === "book"))) return false;
  if ((kind === "note" || kind === "bookmark") && (typeof value.book !== "string" || !hash.test(value.book))) return false;
  return Object.entries(value).every(([key, v]) => {
    if (key === "tag") return Array.isArray(v) && v.every((tag) => typeof tag === "string");
    if (key === "date") return object(v) && Object.keys(v).every((k) => ["year", "month", "day"].includes(k)) && Object.values(v).every((n) => typeof n === "number" && Number.isSafeInteger(n));
    const numeric = kind === "progress" || ["size", "page", "chapterIndex", "percentage", "color"].includes(key);
    return typeof v === "string" || (numeric && typeof v === "number" && Number.isFinite(v));
  });
}
