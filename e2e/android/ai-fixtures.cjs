const modelId = "gemini-phone-fixture";
const endpoint = "https://android-ai.invalid/v1beta";
function serviceResponse(url, method, headers, body) {
  if (headers["x-goog-api-key"] === "invalid") return { status: 401, body: { error: { message: "Invalid synthetic credential" } } };
  if (method === "GET" && url.endsWith("/models")) return { status: 200, body: { models: [{ name: `models/${modelId}`, displayName: "Gemini phone fixture" }] } };
  const data = typeof body === "string" ? JSON.parse(body) : body;
  const prompt = data.contents?.[0]?.parts?.[0]?.text || "";
  let text = prompt === "Reply only OK." ? "OK" : "Gemini 翻译结果";
  if (data.generationConfig?.responseMimeType === "application/json") {
    const input = JSON.parse(prompt);
    text = JSON.stringify(input.texts ? { texts: input.texts.map((value) => `译文：${value}`) } : {
      words: Object.fromEntries((input.paragraphs || []).map((item) => [item.id, [{ word: item.text.includes("安卓") ? "安卓" : "enigmatic", simplified: "安卓", traditional: "安卓", pinyin: "ān zhuó", meaning: "test definition", cn_meaning: "测试释义" }]])),
    });
  }
  return { status: 200, body: { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] } };
}
module.exports = { modelId, endpoint, serviceResponse };
