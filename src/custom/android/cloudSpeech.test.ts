import { beforeEach, describe, expect, it, vi } from "vitest";
const fetcher = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ serviceFetch: fetcher }));
import { cloudSpeechPlugins, getAndroidCloudVoices, supportsAndroidCloudVoice } from "./cloudSpeech";

beforeEach(() => fetcher.mockReset());
describe("Android cloud voice catalog", () => {
  it("exposes only the two native cloud providers", () => {
    expect(supportsAndroidCloudVoice(cloudSpeechPlugins.azure)).toBe(true);
    expect(supportsAndroidCloudVoice(cloudSpeechPlugins.mimo)).toBe(true);
    expect(supportsAndroidCloudVoice("custom-voice-plugin")).toBe(false);
  });
  it("fetches Azure locale and supported emotion metadata using header authentication", async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify([{ ShortName: "zh-CN-XiaoxiaoNeural", Locale: "zh-CN", LocalName: "晓晓", StyleList: ["cheerful", "invalid style"] }, {}])));
    const voices = await getAndroidCloudVoices(cloudSpeechPlugins.azure, { region: "eastus", apiKey: "synthetic-key" });
    expect(fetcher).toHaveBeenCalledWith("https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list", { headers: { "Ocp-Apim-Subscription-Key": "synthetic-key" } });
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({ name: "zh-CN-XiaoxiaoNeural", locale: "zh-CN", styles: ["neutral", "cheerful"], config: { voiceName: "zh-CN-XiaoxiaoNeural", locale: "zh-CN" } });
  });
  it("rejects invalid Azure configuration before making a request", async () => {
    await expect(getAndroidCloudVoices(cloudSpeechPlugins.azure, { region: "eastus/attack", apiKey: "key" })).rejects.toThrow();
    await expect(getAndroidCloudVoices(cloudSpeechPlugins.azure, { region: "eastus", apiKey: "key\nheader" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("provides MiMo preset identifiers without a paid synthesis call", async () => {
    const voices = await getAndroidCloudVoices(cloudSpeechPlugins.mimo, { apiKey: "synthetic-key" });
    expect(voices.map((voice) => voice.name)).toContain("冰糖");
    expect(voices.find((voice) => voice.name === "Dean")?.locale).toBe("en-US");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
