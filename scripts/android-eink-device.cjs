const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");
const { systemPicker } = require("./android-system-picker.cjs");

const pkg = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const configKeys = ["readerConfig", "recordLocation", "readingTime", "readingStats", "recentBooks"];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter((candidate) => !process.env.ANDROID_SERIAL || candidate.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked device, or select ANDROID_SERIAL");
  const device = selected[0], report = { passed: false, checks: [], errors: [] };
  let page, baseline, preferences;
  const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
  const storage = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
  const rows = async () => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async (dbName) =>
    [dbName, await storage({ channel: "database-command", dbName, statement: "getAllStatement" })])));
  const attach = async () => {
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    page = await (await device.webView({ pkg })).page();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.context().route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "localhost" || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    await expect(page.locator(".android-header")).toBeVisible();
  };
  const tap = (locator) => systemPicker(page, device).tap(locator);
  const closeReader = async () => {
    if (await page.locator(".android-reader").count()) {
      await showReadingTools(page);
      await page.getByRole("button", { name: "Exit reader", exact: true }).click();
      await expect(page.locator(".android-header")).toBeVisible();
    }
  };
  const toggle = async (enabled) => {
    await tap(page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }));
    await tap(page.getByRole("button", { name: "Appearance", exact: true }));
    await tap(page.locator(".setting-dialog-new-title").filter({ hasText: "E-ink mode" }).locator(".single-control-switch"));
    await expect(page.locator("html")).toHaveAttribute("data-eink", String(enabled));
    await expect(page.locator(".android-header")).toBeVisible();
    await expect.poll(async () => JSON.parse((await storage({ channel: "preferences", action: "read" })).values.readerConfig).isEinkMode).toBe(enabled ? "yes" : "no");
  };
  const position = (key) => page.evaluate((key) => JSON.parse(localStorage.getItem("recordLocation") || "{}")[key], key);
  try {
    await device.shell(`am force-stop ${pkg}`);
    await attach();
    baseline = await rows();
    preferences = (await storage({ channel: "preferences", action: "read" })).values;
    if (process.argv.includes("--upgrade-baseline")) {
      const before = JSON.parse(await fs.readFile(path.join(output, "eink-upgrade-baseline.json"), "utf8"));
      for (const [table, values] of Object.entries(baseline)) {
        assert.equal(values.length, before.tables[table].count);
        assert.equal(hash(values), before.tables[table].sha256);
      }
      checked("APK upgrade preserves every book, note, bookmark, word and plugin record");
    }
    await page.evaluate(() => {
      const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
      Object.assign(config, { appSkin: "night", themeColor: "#0179CA", textColor: "rgba(255,255,255,1)", backgroundColor: "rgba(44,47,49,1)", animation: "sliding", isEinkMode: "no" });
      localStorage.setItem("readerConfig", JSON.stringify(config));
    });
    await page.reload();
    await toggle(true);
    await expect(page.locator(".android-manager")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".android-manager")).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(page.locator("#root")).toHaveCSS("filter", "grayscale(1)");
    await expect(page.locator(".book-item-cover").first()).toBeVisible();
    await fs.writeFile(path.join(output, "eink-library.png"), await device.screenshot());
    checked("physical e-ink switch persists to native preferences and overrides the saved dark palette");
    await tap(page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }));
    await expect(page.locator(".android-settings")).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(page.locator(".android-settings")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await fs.writeFile(path.join(output, "eink-settings.png"), await device.screenshot());
    await tap(page.locator(".setting-close-container"));
    checked("grouped settings retain high-contrast surfaces and physical navigation");

    for (const [name, format] of [["安卓章节样本", "epub"], ["安卓文本样本", "txt"], ["安卓 PDF 样本", "pdf"]]) {
      const book = baseline.books.find((item) => item.name === name);
      assert.ok(book, "Install the synthetic Chinese reading fixtures before device QA");
      await page.locator(".book-list-item").filter({ hasText: name }).locator(".book-item-cover").click();
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      if (format !== "pdf") {
        const body = page.frameLocator("#page-area > iframe").locator("body");
        await expect(body).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect(body.locator("p").first()).toHaveCSS("color", "rgb(0, 0, 0)");
      } else {
        await expect.poll(() => page.frameLocator("#page-area > iframe").locator('iframe[id^="pdf-iframe-"]').evaluateAll((frames) =>
          frames.map((frame) => frame.contentDocument?.body?.textContent || "").join("\n"))).toContain("PDF page");
      }
      await showReadingTools(page);
      const before = await position(book.key);
      await tap(page.locator(".next-chapter-single-container"));
      await expect.poll(async () => (await position(book.key))?.percentage).not.toBe(before?.percentage);
      await fs.writeFile(path.join(output, `eink-${format}.png`), await device.screenshot());
      if (format === "epub") {
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        const panel = page.locator(".setting-panel-container");
        await expect(panel).toHaveCSS("box-shadow", "none");
        await expect(panel).toHaveCSS("transition-duration", "0s");
        await panel.getByText("Theme", { exact: true }).click();
        await expect(panel.getByRole("status")).toContainText("E-ink mode uses black text");
        await panel.getByText("More", { exact: true }).click();
        await expect(panel.getByLabel("Page turning animation")).toBeDisabled();
        await expect(panel.getByLabel("Page turning animation")).toHaveValue("none");
        await panel.getByRole("button", { name: "Close", exact: true }).click();
      }
      await closeReader();
      checked(`${format.toUpperCase()} renders and physically turns pages with e-ink tools`);
    }

    const note = baseline.notes.find((item) => item.bookKey === baseline.books.find((book) => book.name === "安卓章节样本")?.key && item.range && item.notes);
    assert.ok(note, "An existing synthetic EPUB note is required");
    await tap(page.locator(".android-bottom-nav").getByRole("button", { name: "Notes", exact: true }));
    const card = page.locator(".android-note-card").filter({ hasText: note.notes }).first();
    await expect(card).toHaveCSS("border-top-color", "rgb(0, 0, 0)");
    await tap(page.getByRole("button", { name: "Filter", exact: true }));
    const filter = page.getByRole("dialog", { name: "Filter", exact: true });
    await expect(filter).toBeInViewport();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(filter).toBeHidden();
    await tap(card.getByRole("button", { name: "Edit", exact: true }));
    const editor = page.getByRole("dialog", { name: "Edit", exact: true });
    await tap(editor.locator(".editor-box"));
    await expect.poll(async () => (await device.shell("dumpsys input_method")).toString().includes("mInputShown=true")).toBe(true);
    const confirm = await editor.getByText("Confirm", { exact: true }).boundingBox();
    assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= await page.evaluate(() => innerHeight));
    await fs.writeFile(path.join(output, "eink-notes-keyboard.png"), await device.screenshot());
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(editor).toBeVisible();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(editor).toBeHidden();
    checked("note filters and the physical keyboard keep dialogs and actions within the e-ink viewport");
    await tap(card.getByRole("button", { name: "Show in the book", exact: true }));
    const marker = page.frameLocator("#page-area > iframe").locator("[data-key]").first();
    await expect(marker).toBeAttached();
    const markerKey = await marker.getAttribute("data-key");
    assert.ok(baseline.notes.some((item) => item.bookKey === note.bookKey && item.key === markerKey), "A saved note marker must be present");
    await expect(marker).toHaveCSS("text-decoration-line", "underline");
    await expect(marker).toHaveCSS("text-decoration-color", "rgb(0, 0, 0)");
    await closeReader();
    checked("saved annotations remain visible as black underlines without changing note records");
    await device.shell(`am force-stop ${pkg}`);
    await attach();
    await expect(page.locator("html")).toHaveAttribute("data-eink", "true");
    checked("e-ink remains active after native process restart");
    await toggle(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#root")).toHaveCSS("filter", "none");
    const config = await page.evaluate(() => JSON.parse(localStorage.getItem("readerConfig")));
    assert.equal(config.appSkin, "night"); assert.equal(config.themeColor, "#0179CA");
    assert.equal(config.animation, "sliding"); assert.equal(config.textColor, "rgba(255,255,255,1)");
    await page.locator(".book-list-item").filter({ hasText: "安卓章节样本" }).locator(".book-item-cover").click();
    await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("color", "rgb(255, 255, 255)");
    await closeReader();
    checked("turning e-ink off restores the saved dark book text, accent and animation preference");
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    await fs.writeFile(path.join(output, "eink-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    try {
      if (page && !page.isClosed() && preferences) {
        await closeReader();
        await page.evaluate(({ original, keys }) => {
          for (const key of keys) { if (original[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, original[key]); }
        }, { original: preferences, keys: configKeys });
        await expect.poll(async () => {
          const saved = (await storage({ channel: "preferences", action: "read" })).values;
          return configKeys.every((key) => saved[key] === preferences[key]);
        }).toBe(true);
        assert.equal(hash(await rows()), hash(baseline), "Primary records changed");
        await page.reload();
        checked("all original appearance preferences, reading positions and primary database records are preserved");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally {
      await fs.writeFile(path.join(output, "eink-report.json"), JSON.stringify(report, null, 2));
      await Promise.all(devices.map((item) => item.close()));
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
