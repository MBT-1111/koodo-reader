import { ConfigService, HighlightUtil } from "../../assets/lib/kookit-extra-browser.min";
import { flushAndroidPreferences } from "./bootstrap";
import { androidSpeech, hasAndroidSpeech, type AndroidSpeechPosition } from "./speech";
import { isNativeAndroid } from "../../utils/platform";

interface ReadingPosition { text?: string; chapterDocIndex?: string | number; [key: string]: unknown }
interface SpeechRendition {
  getPosition(): ReadingPosition;
  getChapterDoc(): { href?: string }[];
  goToPosition(position: string): Promise<void>;
  visibleText(): Promise<string[]>;
  highlightAudioNode(text: string, style: unknown): void;
  record(): Promise<void>;
}

export function speechReadingPosition(position: AndroidSpeechPosition) {
  return { text: position.text, chapterDocIndex: String(position.chapterDocIndex), chapterTitle: position.chapterTitle, chapterHref: "", count: "ignore",
    ...(Number.isInteger(position.page) && position.page! >= 0 ? { page: String(position.page) } : {}) };
}

// Native anchors survive a suspended WebView or process death, and enter the same
// reading-position record used by normal reading, backups and manual cloud sync.
export async function flushSpeechReadingPositions() {
  if (!isNativeAndroid || !hasAndroidSpeech()) return;
  const { positions = [] } = await androidSpeech.readingPosition({});
  for (const position of positions) ConfigService.setObjectConfig(position.bookKey, speechReadingPosition(position), "recordLocation");
  if (!positions.length) return;
  await flushAndroidPreferences();
  for (const position of positions) await androidSpeech.readingPosition({ bookKey: position.bookKey, acknowledge: position.id });
}

export async function followSpeechPosition(rendition: SpeechRendition, position: AndroidSpeechPosition, current: () => boolean) {
  if (!current()) return;
  const location = rendition.getPosition(), visible = await rendition.visibleText();
  if (!current()) return;
  const anchor = position.text.trim();
  const onPage = Number(location.chapterDocIndex) === position.chapterDocIndex && visible.some(text => text.includes(anchor));
  if (!onPage) await rendition.goToPosition(JSON.stringify({ ...speechReadingPosition(position), chapterHref: rendition.getChapterDoc()[position.chapterDocIndex]?.href || "" }));
  if (!current()) return;
  const style = new HighlightUtil(ConfigService).buildTtsHighlightStyle(false, ConfigService.getReaderConfig("textOrientation") === "vertical");
  rendition.highlightAudioNode(anchor, style);
  await rendition.record();
  if (!current()) return;
  const actual = rendition.getPosition();
  const saved = actual.text && Number(actual.chapterDocIndex) === position.chapterDocIndex ? actual : {
    ...speechReadingPosition(position), chapterHref: rendition.getChapterDoc()[position.chapterDocIndex]?.href || "",
  };
  ConfigService.setObjectConfig(position.bookKey, saved, "recordLocation");
  if (isNativeAndroid) {
    await flushAndroidPreferences();
    if (current()) await androidSpeech.readingPosition({ bookKey: position.bookKey, acknowledge: position.id });
  }
}
