import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import type { PluginVoice } from "../../utils/plugins/types";
import { AZURE_PLUGIN, AZURE_DEGREES, azureStyles, selectedAzureStyle, selectedAzureDegree } from "./emotion";
import "./emotion.css";

interface Props { voice?: PluginVoice; disabled: boolean; label?: string; onChange: () => void }
export default function EmotionSelect({ voice, disabled, label, onChange }: Props) {
  const { t } = useTranslation();
  const [, render] = useState(0);
  if (!voice || voice.plugin !== AZURE_PLUGIN) return null;
  const saved = ConfigService.getItem("customAzureStyles") || "{}";
  const styles = azureStyles(voice);
  const degrees = ConfigService.getItem("customAzureDegrees") || "{}";
  return <div><label className="custom-emotion">
    <span>{label || t("custom.tts.emotion")}</span>
    <select value={selectedAzureStyle(voice, saved)} disabled={disabled} title={disabled ? t("custom.tts.stopToChange") : undefined} onChange={(event) => {
      let preferences: Record<string, string> = {};
      try { const data: unknown = JSON.parse(saved); if (data && typeof data === "object" && !Array.isArray(data)) preferences = data as Record<string, string>; } catch { /* Reset corrupt preferences. */ }
      ConfigService.setItem("customAzureStyles", JSON.stringify({ ...preferences, [voice.name]: event.target.value }));
      render((value) => value + 1);
      onChange();
    }}>
      {styles.map((style) => <option key={style} value={style}>{t(`custom.tts.style.${style}`, { defaultValue: style })}</option>)}
    </select>
    {styles.length === 1 && <small>{t("custom.tts.refreshVoices")}</small>}
  </label>
    <label className="custom-emotion">
      <span>{t("custom.tts.degree")}</span>
      <select value={selectedAzureDegree(voice, degrees)} disabled={disabled || selectedAzureStyle(voice, saved) === "neutral"} onChange={(event) => {
        let preferences: Record<string, unknown> = {};
        try { const data: unknown = JSON.parse(degrees); if (data && typeof data === "object" && !Array.isArray(data)) preferences = data as Record<string, unknown>; } catch { /* Reset corrupt preferences. */ }
        ConfigService.setItem("customAzureDegrees", JSON.stringify({ ...preferences, [voice.name]: Number(event.target.value) }));
        render((value) => value + 1); onChange();
      }}>
        {AZURE_DEGREES.map((degree) => <option value={degree} key={degree}>{t("custom.tts.degreeValue", { value: degree })}</option>)}
      </select>
      <small>{t("custom.tts.degreeHelp")}</small>
    </label>
  </div>;
}
