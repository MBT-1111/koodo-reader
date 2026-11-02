import type { PreferencesSnapshot } from "./storage";

export const PREFERENCES_VERSION_KEY = "__koodo_native_preferences_version";
export type PreferenceCache = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem" | "clear">;

export function cachedValues(cache: PreferenceCache): Record<string, string> {
  const entries: [string, string][] = [];
  for (let i = 0; i < cache.length; i++) {
    const key = cache.key(i);
    if (key && key !== PREFERENCES_VERSION_KEY) entries.push([key, cache.getItem(key)!]);
  }
  return Object.fromEntries(entries);
}

export function cachedVersion(cache: PreferenceCache): number {
  const version = Number(cache.getItem(PREFERENCES_VERSION_KEY) || 0);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("ANDROID_STORAGE_VERSION");
  return version;
}

export function hydratePreferences(cache: PreferenceCache, snapshot: PreferencesSnapshot): PreferencesSnapshot {
  if (snapshot.schema !== 1 || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1 ||
      !snapshot.values || typeof snapshot.values !== "object" || Object.values(snapshot.values).some((value) => typeof value !== "string")) {
    throw new Error("ANDROID_STORAGE_PREFERENCES");
  }
  if (cachedVersion(cache) > snapshot.version) {
    return { schema: 1, version: cachedVersion(cache), values: cachedValues(cache) };
  }
  cache.clear();
  for (const [key, value] of Object.entries(snapshot.values)) cache.setItem(key, value);
  cache.setItem(PREFERENCES_VERSION_KEY, String(snapshot.version));
  return snapshot;
}

export function observePreferences(
  cache: PreferenceCache,
  write: (snapshot: PreferencesSnapshot) => Promise<void>,
  onFailure: () => void
) {
  const prototype = Object.getPrototypeOf(cache) as PreferenceCache;
  const descriptors = ["setItem", "removeItem", "clear"].map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)!] as const);
  const rawSet = prototype.setItem;
  const rawRemove = prototype.removeItem;
  const rawClear = prototype.clear;
  let version = cachedVersion(cache);
  let dirty = false;
  let pending: Promise<void> | null = null;
  let error: unknown;

  const schedule = () => {
    if (pending) return;
    pending = Promise.resolve().then(async () => {
      while (dirty) {
        dirty = false;
        await write({ schema: 1, version, values: cachedValues(cache) });
        error = undefined;
      }
    }).catch((failure: unknown) => {
      error = failure;
      dirty = true;
      onFailure();
    }).finally(() => { pending = null; });
  };
  const changed = () => {
    version++;
    rawSet.call(cache, PREFERENCES_VERSION_KEY, String(version));
    dirty = true;
    schedule();
  };
  Object.defineProperty(prototype, "setItem", { configurable: true, writable: true, value: function (this: PreferenceCache, key: string, value: string) {
    rawSet.call(this, key, value);
    if (this === cache && key !== PREFERENCES_VERSION_KEY) changed();
  } });
  Object.defineProperty(prototype, "removeItem", { configurable: true, writable: true, value: function (this: PreferenceCache, key: string) {
    rawRemove.call(this, key);
    if (this === cache && key !== PREFERENCES_VERSION_KEY) changed();
  } });
  Object.defineProperty(prototype, "clear", { configurable: true, writable: true, value: function (this: PreferenceCache) {
    rawClear.call(this);
    if (this === cache) changed();
  } });
  return {
    get failed() { return error !== undefined; },
    async flush() {
      if (dirty) schedule();
      await pending;
      if (error !== undefined) throw error;
    },
    restore() { for (const [key, descriptor] of descriptors) Object.defineProperty(prototype, key, descriptor); },
  };
}
