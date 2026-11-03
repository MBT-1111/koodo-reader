import type { PluginConfig, PluginVoice } from "../../utils/plugins/types";
import { serviceFetch } from "./http";

export const cloudSpeechPlugins = { azure: "azure-tts-voice-plugin", mimo: "mimo-tts-voice-plugin" } as const;
export type SpeechSource = "system" | keyof typeof cloudSpeechPlugins;
export const supportsAndroidCloudVoice = (key: string) => Object.values(cloudSpeechPlugins).some((value) => value === key);
export const speechVoiceKey = (source: SpeechSource) => source === "system" ? "androidVoice" : source === "azure" ? "androidAzureVoice" : "androidMimoVoice";

export async function getAndroidCloudVoices(key: string, config: PluginConfig): Promise<PluginVoice[]> {
  if (!config.apiKey?.trim() || /[\r\n]/.test(config.apiKey)) throw new Error("ANDROID_SPEECH_CONFIG");
  if (key === cloudSpeechPlugins.mimo) {
    return ["mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean"].map((name, index) => ({
      name, displayName: `MiMo · ${name}`, locale: index < 5 ? "zh-CN" : "en-US", plugin: key, config: { ...config, voiceName: name },
    }));
  }
  if (key !== cloudSpeechPlugins.azure || !/^[a-z][a-z0-9-]{0,62}$/.test(config.region || "") || !config.apiKey?.trim() || /[\r\n]/.test(config.apiKey)) throw new Error("ANDROID_SPEECH_CONFIG");
  const base = config.endpoint || `https://${config.region}.tts.speech.microsoft.com`;
  const response = await serviceFetch(`${base.replace(/\/$/, "")}/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": config.apiKey } });
  if (!response.ok) throw new Error("ANDROID_SPEECH_CONFIG");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("ANDROID_SPEECH_CONFIG");
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && typeof row.ShortName === "string" && typeof row.Locale === "string")
    .map((row) => {
      const name = String(row.ShortName), locale = String(row.Locale);
      const styles = Array.isArray(row.StyleList) ? row.StyleList.filter((value): value is string => typeof value === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(value)) : [];
      return { name, locale, displayName: `Azure · ${row.LocalName || name} (${locale})`, plugin: key, styles: ["neutral", ...styles], config: { ...config, voiceName: name, locale, supportedStyles: ["neutral", ...styles] } };
    });
}
