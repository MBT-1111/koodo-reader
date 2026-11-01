export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Kind = "book" | "note" | "bookmark" | "progress" | "shelf" | "shelfName" | "favorite" | "trash" | "recent" | "tag" | "time" | "daily";
export interface Item { kind: Kind; value: Json }
export type Snapshot = Record<string, Item>;
export interface Revision { id: string; clock: Record<string, number>; deleted: boolean; kind: Kind; value: Json }
export interface Envelope {
  format: "koodo-reader-custom";
  version: 1;
  deviceId: string;
  sequence: number;
  entries: Record<string, Revision[]>;
}
export interface Mappings {
  books: Record<string, string>;
  notes: Record<string, string>;
  bookmarks: Record<string, string>;
}
export interface Checkpoint extends Envelope { observed: Snapshot; mappings: Mappings; context: Record<string, Record<string, number>> }
export interface Counter { baseline: number; devices: Record<string, number> }
export interface Conflict { entity: string; kind: Kind; versions: Revision[]; selected: string; bookTitle?: string }
export type Table = "books" | "notes" | "bookmarks";
export type Row = Record<string, Json> & { key: string };
export interface RawData { tables: Record<Table, Row[]>; config: Record<string, string | null> }
export interface Change { key: string; before: Row | null; value: Row | null }
export type SyncProvider = "mega" | "folder";
export interface SyncConnection {
  provider: SyncProvider;
  namespace: string;
  autoMinutes: number;
  email: string;
  folder: string;
}
export interface SyncStatus {
  configured: boolean;
  provider: SyncProvider;
  namespace: string;
  autoMinutes: number;
  testing: boolean;
  busy: boolean;
  activeProvider: SyncProvider;
  connections: SyncConnection[];
}
