import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginListenerHandle } from "@capacitor/core";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../store/useAppStore";
import { androidSpeech, hasAndroidSpeech, speechFromVisible, stopAndroidSpeech, type AndroidSpeechState, type AndroidVoice } from "../../custom/android/speech";
import { ANDROID_READER_CLOSE_EVENT } from "../../custom/android/navigation";
import TTSUtil from "../../utils/reader/ttsUtil";
import { getTextRules } from "../../utils/common";
import "./androidSpeech.css";

interface AndroidSpeechProps { open: boolean; onClose: () => void }

const AndroidSpeech = ({ open, onClose }: AndroidSpeechProps) => {
  const { t } = useTranslation();
  const book = useAppStore((state) => state.book.currentBook);
  const htmlBook = useAppStore((state) => state.reader.htmlBook);
  const [voices, setVoices] = useState<AndroidVoice[]>([]);
  const [voice, setVoice] = useState(ConfigService.getReaderConfig("androidVoice") || "");
  const [speed, setSpeed] = useState(ConfigService.getReaderConfig("androidVoiceSpeed") || "1");
  const [playback, setPlayback] = useState<AndroidSpeechState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const active = !!playback && playback.bookKey === book.key && ["playing", "paused"].includes(playback.status);

  useEffect(() => {
    if (!hasAndroidSpeech()) return;
    let disposed = false;
    let listener: PluginListenerHandle | undefined;
    void androidSpeech.addListener("stateChanged", (state) => { if (!disposed) setPlayback(state); })
      .then((handle) => { if (disposed) void handle.remove(); else listener = handle; }).catch(() => { if (!disposed) setError(true); });
    const closing = () => { generation.current++; setBusy(false); };
    window.addEventListener(ANDROID_READER_CLOSE_EVENT, closing);
    return () => {
      disposed = true; generation.current++;
      window.removeEventListener(ANDROID_READER_CLOSE_EVENT, closing);
      void listener?.remove();
      void stopAndroidSpeech().catch(() => {});
    };
  }, [book.key]);

  useEffect(() => {
    if (!open || !hasAndroidSpeech()) return;
    let disposed = false;
    setBusy(true); setError(false);
    void Promise.all([androidSpeech.execute({ action: "voices" }), androidSpeech.execute({ action: "state" })])
      .then(([result, state]) => {
        if (disposed) return;
        const available = result.voices || [];
        setVoices(available); setPlayback(state);
        setVoice((previous) => available.some((item) => item.name === previous) ? previous
          : (available.find((item) => item.locale.split("-")[0] === navigator.language.split("-")[0] && !item.network) || available.find((item) => !item.network) || available[0])?.name || "");
      }).catch(() => { if (!disposed) setError(true); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [open]);

  const command = async (action: string) => {
    const current = ++generation.current;
    setBusy(true); setError(false);
    try {
      let result: AndroidSpeechState;
      if (action === "start") {
        if (!htmlBook?.rendition || htmlBook.key !== book.key) throw new Error("ANDROID_SPEECH_NOT_READY");
        const [text, visible] = await Promise.all([htmlBook.rendition.audioText(), htmlBook.rendition.visibleText()]);
        if (current !== generation.current || useAppStore.getState().reader.htmlBook !== htmlBook) return;
        TTSUtil.setTextRules(getTextRules(book.key));
        const paragraphs = speechFromVisible(text, visible).map((item) => TTSUtil.applyTextRules(item));
        ConfigService.setReaderConfig("androidVoice", voice);
        ConfigService.setReaderConfig("androidVoiceSpeed", speed);
        result = await androidSpeech.execute({ action, bookKey: book.key, title: book.name, text: paragraphs, voice, speed: Number(speed) });
      } else result = await androidSpeech.execute({ action });
      if (current === generation.current) setPlayback(result);
    } catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) setBusy(false); }
  };

  if (!open) return null;
  return (
    <>
      <button className="android-speech-backdrop" type="button" aria-label={t("Close")} onClick={onClose} />
      <section className="android-speech" role="dialog" aria-modal="true" aria-label={t("Text to speech")} aria-busy={busy}>
        <div className="android-reader-sheet-heading"><span>{t("Text to speech")}</span><button type="button" aria-label={t("Close")} onClick={onClose}><span className="icon-close" aria-hidden="true" /></button></div>
        {!hasAndroidSpeech() ? <p>{t("android.speech.nativeOnly")}</p> : <div className="android-speech-body">
          <p>{t("android.speech.scope")}</p>
          <label>{t("Voice")}<select aria-label={t("Voice")} disabled={busy || active} value={voice} onChange={(event) => setVoice(event.target.value)}>
            {voices.map((item) => <option key={item.name} value={item.name}>{item.locale} · {item.name}{item.network ? ` · ${t("android.speech.network")}` : ""}</option>)}
          </select></label>
          {!busy && !voices.length && <p role="status">{t("android.speech.noVoices")}</p>}
          <label>{t("Speed")}<select aria-label={t("Speed")} value={speed} disabled={busy || active} onChange={(event) => setSpeed(event.target.value)}>
            {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select></label>
          {playback?.bookKey === book.key && playback.total > 0 && <p role="status">{t(`android.speech.${playback.status}`)} · {playback.index + 1}/{playback.total}</p>}
          {(error || playback?.status === "error") && <p role="alert">{t("android.speech.failed")}</p>}
          <div className="android-speech-actions">
            {active && <button type="button" disabled={busy} onClick={() => void command("previous")}>{t("android.speech.previous")}</button>}
            <button type="button" disabled={busy || !voice || !htmlBook || htmlBook.key !== book.key} onClick={() => void command(active ? playback?.status === "playing" ? "pause" : "resume" : "start")}>
              {t(active ? playback?.status === "playing" ? "android.speech.pause" : "android.speech.resume" : "android.speech.start")}
            </button>
            {active && <button type="button" disabled={busy} onClick={() => void command("next")}>{t("android.speech.next")}</button>}
            {active && <button type="button" disabled={busy} onClick={() => void command("stop")}>{t("android.speech.stop")}</button>}
          </div>
        </div>}
      </section>
    </>
  );
};

export default AndroidSpeech;
