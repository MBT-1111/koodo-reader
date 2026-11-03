const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");
const { serviceResponse, modelId } = require("../e2e/android/ai-fixtures.cjs");
const { systemPicker } = require("./android-system-picker.cjs");

const pkg = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const keys = ["readerConfig", "aiModelConfig", "fullTranslationBooks", "wordDefinitionBooks", "recordLocation", "readingTime", "readingStats", "recentBooks"];

async function main() {
  const report = { passed: false, checks: [], errors: [], requests: 0 };
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    report.requests++;
    try {
      const result = serviceResponse(request.url, request.method, request.headers, Buffer.concat(chunks).toString());
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
    } catch { response.writeHead(400); response.end("Invalid synthetic request"); }
  });
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter((item) => !process.env.ANDROID_SERIAL || item.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked device, or select ANDROID_SERIAL");
  const device = selected[0];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, endpoint = `http://localhost:${port}/v1beta`;
  let page, preferences, baseline;
  const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
  const storage = (data) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, data);
  const rows = async () => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async (dbName) => [dbName, await storage({ channel: "database-command", statement: "getAllStatement", dbName })])));
  const attach = async () => {
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    page = await (await device.webView({ pkg })).page();
    page.setDefaultTimeout(15000); page.on("pageerror", (error) => report.errors.push(error.message));
    await expect(page.locator(".android-header")).toBeVisible();
  };
  const tap = (locator) => systemPicker(page, device).tap(locator);
  const openAI = async () => {
    await tap(page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }));
    await tap(page.getByRole("button", { name: "AI service", exact: true }));
  };
  const exitReader = async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("android-reader-dismiss", { cancelable: true })));
    if (await page.locator(".android-reader").count()) {
      await showReadingTools(page);
      await page.getByRole("button", { name: "Exit reader", exact: true }).click();
      await expect(page.locator(".android-header")).toBeVisible();
    }
  };
  try {
    await device.shell(`am force-stop ${pkg}`); await attach();
    execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "reverse", `tcp:${port}`, `tcp:${port}`]);
    baseline = await rows(); preferences = (await storage({ channel: "preferences", action: "read" })).values;
    const book = baseline.books.find((item) => item.name === "安卓章节样本");
    assert.ok(book, "Import the synthetic Chinese EPUB fixture before QA");
    await openAI(); await page.getByText("Add new model", { exact: true }).click();
    const provider = page.getByLabel("Provider", { exact: true });
    const providerId = await provider.locator("option").evaluateAll((items) => items.map((item) => item.value).find((value) => ["google", "gemini"].includes(value)));
    assert.ok(providerId); await provider.selectOption(providerId);
    await page.getByLabel("Endpoint", { exact: true }).fill(endpoint);
    const key = page.getByPlaceholder("Enter your API Key"); await key.fill("synthetic-gemini-key");
    await tap(page.getByRole("button", { name: "Fetch models", exact: true }));
    await page.getByLabel("Select model", { exact: true }).selectOption(modelId);
    await tap(page.getByRole("button", { name: "Test", exact: true }));
    await expect(page.getByText(/Test successful: OK/)).toBeVisible();
    checked("physical Gemini model listing and connection test use native HTTP without CORS headers");
    await key.fill("invalid"); await tap(page.getByRole("button", { name: "Test", exact: true }));
    await expect(page.getByText(/Test failed: HTTP 401/)).toBeVisible();
    await key.fill("synthetic-gemini-key"); await tap(page.getByRole("button", { name: "Test", exact: true }));
    await expect(page.getByText(/Test successful: OK/)).toBeVisible();
    checked("invalid credentials release the connection-test control for a successful retry");
    await tap(page.getByRole("button", { name: "Add", exact: true }));
    for (const label of ["AI translation model", "AI dictionary model"]) await page.getByLabel(label, { exact: true }).selectOption({ label: "Gemini phone fixture" });
    await expect.poll(async () => JSON.parse((await storage({ channel: "preferences", action: "read" })).values.readerConfig).aiTranslateModel).toBeTruthy();
    await device.shell(`am force-stop ${pkg}`); await attach(); await openAI();
    await expect(page.getByLabel("AI translation model", { exact: true }).locator("option:checked")).toHaveText("Gemini phone fixture");
    await tap(page.locator(".setting-close-container"));
    checked("Gemini configuration and feature assignments survive native process restart");

    await page.locator(".book-list-item").filter({ hasText: "安卓章节样本" }).locator(".book-item-cover").click();
    await showReadingTools(page); await tap(page.getByRole("button", { name: "Translation", exact: true }));
    const panel = page.getByRole("dialog", { name: "Translation", exact: true });
    await panel.getByLabel("Current page translation").selectOption("both");
    const body = page.frameLocator("#page-area > iframe").locator("body");
    await expect.poll(() => body.evaluate((element) => element.innerHTML.includes("译文：")), { timeout: 20000 }).toBe(true);
    await fs.writeFile(path.join(output, "ai-gemini-bilingual.png"), await device.screenshot());
    await panel.getByLabel("Current page translation").selectOption("no");
    await expect.poll(() => body.evaluate((element) => element.innerHTML.includes("译文："))).toBe(false);
    checked("Gemini page translation displays bilingual text and restores original paragraphs when disabled");
    const words = panel.locator(".scale-page-fit-switch").filter({ hasText: "Enable word definitions" });
    await tap(words);
    await expect.poll(() => body.evaluate((element) => /test definition|测试释义/.test(element.innerHTML)), { timeout: 20000 }).toBe(true);
    await tap(words);
    checked("Gemini word definitions render through the book annotation contract");
    await device.shell("input keyevent KEYCODE_BACK"); await expect(panel).toBeHidden();
    await body.evaluate((element) => {
      const paragraph = element.querySelector("p"), doc = element.ownerDocument;
      const range = doc.createRange(); range.selectNodeContents(paragraph);
      const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
    });
    await page.locator(".popup-menu-box .translation-option").click();
    await expect(page.locator(".trans-text-box")).toContainText("Gemini 翻译结果");
    await fs.writeFile(path.join(output, "ai-gemini-selection.png"), await device.screenshot());
    await device.shell("input keyevent KEYCODE_BACK");
    checked("selected-text Gemini translation returns through the native request path");
    await exitReader();
    assert.ok(report.requests >= 6); assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    report.error = error.message;
    await fs.writeFile(path.join(output, "ai-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    try {
      if (page && !page.isClosed() && preferences) {
        await exitReader();
        await page.evaluate(({ original, keys }) => {
          for (const key of keys) { if (original[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, original[key]); }
        }, { original: preferences, keys });
        await expect.poll(async () => {
          const saved = (await storage({ channel: "preferences", action: "read" })).values;
          return keys.every((key) => saved[key] === preferences[key]);
        }).toBe(true);
        assert.equal(hash(await rows()), hash(baseline));
        await page.reload(); checked("original model settings, reading state and every primary record are preserved");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally {
      try { execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "reverse", "--remove", `tcp:${port}`]); } catch {}
      await fs.writeFile(path.join(output, "ai-report.json"), JSON.stringify(report, null, 2));
      await Promise.all(devices.map((item) => item.close()));
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
