import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";
import { mockSpeech, type SpeechHarness } from "./speech-fixtures";
import { selectSpeechParagraph } from "./speech-selection.cjs";

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

async function installCloudVoices(page: Page, context: BrowserContext) {
  await mockSpeech(page);
  await context.route("**/cognitiveservices/voices/list", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ ShortName: "zh-CN-XiaoxiaoNeural", Locale: "zh-CN", LocalName: "晓晓", StyleList: ["cheerful"] }]) }));
  await page.goto("/");
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.locator(".plugin-tab-item").filter({ hasText: "Voice" }).click();
  await expect(page.locator(".setting-plugin-name").filter({ hasText: "OpenAI TTS" })).toHaveCount(0);
  for (const name of ["Azure TTS (API Key)", "MiMo TTS (API Key)"]) {
    const row = page.locator(".setting-dialog-new-title").filter({ has: page.locator(".setting-plugin-name").filter({ hasText: name }) });
    await row.getByText("Install", { exact: true }).click();
    const form = page.locator(".vex-dialog-form");
    if (name.startsWith("Azure")) await form.locator('input[name="region"]').fill("eastus");
    await form.locator('input[name="apiKey"]').fill("synthetic-key");
    await form.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(row.getByText("Delete", { exact: true })).toBeVisible();
  }
  await page.locator(".setting-close-container").click();
}

test("installs Azure and MiMo presets and controls cloud buffering without exposing unsupported voice plugins", async ({ page, context }, testInfo) => {
  await installCloudVoices(page, context);
  await openReader(page);
  const panel = page.locator(".android-speech");
  await panel.getByLabel("Speech service", { exact: true }).selectOption("azure");
  await expect(panel.getByLabel("Voice", { exact: true })).toHaveValue("zh-CN-XiaoxiaoNeural");
  await panel.locator(".custom-emotion select").first().selectOption("cheerful");
  await panel.locator(".custom-emotion select").last().selectOption("1.5");
  await panel.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(panel).toContainText("Generating speech");
  await expect(panel.getByLabel("Speech service", { exact: true })).toBeDisabled();
  const request = await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.findLast((item) => item.action === "start"));
  expect(request).toMatchObject({ source: "azure", config: { voiceName: "zh-CN-XiaoxiaoNeural", style: "cheerful", styleDegree: 1.5 } });
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await panel.getByRole("button", { name: "Resume", exact: true }).click();
  await panel.getByRole("button", { name: "Next segment", exact: true }).click();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByLabel("Speech service", { exact: true }).selectOption("mimo");
  await panel.getByLabel("Voice", { exact: true }).selectOption("冰糖");
  await panel.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(panel).toContainText("Generating speech");
  await page.screenshot({ path: testInfo.outputPath("mimo-cloud-panel.png") });
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
});

test("analyzes roles with Gemini, preserves originals, mixes cloud voices and cancels delayed analysis", async ({ page, context }, testInfo) => {
  await installCloudVoices(page, context);
  let delay = false;
  const analyzed: string[] = [];
  await context.route("**/models/gemini-roles-fixture:generateContent", async route => {
    const input = JSON.parse(route.request().postDataJSON().contents[0].parts[0].text) as { sentences: { id: string; text: string }[] };
    analyzed.push(...input.sentences.map(item => item.text));
    const roles = Object.fromEntries(input.sentences.filter((_, index) => index !== 1).map((item, index) => [item.id, ["narrator", "male", "female", "child"][index % 4]]));
    if (delay) await new Promise(resolve => setTimeout(resolve, 5000));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ roles }) }] } }] }) }).catch(() => {});
  });
  await openReader(page);
  const panel = page.locator(".android-speech");
  await panel.getByLabel("Speech service", { exact: true }).selectOption("azure");
  await panel.getByRole("switch", { name: /AI multi-role speech/ }).click();
  await expect(panel.getByRole("checkbox", { name: "Continue to next chapters", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Read aloud", exact: true })).toBeDisabled();
  await expect(panel).toContainText("Configure the corresponding personal model");
  await page.evaluate(() => {
    localStorage.setItem("aiModelConfig", JSON.stringify({ roleQA: { key: "roleQA", displayName: "Gemini roles fixture", config: { endpoint: "https://roles.invalid/v1beta", modelId: "gemini-roles-fixture", apiKey: "synthetic", providerId: "google" } } }));
    const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
    Object.assign(config, { aiAssistanceModel: "roleQA", androidSpeechSource: "azure" }); localStorage.setItem("readerConfig", JSON.stringify(config));
  });
  await page.reload(); await showReadingTools(page);
  await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await panel.getByLabel("Male voice", { exact: true }).selectOption(JSON.stringify(["mimo-tts-voice-plugin", "冰糖"]));
  await panel.getByLabel("Female voice", { exact: true }).selectOption(JSON.stringify(["azure-tts-voice-plugin", "zh-CN-XiaoxiaoNeural"]));
  await panel.getByLabel("Child voice", { exact: true }).selectOption(JSON.stringify(["mimo-tts-voice-plugin", "苏打"]));
  await panel.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(panel).toContainText("Generating speech");
  await expect(panel).toContainText(/The model omitted/);
  const request = await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.findLast(item => item.action === "start"));
  expect(request).toMatchObject({ source: "azure", roleVoices: { male: { source: "mimo", config: { voiceName: "冰糖" } }, female: { source: "azure" }, child: { source: "mimo", config: { voiceName: "苏打" } } } });
  const texts = request!.text as string[];
  expect(request!.roles).toHaveLength(texts.length);
  for (const text of analyzed) expect(texts).toContain(text);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mixed-role-voices.png") });
  const starts = await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.filter(item => item.action === "start").length);
  delay = true;
  await panel.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(panel).toContainText("Analyzing roles, please wait...");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(panel.getByLabel("Male voice", { exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(5200);
  expect(await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.filter(item => item.action === "start").length)).toBe(starts);
  await expect(panel.getByRole("button", { name: "Read aloud", exact: true })).toBeEnabled();
  await panel.getByRole("switch").click();
  await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

test("Read from here starts once at the selected sentence and replaces an active session", async ({ page }) => {
  await mockSpeech(page); await openReader(page);
  const panel = page.locator(".android-speech");
  await expect(panel.getByLabel("Voice", { exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  const first = await selectSpeechParagraph(page, 1);
  await page.locator(".speech-start-option").click();
  await expect(panel.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const starts = () => page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.filter(item => item.action === "start"));
  expect(await starts()).toHaveLength(1);
  expect((await starts())[0].text).toEqual(expect.arrayContaining([first]));
  expect(((await starts())[0].text as string[])[0]).toBe(first);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(await starts()).toHaveLength(1);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  const second = await selectSpeechParagraph(page, 2);
  await page.locator(".speech-start-option").click();
  await expect.poll(async () => (await starts()).length).toBe(2);
  expect(((await starts())[1].text as string[])[0]).toBe(second);
  const actions = await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.filter(item => ["start", "stop"].includes(String(item.action))).map(item => item.action));
  expect(actions.slice(-3)).toEqual(["start", "stop", "start"]);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Read aloud", exact: true })).toBeEnabled();
  expect(await starts()).toHaveLength(2);
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
