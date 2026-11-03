const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { systemPicker, importNativeFixture, shared } = require("./android-system-picker.cjs");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");
const appId = "xyz.koodoreader.custom.android", qaId = `${appId}.restoreqa`;
const output = path.join(__dirname, "..", "dist", "android-device");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const device = devices.find((d) => d.serial() === process.env.ANDROID_SERIAL) || devices[0];
  assert.ok(device);
  const primary = process.argv.includes("--primary"), pkg = primary ? appId : qaId;
  const report = { passed: false, checks: [], errors: [] };
  const checked = (text) => { report.checks.push(text); console.log(`PASS ${text}`); };
  let page;
  try {
    const attach = async () => {
      await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`);
      page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(60000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.context().route("**/*", (route) => new URL(route.request().url()).hostname === "localhost" || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
      await expect(page.locator(".android-header, .android-reader").first()).toBeVisible();
    };
    await attach();
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const rows = async (dbName) => native({ channel: "database-command", dbName, statement: "getAllStatement" });
    const allRows = async () => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async (table) => [table, await rows(table)])));
    const openData = async () => {
      const picker = systemPicker(page, device);
      await picker.tap(page.getByRole("button", { name: "Settings", exact: true }));
      await picker.tap(page.getByRole("button", { name: "Data", exact: true }));
    };
    const idle = () => expect(page.locator(".android-data")).toHaveAttribute("aria-busy", "false", { timeout: 120000 });
    if (primary) {
      if (await page.locator(".android-reader").isVisible()) {
        await showReadingTools(page); await systemPicker(page, device).tap(page.getByRole("button", { name: "Exit reader", exact: true }));
      }
      const before = await allRows(); assert.ok(before.books.some((b) => b.size > 1000000));
      await openData();
      const picker = systemPicker(page, device);
      await picker.tap(page.getByRole("button", { name: "Back up reading data", exact: true }));
      await picker.folder();
      const name = (await picker.nodes()).find((node) => node.class === "android.widget.EditText").text;
      assert.match(name, /^KoodoReader-Data-\d+\.json$/);
      await picker.tapNode((node) => /^(Save|SAVE|保存)$/.test(node.text || "")); await idle();
      await expect(page.getByText("Backup saved", { exact: true })).toBeVisible();
      const bytes = Buffer.from((await device.shell(`base64 ${shared}/${name}`)).toString(), "base64");
      const backup = JSON.parse(bytes.toString("utf8"));
      assert.equal(backup.format, "koodo-reader-custom-data-backup");
      assert.equal(Object.hasOwn(backup, "files"), false); assert.equal(Object.hasOwn(backup, "tables"), false);
      for (const book of before.books) assert.equal(bytes.includes(Buffer.from(book.key)), false, "Device-local book key leaked");
      assert.ok(bytes.length < 1000000, "Metadata backup unexpectedly contains original bytes");
      assert.equal(isDeepStrictEqual(before, await allRows()), true, "Primary records changed");
      report.bytes = bytes.length; report.books = before.books.length; report.notes = before.notes.length;
      await fs.writeFile(path.join(output, "data-backup.json"), bytes);
      await fs.writeFile(path.join(output, "data-backup-source.json"), JSON.stringify({ name, sha256: hash(bytes), bytes: bytes.length }));
      checked("system Save As creates a small shared JSON with no book files or local identifiers");
      checked("all primary book, note, bookmark, word and plugin rows are unchanged");
      await fs.writeFile(path.join(output, "data-backup-settings.png"), await device.screenshot());
      await picker.tap(page.locator(".setting-close-container"));
    } else {
      const source = JSON.parse(await fs.readFile(path.join(output, "data-backup-source.json"), "utf8"));
      const backupBytes = await fs.readFile(path.join(output, "data-backup.json")); assert.equal(hash(backupBytes), source.sha256);
      assert.equal((await rows("books")).length, 0, "Use a fresh isolated QA app");
      // The real source stays outside the QA app. This temporary test document
      // is deleted after the isolated package is uninstalled.
      await device.shell(`am start -n ${appId}/xyz.koodoreader.custom.android.MainActivity`);
      const primaryPage = await (await device.webView({ pkg: appId })).page();
      const original = await primaryPage.evaluate(async () => (await window.Capacitor.Plugins.KoodoStorage.execute({ channel: "database-command", dbName: "books", statement: "getAllStatement" })).value);
      const real = original.find((book) => book.size > 1000000);
      const base64 = await primaryPage.evaluate(async (name) => (await window.Capacitor.Plugins.KoodoStorage.execute({ channel: "file-command", action: "read", group: "book", name })).value, `${real.key}.${real.format.toLowerCase()}`);
      await attach();
      const fixtureName = await importNativeFixture(page, device, { name: "real.epub", buffer: Buffer.from(base64, "base64") });
      await expect(page.locator(".book-list-item")).toHaveCount(1, { timeout: 120000 });
      const book = (await rows("books"))[0];
      assert.notEqual(book.key, real.key);
      const privateFile = (await device.shell(`run-as ${qaId} sh -c 'test -f files/library-v1/book/${book.key}.epub && echo copied || echo mapped'`)).toString().trim();
      assert.equal(privateFile, "mapped");
      checked("system Open Document imports the real EPUB by persistent URI without a private original copy");
      await openData();
      const input = page.locator('.android-backup-section input[type="file"]');
      await input.setInputFiles({ name: "damaged.json", mimeType: "application/json", buffer: Buffer.from('{"format":"broken"}') }); await idle();
      await expect(page.getByText("Unsupported or damaged reading data backup. The current library has not been changed.", { exact: true })).toBeVisible();
      const restore = async () => {
        const picker = systemPicker(page, device);
        await picker.tap(page.getByRole("button", { name: "Restore reading data", exact: true }));
        await picker.folder(); await picker.select(source.name);
        await expect(page.getByRole("dialog", { name: "Restore reading data" })).toBeVisible();
        const loaded = page.waitForEvent("load", { timeout: 120000 });
        await picker.tap(page.getByRole("button", { name: "Restore matching reading data", exact: true }));
        await loaded;
        await expect(page.locator(".android-header")).toBeVisible({ timeout: 120000 });
      };
      await restore();
      const first = await allRows();
      assert.equal(first.books.length, 1); assert.equal(first.books[0].key, book.key);
      assert.equal(first.books[0].path, book.path);
      const document = JSON.parse(backupBytes.toString("utf8")).document;
      const sourceHash = hash(Buffer.from(base64, "base64"));
      const expectedNotes = Object.values(document.entries).filter((versions) => versions[0].kind === "note" && !versions[0].deleted && versions[0].value.book === sourceHash).length;
      assert.equal(first.notes.length, expectedNotes);
      const persisted = (await native({ channel: "preferences", action: "read" })).values;
      const progress = document.entries[`progress/${sourceHash}`]?.[0];
      if (progress && !progress.deleted) assert.equal(isDeepStrictEqual(JSON.parse(persisted.recordLocation)[book.key], progress.value), true, "Mapped progress differs");
      checked("shared backup restores matching progress/statistics while keeping the QA book key and URI");
      await openData(); await restore();
      assert.equal(isDeepStrictEqual(first, await allRows()), true, "Repeated restore changed or duplicated records");
      await device.shell(`am force-stop ${qaId}`); await attach();
      await systemPicker(page, device).tap(page.locator(".book-item-cover").first());
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false", { timeout: 120000 });
      await expect(page.locator("#page-area > iframe")).toBeVisible();
      await showReadingTools(page);
      await systemPicker(page, device).tap(page.getByRole("button", { name: "Next page", exact: true }));
      checked("mapped real EPUB still renders and turns pages after process restart and repeated restore");
      report.fixtureName = fixtureName;
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    report.error = error.message;
    await fs.writeFile(path.join(output, "data-backup-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, primary ? "data-backup-primary-report.json" : "data-backup-qa-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((d) => d.close()));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
