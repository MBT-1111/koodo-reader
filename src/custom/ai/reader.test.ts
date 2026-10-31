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
    network.mockResolvedValue(response(["narrator", "female"]));
    const input = [{ text: "原始旁白", index: 7 }, { text: "原始对话 & <tag>", index: 8 }];
    const result = await personalSplitSentence(input);
    expect(result.data.sentences).toEqual(input.map((item, index) => ({ ...item, role: index ? "female" : "narrator" })));
    expect(network.mock.calls[0][0]).toBe("https://example.invalid/v1/chat/completions");
    const options = network.mock.calls[0][1]!;
    expect(options.headers).toMatchObject({ Authorization: "Bearer synthetic-secret" });
    expect(JSON.parse(String(options.body))).toMatchObject({ model: "synthetic-model", stream: false });
    expect(String(options.body)).not.toContain("synthetic-secret");
    expect(readingAIIdentity("roles")).not.toContain("synthetic-secret");
  });
  it("batches translations while preserving order and rejects truncated responses", async () => {
    network.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const data = JSON.parse(body.messages[1].content) as { texts: string[] };
      return response(data.texts.map(text => `译:${text}`));
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
});
