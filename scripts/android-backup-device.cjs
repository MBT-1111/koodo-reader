const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const JSZip = require("jszip");
const { fontBook } = require("../e2e/android/font-fixtures.cjs");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");

const appId = "xyz.koodoreader.custom.android";
const qaId = `${appId}.restoreqa`;
const output = path.join(__dirname, "..", "dist", "android-device");
const saved = path.join(output, "backup-source.json");
const dump = "/data/local/tmp/koodo-backup.xml";
const shared = "/sdcard/Download/KoodoReaderCustomTest";
const tables = ["books", "notes", "bookmarks", "words", "plugins"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const device = devices.find((d) => d.serial() === process.env.ANDROID_SERIAL) || devices[0];
  assert.ok(device, "Connect an authorized Android device");
  const primary = process.argv.includes("--primary");
  const report = { passed: false, checks: [], errors: [] };
  const checked = (message) => { report.checks.push(message); console.log(`PASS ${message}`); };
  let page, currentPkg;
  try {
    const attach = async (pkg) => {
      currentPkg = pkg;
      await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`);
      page = await (await device.webView({ pkg })).page();
      page.setDefaultTimeout(60000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await expect(page.locator(".android-header, .android-reader").first()).toBeVisible();
    };
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const records = async () => {
      const result = {};
      for (const dbName of tables) result[dbName] = await native({ channel: "database-command", dbName, statement: "getAllStatement" });
      return result;
    };
    const preferences = async () => (await native({ channel: "preferences", action: "read" })).values;
    const nodes = async () => {
      await device.shell(`uiautomator dump --compressed ${dump}`);
      return [...(await device.shell(`cat ${dump}`)).toString().matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])));
    };
    const tapNode = async (matches) => {
      let node;
      await expect.poll(async () => { node = (await nodes()).find(matches); return !!node; }, { timeout: 120000 }).toBe(true);
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
    const backOutOfPicker = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!(await nodes()).some((node) => node.package === "com.google.android.documentsui")) return;
        await device.shell("input keyevent KEYCODE_BACK");
      }
      throw new Error("System picker did not close");
    };
    const selectFolder = async () => {
      await tapNode((node) => /^(Show roots|显示根目录|显示根位置)$/.test(node["content-desc"] || ""));
      await tapNode((node) => node["resource-id"] === "android:id/title" && /^(Downloads|下载|下载内容)$/.test(node.text || ""));
      await tapNode((node) => node.text === "KoodoReaderCustomTest");
    };
    const idle = async () => expect(page.locator(".android-data")).toHaveAttribute("aria-busy", "false", { timeout: 120000 });
    const openData = async () => {
      await tap(page.getByRole("button", { name: "Settings", exact: true }));
      await tap(page.getByRole("button", { name: "Data", exact: true }));
      await expect(page.locator(".android-backup-section")).toBeVisible();
    };
    const readShared = async (name) => {
      assert.match(name, /^KoodoReader-Android-Backup-\d+\.zip$/);
      return Buffer.from((await device.shell(`base64 ${shared}/${name}`)).toString(), "base64");
    };
    // Startup refreshes platform values and OS-theme timestamps in the sync journal.
    const corePreferences = (values) => Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith("__koodo_native_") && !["appVersion", "appPlatform", "syncRecord"].includes(key)));
    const sameRecords = (actual, expected) => {
      for (const table of tables) assert.equal(isDeepStrictEqual(actual[table], expected[table]), true, `${table} records differ`);
    };
    const samePreferences = (actual, expected) => {
      const left = corePreferences(actual), right = corePreferences(expected);
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) assert.equal(left[key] === right[key], true, `Preference differs: ${key}`);
    };
    const validateFiles = async (manifest, archive) => {
      for (const file of manifest.files) {
        const bytes = await archive.file(`${file.group}/${file.name}`).async("nodebuffer");
        assert.equal(bytes.length, file.size);
        assert.equal(hash(bytes), file.sha256);
        const stored = await native({ channel: "file-command", group: file.group, name: file.name, action: "read" });
        assert.equal(hash(Buffer.from(stored, "base64")), file.sha256);
      }
    };
    if (primary) {
      await attach(appId);
      if (await page.locator(".android-reader").isVisible()) {
        await showReadingTools(page);
        await tap(page.getByRole("button", { name: "Exit reader", exact: true }));
      }
      const original = await records();
      const originalPreferences = await preferences();
      assert.ok(original.books.some((book) => book.size > 1024 * 1024), "The real test book must be in the primary library");
      await openData();
      const create = () => page.getByRole("button", { name: "Create full backup", exact: true });
      await tap(create());
      await tapNode((node) => node.class === "android.widget.EditText");
      await backOutOfPicker();
      await idle();
      sameRecords(await records(), original);
      samePreferences(await preferences(), originalPreferences);
      checked("cancelling a full backup retains the real library and releases the snapshot lock");
      await tap(create());
      await selectFolder();
      const name = (await nodes()).find((node) => node.class === "android.widget.EditText").text;
      assert.match(name, /^KoodoReader-Android-Backup-\d+\.zip$/);
      await fs.writeFile(path.join(output, "backup-save-dialog.png"), await device.screenshot());
      await tapNode((node) => /^(Save|SAVE|保存)$/.test(node.text || ""));
      await idle();
      await expect(page.getByText("Backup saved", { exact: true })).toBeVisible();
      const bytes = await readShared(name);
      const archive = await JSZip.loadAsync(bytes);
      const manifest = JSON.parse(await archive.file("koodo-android-backup.json").async("string"));
      sameRecords(manifest.tables, original);
      samePreferences(manifest.preferences, originalPreferences);
      await validateFiles(manifest, archive);
      await fs.writeFile(saved, JSON.stringify({ name, sha256: hash(bytes), bookCount: manifest.tables.books.length, files: manifest.files.length, bytes: bytes.length }, null, 2));
      checked("system Save As produces a full backup with every real book and resource SHA-256 verified");
      sameRecords(await records(), original);
      await tap(page.locator(".setting-close-container"));
      checked("creating and saving a backup leaves all primary records and settings intact");
    } else {
      const source = JSON.parse(await fs.readFile(saved, "utf8"));
      const bytes = await readShared(source.name);
      assert.equal(hash(bytes), source.sha256);
      const archive = await JSZip.loadAsync(bytes);
      const manifest = JSON.parse(await archive.file("koodo-android-backup.json").async("string"));
      await attach(qaId);
      assert.equal(currentPkg, qaId);
      assert.equal((await records()).books.length, 0, "Use a fresh isolated QA installation");
      await page.locator("#import-book-box").setInputFiles(await fontBook());
      await expect(page.locator(".book-list-item")).toHaveCount(1);
      const qaOriginal = await records();
      const qaPreferences = await preferences();
      await openData();
      const invalid = new JSZip(); invalid.file("unrelated.txt", "not a backup");
      await page.locator('.android-backup-section input[type="file"]').setInputFiles({ name: "invalid.zip", mimeType: "application/zip", buffer: await invalid.generateAsync({ type: "nodebuffer" }) });
      await idle();
      await expect(page.getByText("Unsupported or damaged Android full backup. The current library has not been changed.", { exact: true })).toBeVisible();
      sameRecords(await records(), qaOriginal);
      samePreferences(await preferences(), qaPreferences);
      checked("invalid restore files cannot change the isolated library or its preferences");
      const chooseBackup = async () => {
        await tap(page.getByRole("button", { name: "Restore full backup", exact: true }));
        await selectFolder();
        await tapNode((node) => node.text === source.name || (node["content-desc"] || "").startsWith(`${source.name},`));
        await expect(page.locator(".android-backup-preview")).toBeVisible({ timeout: 120000 });
        await idle();
      };
      await chooseBackup();
      await device.shell("input keyevent KEYCODE_BACK");
      await expect(page.locator(".android-backup-preview")).toHaveCount(0);
      sameRecords(await records(), qaOriginal);
      checked("system selection validates the real archive and native Back cancels its restore preview");
      await chooseBackup();
      await fs.writeFile(path.join(output, "backup-restore-preview.png"), await device.screenshot());
      assert.equal(currentPkg, qaId, "Never perform replacement tests on the primary app");
      await tap(page.getByRole("button", { name: "Replace library and restore", exact: true }));
      await expect.poll(async () => { try { return (await records()).books.length; } catch { return -1; } }, { timeout: 120000 }).toBe(manifest.tables.books.length);
      await expect(page.locator(".android-backup-preview")).toHaveCount(0, { timeout: 120000 });
      sameRecords(await records(), manifest.tables);
      samePreferences(await preferences(), manifest.preferences);
      await validateFiles(manifest, archive);
      checked("confirmed restore replaces every record, setting and file together in the QA app");
      await device.shell(`am force-stop ${qaId}`);
      await expect.poll(() => device.webViews().filter((view) => view.pkg() === qaId).length).toBe(0);
      await attach(qaId);
      sameRecords(await records(), manifest.tables);
      samePreferences(await preferences(), manifest.preferences);
      checked("process restart retains the restored library and preference version");
      const real = manifest.tables.books.find((book) => book.size > 1024 * 1024);
      await tap(page.locator(".book-list-item").filter({ hasText: real.name }).locator(".book-item-cover"));
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false", { timeout: 120000 });
      await expect(page.locator("#page-area > iframe")).toBeVisible();
      const content = await page.frameLocator("#page-area > iframe").locator("body").evaluate((body) => ({ text: body.innerText.length, images: body.querySelectorAll("img, image").length }));
      assert.ok(content.text > 0 || content.images > 0);
      await showReadingTools(page);
      await tap(page.getByRole("button", { name: "Next page", exact: true }));
      await tap(page.getByRole("button", { name: "Exit reader", exact: true }));
      await expect(page.locator(".android-header")).toBeVisible();
      checked("the restored real EPUB opens, renders and turns a page in the isolated app");
      await attach(appId);
      sameRecords(await records(), manifest.tables);
      samePreferences(await preferences(), manifest.preferences);
      checked("all replacement and reading tests leave the primary real library unchanged");
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "backup-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    if (device) await device.shell(`rm -f ${dump}`).catch(() => {});
    await fs.writeFile(path.join(output, primary ? "backup-primary-report.json" : "backup-restore-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((d) => d.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
