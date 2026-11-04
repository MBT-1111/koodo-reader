import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

// Execute the registered handler without booting Electron or accessing a real profile.
const source = fs.readFileSync(new URL("../../../main.js", import.meta.url), "utf8");
const start = source.indexOf('  ipcMain.handle("get-cache-size"');
const end = source.indexOf('  // 清理临时缓存', start);
const library = path.resolve("synthetic-library"), tts = path.resolve("synthetic-tts");
type Handler = (event: unknown, config?: unknown) => Promise<number>;
function cacheHandler() {
  if (start < 0 || end < start) throw new Error("Cache IPC registration not found");
  let handle: Handler | undefined;
  const size = vi.fn((directory: string) => directory === library ? 100 : 10);
  runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (channel: string, handler: Handler) => { expect(channel).toBe("get-cache-size"); handle = handler; } },
    path, dataPath: library, getDirSize: size, getTTSCacheDirPath: () => tts, getTempCacheDirPaths: () => ["temp-one", "temp-two"],
  });
  if (!handle) throw new Error("Cache IPC handler missing");
  return { handle, size };
}

it("counts the active library and TTS cache when no override or the active root is supplied", async () => {
  const { handle, size } = cacheHandler();
  expect(await handle({}, { type: "all" })).toBe(110);
  expect(await handle({}, { type: "all", storagePath: library })).toBe(110);
  expect(size.mock.calls.map(([directory]) => directory)).toEqual([library, tts, library, tts]);
});

it.each([path.resolve("other-library"), path.join(library, "books"), "../other-library", "", 12, null])("rejects a foreign or invalid cache root before reading directories: %s", async storagePath => {
  const { handle, size } = cacheHandler();
  await expect(handle({}, { type: "all", storagePath })).rejects.toThrow("Invalid cache size request");
  expect(size).not.toHaveBeenCalled();
});

it("preserves TTS and temporary cache queries and rejects unknown types", async () => {
  const { handle } = cacheHandler();
  expect(await handle({}, { type: "tts" })).toBe(10);
  expect(await handle({}, { type: "temp" })).toBe(20);
  await expect(handle({}, { type: "unknown" })).rejects.toThrow("Invalid cache size request");
});
