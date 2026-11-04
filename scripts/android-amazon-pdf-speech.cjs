const assert = require("node:assert/strict"), http = require("node:http");
const { execFileSync } = require("node:child_process");
const { expect } = require("@playwright/test");
const { wave, plugin } = require("../e2e/android/cloud-speech-fixtures.cjs");
const { showReadingTools, visibleParagraphs } = require("../e2e/android/fixtures.cjs");
const { visiblePdfPage } = require("../e2e/android/amazon-pdf-fixtures.cjs");

// Only called by the fresh, credential-free QA harness. All service responses are local.
async function amazonPdfSpeech(device, checked) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (request.url.startsWith("/v1beta/")) {
        const input = JSON.parse(JSON.parse(raw).contents[0].parts[0].text);
        requests.push({ type: "roles", text: input.sentences.map(item => item.text).join("") });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ roles: Object.fromEntries(input.sentences.map((item, index) => [item.id, index % 2 ? "male" : "narrator"])) }) }] } }] }));
      } else {
        const azure = request.url.startsWith("/azure");
        requests.push({ type: azure ? "azure" : "mimo", text: azure ? raw : JSON.parse(raw).messages[0].content });
        response.writeHead(200, { "Content-Type": azure ? "audio/mpeg" : "application/json" });
        const audio = wave(4);
        response.end(azure ? audio : JSON.stringify({ choices: [{ message: { audio: { data: audio.toString("base64") } } }] }));
      }
    } catch { if (!response.destroyed) { response.writeHead(400); response.end(); } }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const reverse = args => execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "reverse", ...args]);
  reverse([`tcp:${port}`, `tcp:${port}`]);
  const native = (page, request) => page.evaluate(request => window.Capacitor.Plugins.KoodoSpeech.execute(request), request);
  const storage = (page, request) => page.evaluate(async request => (await window.Capacitor.Plugins.KoodoStorage.execute(request)).value, request);
  const setup = async page => {
    for (const provider of ["azure", "mimo"]) await storage(page, { channel: "database-command", dbName: "plugins", statement: "saveStatement", data: plugin(provider, `http://localhost:${port}/${provider}`) });
    await page.evaluate(port => {
      const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
      Object.assign(config, { aiAssistanceModel: "qa", multiRoleMaleEngine: "mimo-tts-voice-plugin", multiRoleMaleVoice: "冰糖" });
      localStorage.setItem("readerConfig", JSON.stringify(config));
      localStorage.setItem("aiModelConfig", JSON.stringify({ qa: { key: "qa", displayName: "QA local roles", config: { endpoint: `http://localhost:${port}/v1beta`, modelId: "qa", apiKey: "synthetic", providerId: "google" } } }));
    }, port);
    await expect.poll(async () => Object.keys((await storage(page, { channel: "preferences", action: "read" })).values)).toContain("aiModelConfig");
    await page.reload(); await expect(page.locator(".android-header")).toBeVisible();
  };
  const verify = async (page, fixture, book) => {
    const pdf = fixture.format === "pdf";
    for (const source of ["system", ...(["azw3", "pdf"].includes(fixture.format) && (!pdf || fixture.columns === 2) ? ["azure"] : [])]) {
      if (source !== "system") {
        await showReadingTools(page);
        await page.getByRole("slider", { name: "Reading progress", exact: true }).press("Home");
        if (pdf) await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(0);
        else await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining("第一章")]));
      }
      requests.length = 0;
      await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
      const panel = page.locator(".android-speech");
      await panel.getByLabel("Speech service", { exact: true }).selectOption(source);
      await panel.getByLabel("Speed", { exact: true }).selectOption(source === "system" ? "3" : "1");
      if (source === "system") {
        const voices = (await native(page, { action: "voices" })).voices;
        const voice = voices.find(item => item.locale.startsWith("zh") && !item.network) || voices.find(item => item.locale.startsWith("cmn") && !item.network) || voices.find(item => !item.network);
        assert(voice, "An installed offline voice is required"); await panel.getByLabel("Voice", { exact: true }).selectOption(voice.name);
      } else {
        if (await panel.getByRole("switch").getAttribute("aria-checked") !== "true") await panel.getByRole("switch").click();
        await panel.getByLabel("Male voice", { exact: true }).selectOption(JSON.stringify(["mimo-tts-voice-plugin", "冰糖"]));
      }
      await panel.getByRole("checkbox", { name: "Continue to next chapters", exact: true }).check();
      try { await expect(panel.getByRole("button", { name: "Read aloud", exact: true })).toBeEnabled({ timeout: 10000 }); }
      catch {
        const diagnostic = await panel.evaluate(element => {
          const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"), models = JSON.parse(localStorage.getItem("aiModelConfig") || "{}");
          return { busy: element.getAttribute("aria-busy"), selectedModel: config.aiAssistanceModel, modelKeys: Object.keys(models), voiceOptions: [...element.querySelectorAll("select")].map(select => ({ label: select.getAttribute("aria-label"), selected: select.value, count: select.options.length })), status: element.textContent };
        });
        throw Error(`QA speech preparation failed: ${JSON.stringify(diagnostic)}`);
      }
      await panel.getByRole("button", { name: "Read aloud", exact: true }).click();
      await expect.poll(async () => (await native(page, { action: "state" })).status, { timeout: 30000 }).toBe("playing");
      let state, moves = 0;
      while (++moves < 180) {
        state = await native(page, { action: "state" });
        if (state.position?.text.includes(fixture.nextAnchor)) break;
        assert(!["error", "completed", "idle"].includes(state.status), `Speech stopped before ${fixture.nextAnchor}: ${state.error}`);
        await native(page, { action: "next" });
        if (state.status === "buffering") await page.waitForTimeout(100);
      }
      assert(moves < 180, "Speech must reach the later chapter/page");
      await expect.poll(async () => (await native(page, { action: "state" })).status, { timeout: 15000 }).toBe("playing");
      await native(page, { action: "pause" });
      if (pdf) {
        assert.equal(state.position.page, 2);
        await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(2);
        await expect(page.locator(".background-page-left")).toHaveText("Page 3");
      } else await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining(fixture.nextAnchor)]));
      if (source !== "system") {
        assert.equal(state.multiRole, true);
        assert(requests.some(item => item.type === "roles"));
        assert(requests.some(item => item.type === "azure")); assert(requests.some(item => item.type === "mimo"));
      }
      await native(page, { action: "stop" });
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await showReadingTools(page);
      const bookmarks = await storage(page, { channel: "database-command", dbName: "bookmarks", statement: "getAllStatement" });
      if (!bookmarks.some(bookmark => bookmark.bookKey === book.key)) await page.locator(".add-bookmark-button").click();
      checked(`${fixture.file}: ${source === "system" ? "native system speech" : "local Azure/MiMo multi-role speech"}, continuous boundary, visible text following and saved position`);
    }
  };
  return { setup, verify, requests, close: async () => { reverse(["--remove", `tcp:${port}`]); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { amazonPdfSpeech };
