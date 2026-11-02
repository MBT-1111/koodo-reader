const { showReadingTools, hideReadingTools } = require("../e2e/android/fixtures.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const JSZip = require("jszip");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const title = "Android native storage fixture";
const report = { model: "", android: "", checks: [], passed: false };

async function makeEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("book.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">koodo-android-native-storage-fixture-v2</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language><dc:creator>Test</dc:creator><meta name="cover" content="cover"/></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`);
  zip.file("cover.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=", "base64"));
  zip.file("toc.ncx", `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="koodo-android-device-fixture-v1"/></head><docTitle><text>${title}</text></docTitle><navMap><navPoint id="chapter" playOrder="1"><navLabel><text>Device chapter</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>`);
  const paragraphs = Array.from({ length: 100 }, (_, i) => `<p>Paragraph ${i + 1}. This synthetic EPUB verifies reading, Android Back and progress after a process restart. No personal books are used.</p>`).join("");
  zip.file("chapter.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Device chapter</title></head><body><h1>Device chapter</h1>${paragraphs}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function position(page, key) {
  return page.evaluate((bookKey) => JSON.parse(localStorage.getItem("recordLocation") || "{}")[bookKey], key);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  let page;
  try {
    const selected = devices.filter((device) => !process.env.ANDROID_SERIAL || device.serial() === process.env.ANDROID_SERIAL);
    assert.equal(selected.length, 1, "Connect one test device or select it with ANDROID_SERIAL");
    const device = selected[0];
    device.setDefaultTimeout(20000);
    report.model = device.model();
    report.android = (await device.shell("getprop ro.build.version.release")).toString().trim();
    const focus = async () => (await device.shell("dumpsys window | grep mCurrentFocus")).toString();
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      await expect.poll(focus, { timeout: 15000 }).toContain(appId);
      const webview = await device.webView({ pkg: appId });
      page = await webview.page();
      page.setDefaultTimeout(15000);
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      return page;
    };
    const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
    await start();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".android-header")).toBeVisible();
    assert.equal(await page.evaluate(() => window.Capacitor.getPlatform()), "android");
    checked("native WebView startup");

    await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator(".setting-dialog-container")).toBeVisible();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".setting-dialog-container")).toBeHidden();
    checked("native Back closes settings");

    await page.locator(".android-bottom-nav").getByRole("button", { name: "Shelf", exact: true }).click();
    await expect(page.locator(".android-shelves")).toBeVisible();
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page).toHaveURL(/#\/manager\/home/);
    checked("native Back returns from shelves to Home");

    await page.locator(".import-from-local").click();
    await expect.poll(focus, { timeout: 15000 }).toMatch(/documentsui|myfiles/i);
    // The picker remembers its last folder; Back first navigates to its parents.
    for (let i = 0; i < 6 && !(await focus()).includes(appId); i++) {
      assert.match(await focus(), /documentsui|myfiles/i, "Only cancel the test file picker");
      await device.shell("input keyevent KEYCODE_BACK");
      await expect.poll(focus, { timeout: 5000 }).not.toContain("mCurrentFocus=null");
    }
    await expect.poll(focus, { timeout: 15000 }).toContain(appId);
    checked("system file picker opens and cancels");

    const fixture = await makeEpub();
    await fs.writeFile(path.join(output, "koodo-device-smoke.epub"), fixture);
    const card = () => page.locator(".book-list-item").filter({ hasText: title }).first();
    if (!await card().count()) {
      await page.locator("#import-book-box").setInputFiles({ name: "koodo-device-smoke.epub", mimeType: "application/epub+zip", buffer: fixture });
    }
    await expect(card()).toBeVisible();
    checked("synthetic EPUB imports in native WebView");
    await card().locator(".book-item-cover").click();
    await showReadingTools(page);
    await expect(page).toHaveURL(/#\/epub\//);
    const key = new URL(page.url()).hash.split("?")[0].split("/").pop();
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    assert.equal(await native({ channel: "file-command", action: "exists", group: "book", name: `${key}.epub` }), true);
    const covers = await native({ channel: "file-command", action: "list", group: "cover" });
    assert.ok(covers.some((name) => name.startsWith(`${key}.`)), "Imported cover must be a native file");
    const record = await native({ channel: "database-command", dbName: "books", statement: "getStatement", data: key });
    assert.equal(record.cover, "", "Book metadata must reference the native cover instead of embedding it");
    checked("book bytes, cover and metadata use native storage");
    await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("Paragraph");
    const background = await page.locator(".background").first().evaluate((element) => getComputedStyle(element).backgroundColor);
    const foreground = await page.frameLocator("#page-area iframe").first().locator("p").first().evaluate((element) => getComputedStyle(element).color);
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const colors = [luminance(background), luminance(foreground)];
    assert.ok((Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05) >= 4.5, "Reader text must contrast with the actual page background");
    checked("reader foreground/background contrast");
    await expect.poll(() => position(page, key)).toBeTruthy();
    const before = await position(page, key);
    await page.locator(Number(before.percentage) < 0.9 ? ".next-chapter-single-container" : ".previous-chapter-single-container").click();
    await expect.poll(async () => (await position(page, key))?.percentage).not.toBe(before.percentage);
    const advanced = await position(page, key);
    await page.screenshot({ path: path.join(output, "native-reader.png") });
    checked("native EPUB pagination saves progress");
    await hideReadingTools(page);
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page).toHaveURL(/#\/manager\/home/);
    checked("native Back exits reader");
    const preferences = await native({ channel: "preferences", action: "read" });
    assert.ok(preferences.version > 0);
    assert.equal(JSON.parse(preferences.values.recordLocation)[key].percentage, advanced.percentage);
    checked("reader exit flushes progress to native preferences");

    await card().locator(".book-item-cover").click();

    await showReadingTools(page);
    await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("Paragraph");
    await page.evaluate(() => window.dispatchEvent(new Event("android-reader-close")));
    await expect.poll(() => position(page, key)).toMatchObject({ percentage: advanced.percentage });
    checked("reopening restores progress");
    await device.shell(`am force-stop ${appId}`);
    await expect.poll(() => device.webViews().filter((view) => view.pkg() === appId).length).toBe(0);
    await start();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(card()).toBeVisible();
    await card().locator(".book-item-cover").click();
    await showReadingTools(page);
    await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("Paragraph");
    await page.evaluate(() => window.dispatchEvent(new Event("android-reader-close")));
    await expect.poll(() => position(page, key)).toMatchObject({ percentage: advanced.percentage });
    checked("library and progress survive force-stop and restart");
    await showReadingTools(page);
    await page.locator(".android-reader-toolbar button").first().click();
    await expect(page).toHaveURL(/#\/manager\/home/);
    await page.screenshot({ path: path.join(output, "native-library.png") });
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((device) => device.close()));
  }
}

module.exports = { makeEpub };
if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
