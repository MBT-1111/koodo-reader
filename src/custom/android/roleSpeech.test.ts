import { afterEach, beforeEach, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ model: "fixture" }));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: {
  getReaderConfig: () => config.model,
  getObjectConfig: () => ({ config: { endpoint: "https://gemini.invalid/v1beta", modelId: "gemini-fixture", providerId: "google", apiKey: "synthetic" } }),
} }));
import { analyzeAndroidSpeech } from "./roleSpeech";
const network = vi.fn<typeof fetch>();
const response = (roles: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ roles }) }] } }] }));
beforeEach(() => { network.mockReset(); vi.stubGlobal("fetch", network); });
afterEach(() => vi.unstubAllGlobals());

it("keeps original headings, punctuation, quotes and emoji while accepting only role labels from Gemini", async () => {
  network.mockImplementation(async (_url, options) => {
    const input = JSON.parse(JSON.parse(String(options?.body)).contents[0].parts[0].text);
    return response(Object.fromEntries(input.sentences.map((item: { id: string }, index: number) => [item.id, index % 2 ? "female" : "male"])));
  });
  const original = ["123", "—", "旁白开始。‘原始对话！’下一句。😀"];
  const result = await analyzeAndroidSpeech(original, new AbortController().signal);
  expect(result.text.join("")).toBe(original.join(""));
  expect(result.roles.slice(0, 2)).toEqual(["narrator", "narrator"]);
  expect(result.roles).toContain("female");
  expect(network.mock.calls[0][0]).toBe("https://gemini.invalid/v1beta/models/gemini-fixture:generateContent");
});

it("keeps omitted assignments as narration and reports the fallback", async () => {
  network.mockResolvedValue(response({ "1": "child" }));
  const result = await analyzeAndroidSpeech(["原始旁白。", "原始童声。"], new AbortController().signal);
  expect(result).toEqual({ text: ["原始旁白。", "原始童声。"], roles: ["narrator", "child"], anchors: ["原始旁白。", "原始童声。"], fallbackCount: 1 });
});

it("ignores a delayed model result after stopping and rejects oversized chapters before sending", async () => {
  const controller = new AbortController();
  network.mockImplementation(async () => { controller.abort(); return response({ "0": "female" }); });
  await expect(analyzeAndroidSpeech(["原文。"], controller.signal)).rejects.toThrow();
  network.mockClear();
  await expect(analyzeAndroidSpeech(["字".repeat(50001)], new AbortController().signal)).rejects.toThrow("CUSTOM_AI_TEXT_TOO_LONG");
  expect(network).not.toHaveBeenCalled();
});
