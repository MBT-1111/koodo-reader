import build from "./build.json";

export const personalMode = build.personalServicesOnly;
export const isOfficialPlugin = (key: string) => key.startsWith("official-ai-");
export const availablePlugin = (plugin: { key: string }) => !personalMode || !isOfficialPlugin(plugin.key);
export const personalSettingMode = (mode: string) => personalMode && mode === "account" ? "ai" : mode;
