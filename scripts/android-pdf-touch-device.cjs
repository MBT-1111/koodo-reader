const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const { _android: android } = require("playwright"), { expect } = require("@playwright/test");
const { imagePdfFixture, amazonPdfFixtures, visiblePdfPage } = require("../e2e/android/amazon-pdf-fixtures.cjs");
const { hideReadingTools, showReadingTools } = require("../e2e/android/fixtures.cjs");
const { importNativeFixture, systemPicker, shared } = require("./android-system-picker.cjs");
const primary = "xyz.koodoreader.custom.android", qa = `${primary}.restoreqa`, output = path.resolve(__dirname, "../dist/android-device");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

const primarySummary = page => page.evaluate(async () => {
  const command = async request => (await window.Capacitor.Plugins.KoodoStorage.execute(request)).value;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const tables = {}, preferences = {};
  for (const dbName of ["books", "notes", "bookmarks", "words", "plugins"]) {
    const rows = await command({ channel: "database-command", dbName, statement: "getAllStatement" });
    tables[dbName] = { count: rows.length, sha256: await digest(JSON.stringify(canonical(rows.sort((a, b) => String(a.key).localeCompare(String(b.key)))))) };
  }
  const values = (await command({ channel: "preferences", action: "read" })).values;
  for (const key of Object.keys(values).sort()) if (key !== "syncRecord") preferences[key] = await digest(values[key]);
  return { tables, preferences, credential: await digest(String(await command({ channel: "credential", slot: "mega", action: "read" }))) };
});

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(device => !process.env.ANDROID_SERIAL || device.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one test device or set ANDROID_SERIAL");
  const device = selected[0], adb = process.env.ADB_PATH || "adb", aapt = process.env.AAPT_PATH || "aapt";
  const command = args => execFileSync(adb, ["-s", device.serial(), ...args], { encoding: "utf8" });
  const report = { passed: false, checks: [], errors: [] }, files = [];
  let page, baseline, ownsQa = false;
  const checked = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  const native = request => page.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
  const attach = async pkg => {
    await device.shell(`am start --user 0 -n ${pkg}/${primary}.MainActivity`);
    const target = await (await device.webView({ pkg })).page(); target.setDefaultTimeout(20000);
    return target;
  };
  const closeReader = async target => {
    if (!await target.locator(".android-reader").count()) return;
    const toggle = target.locator(".android-reader-menu-toggle"); if (await toggle.isVisible()) await toggle.click();
    await target.locator(".android-reader-toolbar > button").first().click();
    await expect(target.locator(".android-header")).toBeVisible();
  };
  const attachQa = async () => {
    page = await attach(qa);
    page.on("pageerror", error => report.errors.push(error.message));
    await page.context().route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await expect(page.locator(".android-header")).toBeVisible();
  };
  const swipe = async direction => {
    const view = (await systemPicker(page, device).nodes()).find(node => node.class === "android.webkit.WebView"); assert(view);
    const [left, top, right] = view.bounds.match(/\d+/g).map(Number);
    const scale = (right - left) / await page.evaluate(() => innerWidth);
    const bounds = await page.locator("#page-area").boundingBox(), horizontal = ["left", "right"].includes(direction), forward = ["left", "up"].includes(direction);
    const point = fraction => [Math.round(left + (bounds.x + bounds.width * (horizontal ? fraction : 0.5)) * scale), Math.round(top + (bounds.y + Math.min(bounds.height, 500) * (horizontal ? 0.5 : fraction)) * scale)];
    await device.shell(`input touchscreen swipe ${point(forward ? 0.8 : 0.2).join(" ")} ${point(forward ? 0.2 : 0.8).join(" ")} 450`);
  };
  try {
    assert.equal(command(["shell", "pm", "list", "packages", "--user", "0", qa]).trim(), "", "Preserve any existing QA installation");
    const apk = process.env.ANDROID_QA_APK || path.join(output, "pdf-touch-qa-debug.apk");
    const metadata = execFileSync(aapt, ["dump", "badging", apk], { encoding: "utf8" });
    assert.equal(/^package: name='([^']+)'/m.exec(metadata)?.[1], qa);
    report.apkSha256 = hash(await fs.readFile(apk));
    const primaryPage = await attach(primary); await closeReader(primaryPage);
    baseline = await primarySummary(primaryPage);
    assert.match(command(["install", "--user", "0", apk]), /Success/); ownsQa = true;
    await attachQa();
    assert.equal((await native({ channel: "database-command", dbName: "books", statement: "getAllStatement" })).length, 0);
    assert.equal(await native({ channel: "credential", slot: "mega", action: "read" }), null);
    await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.lang = "en"; localStorage.setItem("readerConfig", JSON.stringify(config)); });
    await page.reload();
    const fixtures = [await imagePdfFixture(page), ...(await amazonPdfFixtures(["pdf-zh-1col.pdf"]))], imported = [];
    for (const fixture of fixtures) {
      const before = await native({ channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const name = await importNativeFixture(page, device, fixture); files.push({ name, sha256: hash(fixture.buffer) });
      await expect.poll(async () => (await native({ channel: "database-command", dbName: "books", statement: "getAllStatement" })).length).toBe(before.length + 1);
      const books = await native({ channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const book = books.find(item => !before.some(original => original.key === item.key)); assert(book);
      imported.push(book);
      assert.deepEqual(await native({ channel: "file-command", action: "fingerprint", group: "book", name: `${book.key}.pdf` }), { size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      const card = () => page.locator(".book-list-item").filter({ hasText: book.name }).locator(".book-item-cover");
      await systemPicker(page, device).tap(card());
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await hideReadingTools(page);
      const current = async () => (await visiblePdfPage(page))?.index;
      await expect.poll(current).toBe(0);
      for (const [direction, target] of [["left", 1], ["right", 0], ["up", 1], ["down", 0]]) {
        await swipe(direction); await expect.poll(current).toBe(target);
      }
      checked(`${fixture.name}: native four-direction touch paging`);
      const target = fixture.name === "android-image-touch.pdf" ? 6 : 2;
      for (let index = 1; index <= target; index++) { await swipe("left"); await expect.poll(current).toBe(index); }
      await swipe("right"); await expect.poll(current).toBe(target - 1);
      await expect.poll(() => page.evaluate(key => Number(JSON.parse(localStorage.getItem("recordLocation") || "{}")[key]?.page), book.key)).toBe(target - 1);
      checked(`${fixture.name}: late PDF frames bind gestures and save the visible page`);
      await showReadingTools(page); await closeReader(page);
      await device.shell(`am force-stop --user 0 ${qa}`); await attachQa();
      await systemPicker(page, device).tap(card()); await expect.poll(current).toBe(target - 1);
      await fs.writeFile(path.join(output, fixture.name === "android-image-touch.pdf" ? "pdf-touch-image-device.png" : "pdf-touch-text-device.png"), await device.screenshot());
      await closeReader(page);
      checked(`${fixture.name}: reading position survives process restart`);
    }
    await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.pdfReaderMode = "scroll"; localStorage.setItem("readerConfig", JSON.stringify(config)); });
    await page.reload();
    await systemPicker(page, device).tap(page.locator(".book-list-item").filter({ hasText: imported[0].name }).locator(".book-item-cover"));
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false"); await hideReadingTools(page);
    const offset = () => page.locator("#page-area").evaluate(element => element.scrollTop);
    const start = await offset(); await swipe("up"); await expect.poll(offset).toBeGreaterThan(start + 100);
    await swipe("down"); await expect.poll(offset).toBeLessThan(start + 100);
    await closeReader(page);
    checked("explicit PDF scroll mode supports native vertical dragging");
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "pdf-touch-failure.png") }).catch(() => {});
    throw error;
  }
  finally {
    try {
      if (ownsQa) {
        await device.shell(`am force-stop --user 0 ${qa}`);
        command(["shell", "pm", "uninstall", "--user", "0", qa]);
        for (const file of files) {
          assert.match(file.name, /^Koodo-Mapped-Fixture-\d+\.pdf$/);
          const bytes = Buffer.from((await device.shell(`base64 ${shared}/${file.name}`)).toString(), "base64");
          assert.equal(hash(bytes), file.sha256, "Preserve modified temporary files");
          await device.shell(`rm -f ${shared}/${file.name}`);
        }
      }
      if (baseline) {
        const primaryPage = await attach(primary); await expect(primaryPage.locator(".android-header")).toBeVisible();
        assert.deepEqual(await primarySummary(primaryPage), baseline, "Primary books, notes, progress, settings and credentials must stay unchanged");
        report.primaryPreserved = true;
        checked("isolated QA removed; primary library, preferences and credentials preserved");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally { await fs.writeFile(path.join(output, "pdf-touch-device-report.json"), JSON.stringify(report, null, 2)); await Promise.all(devices.map(item => item.close())); }
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { primarySummary };
