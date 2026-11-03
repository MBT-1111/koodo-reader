import { CapacitorHttp } from "@capacitor/core";
import axios, { AxiosError, CanceledError, type AxiosAdapter } from "axios";
import { isNativeAndroid } from "../../utils/platform";

// Keep browser/Electron requests unchanged. Native requests avoid WebView CORS.
export async function serviceFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isNativeAndroid) return fetch(url, init);
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("CUSTOM_AI_NOT_CONFIGURED");
  if (init.body != null && typeof init.body !== "string") throw new Error("CUSTOM_AI_REQUEST_FAILED");
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  signal.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    // Capacitor does not cancel an in-flight native request; ignore late results.
    void CapacitorHttp.request({
      url: target.toString(), method: init.method || "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      data: init.body || undefined, responseType: "text",
      connectTimeout: 15000, readTimeout: 60000, disableRedirects: true,
    }).then((result) => {
      if (signal.aborted) return;
      const body = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
      if (body?.length > 2 * 1024 * 1024) throw new Error("CUSTOM_AI_REQUEST_FAILED");
      resolve(new Response([204, 205, 304].includes(result.status) ? null : body, { status: result.status, headers: result.headers }));
    }).catch(() => reject(new Error("CUSTOM_AI_REQUEST_FAILED")))
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

const nativeAdapter: AxiosAdapter = async (config) => {
  if (config.signal?.aborted) throw new CanceledError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  config.signal?.addEventListener?.("abort", abort);
  try {
    const response = await serviceFetch(axios.getUri(config), {
      method: config.method?.toUpperCase(),
      headers: Object.fromEntries(Object.entries(config.headers || {}).filter(([, value]) => value != null && value !== false && typeof value !== "object").map(([key, value]) => [key, String(value)])),
      body: config.data, signal: controller.signal,
    });
    const result = { data: await response.text(), status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), config };
    if (config.validateStatus && !config.validateStatus(result.status)) throw new AxiosError(`HTTP ${result.status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined, result);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new CanceledError();
    throw error;
  } finally { config.signal?.removeEventListener?.("abort", abort); }
};

export const serviceAxios = isNativeAndroid ? axios.create({ adapter: nativeAdapter, timeout: 60000 }) : axios;
