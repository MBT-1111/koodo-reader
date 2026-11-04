import type { Page } from "@playwright/test";
import type { AndroidSpeechState } from "../../src/custom/android/speech";

export interface SpeechHarness {
  requests: Record<string, unknown>[];
  fail: boolean;
  empty: boolean;
  state: AndroidSpeechState;
  emit(state: AndroidSpeechState): void;
}

export async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    const qa: SpeechHarness = { requests: [], fail: false, empty: false,
      state: { status: "idle", bookKey: "", index: 0, total: 0, error: "" }, emit: () => {} };
    const listeners = new Map<string, (state: AndroidSpeechState) => void>();
    let sequence = 0;
    qa.emit = state => { qa.state = state; listeners.forEach(listener => listener({ ...state })); };
    Object.assign(window, { speechQA: qa, Capacitor: {
      PluginHeaders: [{ name: "KoodoSpeech", methods: [{ name: "execute", rtype: "promise" }, { name: "readingPosition", rtype: "promise" }, { name: "addListener" }, { name: "removeListener", rtype: "promise" }] }],
      nativeCallback: (_plugin: string, _method: string, _options: unknown, callback: (state: AndroidSpeechState) => void) => {
        const id = String(++sequence); listeners.set(id, callback); return id;
      },
      nativePromise: async (_plugin: string, method: string, request: Record<string, unknown>) => {
        if (method === "removeListener") { listeners.delete(String(request.callbackId)); return; }
        if (method === "readingPosition") return { positions: [] };
        qa.requests.push(request);
        const action = request.action;
        if (action === "voices") return { voices: qa.empty ? [] : [{ name: "fixture-offline-zh", locale: "zh-CN", network: false }] };
        if (action === "start" && qa.fail) throw new Error("ANDROID_SPEECH_FAILED");
        if (action === "start") qa.state = { status: request.source && request.source !== "system" ? "buffering" : "playing", source: request.source as AndroidSpeechState["source"], bookKey: String(request.bookKey), index: 0, total: (request.text as string[]).length, error: "" };
        if (action === "pause") qa.state.status = "paused";
        if (action === "resume") qa.state.status = "playing";
        if (action === "next") qa.state.index++;
        if (action === "previous") qa.state.index = Math.max(0, qa.state.index - 1);
        if (action === "stop") qa.state = { status: "idle", bookKey: "", index: 0, total: 0, error: "" };
        listeners.forEach((listener) => listener({ ...qa.state }));
        return { ...qa.state };
      },
    } });
  });
}
