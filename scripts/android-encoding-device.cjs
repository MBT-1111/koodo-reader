const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const { _android: android } = require("playwright"), { expect } = require("@playwright/test");
const { encodedTextFixtures, textBoundaryFixtures } = require("../e2e/android/encoding-fixtures.cjs");
const { formatFixtures, savedPosition, showReadingTools, visibleComicColor, readFormatState, expectFormatState } = require("../e2e/android/format-fixtures.cjs");
const { importNativeFixture, shared, systemPicker } = require("./android-system-picker.cjs");
const { amazonPdfFixtures, visiblePdfPage } = require("../e2e/android/amazon-pdf-fixtures.cjs");
const { amazonPdfSpeech } = require("./android-amazon-pdf-speech.cjs");
const primary = "xyz.koodoreader.custom.android", qa = `${primary}.restoreqa`;
const output = path.join(__dirname, "..", "dist", "android-device");
const boundaries = process.argv.includes("--boundaries");
const amazonPdf = process.argv.includes("--amazon-pdf");
const formats = process.argv.includes("--formats") || amazonPdf;
const reportName = amazonPdf ? "amazon-pdf" : formats ? "formats" : boundaries ? "text-boundary" : "encoding";
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(value).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(item => !process.env.ANDROID_SERIAL || item.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked test phone or select ANDROID_SERIAL");
  const device = selected[0], files = [], report = { passed: false, checks: [], cases: [], errors: [] };
  let primaryPage, page, baseline, originalPreferences, originalCredential, speechFixture, ownsQa = false;
  const checked = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  const native = (target, request) => target.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
  const allRows = async target => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async dbName => {
    const records = await native(target, { channel: "database-command", dbName, statement: "getAllStatement" });
    return [dbName, { count: records.length, sha256: hash(JSON.stringify(canonical(records.sort((a, b) => String(a.key).localeCompare(String(b.key)))))) }];
  })));
  const stablePreferences = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "syncRecord"));
  const credentialHash = target => target.evaluate(async () => {
    const value = String((await window.Capacitor.Plugins.KoodoStorage.execute({ channel: "credential", slot: "mega", action: "read" })).value);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  });
  const attachQA = async () => {
    await device.shell(`am start --user 0 -n ${qa}/${primary}.MainActivity`);
    page = await (await device.webView({ pkg: qa })).page(); page.setDefaultTimeout(60000);
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("console", async message => {
      if (message.type() !== "error") return;
      const values = await Promise.all(message.args().map(arg => arg.evaluate(value => typeof value === "string" ? value : typeof value?.message === "string" ? value.message : "").catch(() => "")));
      if (values.some(Boolean)) { (report.consoleErrors ||= []).push(values); console.log(`QA error ${JSON.stringify(values)}`); }
    });
    await page.context().route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await expect(page.locator(".android-header")).toBeVisible({ timeout: 15000 });
  };
  const closeReader = async () => {
    const toggle = page.locator(".android-reader-menu-toggle"); if (await toggle.isVisible()) await toggle.click();
    await page.locator(".android-reader-toolbar > button").first().click(); await expect(page.locator(".android-header")).toBeVisible();
  };
  try {
    const adb = process.env.ADB_PATH || "adb";
    const existing = execFileSync(adb, ["-s", device.serial(), "shell", "pm", "list", "packages", "--user", "0", qa], { encoding: "utf8" });
    assert.equal(existing.trim(), "", "Preserve the existing QA app; this test requires a new installation");
    const apk = process.env.ANDROID_QA_APK || path.join(output, `${reportName}-qa-debug.apk`);
    const metadata = execFileSync(process.env.AAPT_PATH || "aapt", ["dump", "badging", apk], { encoding: "utf8" });
    assert.equal(/^package: name='([^']+)'/m.exec(metadata)?.[1], qa, "Install only the isolated QA package");
    report.mode = amazonPdf ? "amazon-pdf" : formats ? "formats" : boundaries ? "text-boundaries" : "encodings";
    report.apkSha256 = hash(await fs.readFile(apk));
    await device.shell(`am start --user 0 -n ${primary}/.MainActivity`);
    primaryPage = await (await device.webView({ pkg: primary })).page(); await expect(primaryPage.locator(".android-header")).toBeVisible();
    baseline = await allRows(primaryPage); originalPreferences = (await native(primaryPage, { channel: "preferences", action: "read" })).values;
    originalCredential = await credentialHash(primaryPage);
    execFileSync(adb, ["-s", device.serial(), "install", "--user", "0", apk]);
    ownsQa = true;
    await attachQA();
    assert.deepEqual(Object.values(await allRows(page)).map(value => value.count), [0, 0, 0, 0, 0], "Use a fresh isolated QA app");
    assert.equal(await native(page, { channel: "credential", slot: "mega", action: "read" }), null, "The QA app must have no real MEGA session");
    await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.lang = "en"; localStorage.setItem("readerConfig", JSON.stringify(config)); }); await page.reload();
    if (amazonPdf) {
      const testApk = path.join(output, "amazon-pdf-qa-test.apk");
      assert.equal(execFileSync(adb, ["-s", device.serial(), "shell", "pm", "list", "packages", "--user", "0", `${qa}.test`], { encoding: "utf8" }).trim(), "", "Preserve an existing QA instrumentation package");
      const metadata = execFileSync(process.env.AAPT_PATH || "aapt", ["dump", "badging", testApk], { encoding: "utf8" });
      assert.equal(/^package: name='([^']+)'/m.exec(metadata)?.[1], `${qa}.test`);
      execFileSync(adb, ["-s", device.serial(), "install", "--user", "0", testApk]);
      try {
        const result = execFileSync(adb, ["-s", device.serial(), "shell", "am", "instrument", "-w", `${qa}.test/androidx.test.runner.AndroidJUnitRunner`], { encoding: "utf8" });
        await fs.writeFile(path.join(output, "amazon-pdf-instrumentation.log"), result);
        assert.match(result, /OK \(36 tests\)/); checked("36 isolated native instrumentation tests including PDF progress persistence");
      } finally { execFileSync(adb, ["-s", device.serial(), "shell", "pm", "uninstall", "--user", "0", `${qa}.test`]); }
      await attachQA();
      await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.lang = "en"; localStorage.setItem("readerConfig", JSON.stringify(config)); }); await page.reload();
      speechFixture = await amazonPdfSpeech(device, checked);
      await speechFixture.setup(page);
    }
    const fingerprints = [];
    const fixtures = amazonPdf ? await amazonPdfFixtures() : formats ? await formatFixtures(page) : boundaries ? textBoundaryFixtures() : encodedTextFixtures();
    for (const fixture of fixtures) {
      const timing = {}, mark = async (key, action) => { const start = performance.now(); const value = await action(); timing[key] = Math.round(performance.now() - start); return value; };
      const before = await native(page, { channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const name = await mark("importMs", () => importNativeFixture(page, device, fixture)); files.push({ name, sha256: hash(fixture.buffer) });
      await expect.poll(async () => (await native(page, { channel: "database-command", dbName: "books", statement: "getAllStatement" })).length, { timeout: 60000 }).toBe(before.length + 1);
      const books = await native(page, { channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const book = books.find(item => !before.some(original => original.key === item.key)); assert.ok(book);
      const extension = fixture.format || "txt";
      if (formats) assert.equal(book.format, extension.toUpperCase());
      if (fixture.name.startsWith("no-bom-")) assert.equal(book.charset.toUpperCase(), fixture.encoding === "utf16le" ? "UTF-16LE" : "UTF-16BE");
      const fingerprint = () => native(page, { channel: "file-command", action: "fingerprint", group: "book", name: `${book.key}.${extension}` });
      assert.deepEqual(await fingerprint(), { size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      assert.equal(book.path.startsWith("content://"), true, "Original must be a system document mapping");
      const card = () => page.locator(".book-list-item").filter({ hasText: book.name });
      const ui = systemPicker(page, device);
      const body = () => page.frameLocator("#page-area > iframe").locator("body");
      await mark("openMs", async () => {
        await ui.tap(card().locator(".book-item-cover"));
        await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
        if (fixture.format === "pdf") await expect.poll(async () => (await visiblePdfPage(page))?.text).toContain(fixture.anchor);
        else if (fixture.anchor) await expect(body()).toContainText(fixture.anchor);
        if (fixture.colors) await expect.poll(() => visibleComicColor(page)).toEqual([...fixture.colors[0], 255]);
      });
      await mark("chapterMs", async () => {
        if (formats) {
          await expect.poll(() => savedPosition(page)).toBeTruthy();
          const initial = await savedPosition(page);
          await showReadingTools(page); await page.locator(".next-chapter-single-container").click();
          await expect.poll(async () => (await savedPosition(page))?.percentage).not.toBe(initial.percentage);
          if (fixture.colors) await expect.poll(() => visibleComicColor(page)).toEqual([...fixture.colors[1], 255]);
          if (fixture.format === "pdf") await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(1);
          return;
        }
        const toggle = page.locator(".android-reader-menu-toggle"); if (await toggle.isVisible()) await ui.tap(toggle);
        await ui.tap(page.getByRole("button", { name: "Chapters", exact: true }));
        const chapters = page.locator(".content-chapter-title");
        await (fixture.name.startsWith("large-") ? chapters.last() : chapters.filter({ hasText: "第二章" })).click();
        await expect(body()).toContainText(fixture.secondAnchor);
      });
      if (speechFixture) await speechFixture.verify(page, fixture, book);
      const position = () => page.evaluate(key => JSON.parse(localStorage.getItem("recordLocation") || "{}")[key], book.key);
      if (!formats) await expect.poll(async () => Number((await position())?.chapterDocIndex)).toBeGreaterThan(0);
      const chapterValue = (await position()).chapterDocIndex;
      const chapterIndex = chapterValue === undefined ? undefined : Number(chapterValue);
      if (!formats && !fixture.name.startsWith("large-")) assert.equal(chapterIndex, 1);
      const expectedState = formats ? await readFormatState(page, fixture) : null;
      await closeReader();
      await mark("reloadMs", async () => {
        await page.reload(); await ui.tap(card().locator(".book-item-cover"));
        if (formats) await expectFormatState(page, expectedState);
        else { await expect(body()).toContainText(fixture.secondAnchor); await expect.poll(async () => Number((await position())?.chapterDocIndex)).toBe(chapterIndex); }
      });
      await closeReader();
      assert.deepEqual(await fingerprint(), { size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      fingerprints.push({ key: book.key, name: book.name, extension, chapterIndex, expectedState, secondAnchor: fixture.secondAnchor, size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      report.cases.push({ name: fixture.name, format: extension, encoding: fixture.encoding, detectedCharset: book.charset, bytes: fixture.buffer.length, chapterIndex, timing });
      checked(`${fixture.name}: system picker import, readable content, navigation, reload progress and original bytes`);
    }
    await device.shell(`am force-stop ${qa}`); await attachQA();
    const requestsBeforeReopen = speechFixture?.requests.length;
    const preferences = (await native(page, { channel: "preferences", action: "read" })).values;
    const locations = JSON.parse(preferences.recordLocation || "{}");
    for (const entry of fingerprints) {
      if (entry.chapterIndex !== undefined) assert.equal(Number(locations[entry.key].chapterDocIndex), entry.chapterIndex);
      if (formats) assert.equal(locations[entry.key].page, entry.expectedState.position.page);
      assert.deepEqual(await native(page, { channel: "file-command", action: "fingerprint", group: "book", name: `${entry.key}.${entry.extension}` }), { size: entry.size, sha256: entry.sha256 });
      if (boundaries || formats) {
        await systemPicker(page, device).tap(page.locator(".book-list-item").filter({ hasText: entry.name }).locator(".book-item-cover"));
        if (formats) await expectFormatState(page, entry.expectedState);
        else await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText(entry.secondAnchor);
        await closeReader();
      }
    }
    checked(`all ${fixtures.length} document mappings, original bytes and saved positions survive process restart`);
    if (amazonPdf) {
      const bookmarks = await native(page, { channel: "database-command", dbName: "bookmarks", statement: "getAllStatement" });
      assert(fingerprints.every(entry => bookmarks.some(bookmark => bookmark.bookKey === entry.key)), "Keep each format's bookmark after process restart");
      assert.equal((await page.evaluate(() => window.Capacitor.Plugins.KoodoSpeech.execute({ action: "state" }))).status, "idle");
      assert.equal(speechFixture.requests.length, requestsBeforeReopen, "Reopening must not generate cloud speech or AI requests");
      checked("five-format bookmarks survive restart; no automatic playback or new cloud/AI requests");
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) { report.error = error.message; report.stack = error.stack; throw error; }
  finally {
    try {
      // Only the newly installed QA package and content-verified synthetic documents are removed.
      if (ownsQa) {
        await device.shell(`am force-stop ${qa}`);
        execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "shell", "pm", "uninstall", "--user", "0", qa]);
        for (const file of files) {
          assert.match(file.name, /^Koodo-Mapped-Fixture-\d+\.(txt|md|html|fb2|docx|cbz|mobi|azw|azw3|pdf)$/);
          const bytes = Buffer.from((await device.shell(`base64 ${shared}/${file.name}`)).toString(), "base64");
          assert.equal(hash(bytes), file.sha256, "Preserve a test document if its content changed");
          await device.shell(`rm -f ${shared}/${file.name}`);
        }
      }
      if (baseline) {
        await device.shell(`am start --user 0 -n ${primary}/.MainActivity`);
        primaryPage = await (await device.webView({ pkg: primary })).page();
        await expect(primaryPage.locator(".android-header")).toBeVisible();
        assert.deepEqual(await allRows(primaryPage), baseline);
        const currentPreferences = (await native(primaryPage, { channel: "preferences", action: "read" })).values;
        assert.equal(hash(JSON.stringify(canonical(stablePreferences(currentPreferences)))), hash(JSON.stringify(canonical(stablePreferences(originalPreferences)))), "Primary preferences changed during the test");
        assert.equal(await credentialHash(primaryPage), originalCredential);
        report.primaryRecordsPreserved = true;
        report.primaryPreferencesPreserved = true;
        report.primaryCredentialPreserved = true;
        report.syncRecordChanged = currentPreferences.syncRecord !== originalPreferences.syncRecord;
        // Multi-WebView debugging can leave this test's library window awake.
        // The primary app started in the library and never opened a reader.
        assert.equal(await primaryPage.locator(".android-reader").count(), 0);
        await primaryPage.evaluate(() => window.Capacitor.Plugins.KoodoStorage.setKeepScreenOn({ enabled: false }));
        checked("isolated QA app and verified temporary files removed; primary library and preferences preserved");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally { await fs.writeFile(path.join(output, `${reportName}-device-report.json`), JSON.stringify(report, null, 2)); await speechFixture?.close(); await Promise.all(devices.map(item => item.close())); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
