const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const { _android: android } = require("playwright"), { expect } = require("@playwright/test");
const { encodedTextFixtures } = require("../e2e/android/encoding-fixtures.cjs");
const { importNativeFixture, shared, systemPicker } = require("./android-system-picker.cjs");
const primary = "xyz.koodoreader.custom.android", qa = `${primary}.restoreqa`;
const output = path.join(__dirname, "..", "dist", "android-device");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(value).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(item => !process.env.ANDROID_SERIAL || item.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked test phone or select ANDROID_SERIAL");
  const device = selected[0], files = [], report = { passed: false, checks: [], cases: [], errors: [] };
  let primaryPage, page, baseline, originalPreferences, ownsQa = false;
  const checked = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  const native = (target, request) => target.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
  const allRows = async target => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async dbName => {
    const records = await native(target, { channel: "database-command", dbName, statement: "getAllStatement" });
    return [dbName, { count: records.length, sha256: hash(JSON.stringify(canonical(records.sort((a, b) => String(a.key).localeCompare(String(b.key)))))) }];
  })));
  const stablePreferences = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "syncRecord"));
  const attachQA = async () => {
    await device.shell(`am start --user 0 -n ${qa}/${primary}.MainActivity`);
    page = await (await device.webView({ pkg: qa })).page(); page.setDefaultTimeout(60000);
    page.on("pageerror", error => report.errors.push(error.message));
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
    const apk = process.env.ANDROID_QA_APK || path.join(output, "encoding-qa-debug.apk");
    const metadata = execFileSync(process.env.AAPT_PATH || "aapt", ["dump", "badging", apk], { encoding: "utf8" });
    assert.equal(/^package: name='([^']+)'/m.exec(metadata)?.[1], qa, "Install only the isolated QA package");
    await device.shell(`am start --user 0 -n ${primary}/.MainActivity`);
    primaryPage = await (await device.webView({ pkg: primary })).page(); await expect(primaryPage.locator(".android-header")).toBeVisible();
    baseline = await allRows(primaryPage); originalPreferences = (await native(primaryPage, { channel: "preferences", action: "read" })).values;
    execFileSync(adb, ["-s", device.serial(), "install", "--user", "0", apk]);
    ownsQa = true;
    await attachQA();
    assert.deepEqual(Object.values(await allRows(page)).map(value => value.count), [0, 0, 0, 0, 0], "Use a fresh isolated QA app");
    await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.lang = "en"; localStorage.setItem("readerConfig", JSON.stringify(config)); }); await page.reload();
    const fingerprints = [];
    for (const fixture of encodedTextFixtures()) {
      const before = await native(page, { channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const name = await importNativeFixture(page, device, fixture); files.push({ name, sha256: hash(fixture.buffer) });
      await expect.poll(async () => (await native(page, { channel: "database-command", dbName: "books", statement: "getAllStatement" })).length, { timeout: 30000 }).toBe(before.length + 1);
      const books = await native(page, { channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const book = books.find(item => !before.some(original => original.key === item.key)); assert.ok(book);
      const fingerprint = () => native(page, { channel: "file-command", action: "fingerprint", group: "book", name: `${book.key}.txt` });
      assert.deepEqual(await fingerprint(), { size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      assert.equal(book.path.startsWith("content://"), true, "Original must be a system document mapping");
      const card = () => page.locator(".book-list-item").filter({ hasText: book.name });
      const ui = systemPicker(page, device); await ui.tap(card().locator(".book-item-cover"));
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      const body = () => page.frameLocator("#page-area > iframe").locator("body");
      await expect(body()).toContainText(fixture.anchor);
      const toggle = page.locator(".android-reader-menu-toggle"); if (await toggle.isVisible()) await ui.tap(toggle);
      await ui.tap(page.getByRole("button", { name: "Chapters", exact: true }));
      await page.locator(".content-chapter-title").filter({ hasText: "第二章" }).click();
      await expect(body()).toContainText(fixture.secondAnchor); await closeReader();
      await page.reload(); await ui.tap(card().locator(".book-item-cover")); await expect(body()).toContainText(fixture.secondAnchor); await closeReader();
      assert.deepEqual(await fingerprint(), { size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      fingerprints.push({ key: book.key, size: fixture.buffer.length, sha256: hash(fixture.buffer) });
      report.cases.push({ encoding: fixture.encoding, detectedCharset: book.charset, bytes: fixture.buffer.length });
      checked(`${fixture.encoding}: system picker import, both chapters, reload progress and original byte fingerprint`);
    }
    await device.shell(`am force-stop ${qa}`); await attachQA();
    const preferences = (await native(page, { channel: "preferences", action: "read" })).values;
    const locations = JSON.parse(preferences.recordLocation || "{}");
    for (const entry of fingerprints) {
      assert.equal(Number(locations[entry.key].chapterDocIndex), 1);
      assert.deepEqual(await native(page, { channel: "file-command", action: "fingerprint", group: "book", name: `${entry.key}.txt` }), { size: entry.size, sha256: entry.sha256 });
    }
    checked("all six document mappings, byte fingerprints and second-chapter positions survive process restart");
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) { report.error = error.message; report.stack = error.stack; throw error; }
  finally {
    try {
      // Only the newly installed QA package and content-verified synthetic documents are removed.
      if (ownsQa) {
        await device.shell(`am force-stop ${qa}`);
        execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "shell", "pm", "uninstall", "--user", "0", qa]);
        for (const file of files) {
          assert.match(file.name, /^Koodo-Mapped-Fixture-\d+\.txt$/);
          const bytes = Buffer.from((await device.shell(`base64 ${shared}/${file.name}`)).toString(), "base64");
          assert.equal(hash(bytes), file.sha256, "Preserve a test document if its content changed");
          await device.shell(`rm -f ${shared}/${file.name}`);
        }
      }
      if (baseline) {
        await device.shell(`am start --user 0 -n ${primary}/.MainActivity`);
        assert.deepEqual(await allRows(primaryPage), baseline);
        const currentPreferences = (await native(primaryPage, { channel: "preferences", action: "read" })).values;
        assert.deepEqual(stablePreferences(currentPreferences), stablePreferences(originalPreferences));
        report.syncRecordChanged = currentPreferences.syncRecord !== originalPreferences.syncRecord;
        // Multi-WebView debugging can leave this test's library window awake.
        // The primary app started in the library and never opened a reader.
        assert.equal(await primaryPage.locator(".android-reader").count(), 0);
        await primaryPage.evaluate(() => window.Capacitor.Plugins.KoodoStorage.setKeepScreenOn({ enabled: false }));
        checked("isolated QA app and verified temporary files removed; primary library and preferences preserved");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally { await fs.writeFile(path.join(output, "encoding-device-report.json"), JSON.stringify(report, null, 2)); await Promise.all(devices.map(item => item.close())); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
