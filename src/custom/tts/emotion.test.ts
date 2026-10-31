import { createRequire } from "node:module";
import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AZURE_PLUGIN, azureParameters, azureStyles, selectedAzureStyle, selectedAzureDegree } from "./emotion";
import type { PluginVoice } from "../../utils/plugins/types";

const require = createRequire(import.meta.url);
const { azureSSML } = require("../../utils/plugins/main/voice/azureSSML.js") as typeof import("../../utils/plugins/main/voice/azureSSML.js");
const azure = require("../../utils/plugins/main/voice/azureTTSVoice.js") as typeof import("../../utils/plugins/main/voice/azureTTSVoice.js");
const axios = require("axios") as typeof import("axios").default;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-unit-tts-"));
afterAll(() => { vi.restoreAllMocks(); if (path.dirname(root) === fs.realpathSync(os.tmpdir()) && path.basename(root).startsWith("krc-unit-tts-")) fs.rmSync(root, { recursive: true, force: true }); });
const voice: PluginVoice = { name: "zh-CN-XiaoxiaoNeural", displayName: "Voice", locale: "zh-CN", plugin: AZURE_PLUGIN, styles: ["sad", "cheerful"], config: { voiceName: "zh-CN-XiaoxiaoNeural", apiKey: "synthetic-key", region: "eastus" } };

describe("Azure emotion and SSML", () => {
  it("shows only supported styles and resets unsupported saved preferences", () => {
    expect(azureStyles(voice)).toEqual(["neutral", "sad", "cheerful"]);
    expect(selectedAzureStyle(voice, JSON.stringify({ [voice.name]: "angry" }))).toBe("neutral");
    expect(selectedAzureStyle(voice, "broken json")).toBe("neutral");
    expect(azureStyles({ ...voice, styles: undefined, config: {} })).toEqual(["neutral"]);
  });
  it.each([[0, 1], [-50, 0.5], [50, 1.5], [100, 2]])("converts reader percentage %s to multiplier %s", (delta, expected) => {
    const result = azureParameters(voice, JSON.stringify({ [voice.name]: "sad" }), delta);
    expect(result.speed).toBe(expected); expect(result.config.style).toBe("sad");
  });
  it("escapes text and attributes, uses locale, and omits the neutral express-as tag", () => {
    const ssml = azureSSML('A & <tag> "quote" \u0000', 1.5, { name: 'voice"', locale: "zh-CN", styles: ["sad"] }, "sad");
    expect(ssml).toContain('xml:lang="zh-CN"'); expect(ssml).toContain('name="voice&quot;"');
    expect(ssml).toContain("A &amp; &lt;tag&gt; &quot;quote&quot; �");
    expect(ssml).toContain('rate="+50%"'); expect(ssml).toContain('style="sad"');
    expect(azureSSML("Text", 1, { name: "v", locale: "en-US", styles: [] }, "sad")).not.toContain("<mstts:express-as");
    expect(() => azureSSML("Text", NaN, voice)).toThrow();
  });
  it("validates intensity preferences and passes them into SSML and synthesis parameters", () => {
    const saved = JSON.stringify({ [voice.name]: 1.75 });
    expect(selectedAzureDegree(voice, saved)).toBe(1.75);
    expect(selectedAzureDegree(voice, JSON.stringify({ [voice.name]: 3 }))).toBe(1);
    expect(selectedAzureDegree(voice, "broken")).toBe(1);
    expect(azureParameters(voice, "{}", 0, saved).config.styleDegree).toBe(1.75);
    expect(azureSSML("Text", 1, voice, "sad", 0.01)).toContain('styledegree="0.01"');
    expect(azureSSML("Text", 1, voice, "neutral", 2)).not.toContain("express-as");
    for (const invalid of [0, 2.01, NaN, Infinity]) expect(() => azureSSML("Text", 1, voice, "sad", invalid)).toThrow("INVALID_AZURE_STYLE_DEGREE");
  });
  it("fetches authoritative capabilities, separates style caches and excludes credentials from cache identity", async () => {
    const get = vi.spyOn(axios, "get").mockResolvedValue({ data: [{ ShortName: voice.name, Locale: "zh-CN", Gender: "Female", LocalName: "Voice", StyleList: ["sad"] }] });
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: Buffer.from("ID3synthetic-audio") });
    const voices = await azure.getTTSVoice(voice.config);
    expect(voices[0].styles).toEqual(["neutral", "sad"]);
    const sad = await azure.getAudioPath("Text", 1, root, { ...voice.config, style: "sad" });
    const strong = await azure.getAudioPath("Text", 1, root, { ...voice.config, style: "sad", styleDegree: 2 });
    const neutral = await azure.getAudioPath("Text", 1, root, { ...voice.config, style: "neutral" });
    const reused = await azure.getAudioPath("Text", 1, root, { ...voice.config, apiKey: "other-synthetic-key", style: "neutral" });
    expect(sad).not.toBe(neutral); expect(strong).not.toBe(sad); expect(reused).toBe(neutral); expect(post).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toContain('style="sad"');
    get.mockRestore(); post.mockRestore();
  });
  it("does not forward Axios errors that contain request credentials", async () => {
    const get = vi.spyOn(axios, "get").mockRejectedValue(new Error("synthetic-secret"));
    await expect(azure.getTTSVoice(voice.config)).rejects.toThrow("AZURE_VOICE_LIST_FAILED");
    get.mockRestore();
  });
});
