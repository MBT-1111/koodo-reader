import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface AndroidVoice { name: string; locale: string; network: boolean }
export interface AndroidSpeechState {
  status: "idle" | "buffering" | "playing" | "paused" | "completed" | "error";
  bookKey: string;
  index: number;
  total: number;
  error: string;
  source?: "system" | "azure" | "mimo";
  multiRole?: boolean;
  role?: "narrator" | "male" | "female" | "child";
  chapterDocIndex?: number;
  chapterTitle?: string;
}
interface SpeechPlugin {
  execute(request: Record<string, unknown>): Promise<AndroidSpeechState & { voices?: AndroidVoice[] }>;
  addListener(event: "stateChanged", callback: (state: AndroidSpeechState) => void): Promise<PluginListenerHandle>;
}

export const androidSpeech = registerPlugin<SpeechPlugin>("KoodoSpeech");
export const hasAndroidSpeech = () => Capacitor.isPluginAvailable("KoodoSpeech");
export const stopAndroidSpeech = () => hasAndroidSpeech() ? androidSpeech.execute({ action: "stop" }) : Promise.resolve();

// Start at the first visible paragraph, including when audioText returns the whole chapter.
export function speechFromVisible(text: string[], visible: string[], selected = ""): string[] {
  const paragraphs = text.filter((value) => value.trim());
  const first = visible.find((value) => value.trim())?.trim();
  const visibleIndex = first ? paragraphs.findIndex(value => value.includes(first)) : -1;
  if (selected.trim()) {
    const target = selected.trim();
    const index = paragraphs.findIndex((value, index) => index >= Math.max(0, visibleIndex) && value.includes(target));
    if (index < 0) throw new Error("ANDROID_SPEECH_SELECTION");
    return [paragraphs[index].slice(paragraphs[index].indexOf(target)), ...paragraphs.slice(index + 1)];
  }
  if (!first) return paragraphs;
  const index = visibleIndex;
  return index < 0 ? paragraphs : [paragraphs[index].slice(paragraphs[index].indexOf(first)), ...paragraphs.slice(index + 1)];
}
