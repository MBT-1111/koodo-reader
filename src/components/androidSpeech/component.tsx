import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginListenerHandle } from "@capacitor/core";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../store/useAppStore";
import { androidSpeech, hasAndroidSpeech, speechFromVisible, stopAndroidSpeech, type AndroidSpeechState, type AndroidVoice } from "../../custom/android/speech";
import { ANDROID_READER_CLOSE_EVENT } from "../../custom/android/navigation";
import TTSUtil from "../../utils/reader/ttsUtil";
import { getTextRules } from "../../utils/common";
import { cloudSpeechPlugins, getAndroidCloudVoices, speechVoiceKey, type SpeechSource } from "../../custom/android/cloudSpeech";
import DatabaseService from "../../utils/storage/databaseService";
import EmotionSelect from "../../custom/tts/EmotionSelect";
import { selectedAzureDegree, selectedAzureStyle } from "../../custom/tts/emotion";
import type { PluginConfig, PluginVoice } from "../../utils/plugins/types";
import { hasReadingAI, readingAIErrorKey } from "../../custom/ai/reader";
import { analyzeAndroidSpeech, dialogueRoles, roleConfigKey, speechRoleLabels } from "../../custom/android/roleSpeech";
import { prepareSpeechChapters } from "../../custom/android/speechChapters";
import "./androidSpeech.css";

interface AndroidSpeechProps { open: boolean; onClose: () => void }

const AndroidSpeech = ({ open, onClose }: AndroidSpeechProps) => {
  const { t } = useTranslation();
  const book = useAppStore((state) => state.book.currentBook);
  const htmlBook = useAppStore((state) => state.reader.htmlBook);
  const plugins = useAppStore((state) => state.manager.plugins);
  const handleFetchPlugins = useAppStore((state) => state.handleFetchPlugins);
  const handleSetting = useAppStore((state) => state.handleSetting);
  const handleSettingMode = useAppStore((state) => state.handleSettingMode);
  const handlePluginSettingTab = useAppStore((state) => state.handlePluginSettingTab);
  const speechStartText = useAppStore(state => state.reader.speechStartText);
  const isSpeechAutoStart = useAppStore(state => state.reader.isSpeechAutoStart);
  const handleSpeechStartText = useAppStore(state => state.handleSpeechStartText);
  const handleSpeechAutoStart = useAppStore(state => state.handleSpeechAutoStart);
  const savedSource = ConfigService.getReaderConfig("androidSpeechSource");
  const [source, setSource] = useState<SpeechSource>(savedSource === "azure" || savedSource === "mimo" ? savedSource : "system");
  const [voices, setVoices] = useState<AndroidVoice[]>([]);
  const [voice, setVoice] = useState(ConfigService.getReaderConfig(speechVoiceKey(source)) || "");
  const [speed, setSpeed] = useState(ConfigService.getReaderConfig("androidVoiceSpeed") || "1");
  const [playback, setPlayback] = useState<AndroidSpeechState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisNotice, setAnalysisNotice] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [autoChapters, setAutoChapters] = useState(ConfigService.getReaderConfig("androidSpeechAutoChapters") === "yes");
  const [multiRole, setMultiRole] = useState(ConfigService.getAllListConfig("multiRoleVoiceBooks").includes(book.key));
  const [roleSelections, setRoleSelections] = useState(() => Object.fromEntries(dialogueRoles.map(role => [role, JSON.stringify([ConfigService.getReaderConfig(roleConfigKey(role, "Engine")), ConfigService.getReaderConfig(roleConfigKey(role, "Voice"))])])));
  const roleRequest = useRef<AbortController | null>(null);
  const voicesLoaded = useRef(false);
  const generation = useRef(0);
  const active = !!playback && playback.bookKey === book.key && ["buffering", "playing", "paused"].includes(playback.status);
  const locked = busy || analyzing || preparing || active;
  const supportsAutoChapters = ["EPUB", "TXT"].includes(book.format) && (source === "system" || !multiRole);
  const speaking = playback?.status === "playing" || playback?.status === "buffering";
  const playbackError = playback?.status === "error" && playback.bookKey === book.key && (!playback.source || playback.source === source);
  const plugin = source === "system" ? undefined : (plugins || []).find((item) => item.key === cloudSpeechPlugins[source]);
  const pluginVoices: PluginVoice[] = Array.isArray(plugin?.voiceList) ? plugin.voiceList : [];
  const cloudVoice = pluginVoices.find((item) => item.name === voice);
  const roleOptions = (plugins || []).flatMap(item => {
    const provider = Object.entries(cloudSpeechPlugins).find(([, key]) => key === item.key)?.[0] as Exclude<SpeechSource, "system"> | undefined;
    const list: PluginVoice[] = Array.isArray(item.voiceList) ? item.voiceList : [];
    return provider ? list.map(voice => ({ id: JSON.stringify([item.key, voice.name]), source: provider, voice, config: item.config })) : [];
  });
  const voiceConfig = (item: PluginVoice, config: object) => ({ ...config, ...item.config, voiceName: item.name,
    style: selectedAzureStyle(item, ConfigService.getItem("customAzureStyles") || "{}"), styleDegree: selectedAzureDegree(item, ConfigService.getItem("customAzureDegrees") || "{}") });

  useEffect(() => {
    if (!hasAndroidSpeech()) return;
    let disposed = false;
    let listener: PluginListenerHandle | undefined;
    void androidSpeech.addListener("stateChanged", (state) => { if (!disposed) setPlayback(state); })
      .then((handle) => { if (disposed) void handle.remove(); else listener = handle; }).catch(() => { if (!disposed) setError(true); });
    setMultiRole(ConfigService.getAllListConfig("multiRoleVoiceBooks").includes(book.key)); setAnalyzing(false); setPreparing(false); setBusy(false); setAnalysisError("");
    const closing = () => { generation.current++; roleRequest.current?.abort(); setAnalyzing(false); setPreparing(false); setBusy(false); handleSpeechAutoStart(false); handleSpeechStartText(""); };
    window.addEventListener(ANDROID_READER_CLOSE_EVENT, closing);
    return () => {
      disposed = true; generation.current++; roleRequest.current?.abort();
      handleSpeechAutoStart(false); handleSpeechStartText("");
      window.removeEventListener(ANDROID_READER_CLOSE_EVENT, closing);
      void listener?.remove();
      void stopAndroidSpeech().catch(() => {});
    };
  }, [book.key]);

  useEffect(() => {
    if (!open || !hasAndroidSpeech()) return;
    let disposed = false;
    voicesLoaded.current = false;
    setBusy(true); setError(false);
    void Promise.all([source === "system" ? androidSpeech.execute({ action: "voices" }) : Promise.resolve({ voices: pluginVoices.map((item) => ({ name: item.name, locale: item.locale || "", network: true })) }), androidSpeech.execute({ action: "state" })])
      .then(([result, state]) => {
        if (disposed) return;
        const available = result.voices || [];
        setVoices(available); setPlayback(state);
        if (state.bookKey === book.key && ["buffering", "playing", "paused"].includes(state.status) && state.source) setSource(state.source);
        setVoice((previous) => available.some((item) => item.name === previous) ? previous
          : (available.find((item) => item.locale.split("-")[0] === navigator.language.split("-")[0] && !item.network) || available.find((item) => !item.network) || available[0])?.name || "");
      }).catch(() => { if (!disposed) setError(true); })
      .finally(() => { if (!disposed) { voicesLoaded.current = true; setBusy(false); } });
    return () => { disposed = true; };
  }, [open, source, plugin]);

  const command = async (action: string) => {
    const current = ++generation.current;
    roleRequest.current?.abort(); roleRequest.current = null;
    setBusy(true); setPreparing(false); setError(false); setAnalysisError(""); setAnalysisNotice(0);
    try {
      let result: AndroidSpeechState;
      if (action === "start") {
        const selectedStart = useAppStore.getState().reader.speechStartText;
        if (!htmlBook?.rendition || htmlBook.key !== book.key) throw new Error("ANDROID_SPEECH_NOT_READY");
        if (active) {
          const stopped = await androidSpeech.execute({ action: "stop" });
          if (current !== generation.current) return;
          setPlayback(stopped);
        }
        const [text, visible] = await Promise.all([htmlBook.rendition.audioText(), htmlBook.rendition.visibleText()]);
        if (current !== generation.current || useAppStore.getState().reader.htmlBook !== htmlBook || useAppStore.getState().reader.isSpeechAutoStart) return;
        TTSUtil.setTextRules(getTextRules(book.key));
        const paragraphs = speechFromVisible(text, visible, selectedStart).map((item) => TTSUtil.applyTextRules(item));
        let chapters: Awaited<ReturnType<typeof prepareSpeechChapters>> | undefined;
        if (autoChapters && supportsAutoChapters) {
          const controller = new AbortController(); roleRequest.current = controller; setPreparing(true);
          chapters = await prepareSpeechChapters(htmlBook.rendition, paragraphs, item => TTSUtil.applyTextRules(item), controller.signal);
          if (current !== generation.current || useAppStore.getState().reader.htmlBook !== htmlBook || useAppStore.getState().reader.isSpeechAutoStart) return;
        }
        let classified: Awaited<ReturnType<typeof analyzeAndroidSpeech>> | undefined;
        if (source !== "system" && multiRole) {
          const controller = new AbortController(); roleRequest.current = controller; setAnalyzing(true);
          try { classified = await analyzeAndroidSpeech(paragraphs, controller.signal); }
          catch (failure) { if (current === generation.current) setAnalysisError(readingAIErrorKey(failure)); return; }
          if (current !== generation.current || useAppStore.getState().reader.htmlBook !== htmlBook || useAppStore.getState().reader.isSpeechAutoStart) return;
          setAnalysisNotice(classified.fallbackCount);
        }
        ConfigService.setReaderConfig(speechVoiceKey(source), voice);
        ConfigService.setReaderConfig("androidSpeechSource", source);
        ConfigService.setReaderConfig("androidVoiceSpeed", speed);
        const roleVoices = Object.fromEntries(dialogueRoles.flatMap(role => {
          const option = roleOptions.find(item => item.id === roleSelections[role]);
          return option ? [[role, { source: option.source, config: voiceConfig(option.voice, option.config) }]] : [];
        }));
        result = await androidSpeech.execute({ action, bookKey: book.key, title: book.name, text: classified?.text || paragraphs, voice, speed: Number(speed), source,
          ...chapters,
          ...(source !== "system" && plugin && cloudVoice ? { config: voiceConfig(cloudVoice, plugin.config) } : {}),
          ...(classified ? { roles: classified.roles, roleVoices } : {}) });
        if (current === generation.current && !useAppStore.getState().reader.isSpeechAutoStart && useAppStore.getState().reader.speechStartText === selectedStart) handleSpeechStartText("");
      } else {
        if (action === "stop") { handleSpeechStartText(""); handleSpeechAutoStart(false); }
        result = await androidSpeech.execute({ action });
      }
      if (current === generation.current) setPlayback(result);
    } catch (failure) {
      if (current === generation.current) {
        if (failure instanceof Error && failure.message === "ANDROID_SPEECH_SELECTION") setAnalysisError("android.speech.selectionMissing");
        else if (failure instanceof Error && failure.message === "ANDROID_SPEECH_CHAPTER_LIMIT") setAnalysisError("android.speech.chapterLimit");
        else if (failure instanceof Error && failure.message === "ANDROID_SPEECH_CHAPTERS") setAnalysisError("android.speech.chapterFailed");
        else setError(true);
      }
    }
    finally { if (current === generation.current) { setBusy(false); setAnalyzing(false); setPreparing(false); roleRequest.current = null; } }
  };

  useEffect(() => {
    if (!open || !isSpeechAutoStart) return;
    if (!hasAndroidSpeech()) { handleSpeechAutoStart(false); return; }
    if (analyzing || preparing) { generation.current++; roleRequest.current?.abort(); setAnalyzing(false); setPreparing(false); setBusy(false); return; }
    if (busy || analyzing || !voicesLoaded.current || !htmlBook || htmlBook.key !== book.key) return;
    // Consume the intent before starting; another render or a delayed reply must not replay it.
    if (!useAppStore.getState().reader.isSpeechAutoStart) return;
    handleSpeechAutoStart(false);
    if (!voice || !voices.length) return;
    if (source !== "system" && multiRole && !hasReadingAI("roles")) { setAnalysisError("custom.ai.CUSTOM_AI_NOT_CONFIGURED"); return; }
    void command("start");
    // The store intent and voice readiness trigger this action, not command's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isSpeechAutoStart, busy, analyzing, preparing, voice, voices.length, htmlBook, book.key]);

  if (!open) return null;
  return (
    <>
      <button className="android-speech-backdrop" type="button" aria-label={t("Close")} onClick={onClose} />
      <section className="android-speech" role="dialog" aria-modal="true" aria-label={t("Text to speech")} aria-busy={busy}>
        <div className="android-reader-sheet-heading"><span>{t("Text to speech")}</span><button type="button" aria-label={t("Close")} onClick={onClose}><span className="icon-close" aria-hidden="true" /></button></div>
        {!hasAndroidSpeech() ? <p>{t("android.speech.nativeOnly")}</p> : <div className="android-speech-body">
          <p>{t(autoChapters && supportsAutoChapters ? "android.speech.continuousScope" : source === "system" ? "android.speech.scope" : "android.speech.cloudScope")}</p>
          <label className="android-speech-auto"><input type="checkbox" checked={autoChapters && supportsAutoChapters} disabled={locked || !supportsAutoChapters} onChange={event => {
            setAutoChapters(event.target.checked); ConfigService.setReaderConfig("androidSpeechAutoChapters", event.target.checked ? "yes" : "no");
          }} />{t("android.speech.autoChapters")}</label>
          <p>{t("android.speech.autoChaptersHelp")}</p>
          {speechStartText && <p role="status">{t("android.speech.fromSelection")}</p>}
          <label>{t("android.speech.service")}<select aria-label={t("android.speech.service")} disabled={active} value={source} onChange={(event) => {
            const next = event.target.value as SpeechSource;
            generation.current++; roleRequest.current?.abort(); setAnalyzing(false); setPreparing(false); setBusy(false); setAnalysisError(""); setAnalysisNotice(0);
            setSource(next); setVoice(ConfigService.getReaderConfig(speechVoiceKey(next)) || "");
          }}>
            <option value="system">{t("android.speech.system")}</option><option value="azure">{t("android.speech.azure")}</option><option value="mimo">{t("android.speech.mimo")}</option>
          </select></label>
          <label>{t(source !== "system" && multiRole ? "Narrator voice" : "Voice")}<select aria-label={t(source !== "system" && multiRole ? "Narrator voice" : "Voice")} disabled={locked} value={voice} onChange={(event) => setVoice(event.target.value)}>
            {voices.map((item) => <option key={item.name} value={item.name}>{item.locale} · {item.name}{item.network ? ` · ${t("android.speech.network")}` : ""}</option>)}
          </select></label>
          {!busy && !voices.length && <p role="status">{t(source === "system" ? "android.speech.noVoices" : "android.speech.configureCloud")}</p>}
          {source !== "system" && <div className="android-speech-actions"><button type="button" disabled={locked} onClick={() => { onClose(); handlePluginSettingTab("voice"); handleSettingMode("plugins"); handleSetting(true); }}>{t("Plugins")}</button>
            {plugin && <button type="button" disabled={locked} onClick={async () => {
              setBusy(true); setError(false);
              try { const voiceList = await getAndroidCloudVoices(plugin.key, plugin.config as PluginConfig); await DatabaseService.saveRecord({ ...plugin, voiceList }, "plugins"); handleFetchPlugins(); }
              catch { setError(true); } finally { setBusy(false); }
            }}>{t("android.speech.refreshVoices")}</button>}
          </div>}
          {source === "azure" && <EmotionSelect voice={cloudVoice} disabled={locked} onChange={() => {}} />}
          {source !== "system" && <div className="android-speech-roles">
            <button type="button" role="switch" aria-checked={multiRole} disabled={locked} onClick={() => {
              if (multiRole) ConfigService.deleteListConfig(book.key, "multiRoleVoiceBooks"); else ConfigService.setListConfig(book.key, "multiRoleVoiceBooks");
              setMultiRole(!multiRole); setAnalysisError(""); setAnalysisNotice(0);
            }}>{t("AI multi-role speech")} · {t(multiRole ? "android.speech.enabled" : "android.speech.disabled")}</button>
            {multiRole && <>
              <p>{t("android.speech.rolesHelp")}</p>
              {!hasReadingAI("roles") && <p role="status">{t("custom.ai.CUSTOM_AI_NOT_CONFIGURED")}</p>}
              <div className="android-speech-actions"><button type="button" disabled={locked} onClick={() => { onClose(); handleSettingMode("ai"); handleSetting(true); }}>{t("AI service")}</button></div>
              {dialogueRoles.map(role => {
                const selected = roleOptions.find(item => item.id === roleSelections[role]);
                return <div key={role}><label>{t(speechRoleLabels[role])}<select aria-label={t(speechRoleLabels[role])} disabled={locked} value={selected?.id || ""} onChange={event => {
                  const next = roleOptions.find(item => item.id === event.target.value);
                  ConfigService.setReaderConfig(roleConfigKey(role, "Voice"), next?.voice.name || "");
                  ConfigService.setReaderConfig(roleConfigKey(role, "Engine"), next?.voice.plugin || "");
                  setRoleSelections(previous => ({ ...previous, [role]: event.target.value }));
                }}><option value="">{t("android.speech.useNarrator")}</option>{roleOptions.map(item => <option key={item.id} value={item.id}>{t(`android.speech.${item.source}`)} · {item.voice.displayName || item.voice.name}</option>)}</select></label>
                  {selected?.source === "azure" && <EmotionSelect voice={selected.voice} disabled={locked} onChange={() => {}} />}
                </div>;
              })}
            </>}
          </div>}
          <label>{t("Speed")}<select aria-label={t("Speed")} value={speed} disabled={locked} onChange={(event) => setSpeed(event.target.value)}>
            {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select></label>
          {analyzing && <p role="status">{t("Analyzing roles, please wait...")}</p>}
          {preparing && <p role="status">{t("android.speech.preparingChapters")}</p>}
          {!!analysisNotice && <p role="status">{t("custom.ai.roleFallback", { count: analysisNotice })}</p>}
          {analysisError && <p role="alert">{t(analysisError)}</p>}
          {!analyzing && playback?.bookKey === book.key && playback.total > 0 && <p role="status">{t(`android.speech.${playback.status}`)} · {playback.chapterTitle ? `${playback.chapterTitle} · ` : ""}{playback.index + 1}/{playback.total}{playback.multiRole && playback.role ? ` · ${t(speechRoleLabels[playback.role])}` : ""}</p>}
          {(error || playbackError) && <p role="alert">{t(playbackError && playback?.error === "ANDROID_SPEECH_AUTH" ? "android.speech.authFailed" : playbackError && playback?.error === "ANDROID_SPEECH_QUOTA" ? "android.speech.quotaFailed" : "android.speech.failed")}</p>}
          <div className="android-speech-actions">
            {active && <button type="button" disabled={busy} onClick={() => void command("previous")}>{t(source === "system" ? "android.speech.previous" : "android.speech.previousSegment")}</button>}
            <button type="button" disabled={busy || analyzing || !voice || !htmlBook || htmlBook.key !== book.key || (!active && source !== "system" && multiRole && !hasReadingAI("roles"))} onClick={() => void command(active ? speaking ? "pause" : "resume" : "start")}>
              {t(active ? speaking ? "android.speech.pause" : "android.speech.resume" : "android.speech.start")}
            </button>
            {active && <button type="button" disabled={busy} onClick={() => void command("next")}>{t(source === "system" ? "android.speech.next" : "android.speech.nextSegment")}</button>}
            {active && <button type="button" disabled={busy} onClick={() => void command("stop")}>{t("android.speech.stop")}</button>}
            {(analyzing || preparing || (!!speechStartText && !active)) && <button type="button" disabled={busy && !analyzing && !preparing} onClick={() => void command("stop")}>{t("android.speech.stop")}</button>}
          </div>
        </div>}
      </section>
    </>
  );
};

export default AndroidSpeech;
