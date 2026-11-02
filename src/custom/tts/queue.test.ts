import { afterEach, describe, expect, it, vi } from "vitest";
import Plugin from "../../models/Plugin";

interface SoundFixture {
  options: { onload: () => void };
  play: ReturnType<typeof vi.fn>;
  unload: ReturnType<typeof vi.fn>;
}
const { sounds } = vi.hoisted(() => ({ sounds: [] as SoundFixture[] }));
vi.mock("howler", () => ({ Howl: class {
  play = vi.fn(); pause = vi.fn(); unload = vi.fn(); playing = () => false;
  constructor(public options: SoundFixture["options"]) { sounds.push(this); }
} }));

vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: { getItem: () => JSON.stringify({ "zh-CN-VoiceNeural": "sad" }) } }));
vi.mock("../../utils/common", () => ({ getAllVoices: () => [], getFormatFromAudioPath: () => "mp3" }));
vi.mock("../../utils/request/reader", () => ({ getTTSAudio: vi.fn() }));
vi.mock("react-device-detect", () => ({ isElectron: true }));
import TTSUtil from "../../utils/reader/ttsUtil";

afterEach(() => { TTSUtil.setAudioPaths(); TTSUtil.isPaused = false; TTSUtil.player = undefined; sounds.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });
const plugin = new Plugin("azure-tts-voice-plugin", "voice", "Azure", "", "1", "", {}, [], [{ name: "zh-CN-VoiceNeural", plugin: "azure-tts-voice-plugin", config: {}, styles: ["sad"] }]);
const nodes = [{ text: "Text", voiceName: "zh-CN-VoiceNeural", voiceEngine: "azure-tts-voice-plugin" }];

describe("TTS queue compatibility", () => {
  it("discards late audio from an earlier voice/style generation without clearing newer work", async () => {
    let finishOld!: (value: string) => void, finishNew!: (value: string) => void;
    const invoke = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finishOld = resolve; })).mockImplementationOnce(() => new Promise<string>((resolve) => { finishNew = resolve; }));
    vi.stubGlobal("window", { electronAPI: { invoke } });
    const old = TTSUtil.cacheAudio(0, 50, [plugin], nodes, 1, true, false);
    TTSUtil.setAudioPaths();
    const current = TTSUtil.cacheAudio(0, 50, [plugin], nodes, 1, true, false);
    finishOld("old.mp3"); await old;
    expect(TTSUtil.processingIndexes.has(0)).toBe(true);
    expect(TTSUtil.audioPaths).toEqual([]);
    finishNew("new.mp3"); await current;
    expect(TTSUtil.audioPaths).toEqual([{ index: 0, audioPath: "new.mp3" }]);
    expect(invoke.mock.calls[1][1]).toMatchObject({ speed: 1.5, config: { style: "sad" } });
  });
  it("resumes a paused audio player without restarting the current sentence", () => {
    const play = vi.fn(); TTSUtil.player = { play, pause: vi.fn() }; TTSUtil.isPaused = true; TTSUtil.pausedMidSentence = true;
    expect(TTSUtil.resumeAudio()).toBe(true); expect(play).toHaveBeenCalledOnce(); expect(TTSUtil.isPaused).toBe(false);
    TTSUtil.player = undefined;
  });
  it("stops pending work immediately without a delayed timer clearing a new session", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn().mockResolvedValue("new.mp3");
    vi.stubGlobal("window", { electronAPI: { invoke } });
    TTSUtil.player = { stop: vi.fn() };
    await TTSUtil.stopAudio();
    TTSUtil.resumeAudio(); // Explicitly begin the new playback session.
    await TTSUtil.cacheAudio(0, 0, [plugin], nodes, 1, true, false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(TTSUtil.audioPaths).toEqual([{ index: 0, audioPath: "new.mp3" }]);
  });
  it("keeps a pending audio load silent after the user pauses", async () => {
    TTSUtil.audioPaths = [{ index: 0, audioPath: "fixture.mp3" }];
    const loading = TTSUtil.readAloud(0);
    await TTSUtil.pauseAudio();
    expect(TTSUtil.getPlayer().pause).not.toHaveBeenCalled();
    sounds[0].options.onload();
    expect(await loading).toBe("load");
    expect(sounds[0].play).not.toHaveBeenCalled();
    expect(TTSUtil.isPaused).toBe(true);
    expect(TTSUtil.resumeAudio()).toBe(true);
    expect(sounds[0].play).toHaveBeenCalledOnce();
  });
  it("does not unpause when an in-flight background cache request finishes", async () => {
    let finish!: (value: string) => void;
    vi.stubGlobal("window", { electronAPI: { invoke: () => new Promise<string>((resolve) => { finish = resolve; }) } });
    const caching = TTSUtil.cacheAudio(0, 0, [plugin], nodes, 1, false, false);
    await TTSUtil.pauseAudio();
    finish("fixture.mp3"); await caching;
    expect(TTSUtil.isPaused).toBe(true);
  });
  it("never starts the replacement player when an old player's load completes late", async () => {
    TTSUtil.audioPaths = [{ index: 0, audioPath: "old.mp3" }];
    const old = TTSUtil.readAloud(0);
    await TTSUtil.stopAudio(); TTSUtil.resumeAudio();
    TTSUtil.audioPaths = [{ index: 0, audioPath: "new.mp3" }];
    const current = TTSUtil.readAloud(0);
    sounds[0].options.onload();
    expect(await old).toBe("cancelled");
    expect(sounds[1].play).not.toHaveBeenCalled();
    sounds[1].options.onload(); await current;
    expect(sounds[1].play).toHaveBeenCalledOnce();
  });
});
