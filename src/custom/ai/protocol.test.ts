import { describe, expect, it } from "vitest";
import { createAIRequest, geminiModelsRequest, isNativeGemini, readAIText } from "./protocol";
const connection = { endpoint: "https://generativelanguage.googleapis.com/v1beta", modelId: "models/gemini-test-flash", providerId: "google", apiKey: "synthetic-google-key" };
const input = { system: "Return JSON", user: '{"texts":["hello"]}', json: true };

describe("Gemini and OpenAI-compatible reading protocols", () => {
  it.each(["https://generativelanguage.googleapis.com", connection.endpoint, connection.endpoint + "/models", connection.endpoint + "/models/old-model:generateContent"])("builds native Gemini requests from %s", endpoint => {
    const request = createAIRequest({ ...connection, endpoint }, input);
    expect(request.url).toBe(connection.endpoint + "/models/gemini-test-flash:generateContent");
    expect(request.headers).toMatchObject({ "x-goog-api-key": connection.apiKey });
    expect(request.headers).not.toHaveProperty("Authorization");
    expect(request.body).toMatchObject({ systemInstruction: { parts: [{ text: input.system }] }, contents: [{ role: "user", parts: [{ text: input.user }] }], generationConfig: { responseMimeType: "application/json" } });
    expect(JSON.stringify(request.body)).not.toContain(connection.apiKey);
    expect(request.url).not.toContain(connection.apiKey);
  });
  it("keeps Gemini OpenAI-compatible endpoints and custom proxy models on the compatible protocol", () => {
    const request = createAIRequest({ ...connection, endpoint: connection.endpoint + "/openai" }, input);
    expect(request.native).toBe(false);
    expect(request.url).toBe(connection.endpoint + "/openai/chat/completions");
    expect(request.body).toMatchObject({ model: "gemini-test-flash", response_format: { type: "json_object" } });
    expect(request.headers).toHaveProperty("Authorization", `Bearer ${connection.apiKey}`);
    expect(createAIRequest({ ...connection, endpoint: connection.endpoint + "/openai/chat/completions/" }, input).url).toBe(connection.endpoint + "/openai/chat/completions");
    expect(isNativeGemini({ ...connection, endpoint: "https://proxy.invalid/v1", providerId: "custom" })).toBe(false);
    expect(isNativeGemini({ ...connection, endpoint: "https://proxy.invalid/v1beta", providerId: "google" })).toBe(true);
  });
  it("lists native models using header authentication without retaining query credentials", () => {
    const request = geminiModelsRequest({ ...connection, endpoint: connection.endpoint + "?key=old-query-secret" });
    expect(request.url).toBe(connection.endpoint + "/models");
    expect(request.headers["x-goog-api-key"]).toBe(connection.apiKey);
    const compatible = geminiModelsRequest({ ...connection, endpoint: connection.endpoint + "/openai" });
    expect(compatible.url).toBe(connection.endpoint + "/openai/models");
    expect(compatible.headers.Authorization).toBe(`Bearer ${connection.apiKey}`);
  });
  it("reads Gemini text parts while excluding thoughts and reports truncation or blocks", () => {
    expect(readAIText({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "private thought", thought: true }, { text: '{"texts":' }, { text: '["译文"]}' }] } }] }, true)).toBe('{"texts":["译文"]}');
    expect(() => readAIText({ candidates: [{ finishReason: "MAX_TOKENS" }] }, true)).toThrow("CUSTOM_AI_INCOMPLETE_RESPONSE");
    expect(() => readAIText({ candidates: [{ finishReason: "SAFETY" }] }, true)).toThrow("CUSTOM_AI_REQUEST_FAILED");
    expect(() => readAIText({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: " " }] } }] }, true)).toThrow("CUSTOM_AI_INCOMPLETE_RESPONSE");
  });
});
