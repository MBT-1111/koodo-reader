const { showReadingTools, hideReadingTools } = require("../e2e/android/fixtures.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { readingFixtures, visibleParagraphs } = require("../e2e/android/fixtures.cjs");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const shared = "/sdcard/Download/KoodoReaderCustomTest";
const pickerDump = "/data/local/tmp/koodo-reading-picker.xml";
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

const visiblePdfText = (page) => page.evaluate(() => {
  const frame = document.querySelector("#page-area > iframe");
  if (!frame?.contentDocument) return "";
  const outer = frame.getBoundingClientRect();
  return [...frame.contentDocument.querySelectorAll('iframe[id^="pdf-iframe-"]')].filter((page) => {
    const rect = page.getBoundingClientRect();
    return outer.top + rect.bottom > 56 && outer.top + rect.top < innerHeight - 64;
  }).map((page) => page.contentDocument?.body?.textContent || "").join("\n");
});

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const report = { checks: [], progress: {}, passed: false };
  let device, page, rotation;
  try {
    const selected = devices.filter((candidate) => !process.env.ANDROID_SERIAL || candidate.serial() === process.env.ANDROID_SERIAL);
    assert.equal(selected.length, 1, "Connect one device or select it with ANDROID_SERIAL");
    device = selected[0];
    device.setDefaultTimeout(20000);
    rotation = (await device.shell("cmd window user-rotation")).toString().trim();
    assert.match(rotation, /^(free|lock [0-3])$/);
    const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
    const focus = async () => (await device.shell("dumpsys window | grep mCurrentFocus")).toString();
    const errors = [];
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      await expect.poll(focus).toContain(appId);
      page = await (await device.webView({ pkg: appId })).page();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await expect(page.locator(".android-header")).toBeVisible();
    };
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const position = () => page.evaluate(() => JSON.parse(localStorage.getItem("recordLocation") || "{}")[location.hash.split("?")[0].split("/").pop()]);
    const close = async () => {
      await hideReadingTools(page);
      await device.shell("input keyevent KEYCODE_BACK");
      await expect(page).toHaveURL(/#\/manager\/home/);
    };
    const card = (fixture) => page.locator(".book-list-item").filter({ hasText: fixture.title }).first();
    const tapWeb = async (locator) => {
      await locator.scrollIntoViewIfNeeded();
      const webview = (await nodes()).find((node) => node.class === "android.webkit.WebView");
      assert.ok(webview);
      const [left, top, right] = webview.bounds.match(/\d+/g).map(Number);
      await expect.poll(() => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
      const bounds = await locator.boundingBox();
      const scale = (right - left) / await page.evaluate(() => innerWidth);
      await device.shell(`input tap ${Math.round(left + (bounds.x + bounds.width / 2) * scale)} ${Math.round(top + (bounds.y + bounds.height / 2) * scale)}`);
    };
    const open = async (fixture) => {
      await tapWeb(card(fixture).locator(".book-item-cover"));
      await expect(page).toHaveURL(new RegExp(`#/${fixture.format}/`));
      await expect.poll(position).toBeTruthy();
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await showReadingTools(page);
      const body = page.frameLocator("#page-area > iframe");
      if (fixture.format === "pdf") {
        await expect.poll(() => visiblePdfText(page)).toContain("PDF page");
      } else {
        await expect(body.locator("body")).toContainText(fixture.format === "txt" ? /安卓中文文本样本|手机旋转后继续阅读/ : "安卓手机离线阅读样本");
      }
      return page.url().split("?")[0].split("/").pop();
    };
    const nodes = async () => {
      await device.shell(`uiautomator dump ${pickerDump}`);
      const xml = (await device.shell(`cat ${pickerDump}`)).toString();
      return [...xml.matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
    };
    const tap = async (matches, long = false) => {
      let node;
      await expect.poll(async () => { node = (await nodes()).find(matches); return !!node; }, { timeout: 15000 }).toBe(true);
      const bounds = node.bounds.match(/\d+/g).map(Number);
      const x = Math.round((bounds[0] + bounds[2]) / 2), y = Math.round((bounds[1] + bounds[3]) / 2);
      await device.shell(long ? `input touchscreen swipe ${x} ${y} ${x} ${y} 700` : `input tap ${x} ${y}`);
    };

    await device.shell(`am force-stop ${appId}`);
    await start();
    const fixtures = await readingFixtures();
    await device.shell(`mkdir -p ${shared}`);
    for (const fixture of fixtures.slice(1)) {
      await fs.writeFile(path.join(output, fixture.name), fixture.buffer);
      await device.push(fixture.buffer, `${shared}/${fixture.name}`);
      const scan = `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${quote(`file://${shared}/${fixture.name}`)}`;
      // Keep the ADB service command ASCII: its framing counts JS characters, not UTF-8 bytes.
      await device.shell(`echo ${Buffer.from(scan).toString("base64")} | base64 -d | sh`);
    }
    await page.locator(".import-from-local").click();
    await expect.poll(focus).toMatch(/documentsui|myfiles/i);
    if (!(await nodes()).some((node) => node.text === fixtures[1].name)) {
      await tap((node) => /^(Show roots|显示根目录|显示根位置)$/.test(node["content-desc"] || ""));
      await tap((node) => node["resource-id"] === "android:id/title" && /^(Downloads|下载|下载内容)$/.test(node.text || ""));
      await tap((node) => node.text === "KoodoReaderCustomTest");
    }
    await tap((node) => node.text === fixtures[1].name, true);
    await tap((node) => node.text === fixtures[2].name);
    await tap((node) => /^(Open|OPEN|Select|SELECT|打开|选择)$/.test(node.text || ""));
    await expect.poll(focus).toContain(appId);
    for (const fixture of fixtures.slice(1)) await expect(card(fixture)).toBeVisible();
    checked("system picker imports Chinese-named TXT and PDF in one selection");
    if (!await card(fixtures[0]).count()) await page.locator("#import-book-box").setInputFiles(fixtures[0]);
    await expect(card(fixtures[0])).toBeVisible();

    const saved = new Map();
    for (const fixture of fixtures) {
      const key = await open(fixture);
      const bytes = Buffer.from(await native({ channel: "file-command", action: "read", group: "book", name: `${key}.${fixture.format}` }), "base64");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(fixture.buffer).digest("hex"));
      const before = await position();
      await page.locator(Number(before.percentage) < 0.9 ? ".next-chapter-single-container" : ".previous-chapter-single-container").click();
      await expect.poll(async () => (await position()).percentage).not.toBe(before.percentage);
      saved.set(fixture.format, { key, position: await position() });
      report.progress[fixture.format] = { saved: await position() };
      if (fixture.format === "pdf") assert.doesNotMatch((await position()).text || "", /安卓中文文本样本|手机旋转后继续阅读/);
      await close();
      const prefs = await native({ channel: "preferences", action: "read" });
      assert.equal(JSON.parse(prefs.values.recordLocation)[key].percentage, saved.get(fixture.format).position.percentage);
      checked(`${fixture.format.toUpperCase()} renders, verifies native file hash and flushes progress`);
    }

    const epub = fixtures[0];
    const epubKey = await open(epub);
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".android-reader-toolbar")).toBeHidden();
    await expect(page).toHaveURL(/#\/epub\//);
    const frame = page.locator("#page-area > iframe");
    const frameBounds = await frame.boundingBox();
    const bodyBefore = await page.frameLocator("#page-area > iframe").locator("body").elementHandle();
    await tapWeb(frame);
    await expect(page.locator(".android-reader-toolbar")).toBeVisible();
    assert.deepEqual(await frame.boundingBox(), frameBounds);
    assert.equal(await bodyBefore.evaluate((body) => body.isConnected), true);
    await fs.writeFile(path.join(output, "reader-tools.png"), await device.screenshot());
    await tapWeb(frame);
    await expect(page.locator(".android-reader-toolbar")).toBeHidden();
    checked("physical body taps and native Back toggle tools without reflow");
    await showReadingTools(page);
    await tapWeb(page.locator(".android-reader-progress .input-progress"));
    await expect.poll(async () => Number((await position()).percentage)).toBeGreaterThan(0.35);
    const sliderPosition = await position();
    await close();
    const sliderPreferences = await native({ channel: "preferences", action: "read" });
    assert.equal(JSON.parse(sliderPreferences.values.recordLocation)[epubKey].percentage, sliderPosition.percentage);
    await open(epub);
    await expect.poll(position).toMatchObject({ percentage: sliderPosition.percentage });
    checked("physical progress slider persists and restores its target");
    for (const label of ["Chapters", "Settings"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator(".android-reader-backdrop")).toBeVisible();
      if (label === "Chapters") await fs.writeFile(path.join(output, "reader-chapters-sheet.png"), await device.screenshot());
      await device.shell("input keyevent KEYCODE_BACK");
      await expect(page.locator(".android-reader-backdrop")).toBeHidden();
      await expect(page).toHaveURL(/#\/epub\//);
    }
    checked("hardware Back dismisses chapters and reader settings before exiting");
    await page.getByRole("button", { name: "Chapters", exact: true }).click();
    await page.locator(".content-chapter-title").filter({ hasText: "第二章" }).click();
    await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText("第二章");
    await expect.poll(async () => Number((await position()).count)).toBe(0);
    await expect(page.locator(".android-reader-backdrop")).toBeHidden();
    checked("chapter selection closes its bottom sheet");

    // Chapter navigation briefly holds the engine's page lock; measure a fresh gesture after it settles.
    await page.waitForTimeout(300);
    const initial = await position();
    await page.locator(".next-chapter-single-container").click();
    await expect.poll(async () => (await position()).percentage).not.toBe(initial.percentage);
    const onePage = await position();
    await expect(async () => {
      await page.locator(".previous-chapter-single-container").click();
      assert.equal((await position()).percentage, initial.percentage);
    }).toPass({ intervals: [250], timeout: 5000 });
    const display = (await device.shell("wm size")).toString().match(/Physical size: (\d+)x(\d+)/);
    assert.ok(display);
    const width = Number(display[1]), y = Math.round(Number(display[2]) * 0.45);
    await device.shell(`input touchscreen swipe ${Math.round(width * 0.8)} ${y} ${Math.round(width * 0.2)} ${y} 600`);
    await expect.poll(position).toMatchObject({ percentage: onePage.percentage });
    checked("one slow Android touch gesture turns exactly one page and saves it");

    if (!(await native({ channel: "database-command", statement: "getByBookKeyStatement", dbName: "bookmarks", data: epubKey })).length) {
      await page.locator(".add-bookmark-button").click();
    }
    await page.getByRole("button", { name: "Bookmark", exact: true }).click();
    await expect.poll(async () => (await native({ channel: "database-command", statement: "getByBookKeyStatement", dbName: "bookmarks", data: epubKey })).length).toBeGreaterThan(0);
    await expect(page.locator(".android-reader-backdrop")).toBeVisible();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".android-reader-backdrop")).toBeHidden();
    await expect(page).toHaveURL(/#\/epub\//);
    checked("toolbar bookmark is stored in native SQLite");
    const anchor = (await visibleParagraphs(page))[0];
    assert.ok(anchor);
    const portraitBody = await page.frameLocator("#page-area > iframe").locator("body").elementHandle();
    await device.shell("cmd window user-rotation lock 1");
    await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(true);
    await expect.poll(() => portraitBody.evaluate((body) => body.isConnected).catch(() => false)).toBe(false);
    await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText("第二章");
    await expect.poll(() => visibleParagraphs(page)).toContain(anchor);
    const landscapeBody = await page.frameLocator("#page-area > iframe").locator("body").elementHandle();
    await device.shell("cmd window user-rotation lock 0");
    await expect.poll(() => page.evaluate(() => innerWidth < innerHeight)).toBe(true);
    await expect.poll(() => landscapeBody.evaluate((body) => body.isConnected).catch(() => false)).toBe(false);
    await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText("第二章");
    await expect.poll(() => visibleParagraphs(page)).toContain(anchor);
    checked("physical phone rotation retains chapter and reading position");
    await close();
    const persisted = await native({ channel: "preferences", action: "read" });
    saved.set("epub", { key: epubKey, position: JSON.parse(persisted.values.recordLocation)[epubKey] });
    report.progress.epub.beforeRestart = saved.get("epub").position;
    await device.shell(`am force-stop ${appId}`);
    await expect.poll(() => device.webViews().filter((view) => view.pkg() === appId).length).toBe(0);
    await start();
    for (const fixture of fixtures) {
      await open(fixture);
      await page.evaluate(() => window.dispatchEvent(new Event("android-reader-close")));
      report.progress[fixture.format].restored = await position();
      await expect.poll(position).toMatchObject({ percentage: saved.get(fixture.format).position.percentage });
      await close();
    }
    assert.ok((await native({ channel: "database-command", statement: "getByBookKeyStatement", dbName: "bookmarks", data: epubKey })).length);
    checked("EPUB, TXT, PDF progress and bookmark survive process restart");
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "reading-failure.png") }).catch(() => {});
    throw error;
  } finally {
    if (device) {
      if (rotation) await device.shell(`cmd window user-rotation ${rotation}`).catch(() => {});
      await device.shell(`rm -f ${pickerDump}`).catch(() => {});
    }
    await fs.writeFile(path.join(output, "reading-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((candidate) => candidate.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
