import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ reader: {} as Record<string, string>, models: {} as Record<string, unknown> }));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: {
  getReaderConfig: (key: string) => fixture.reader[key] || "",
  getObjectConfig: (key: string) => fixture.models[key],
} }));
import { hasReadingAI, personalBatchTranslation, personalSplitSentence, personalWordDefinitions, readingAIIdentity } from "./reader";
const network = vi.fn<typeof fetch>();
const response = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
beforeEach(() => {
  network.mockReset(); vi.stubGlobal("fetch", network);
  fixture.reader = { aiTranslateModel: "test", aiDictModel: "test", aiAssistanceModel: "test", lang: "zhCN" };
  fixture.models = { test: { config: { endpoint: "https://example.invalid/v1", modelId: "synthetic-model", apiKey: "synthetic-secret" } } };
});
afterEach(() => vi.unstubAllGlobals());

describe("personal reading AI without official services", () => {
  it("uses the configured model and preserves every original sentence in role analysis", async () => {
    network.mockResolvedValue(response({ roles: ["narrator", "female"] }));
    const input = [{ text: "原始旁白", index: 7 }, { text: "原始对话 & <tag>", index: 8 }];
    const result = await personalSplitSentence(input);
    expect(result.data.sentences).toEqual(input.map((item, index) => ({ ...item, role: index ? "female" : "narrator" })));
    expect(network.mock.calls[0][0]).toBe("https://example.invalid/v1/chat/completions");
    const options = network.mock.calls[0][1]!;
    expect(options.headers).toMatchObject({ Authorization: "Bearer synthetic-secret" });
    expect(JSON.parse(String(options.body))).toMatchObject({ model: "synthetic-model", stream: false, response_format: { type: "json_object" } });
    expect(JSON.parse(String(options.body))).not.toHaveProperty("thinking");
    expect(String(options.body)).not.toContain("synthetic-secret");
    expect(readingAIIdentity("roles")).not.toContain("synthetic-secret");
  });
  it("batches translations while preserving order and rejects truncated responses", async () => {
    network.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const data = JSON.parse(body.messages[1].content) as { texts: string[] };
      return response({ texts: data.texts.map(text => `译:${text}`) });
    });
    const texts = Array.from({ length: 18 }, (_, index) => `paragraph-${index}`);
    expect((await personalBatchTranslation(texts, "Automatic", "zhCN")).data.texts).toEqual(texts.map(text => `译:${text}`));
    expect(network).toHaveBeenCalledTimes(3);
    network.mockResolvedValue(response([]));
    await expect(personalBatchTranslation(["text"], "en", "zhCN")).rejects.toThrow("CUSTOM_AI_INVALID_RESPONSE");
  });
  it("validates dictionary output and maps it to the public reader annotation contract", async () => {
    network.mockResolvedValue(response([[{ word: "enigmatic", meaning: "mysterious", cn_meaning: "神秘的", apiKey: "discard", level: "C1" }, { word: "absent", meaning: "ignore" }]]));
    const result = await personalWordDefinitions(["An enigmatic example"], "四级", "en");
    expect(result.data.results).toEqual([{ text: "An enigmatic example", words: [{ word: "enigmatic", meaning: "mysterious", cn_meaning: "神秘的", level: "C1" }] }]);
  });
  it("does not contact official endpoints or silently fall back when a personal model is missing", async () => {
    fixture.models.test = { config: { endpoint: "https://api.koodoreader.com/v1", modelId: "blocked" } };
    expect(hasReadingAI("roles")).toBe(false);
    await expect(personalSplitSentence([{ text: "text", index: 0 }])).rejects.toThrow("CUSTOM_AI_NOT_CONFIGURED");
    expect(network).not.toHaveBeenCalled();
    fixture.models = {};
    expect(hasReadingAI("dictionary")).toBe(false);
  });
  it("rejects invalid roles and hides transport errors containing credentials", async () => {
    network.mockResolvedValue(response(["unknown"]));
    await expect(personalSplitSentence([{ text: "text", index: 0 }])).rejects.toThrow("CUSTOM_AI_INVALID_RESPONSE");
    network.mockRejectedValue(new Error("synthetic-secret"));
    await expect(personalSplitSentence([{ text: "text", index: 0 }])).rejects.toThrow("CUSTOM_AI_REQUEST_FAILED");
  });
  it("supports wrapped sentence roles without trusting model text or indexes", async () => {
    network.mockResolvedValue(response({ sentences: [{ role: " Narrator ", text: "modified", index: 99 }, { role: "FEMALE" }] }));
    const input = [{ text: "Original narration", index: 3 }, { text: "Original dialogue", index: 3 }];
    expect((await personalSplitSentence(input)).data.sentences).toEqual(input.map((item, index) => ({ ...item, role: index ? "female" : "narrator" })));
    network.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n["male"]\n```' } }] })));
    expect((await personalSplitSentence(input.slice(0, 1))).data.sentences[0].role).toBe("male");
  });
  it("uses DeepSeek JSON output and disables thinking only on its own endpoint", async () => {
    fixture.models.test = { config: { endpoint: "https://api.deepseek.com/v1", modelId: "deepseek-chat", apiKey: "synthetic-secret" } };
    network.mockResolvedValue(response({ roles: ["narrator"] }));
    await personalSplitSentence([{ text: "Text", index: 0 }]);
    expect(JSON.parse(String(network.mock.calls[0][1]?.body))).toMatchObject({ response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: 8192 });
  });
  it("keeps a chapter number locally when the model would otherwise omit it", async () => {
    network.mockResolvedValue(response({ roles: { "0": "narrator", "1": "female" } }));
    const input = [{ text: "1", index: 0 }, { text: "Original narration.", index: 1 }, { text: "Original dialogue!", index: 1 }];
    const result = await personalSplitSentence(input);
    expect(result.data.sentences).toEqual(input.map((item, index) => ({ ...item, role: index === 2 ? "female" : "narrator" })));
    const body = JSON.parse(String(network.mock.calls[0][1]?.body));
    expect(JSON.parse(body.messages[1].content)).toEqual({ sentences: [{ id: "0", text: input[1].text }, { id: "1", text: input[2].text }] });
  });
  it("assigns numeric and punctuation-only inputs without spending model tokens", async () => {
    const input = [{ text: "123", index: 0 }, { text: "—", index: 1 }];
    expect((await personalSplitSentence(input)).data.sentences).toEqual(input.map(item => ({ ...item, role: "narrator" })));
    expect(network).not.toHaveBeenCalled();
  });
  it("retains cancellation and size limits even when every input is a heading", async () => {
    await expect(personalSplitSentence([{ text: "1".repeat(50001), index: 0 }])).rejects.toThrow("CUSTOM_AI_TEXT_TOO_LONG");
    const controller = new AbortController(); controller.abort();
    await expect(personalSplitSentence([{ text: "1", index: 0 }], controller.signal)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
  it("fills missing identified roles with narration without dropping or shifting text", async () => {
    network.mockResolvedValue(response({ roles: { "1": "female" } }));
    const input = [{ text: "First original.", index: 4 }, { text: "Second original.", index: 5 }];
    const result = await personalSplitSentence(input);
    expect(result.data.fallbackCount).toBe(1);
    expect(result.data.sentences).toEqual(input.map((item, index) => ({ ...item, role: index ? "female" : "narrator" })));
    expect(network).toHaveBeenCalledTimes(1);
    network.mockResolvedValue(response({ roles: { "2": "male" } }));
    await expect(personalSplitSentence(input)).rejects.toThrow("CUSTOM_AI_INVALID_RESPONSE");
  });
  it.each([
    { finish_reason: "stop", message: { content: "   ", reasoning_content: "not an answer" } },
    { finish_reason: "length", message: { content: '{"roles":[' } },
  ])("reports incomplete answers without spending tokens on automatic retries", async choice => {
    network.mockResolvedValue(new Response(JSON.stringify({ choices: [choice] })));
    await expect(personalSplitSentence([{ text: "text", index: 0 }])).rejects.toThrow("CUSTOM_AI_INCOMPLETE_RESPONSE");
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("cancels subsequent batches when the reader leaves or stops", async () => {
    const controller = new AbortController();
    network.mockImplementation(async (_url, options) => {
      const texts: string[] = JSON.parse(JSON.parse(String(options?.body)).messages[1].content).texts;
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      controller.abort();
      return response({ texts });
    });
    await expect(personalBatchTranslation(Array.from({ length: 18 }, (_, index) => `text-${index}`), "en", "zhCN", controller.signal)).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
    network.mockClear();
    await expect(personalSplitSentence([{ text: "text", index: 0 }], controller.signal)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});
