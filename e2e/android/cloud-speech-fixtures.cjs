function wave(seconds = 6) {
  const rate = 16000, count = Math.floor(rate * seconds), data = Buffer.alloc(44 + count * 2);
  data.write("RIFF", 0); data.writeUInt32LE(36 + count * 2, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 180), 44 + i * 2);
  return data;
}
function plugin(source, endpoint) {
  const azure = source === "azure", key = azure ? "azure-tts-voice-plugin" : "mimo-tts-voice-plugin";
  const name = azure ? "zh-CN-XiaoxiaoNeural" : "冰糖";
  const config = { apiKey: "synthetic-cloud-key", region: "eastus", endpoint };
  return { key, type: "voice", displayName: azure ? "Azure TTS" : "MiMo TTS", icon: "speaker", version: "1.0.0", autoValue: "", config, langList: {}, script: "", scriptSHA256: "",
    voiceList: [{ name, displayName: name, plugin: key, locale: "zh-CN", styles: ["neutral", "cheerful"], config: { ...config, voiceName: name, locale: "zh-CN", supportedStyles: ["neutral", "cheerful"] } }] };
}
module.exports = { wave, plugin };
