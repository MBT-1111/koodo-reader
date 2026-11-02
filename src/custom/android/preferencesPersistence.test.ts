import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedValues, hydratePreferences, observePreferences, PREFERENCES_VERSION_KEY } from "./preferencesPersistence";
import type { PreferencesSnapshot } from "./storage";

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const snapshot = (version = 3): PreferencesSnapshot => ({ schema: 1, version, values: { recordLocation: '{"book":{"percentage":0.4}}', theme: "dark" } });
let observer: ReturnType<typeof observePreferences> | undefined;
afterEach(() => { observer?.restore(); observer = undefined; });

describe("Android native preferences", () => {
  it("restores progress and settings when the WebView cache is missing or stale", () => {
    const cache = new MemoryStorage();
    cache.setItem("stale", "remove me");
    hydratePreferences(cache, snapshot());
    expect(cachedValues(cache)).toEqual(snapshot().values);
    expect(cache.getItem(PREFERENCES_VERSION_KEY)).toBe("3");
  });

  it("preserves a newer cache revision left by a failed native write", () => {
    const cache = new MemoryStorage();
    cache.setItem(PREFERENCES_VERSION_KEY, "4");
    cache.setItem("recordLocation", "newer progress");
    expect(hydratePreferences(cache, snapshot())).toEqual({ schema: 1, version: 4, values: { recordLocation: "newer progress" } });
    expect(cache.getItem("recordLocation")).toBe("newer progress");
  });

  it("rejects invalid snapshots before changing the cache", () => {
    const cache = new MemoryStorage();
    cache.setItem("recordLocation", "keep me");
    expect(() => hydratePreferences(cache, { ...snapshot(), version: 0 })).toThrow();
    expect(cache.getItem("recordLocation")).toBe("keep me");
  });

  it("coalesces a burst of synchronous changes and ignores session storage", async () => {
    const cache = new MemoryStorage();
    const session = new MemoryStorage();
    const write = vi.fn(async (_value: PreferencesSnapshot) => {});
    observer = observePreferences(cache, write, vi.fn());
    cache.setItem("recordLocation", "old");
    cache.setItem("recordLocation", "new");
    session.setItem("temporary", "session only");
    await observer.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith({ schema: 1, version: 2, values: { recordLocation: "new" } });
  });

  it("serializes a change made while a native write is still pending", async () => {
    const cache = new MemoryStorage();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const written: PreferencesSnapshot[] = [];
    observer = observePreferences(cache, async (value) => { written.push(value); if (written.length === 1) await blocked; }, vi.fn());
    cache.setItem("recordLocation", "first");
    await Promise.resolve();
    cache.setItem("recordLocation", "last");
    expect(written).toHaveLength(1);
    release();
    await observer.flush();
    expect(written.map((value) => value.values.recordLocation)).toEqual(["first", "last"]);
    expect(written.map((value) => value.version)).toEqual([1, 2]);
  });

  it("keeps failed writes in cache and retries them on the next flush", async () => {
    const cache = new MemoryStorage();
    const failure = new Error("disk full");
    const onFailure = vi.fn();
    const write = vi.fn(async (_value: PreferencesSnapshot) => {}).mockRejectedValueOnce(failure);
    observer = observePreferences(cache, write, onFailure);
    cache.setItem("recordLocation", "keep me");
    await expect(observer.flush()).rejects.toThrow("disk full");
    expect(observer.failed).toBe(true);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(cache.getItem("recordLocation")).toBe("keep me");
    await observer.flush();
    expect(observer.failed).toBe(false);
    expect(write).toHaveBeenLastCalledWith({ schema: 1, version: 1, values: { recordLocation: "keep me" } });
  });

  it("persists removals and clear without resetting the monotonic revision", async () => {
    const cache = new MemoryStorage();
    hydratePreferences(cache, snapshot());
    const write = vi.fn(async (_value: PreferencesSnapshot) => {});
    observer = observePreferences(cache, write, vi.fn());
    cache.removeItem("theme");
    await observer.flush();
    expect(write.mock.calls[0][0].values).not.toHaveProperty("theme");
    cache.clear();
    await observer.flush();
    expect(write).toHaveBeenLastCalledWith({ schema: 1, version: 5, values: {} });
    expect(cache.getItem(PREFERENCES_VERSION_KEY)).toBe("5");
  });
});
