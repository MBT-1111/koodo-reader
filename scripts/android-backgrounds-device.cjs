const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { backgroundFile } = require("../e2e/android/background-fixtures.cjs");
const { hideReadingTools } = require("../e2e/android/fixtures.cjs");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const baselinePath = path.join(output, "backgrounds-before.json");
const legacyId = "android-background-upgrade-v1";
const dump = "/data/local/tmp/koodo-backgrounds.xml";
const shared = "/sdcard/Download/KoodoReaderCustomTest";
const styleKeys = ["appBackgroundImage", "readerBackgroundImage", "textColor", "backgroundColor"];
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const device = devices.find((device) => device.serial() === process.env.ANDROID_SERIAL) || devices[0];
  assert.ok(device, "Connect an authorized Android device");
  const seed = process.argv.includes("--seed-legacy");
  const report = { passed: false, checks: [], errors: [] };
  const checked = (message) => { report.checks.push(message); console.log(`PASS ${message}`); };
  let page;
  let original;
  try {
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      page = await (await device.webView({ pkg: appId })).page();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push(error.message));
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
    const records = async (dbName) => native({ channel: "database-command", dbName, statement: "getAllStatement" });
    const legacy = (id) => page.evaluate(async (id) => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open("localforage"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise((resolve, reject) => { const r = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get(`background_${id}`); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error); }); }
      finally { db.close(); }
    }, id);
    const nodes = async () => {
      await device.shell(`uiautomator dump --compressed ${dump}`);
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
      await expect.poll(() => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
      const [left, top, right] = view.bounds.match(/\d+/g).map(Number);
      const rect = await locator.boundingBox();
      const scale = (right - left) / await page.evaluate(() => innerWidth);
      await device.shell(`input tap ${Math.round(left + (rect.x + rect.width / 2) * scale)} ${Math.round(top + (rect.y + rect.height / 2) * scale)}`);
    };
    const openSettings = async () => {
      await tap(page.getByRole("button", { name: "Settings", exact: true }));
      await tap(page.getByRole("button", { name: "Background", exact: true }));
      await expect(page.locator(".background-setting-grid")).toBeVisible();
    };
    await device.shell(`am force-stop ${appId}`);
    await start();
    const file = await backgroundFile(page);
    const isFileNode = (node) => node.text === file.name || (node["content-desc"] || "").startsWith(`${file.name},`);
    if (seed) {
      assert.notEqual(await page.evaluate(() => localStorage.getItem("__koodo_native_backgrounds_version")), "1", "Seed before installing native background support");
      const config = await page.evaluate(() => JSON.parse(localStorage.getItem("readerConfig") || "{}"));
      original = Object.fromEntries(styleKeys.map((key) => [key, config[key]]));
      const baseline = { original, books: await records("books"), notes: await records("notes"), sha256: hash(file.buffer) };
      await page.evaluate(async ({ id, data }) => {
        const metadata = JSON.parse(localStorage.getItem("customBackgrounds") || "{}");
        if (metadata[id]) throw new Error("Test-owned background already exists");
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open("localforage"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise((resolve, reject) => { const tx = db.transaction("keyvaluepairs", "readwrite"); tx.objectStore("keyvaluepairs").put(data, `background_${id}`); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
        finally { db.close(); }
        metadata[id] = { id, name: "Android legacy background.png", extension: "png", textColor: "#000000", backgroundColor: "#edf2df" };
        localStorage.setItem("customBackgrounds", JSON.stringify(metadata));
        localStorage.setItem("backgroundList", JSON.stringify([...JSON.parse(localStorage.getItem("backgroundList") || "[]"), id]));
      }, { id: legacyId, data: `data:image/png;base64,${file.buffer.toString("base64")}` });
      await expect.poll(async () => JSON.parse((await native({ channel: "preferences", action: "read" })).values.customBackgrounds || "{}")[legacyId]?.extension).toBe("png");
      await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
      checked("old APK contains an IndexedDB background and preserved native metadata before upgrade");
      report.passed = true;
      return;
    }
    const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
    original = baseline.original;
    const bytes = (id) => native({ channel: "file-command", action: "read", group: "background", name: `${id}.png` });
    assert.equal(hash(Buffer.from(await bytes(legacyId), "base64")), baseline.sha256);
    assert.equal(hash(Buffer.from((await legacy(legacyId)).split(",")[1], "base64")), baseline.sha256);
    assert.equal((await native({ channel: "preferences", action: "read" })).values.__koodo_native_backgrounds_version, "1");
    assert.deepEqual(await records("books"), baseline.books);
    assert.deepEqual(await records("notes"), baseline.notes);
    checked("upgrade verifies background bytes and retains the original image, books and annotations");
    await openSettings();
    const item = (name) => page.locator(".background-setting-item").filter({ has: page.getByAltText(name, { exact: true }) });
    await tap(item("Android legacy background.png"));
    await expect(page.locator(".background-preview-actions")).toBeInViewport();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".background-preview-overlay")).toHaveCount(0);
    await expect(page.locator(".android-settings h1")).toHaveText("Background");
    checked("native Back closes image preview and retains its settings page");
    await device.shell(`mkdir -p ${shared}`);
    await device.push(file.buffer, `${shared}/${file.name}`);
    await device.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${shared}/${file.name}`);
    await tap(page.getByRole("button", { name: "Import local image", exact: true }));
    if ((await nodes()).some((node) => node.package === "com.google.android.photopicker")) {
      await tapNode((node) => /^(More|More options|更多|更多选项)$/.test(node["content-desc"] || ""));
      await tapNode((node) => /^(Browse…|Browse|浏览…|浏览)$/.test(node.text || ""));
    }
    if (!(await nodes()).some(isFileNode)) {
      await tapNode((node) => /^(Show roots|显示根目录|显示根位置)$/.test(node["content-desc"] || ""));
      await tapNode((node) => node["resource-id"] === "android:id/title" && /^(Downloads|下载|下载内容)$/.test(node.text || ""));
      await tapNode((node) => node.text === "KoodoReaderCustomTest");
    }
    await tapNode((node) => isFileNode(node) && node.enabled !== "false");
    await expect(item(file.name)).toBeVisible();
    const importedId = await page.evaluate((name) => Object.values(JSON.parse(localStorage.getItem("customBackgrounds") || "{}")).find((meta) => meta.name === name).id, file.name);
    assert.equal(hash(Buffer.from(await bytes(importedId), "base64")), hash(file.buffer));
    assert.equal(await legacy(importedId), null);
    checked("system image picker saves verified native bytes without a new IndexedDB copy");
    await tap(item(file.name));
    const apply = (name) => page.locator(".background-preview-actions").getByRole("button", { name, exact: true });
    await tap(apply("Set as app background"));
    await tap(apply("Set as book background"));
    await tap(page.locator(".background-preview-close"));
    await tap(page.locator(".setting-close-container"));
    const data = `url("data:image/png;base64,${file.buffer.toString("base64")}")`;
    await expect(page.locator("#root")).toHaveCSS("background-image", data);
    await fs.writeFile(path.join(output, "backgrounds-library.png"), await device.screenshot());
    const openBook = async () => {
      await tap(page.locator(".book-list-item").filter({ hasText: "Android custom font sample" }).locator(".book-item-cover"));
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator(".android-reader-background")).toHaveCSS("background-image", data);
      await expect(page.frameLocator("#page-area > iframe").locator("body")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    };
    await openBook();
    await fs.writeFile(path.join(output, "backgrounds-reader.png"), await device.screenshot());
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".android-header")).toBeVisible();
    checked("app and reader backgrounds render offline with readable book text");
    await device.shell(`am force-stop ${appId}`);
    await expect.poll(() => device.webViews().filter((view) => view.pkg() === appId).length).toBe(0);
    await start();
    await expect(page.locator("#root")).toHaveCSS("background-image", data);
    await openBook();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".android-header")).toBeVisible();
    checked("process restart restores app and reader backgrounds from native storage");
    await openSettings();
    await tap(item(file.name).getByRole("button", { name: "Delete", exact: true }));
    await expect(item(file.name)).toHaveCount(0);
    assert.equal(await bytes(importedId), null);
    await expect(page.locator("#root")).toHaveCSS("background-image", "none");
    assert.deepEqual(await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("readerConfig") || "{}"); return [c.appBackgroundImage, c.readerBackgroundImage, c.textColor, c.backgroundColor]; }), ["", "", "", ""]);
    await tap(item("Android legacy background.png").getByRole("button", { name: "Delete", exact: true }));
    assert.equal(await bytes(legacyId), null);
    checked("touch deletion removes native images and clears active background and color references");
    await tap(page.locator(".setting-close-container"));
    assert.deepEqual(await records("notes"), baseline.notes);
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "backgrounds-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    if (!seed && page && !page.isClosed() && original) {
      await page.evaluate((original) => {
        const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
        for (const key of ["appBackgroundImage", "readerBackgroundImage", "textColor", "backgroundColor"]) {
          if (original[key] === undefined) delete config[key]; else config[key] = original[key];
        }
        localStorage.setItem("readerConfig", JSON.stringify(config));
      }, original);
      await page.reload();
    }
    await device.shell(`rm -f ${dump}`).catch(() => {});
    await fs.writeFile(path.join(output, seed ? "backgrounds-seed-report.json" : "backgrounds-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((device) => device.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
