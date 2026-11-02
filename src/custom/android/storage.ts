import { registerPlugin } from "@capacitor/core";
import { Buffer } from "buffer";

export interface PreferencesSnapshot {
  schema: 1;
  version: number;
  values: Record<string, string>;
}

interface StoragePlugin {
  execute(request: Record<string, unknown>): Promise<{ value: unknown }>;
}

const plugin = registerPlugin<StoragePlugin>("KoodoStorage");

export async function nativeCommand<T>(request: Record<string, unknown>): Promise<T> {
  return (await plugin.execute(request)).value as T;
}

export interface DatabaseRequest {
  statement: string;
  dbName: string;
  data?: unknown;
  statementType?: string;
  executeType?: string;
  storagePath?: string | null;
}

export const nativeDatabaseCommand = <T>(request: DatabaseRequest) =>
  nativeCommand<T>({ ...request, channel: "database-command" });

export const readNativePreferences = () =>
  nativeCommand<PreferencesSnapshot | null>({ channel: "preferences", action: "read" });

export const writeNativePreferences = (snapshot: PreferencesSnapshot) =>
  nativeCommand<void>({ channel: "preferences", action: "write", snapshot });

type FileGroup = "book" | "cover";

export const nativeFiles = {
  list: (group: FileGroup) => nativeCommand<string[]>({ channel: "file-command", action: "list", group }),
  exists: (group: FileGroup, name: string) => nativeCommand<boolean>({ channel: "file-command", action: "exists", group, name }),
  remove: (group: FileGroup, name: string) => nativeCommand<void>({ channel: "file-command", action: "remove", group, name }),
  async read(group: FileGroup, name: string): Promise<ArrayBuffer | null> {
    const data = await nativeCommand<string | null>({ channel: "file-command", action: "read", group, name });
    return data === null ? null : Uint8Array.from(Buffer.from(data, "base64")).buffer;
  },
  async write(group: FileGroup, name: string, buffer: ArrayBuffer): Promise<void> {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (value) => value.toString(16).padStart(2, "0")).join("");
    const result = await nativeCommand<{ size: number; sha256: string }>({
      channel: "file-command", action: "write", group, name, data: Buffer.from(buffer).toString("base64"),
    });
    if (result.size !== buffer.byteLength || result.sha256 !== hash) throw new Error("ANDROID_STORAGE_VERIFY_FAILED");
  },
  async saveCover(key: string, cover: string): Promise<boolean> {
    const match = /^data:image\/(png|jpe?g|webp|gif|bmp|svg\+xml|avif);base64,([\s\S]+)$/.exec(cover);
    if (!match) return false;
    const extension = match[1] === "jpeg" ? "jpg" : match[1] === "svg+xml" ? "svg" : match[1];
    await this.write("cover", `${key}.${extension}`, Uint8Array.from(Buffer.from(match[2], "base64")).buffer);
    for (const name of await this.list("cover")) {
      if (name.startsWith(`${key}.`) && name !== `${key}.${extension}`) await this.remove("cover", name);
    }
    return true;
  },
  async getCover(key: string, fallback = ""): Promise<string> {
    const name = (await this.list("cover")).find((item) => item.startsWith(`${key}.`));
    if (!name) return fallback;
    const buffer = await this.read("cover", name);
    if (!buffer) return fallback;
    const extension = name.split(".").pop();
    const mime = extension === "jpg" ? "jpeg" : extension === "svg" ? "svg+xml" : extension;
    return `data:image/${mime};base64,${Buffer.from(buffer).toString("base64")}`;
  },
  async removeCover(key: string): Promise<void> {
    for (const name of await this.list("cover")) {
      if (name.startsWith(`${key}.`)) await this.remove("cover", name);
    }
  },
};
