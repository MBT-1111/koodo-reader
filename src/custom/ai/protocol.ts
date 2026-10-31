export interface AIConnection { endpoint: string; modelId: string; apiKey: string; providerId?: string }
interface AIInput { system: string; user: string; json?: boolean; maxTokens?: number }
interface AIHttpRequest { native: boolean; url: string; headers: Record<string, string>; body: Record<string, unknown> }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isNativeGemini(connection: AIConnection): boolean {
  const url = new URL(connection.endpoint);
  if (/\/openai(?:\/|$)/.test(url.pathname) || /\/chat\/completions\/?$/.test(url.pathname)) return false;
  return ["google", "gemini"].includes(connection.providerId || "") || url.hostname === "generativelanguage.googleapis.com" || /:generateContent$/.test(url.pathname);
}

function geminiBase(connection: AIConnection): URL {
  const url = new URL(connection.endpoint);
  url.searchParams.delete("key");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models(?:\/[^/]+:(?:streamGenerateContent|generateContent))?$/, "") || "/v1beta";
  return url;
}

export function geminiModelsRequest(connection: AIConnection): { url: string; headers: Record<string, string> } {
  if (!isNativeGemini(connection)) {
    const url = new URL(connection.endpoint);
    url.searchParams.delete("key");
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "") + "/models";
    return { url: url.toString(), headers: { Authorization: `Bearer ${connection.apiKey}` } };
  }
  const url = geminiBase(connection);
  url.pathname += "/models";
  return { url: url.toString(), headers: { "x-goog-api-key": connection.apiKey } };
}

export function createAIRequest(connection: AIConnection, input: AIInput): AIHttpRequest {
  const native = isNativeGemini(connection);
  const url = native ? geminiBase(connection) : new URL(connection.endpoint);
  const modelId = native || url.hostname === "generativelanguage.googleapis.com" ? connection.modelId.replace(/^models\//, "") : connection.modelId;
  const maxTokens = input.maxTokens || 8192;
  if (native) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(modelId)) throw new Error("CUSTOM_AI_NOT_CONFIGURED");
    url.pathname += `/models/${modelId}:generateContent`;
    return { native, url: url.toString(), headers: { "Content-Type": "application/json", "x-goog-api-key": connection.apiKey }, body: {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.user }] }],
      generationConfig: { maxOutputTokens: maxTokens, ...(input.json ? { responseMimeType: "application/json" } : {}) },
    } };
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) url.pathname += "/chat/completions";
  return { native, url: url.toString(), headers: { "Content-Type": "application/json", ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}) }, body: {
    model: modelId, stream: false, max_tokens: maxTokens,
    ...(input.json ? { response_format: { type: "json_object" } } : {}),
    ...(/(^|\.)deepseek\.com$/i.test(url.hostname) ? { thinking: { type: "disabled" } } : {}),
    messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
  } };
}

export function readAIText(result: unknown, native: boolean): string {
  let content: unknown;
  if (native) {
    const candidate: unknown = record(result) && Array.isArray(result.candidates) ? result.candidates[0] : null;
    if (!record(candidate)) throw new Error("CUSTOM_AI_INVALID_RESPONSE");
    if (candidate.finishReason === "MAX_TOKENS") throw new Error("CUSTOM_AI_INCOMPLETE_RESPONSE");
    if (candidate.finishReason && candidate.finishReason !== "STOP") throw new Error("CUSTOM_AI_REQUEST_FAILED");
    const parts = record(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    content = parts.filter(part => record(part) && !part.thought && typeof part.text === "string").map(part => part.text).join("");
  } else {
    const choice: unknown = record(result) && Array.isArray(result.choices) ? result.choices[0] : null;
    if (!record(choice) || !record(choice.message)) throw new Error("CUSTOM_AI_INVALID_RESPONSE");
    if (choice.finish_reason === "length") throw new Error("CUSTOM_AI_INCOMPLETE_RESPONSE");
    content = choice.message.content;
  }
  if (typeof content !== "string") throw new Error("CUSTOM_AI_INVALID_RESPONSE");
  if (!content.trim()) throw new Error("CUSTOM_AI_INCOMPLETE_RESPONSE");
  return content;
}
