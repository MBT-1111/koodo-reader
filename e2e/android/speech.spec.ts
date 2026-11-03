import { expect, test, type Page } from "@playwright/test";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";
import type { AndroidSpeechState } from "../../src/custom/android/speech";

interface SpeechHarness {
  requests: Record<string, unknown>[];
  fail: boolean;
  empty: boolean;
  state: AndroidSpeechState;
}

async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    const qa: SpeechHarness = { requests: [], fail: false, empty: false,
      state: { status: "idle", bookKey: "", index: 0, total: 0, error: "" } };
    const listeners = new Map<string, (state: AndroidSpeechState) => void>();
    let sequence = 0;
    Object.assign(window, { speechQA: qa, Capacitor: {
      PluginHeaders: [{ name: "KoodoSpeech", methods: [{ name: "execute", rtype: "promise" }, { name: "addListener" }, { name: "removeListener", rtype: "promise" }] }],
      nativeCallback: (_plugin: string, _method: string, _options: unknown, callback: (state: AndroidSpeechState) => void) => {
        const id = String(++sequence); listeners.set(id, callback); return id;
      },
      nativePromise: async (_plugin: string, method: string, request: Record<string, unknown>) => {
        if (method === "removeListener") { listeners.delete(String(request.callbackId)); return; }
        qa.requests.push(request);
        const action = request.action;
        if (action === "voices") return { voices: qa.empty ? [] : [{ name: "fixture-offline-zh", locale: "zh-CN", network: false }] };
        if (action === "start" && qa.fail) throw new Error("ANDROID_SPEECH_FAILED");
        if (action === "start") qa.state = { status: "playing", bookKey: String(request.bookKey), index: 0, total: (request.text as string[]).length, error: "" };
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

async function openReader(page: Page) {
  await page.goto("/");
  await expect(page.locator(".android-header")).toBeVisible();
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await showReadingTools(page);
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(page.locator(".android-speech")).toHaveCount(1);
}

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
});

test("browser preview explains native speech and consumes reader Back", async ({ page }) => {
  await openReader(page);
  const panel = page.getByRole("dialog", { name: "Text to speech", exact: true });
  await expect(panel).toContainText("System voices are available in the Android app.");
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-reader-dismiss", { cancelable: true })))).toBe(true);
  await expect(panel).toBeHidden();
  await expect(page.locator(".android-speech")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/epub\//);
});

test("phone controls retain native playback across panel closure and stop on reader exit", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockSpeech(page);
  await openReader(page);
  const panel = page.getByRole("dialog", { name: "Text to speech", exact: true });
  await expect(panel.getByLabel("Voice", { exact: true })).toHaveValue("fixture-offline-zh");
  await panel.getByLabel("Speed", { exact: true }).selectOption("1.25");
  await panel.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Playing");
  const start = await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.find((request) => request.action === "start"));
  expect(start).toMatchObject({ speed: 1.25, voice: "fixture-offline-zh", title: "安卓章节样本" });
  expect(start?.text).toEqual(expect.arrayContaining([expect.stringContaining("第一章")]));
  await expect(panel.getByLabel("Voice", { exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Paused");
  await panel.getByRole("button", { name: "Resume", exact: true }).click();
  await panel.getByRole("button", { name: "Next sentence", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("2/");
  await page.screenshot({ path: testInfo.outputPath("speech-playing.png") });
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".android-speech")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.state.status)).toBe("playing");
  await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Playing");
  await expect(panel.getByLabel("Speed", { exact: true })).toHaveValue("1.25");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page).toHaveURL(/#\/manager\/home/);
  expect(await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.state.status)).toBe("idle");
  expect(errors).toEqual([]);
});

test("speech failures release controls for retry and missing voices prevent playback", async ({ page }) => {
  await mockSpeech(page);
  await openReader(page);
  const panel = page.getByRole("dialog", { name: "Text to speech", exact: true });
  const start = panel.getByRole("button", { name: "Read aloud", exact: true });
  await expect(start).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { speechQA: SpeechHarness }).speechQA.fail = true; });
  await start.click();
  await expect(panel.getByRole("alert")).toContainText("Could not play speech");
  await expect(start).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { speechQA: SpeechHarness }).speechQA.fail = false; });
  await start.click();
  await expect(panel.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => { (window as unknown as { speechQA: SpeechHarness }).speechQA.empty = true; });
  await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("No system voices are installed");
  await expect(start).toBeDisabled();
});
