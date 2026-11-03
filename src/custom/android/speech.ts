import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface AndroidVoice { name: string; locale: string; network: boolean }
export interface AndroidSpeechState {
  status: "idle" | "playing" | "paused" | "completed" | "error";
  bookKey: string;
  index: number;
  total: number;
  error: string;
}
interface SpeechPlugin {
  execute(request: Record<string, unknown>): Promise<AndroidSpeechState & { voices?: AndroidVoice[] }>;
  addListener(event: "stateChanged", callback: (state: AndroidSpeechState) => void): Promise<PluginListenerHandle>;
}

export const androidSpeech = registerPlugin<SpeechPlugin>("KoodoSpeech");
export const hasAndroidSpeech = () => Capacitor.isPluginAvailable("KoodoSpeech");
export const stopAndroidSpeech = () => hasAndroidSpeech() ? androidSpeech.execute({ action: "stop" }) : Promise.resolve();

// Start at the first visible paragraph, including when audioText returns the whole chapter.
export function speechFromVisible(text: string[], visible: string[]): string[] {
  const paragraphs = text.filter((value) => value.trim());
  const first = visible.find((value) => value.trim())?.trim();
  if (!first) return paragraphs;
  const index = paragraphs.findIndex((value) => value.includes(first));
  return index < 0 ? paragraphs : [paragraphs[index].slice(paragraphs[index].indexOf(first)), ...paragraphs.slice(index + 1)];
}
