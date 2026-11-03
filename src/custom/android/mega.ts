import { nativeCommand } from "./storage";
import { sha256 } from "../backup/dataBackup";
import { MegaProvider, prepareMegaStorage, catchUpMegaStorage, closeStorage } from "../../utils/main/custom/megaTransport.mjs";
import type { Envelope } from "../sync/types";

export interface AndroidSyncConnection { email: string; namespace: string; autoMinutes: number; scope: string }
interface SavedConnection extends AndroidSyncConnection { version: 1; session: { key: string; sid: string; name: string; user: string; options: Record<string, unknown> } }
export interface SyncTransport { read(): Promise<unknown[]>; append(document: Envelope): Promise<void> }
let connecting = false;
export const isConnectingMega = () => connecting;
const vault = async <T>(action: string, value?: string) => {
  try { return await nativeCommand<T>({ channel: "credential", slot: "mega", action, value }); }
  catch { throw new Error("CUSTOM_CREDENTIAL_STORAGE_UNAVAILABLE"); }
};
export const megaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (/^CUSTOM_[A-Z_]+$/.test(message)) return error as Error;
  if (/Timeout|Abort/i.test(message)) return new Error("CUSTOM_PROVIDER_TIMEOUT");
  if (/EOVERQUOTA|EGOINGOVERQUOTA|EPAYWALL|ERATELIMIT/i.test(message)) return new Error("CUSTOM_MEGA_QUOTA_FAILED");
  if (/ENOENT|EACCESS|ESID|EKEY|EBLOCKED|ENOMFA|EMFAREQUIRED|invalid (password|session)|session.*(expired|invalid)|access denied/i.test(message)) return new Error("CUSTOM_MEGA_AUTH_FAILED");
  return new Error("CUSTOM_MEGA_NETWORK_FAILED");
};

async function savedConnection(): Promise<SavedConnection | null> {
  const text = await vault<string | null>("read");
  if (!text) return null;
  const saved = JSON.parse(text) as SavedConnection;
  if (saved.version !== 1 || typeof saved.email !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(saved.namespace) || ![0, 5, 15, 30, 60].includes(saved.autoMinutes) || !/^[a-f0-9]{64}$/.test(saved.scope) || !saved.session || !["key", "sid", "name", "user"].every((key) => typeof saved.session[key as "key"] === "string") || !saved.session.options || typeof saved.session.options !== "object") throw new Error("CUSTOM_CREDENTIAL_STORAGE_UNAVAILABLE");
  return saved;
}
const summary = ({ email, namespace, autoMinutes, scope }: AndroidSyncConnection): AndroidSyncConnection => ({ email, namespace, autoMinutes, scope });
export async function androidSyncConnection() { const saved = await savedConnection(); return saved && summary(saved); }
export const disconnectAndroidSync = () => vault<void>("remove");

async function deadline<T>(task: (fetcher: typeof fetch, signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request: typeof fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.delete("Content-Length");
    return fetch(input, { ...init, headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000), ...(init.signal ? [init.signal] : [])]) });
  };
  try {
    return await Promise.race([task(request, controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const error = new Error("CUSTOM_PROVIDER_TIMEOUT"); controller.abort(error); reject(error); }, 150000);
    })]);
  } catch (error) { throw megaError(error); }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function configureAndroidMega(input: { email: string; password: string; secondFactorCode: string; namespace: string; autoMinutes: number }) {
  if (connecting) throw new Error("CUSTOM_SYNC_BUSY");
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320 || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.namespace) || ![0, 5, 15, 30, 60].includes(input.autoMinutes) || input.password.length > 4096 || input.secondFactorCode && !/^\d{6}$/.test(input.secondFactorCode)) throw new Error("CUSTOM_INVALID_SETTINGS");
  connecting = true;
  try {
    const old = await savedConnection();
    let session: SavedConnection["session"];
    if (!input.password && !input.secondFactorCode && old?.email === email) session = old.session;
    else {
      if (!input.password) throw new Error("CUSTOM_INVALID_SETTINGS");
      session = await deadline(async (fetcher, signal) => {
        const { Storage } = await import("megajs");
        const storage = prepareMegaStorage(new Storage({ email, password: input.password, secondFactorCode: input.secondFactorCode || undefined, keepalive: false, fetch: fetcher }));
        storage.on("error", () => undefined);
        try {
          await storage.ready; signal.throwIfAborted();
          const serialized = JSON.parse(JSON.stringify(storage.toJSON())) as SavedConnection["session"];
          delete serialized.options.password; delete serialized.options.secondFactorCode; delete serialized.options.fetch;
          return serialized;
        } finally { await closeStorage(storage); }
      });
    }
    const scope = await sha256(new TextEncoder().encode(JSON.stringify(["mega", email.toLowerCase(), input.namespace])).buffer);
    const saved: SavedConnection = { version: 1, email, namespace: input.namespace, autoMinutes: input.autoMinutes, scope, session };
    await vault("write", JSON.stringify(saved));
    return summary(saved);
  } finally { connecting = false; }
}

export async function withAndroidMega<T>(connection: AndroidSyncConnection, action: (transport: SyncTransport) => Promise<T>) {
  const saved = await savedConnection();
  if (!saved || saved.scope !== connection.scope) throw new Error("CUSTOM_NOT_CONFIGURED");
  return deadline(async (fetcher, signal) => {
    const { Storage } = await import("megajs");
    const credentials = { ...saved.session, options: { ...saved.session.options, fetch: fetcher, keepalive: false } } as unknown as Parameters<typeof Storage.fromJSON>[0];
    const storage = prepareMegaStorage(Storage.fromJSON(credentials));
    storage.on("error", () => undefined);
    try {
      await storage.ready; await storage.reload(true); await catchUpMegaStorage(storage); signal.throwIfAborted();
      return await action(new MegaProvider(storage, saved.namespace));
    } finally { await closeStorage(storage); }
  });
}
