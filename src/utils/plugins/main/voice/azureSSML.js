const xmlEscape = (value) => Array.from(String(value), (char) => {
  const code = char.codePointAt(0);
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff) ? char : "\ufffd";
}).join("").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

const normalizeStyles = (styles) => ["neutral", ...new Set(Array.isArray(styles) ? styles.filter((s) => typeof s === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(s) && s !== "neutral") : [])];

const azureSSML = (text, speed, voice, style = "neutral") => {
  if (typeof text !== "string" || !text.trim() || text.length > 50000 || !Number.isFinite(speed) || speed < 0.1 || speed > 8) throw new Error("INVALID_AZURE_REQUEST");
  const selected = normalizeStyles(voice.styles).includes(style) ? style : "neutral";
  const percent = Math.round((speed - 1) * 100);
  const rate = `${percent > 0 ? "+" : ""}${percent}%`;
  let body = `<prosody rate="${rate}">${xmlEscape(text)}</prosody>`;
  if (selected !== "neutral") body = `<mstts:express-as style="${xmlEscape(selected)}">${body}</mstts:express-as>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${xmlEscape(voice.locale)}"><voice name="${xmlEscape(voice.name)}">${body}</voice></speak>`;
};

module.exports = { xmlEscape, normalizeStyles, azureSSML };
