const { showReadingTools, hideReadingTools } = require("../e2e/android/fixtures.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { legacyFontKey, importedFontKey, fontFiles, fontBook, fontLoaded } = require("../e2e/android/font-fixtures.cjs");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const baselinePath = path.join(output, "fonts-before.json");
const dump = "/data/local/tmp/koodo-fonts.xml";
const shared = "/sdcard/Download/KoodoReaderCustomTest";
const styleKeys = ["fontFamily", "subFontFamily", "systemFont"];
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const report = { checks: [], passed: false };
  const seed = process.argv.includes("--seed-legacy");
  let device, page, original;
  try {
    const selected = devices.filter((d) => !process.env.ANDROID_SERIAL || d.serial() === process.env.ANDROID_SERIAL);
    assert.equal(selected.length, 1, "Connect one device or select it with ANDROID_SERIAL");
    device = selected[0];
    device.setDefaultTimeout(20000);
    const errors = [];
    const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      page = await (await device.webView({ pkg: appId })).page();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await expect(page.locator(".android-header, .android-reader").first()).toBeVisible();
      if (await page.locator(".android-reader").isVisible()) {
        await hideReadingTools(page);
        await device.shell("input keyevent KEYCODE_BACK");
      }
      await expect(page.locator(".android-header")).toBeVisible();
    };
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const legacy = (key) => page.evaluate(async (key) => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open("localforage"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get(`font_${key}`); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error); }); }
      finally { db.close(); }
    }, key);
    const nodes = async () => {
      await device.shell(`uiautomator dump ${dump}`);
      return [...(await device.shell(`cat ${dump}`)).toString().matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])));
    };
    const tapNode = async (matches) => {
      let node;
      await expect.poll(async () => { node = (await nodes()).find(matches); return !!node; }, { timeout: 15000 }).toBe(true);
      const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
      await device.shell(`input tap ${Math.round((left + right) / 2)} ${Math.round((top + bottom) / 2)}`);
    };
    const tap = async (locator) => {
      await locator.scrollIntoViewIfNeeded();
      const view = (await nodes()).find((node) => node.class === "android.webkit.WebView");
      assert.ok(view);
      const [left, top, right] = view.bounds.match(/\d+/g).map(Number);
      const rect = await locator.boundingBox();
      const scale = (right - left) / await page.evaluate(() => innerWidth);
      await device.shell(`input tap ${Math.round(left + (rect.x + rect.width / 2) * scale)} ${Math.round(top + (rect.y + rect.height / 2) * scale)}`);
    };
    const openFontSettings = async () => {
      await tap(page.getByRole("button", { name: "Settings", exact: true }));
      await tap(page.getByRole("button", { name: "Font management", exact: true }));
      await expect(page.locator(".font-setting-actions")).toBeVisible();
    };
    const closeBook = async () => {
      await device.shell("input keyevent KEYCODE_BACK");
      await expect(page.locator(".android-header")).toBeVisible();
    };
    await start();
    const fonts = await fontFiles();
    const item = (key) => page.locator(".font-setting-item").filter({ hasText: key });
    if (seed) {
      assert.notEqual(await page.evaluate(() => localStorage.getItem("__koodo_native_fonts_version")), "1", "Seed before installing native font support");
      const config = await page.evaluate(() => JSON.parse(localStorage.getItem("readerConfig") || "{}"));
      original = Object.fromEntries(styleKeys.map((key) => [key, config[key]]));
      const bookKeys = (await native({ channel: "database-command", statement: "getAllStatement", dbName: "books" })).map((book) => book.key);
      await openFontSettings();
      assert.equal(await item(legacyFontKey).count(), 0, "Use a fresh test-owned font name");
      await page.locator('.setting-dialog-main input[type="file"]').setInputFiles(fonts[0]);
      await expect(item(legacyFontKey)).toBeVisible();
      const data = await legacy(legacyFontKey);
      assert.equal(hash(Buffer.from(data.split(",")[1], "base64")), hash(fonts[0].buffer));
      await page.locator(".setting-close-container").click();
      await expect.poll(async () => JSON.parse((await native({ channel: "preferences", action: "read" })).values.customFonts || "{}")[legacyFontKey]?.type).toBe("ttf");
      await fs.writeFile(baselinePath, JSON.stringify({ original, bookKeys, sha256: hash(fonts[0].buffer) }, null, 2));
      checked("old APK imports a Unicode-named font into IndexedDB before upgrade");
      report.passed = true;
      return;
    }
    const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
    original = baseline.original;
    const fontBytes = (key) => native({ channel: "file-command", action: "read", group: "font", name: `${key}.ttf` });
    assert.equal(hash(Buffer.from(await fontBytes(legacyFontKey), "base64")), baseline.sha256);
    assert.equal(hash(Buffer.from((await legacy(legacyFontKey)).split(",")[1], "base64")), baseline.sha256);
    assert.equal((await native({ channel: "preferences", action: "read" })).values.__koodo_native_fonts_version, "1");
    const bookKeys = new Set((await native({ channel: "database-command", statement: "getAllStatement", dbName: "books" })).map((book) => book.key));
    for (const key of baseline.bookKeys) assert.ok(bookKeys.has(key));
    checked("upgrade copies legacy font bytes exactly and retains the source and library");
    await openFontSettings();
    if (await item(importedFontKey).count()) {
      assert.equal(hash(Buffer.from(await fontBytes(importedFontKey), "base64")), hash(fonts[1].buffer));
      await tap(item(importedFontKey).locator(".font-setting-delete"));
      await expect(item(importedFontKey)).toHaveCount(0);
    }
    await device.shell(`mkdir -p ${shared}`);
    await device.push(fonts[1].buffer, `${shared}/${fonts[1].name}`);
    await device.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${shared}/${fonts[1].name}`);
    await tap(page.getByText("Import local font", { exact: true }));
    if (!(await nodes()).some((node) => node.text === fonts[1].name)) {
      await tapNode((node) => /^(Show roots|显示根目录|显示根位置)$/.test(node["content-desc"] || ""));
      await tapNode((node) => node["resource-id"] === "android:id/title" && /^(Downloads|下载|下载内容)$/.test(node.text || ""));
      await tapNode((node) => node.text === "KoodoReaderCustomTest");
    }
    await tapNode((node) => node.text === fonts[1].name && node.enabled !== "false");
    await expect(item(importedFontKey)).toBeVisible();
    assert.equal(hash(Buffer.from(await fontBytes(importedFontKey), "base64")), hash(fonts[1].buffer));
    assert.equal(await legacy(importedFontKey), null);
    checked("system picker imports font directly into verified native private storage");
    await tap(item(importedFontKey));
    await tap(page.locator(".font-preview-actions").getByText("Set as book font", { exact: true }));
    await tap(page.locator(".font-preview-actions").getByText("Set as app font", { exact: true }));
    await tap(page.locator(".font-preview-close"));
    await tap(page.locator(".setting-close-container"));
    if (!await page.locator(".book-list-item").filter({ hasText: "Android custom font sample" }).count()) await page.locator("#import-book-box").setInputFiles(await fontBook());
    const openBook = async () => {
      await tap(page.locator(".book-list-item").filter({ hasText: "Android custom font sample" }).locator(".book-item-cover"));
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await expect.poll(() => fontLoaded(page, importedFontKey)).toBe(true);
      await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("font-family", new RegExp(importedFontKey));
    };
    await openBook();
    await closeBook();
    checked("custom reader font loads as a FontFace and applies to book text");
    await device.shell(`am force-stop ${appId}`);
    await expect.poll(() => device.webViews().filter((view) => view.pkg() === appId).length).toBe(0);
    await start();
    await expect(page.locator("body")).toHaveCSS("font-family", new RegExp(importedFontKey));
    await openBook();
    await fs.writeFile(path.join(output, "fonts-reader.png"), await device.screenshot());
    await closeBook();
    checked("process restart restores custom app and reader fonts without an IndexedDB copy");
    await openFontSettings();
    for (const key of [importedFontKey, legacyFontKey]) {
      await tap(item(key).locator(".font-setting-delete"));
      await expect(item(key)).toHaveCount(0);
      assert.equal(await fontBytes(key), null);
    }
    expect(await page.locator("body").evaluate((body) => getComputedStyle(body).fontFamily)).not.toContain(importedFontKey);
    await page.locator(".setting-close-container").click();
    assert.deepEqual(errors, []);
    checked("deleting active test fonts removes native files and clears font references");
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "fonts-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    if (!seed && page && !page.isClosed() && original) {
      await page.evaluate((original) => {
        const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
        for (const key of ["fontFamily", "subFontFamily", "systemFont"]) {
          if (original[key] === undefined) delete config[key]; else config[key] = original[key];
        }
        localStorage.setItem("readerConfig", JSON.stringify(config));
      }, original);
      await page.reload();
    }
    if (device) await device.shell(`rm -f ${dump}`).catch(() => {});
    await fs.writeFile(path.join(output, seed ? "fonts-seed-report.json" : "fonts-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((d) => d.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
