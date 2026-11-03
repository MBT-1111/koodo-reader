import { personalSplitSentence } from "../ai/reader";

export const speechRoleLabels = { narrator: "Narrator voice", male: "Male voice", female: "Female voice", child: "Child voice" } as const;
export type SpeechRole = keyof typeof speechRoleLabels;
export const dialogueRoles = ["male", "female", "child"] as const;
export const roleConfigKey = (role: typeof dialogueRoles[number], field: "Voice" | "Engine") => `multiRole${role[0].toUpperCase()}${role.slice(1)}${field}`;

export async function analyzeAndroidSpeech(paragraphs: string[], signal: AbortSignal) {
  // Keep headings, punctuation and every original sentence; the model supplies labels only.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const sentences = paragraphs.flatMap((paragraph, index) => Array.from(segmenter.segment(paragraph), item => ({ text: item.segment.trim(), index })).filter(item => item.text));
  const result = await personalSplitSentence(sentences, signal);
  signal.throwIfAborted();
  return { text: result.data.sentences.map(item => item.text), roles: result.data.sentences.map(item => item.role as SpeechRole), fallbackCount: result.data.fallbackCount };
}
