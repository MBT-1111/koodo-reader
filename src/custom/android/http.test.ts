import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const qa = vi.hoisted(() => ({ native: true, request: vi.fn() }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: { request: qa.request } }));
vi.mock("../../utils/platform", () => ({ get isNativeAndroid() { return qa.native; } }));
import { serviceAxios, serviceFetch } from "./http";

beforeEach(() => { qa.native = true; qa.request.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("Android service HTTP", () => {
  it("uses native HTTP with header authentication and preserves parsed JSON and HTTP status", async () => {
    const browser = vi.fn(); vi.stubGlobal("fetch", browser);
    qa.request.mockResolvedValue({ status: 200, headers: { "content-type": "application/json" }, data: { result: "译文" } });
    const response = await serviceFetch("https://api.invalid/v1", { method: "POST", headers: { "x-goog-api-key": "synthetic-key" }, body: '{"text":"hello"}' });
    expect(await response.json()).toEqual({ result: "译文" });
    expect(qa.request).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.invalid/v1", data: '{"text":"hello"}', headers: { "x-goog-api-key": "synthetic-key" }, disableRedirects: true }));
    expect(browser).not.toHaveBeenCalled();
  });
  it("retains normal browser fetch outside native Android", async () => {
    qa.native = false;
    const browser = vi.fn().mockResolvedValue(new Response("browser")); vi.stubGlobal("fetch", browser);
    expect(await (await serviceFetch("https://api.invalid")).text()).toBe("browser");
    expect(qa.request).not.toHaveBeenCalled();
  });
  it.each(["file:///private/config", "https://name:secret@api.invalid"])("rejects invalid native service targets", async (url) => {
    await expect(serviceFetch(url)).rejects.toThrow("CUSTOM_AI_NOT_CONFIGURED");
    expect(qa.request).not.toHaveBeenCalled();
  });
  it("rejects cancellation promptly and ignores a late native completion", async () => {
    let finish!: (value: unknown) => void;
    qa.request.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController(), pending = serviceFetch("https://api.invalid", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish({ status: 200, headers: {}, data: "late" });
    await Promise.resolve();
  });
  it("runs existing translation adapters with query parameters, JSON transforms and HTTP failures", async () => {
    qa.request.mockResolvedValueOnce({ status: 200, headers: { "content-type": "application/json" }, data: [{ translations: [{ text: "你好" }] }] });
    const result = await serviceAxios.post("https://api.invalid/translate", [{ text: "hello" }], { params: { to: "zh-Hans" } });
    expect(result.data[0].translations[0].text).toBe("你好");
    expect(qa.request.mock.calls[0][0].url).toBe("https://api.invalid/translate?to=zh-Hans");
    expect(JSON.parse(qa.request.mock.calls[0][0].data)).toEqual([{ text: "hello" }]);
    qa.request.mockResolvedValueOnce({ status: 429, headers: {}, data: "rate limited" });
    await expect(serviceAxios.get("https://api.invalid/translate")).rejects.toMatchObject({ response: { status: 429 } });
  });
});
