const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { getTTSAudioPath, ensureTTSDir } = require("./ttsCache");
const { normalizeStyles, azureSSML } = require("./azureSSML");

const catalogs = new Map();
const settings = (config) => {
  const region = config.region || "eastus";
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(region) || typeof config.apiKey !== "string" || !config.apiKey.trim() || /[\r\n]/.test(config.apiKey)) throw new Error("INVALID_AZURE_CONFIG");
  return { region, base: `https://${region}.tts.speech.microsoft.com` };
};
const getTTSVoice = async (config) => {
  const { region, base } = settings(config);
  try {
    const { data } = await axios.get(`${base}/cognitiveservices/voices/list`, {
      headers: { "Ocp-Apim-Subscription-Key": config.apiKey }, timeout: 30000, maxRedirects: 0, maxContentLength: 5 * 1024 * 1024,
    });
    if (!Array.isArray(data)) throw new Error("INVALID_AZURE_CATALOG");
    const voices = data.filter((v) => v && typeof v.ShortName === "string" && typeof v.Locale === "string").map((v) => ({
      name: v.ShortName, gender: String(v.Gender || "unknown").toLowerCase(), locale: v.Locale,
      displayName: `Microsoft Azure - ${v.LocalName || v.ShortName} (${v.Locale}) - ${v.Gender || ""}`,
      plugin: "azure-tts-voice-plugin", styles: normalizeStyles(v.StyleList),
      config: { ...config, voiceName: v.ShortName, locale: v.Locale, supportedStyles: normalizeStyles(v.StyleList) },
    }));
    const key = region + ":" + crypto.createHash("sha256").update(config.apiKey).digest("hex");
    catalogs.set(key, { voices, expires: Date.now() + 60 * 60 * 1000 });
    return voices;
  } catch {
    // Axios errors carry request headers; never forward the original error.
    throw new Error("AZURE_VOICE_LIST_FAILED");
  }
};

const getAudioPath = async (text, speed, dirPath, config) => {
  const { region, base } = settings(config);
  const name = config.voiceName || "en-US-AvaMultilingualNeural";
  if (typeof name !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(name)) throw new Error("INVALID_AZURE_VOICE");
  const key = region + ":" + crypto.createHash("sha256").update(config.apiKey).digest("hex");
  let catalog = catalogs.get(key);
  const requestedStyle = typeof config.style === "string" ? config.style : "neutral";
  if (requestedStyle !== "neutral" && (!catalog || catalog.expires < Date.now())) {
    await getTTSVoice(config);
    catalog = catalogs.get(key);
  }
  const voice = catalog?.voices.find((v) => v.name === name) || { name, locale: name.split("-").slice(0, 2).join("-"), styles: ["neutral"] };
  const style = normalizeStyles(voice.styles).includes(requestedStyle) ? requestedStyle : "neutral";
  const styleDegree = style === "neutral" ? 1 : Number(config.styleDegree ?? 1);
  const ssml = azureSSML(text, speed, voice, style, styleDegree);
  const outputFormat = "audio-16khz-128kbitrate-mono-mp3";
  const audioPath = getTTSAudioPath("azure-tts-voice-plugin-v3", text, speed, { region, voiceName: name, locale: voice.locale, style, styleDegree, outputFormat }, dirPath, ".mp3");
  if (fs.existsSync(audioPath)) return audioPath;
  ensureTTSDir(dirPath);
  let data;
  try {
    ({ data } = await axios.post(`${base}/cognitiveservices/v1`, ssml, {
      headers: { "Ocp-Apim-Subscription-Key": config.apiKey, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": outputFormat, "User-Agent": "koodo-reader-custom" },
      responseType: "arraybuffer", timeout: 30000, maxRedirects: 0, maxContentLength: 30 * 1024 * 1024,
    }));
    if (!data || !data.byteLength) throw new Error("EMPTY_AUDIO");
  } catch { throw new Error("AZURE_TTS_FAILED"); }
  const temporary = path.join(path.dirname(audioPath), `${crypto.randomUUID()}.tmp`);
  try { fs.writeFileSync(temporary, data); fs.renameSync(temporary, audioPath); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return audioPath;
};

module.exports = { getAudioPath, getTTSVoice };
