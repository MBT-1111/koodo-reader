import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../store/useAppStore";
import TTSUtil from "../../utils/reader/ttsUtil";
import { flushAndroidPreferences } from "./bootstrap";

export const ANDROID_READER_CLOSE_EVENT = "android-reader-close";
export const ANDROID_READER_DISMISS_EVENT = "android-reader-dismiss";

export function dismissAndroidReaderOverlay(): boolean {
  const event = new Event(ANDROID_READER_DISMISS_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export async function closeAndroidReader() {
  // Flush the current position before clearing the rendition or changing routes.
  window.dispatchEvent(new Event(ANDROID_READER_CLOSE_EVENT));
  try {
    await flushAndroidPreferences();
  } catch {
    // The cache retains its newer revision; keep the reader open for retry.
    return;
  }
  window.speechSynthesis?.cancel();
  await TTSUtil.stopAudio();
  const state = useAppStore.getState();
  state.handleReadingState(false);
  state.handleSearch(false);
  state.handleOpenMenu(false);
  state.handleHtmlBook(null);
  ConfigService.setReaderConfig("isFullscreen", "no");
  if (document.fullscreenElement) await document.exitFullscreen();
  // Replacing prevents Back from reopening a reader that has already been closed.
  window.location.replace(`${window.location.href.split("#")[0]}#/manager/home`);
}
