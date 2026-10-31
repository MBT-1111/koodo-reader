import type { PluginVoice, PluginConfig } from "../../utils/plugins/types";

export const AZURE_PLUGIN = "azure-tts-voice-plugin";

export function azureStyles(voice: Partial<PluginVoice> | undefined): string[] {
  const styles = voice?.styles ?? voice?.config?.supportedStyles;
  return ["neutral", ...new Set(Array.isArray(styles) ? styles.filter((s): s is string => typeof s === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(s) && s !== "neutral") : [])];
}

export function selectedAzureStyle(voice: Partial<PluginVoice> | undefined, saved: string): string {
  try {
    const map: unknown = JSON.parse(saved || "{}");
    if (map && typeof map === "object" && !Array.isArray(map) && voice?.name) {
      const style = (map as Record<string, unknown>)[voice.name];
      if (typeof style === "string" && azureStyles(voice).includes(style)) return style;
    }
  } catch { /* A corrupt preference must not prevent neutral speech. */ }
  return "neutral";
}

// The existing reader queue uses percentage deltas; Azure accepts a multiplier.
export const AZURE_DEGREES = [0.01, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export function selectedAzureDegree(voice: Partial<PluginVoice> | undefined, saved: string): number {
  try {
    const map: unknown = JSON.parse(saved || "{}");
    if (map && typeof map === "object" && !Array.isArray(map) && voice?.name) {
      const value = (map as Record<string, unknown>)[voice.name];
      if (typeof value === "number" && AZURE_DEGREES.includes(value)) return value;
    }
  } catch { /* Invalid preferences use Azure's default degree. */ }
  return 1;
}

export function azureParameters(voice: PluginVoice, saved: string, percent: number, degrees = "{}"): { speed: number; config: PluginConfig } {
  if (!Number.isFinite(percent) || percent < -90 || percent > 700) throw new Error("INVALID_AZURE_SPEED");
  return { speed: (percent + 100) / 100, config: { ...voice.config, style: selectedAzureStyle(voice, saved), styleDegree: selectedAzureDegree(voice, degrees) } };
}
