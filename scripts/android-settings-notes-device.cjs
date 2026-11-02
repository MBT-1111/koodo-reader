const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { fontFiles } = require("../e2e/android/font-fixtures.cjs");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const stamp = Date.now();
const prefix = `Phone UI QA ${stamp}`;
const fontKey = `Android_Settings_QA_${stamp}`;
const report = { checks: [], passed: false };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  let device, page, failure, fontImported = false, originalPosition, sourceBook;
  let baselineNotes = [], baselineBooks = [];
  const added = [];
  const errors = [];
  const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
  const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
  const db = (statement, dbName, data) => native({ channel: "database-command", statement, dbName, data });
  try {
    const selected = devices.filter((candidate) => !process.env.ANDROID_SERIAL || candidate.serial() === process.env.ANDROID_SERIAL);
    assert.equal(selected.length, 1, "Connect one device or select it with ANDROID_SERIAL");
    device = selected[0];
    device.setDefaultTimeout(20000);
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      page = await (await device.webView({ pkg: appId })).page();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await expect(page.locator(".android-bottom-nav")).toBeVisible();
    };
    const back = () => device.shell("input keyevent KEYCODE_BACK");
    const tap = async (locator) => {
      await locator.scrollIntoViewIfNeeded();
      await device.shell("uiautomator dump /data/local/tmp/koodo-settings-notes.xml");
      const xml = (await device.shell("cat /data/local/tmp/koodo-settings-notes.xml")).toString();
      const webview = [...xml.matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))).find((node) => node.class === "android.webkit.WebView");
      assert.ok(webview);
      await expect.poll(() => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
      const [left, top, right] = webview.bounds.match(/\d+/g).map(Number);
      const rect = await locator.boundingBox();
      const scale = (right - left) / await page.evaluate(() => innerWidth);
      await device.shell(`input tap ${Math.round(left + (rect.x + rect.width / 2) * scale)} ${Math.round(top + (rect.y + rect.height / 2) * scale)}`);
    };
    const nav = (name) => page.locator(".android-bottom-nav").getByRole("button", { name, exact: true });
    await device.shell(`am force-stop ${appId}`);
    await start();
    await tap(nav("Settings"));
    const settings = page.locator(".android-settings");
    await expect(settings).toHaveAttribute("data-settings-level", "root");
    await expect(page.locator(".android-settings-group")).toHaveCount(3);
    await fs.writeFile(path.join(output, "settings-groups.png"), await device.screenshot());
    checked("physical Settings entry opens grouped pages above bottom navigation");
    await tap(settings.getByRole("button", { name: "General", exact: true }));
    await expect(settings.getByRole("heading", { level: 1 })).toHaveText("General");
    await back();
    await expect(settings).toHaveAttribute("data-settings-level", "root");
    checked("native Back returns from a settings page to its grouped overview");
    await tap(settings.getByRole("button", { name: "Font management", exact: true }));
    fontImported = true;
    const font = (await fontFiles())[1];
    await page.locator('.setting-dialog-main input[type="file"]').setInputFiles({ ...font, name: `${fontKey}.ttf` });
    const fontItem = page.locator(".font-setting-item").filter({ hasText: fontKey });
    await expect(fontItem).toBeVisible();
    await tap(fontItem);
    await expect(page.locator(".font-preview-content")).toBeVisible();
    await back();
    await expect(page.locator(".font-preview-content")).toBeHidden();
    await expect(settings.getByRole("heading", { level: 1 })).toHaveText("Font management");
    await tap(fontItem.locator(".font-setting-delete"));
    await expect(fontItem).toHaveCount(0);
    assert.equal(await native({ channel: "file-command", action: "exists", group: "font", name: `${fontKey}.ttf` }), false);
    fontImported = false;
    await back();
    await expect(settings).toHaveAttribute("data-settings-level", "root");
    await back();
    await expect(settings).toBeHidden();
    checked("font preview consumes native Back and its temporary font is removed");

    baselineBooks = await db("getAllStatement", "books");
    baselineNotes = await db("getAllStatement", "notes");
    sourceBook = baselineBooks.find((book) => book.name === "安卓章节样本");
    const otherBook = baselineBooks.find((book) => book.name === "Android custom font sample");
    const template = baselineNotes.find((note) => note.bookKey === sourceBook?.key && note.range);
    assert.ok(sourceBook && otherBook && template, "Existing synthetic reading and annotation fixtures are required");
    originalPosition = await page.evaluate((key) => JSON.parse(localStorage.getItem("recordLocation") || "{}")[key], sourceBook.key);
    for (let index = 0; index < 3; index++) {
      const key = String(stamp + index);
      assert.ok(!baselineNotes.some((note) => note.key === key));
      added.push(key);
      await db("saveStatement", "notes", { ...template, key, bookKey: index === 1 ? otherBook.key : sourceBook.key, notes: `${prefix} ${index + 1}`, tag: [index === 0 ? "Phone Alpha" : "Phone Beta"] });
    }
    await page.reload();
    await tap(nav("Notes"));
    await tap(page.locator(".android-header").getByRole("button", { name: "Search", exact: true }));
    const search = page.getByPlaceholder("Search my notes");
    await search.fill(prefix);
    await search.press("Enter");
    await expect(page.locator(".android-note-card")).toHaveCount(3);
    if ((await device.shell("dumpsys input_method")).toString().includes("mInputShown=true")) await back();
    await tap(page.getByRole("button", { name: "Filter", exact: true }));
    const filter = page.getByRole("dialog", { name: "Filter", exact: true });
    await filter.getByLabel("Filter by book").selectOption(sourceBook.key);
    await tap(filter.getByRole("button", { name: "Phone Alpha", exact: true }));
    await back();
    await expect(filter).toBeHidden();
    await expect(search).toHaveValue(prefix);
    await expect(page.locator(".android-note-card")).toHaveCount(1);
    await fs.writeFile(path.join(output, "notes-filtered.png"), await device.screenshot());
    checked("book and tag filters intersect with search and native Back preserves the query");
    await tap(page.locator(".android-note-card").getByRole("button", { name: "Edit", exact: true }));
    const editor = page.getByRole("dialog", { name: "Edit", exact: true });
    await tap(editor.locator(".editor-box"));
    await editor.locator(".editor-box").fill(`${prefix} edited`);
    await expect.poll(async () => (await device.shell("dumpsys input_method")).toString().includes("mInputShown=true")).toBe(true);
    const confirm = editor.getByText("Confirm", { exact: true });
    const rect = await confirm.boundingBox();
    assert.ok(rect.y >= 0 && rect.y + rect.height <= await page.evaluate(() => innerHeight));
    await fs.writeFile(path.join(output, "notes-editor-keyboard.png"), await device.screenshot());
    await tap(confirm);
    await expect(editor).toBeHidden();
    await expect.poll(async () => (await db("getStatement", "notes", added[0])).notes).toBe(`${prefix} edited`);
    checked("physical note editor saves through the visible system keyboard to native SQLite");
    const card = () => page.locator(".android-note-card").filter({ hasText: `${prefix} edited` });
    await expect(card()).toBeVisible();
    await tap(card().getByRole("button", { name: "Edit", exact: true }));
    await tap(editor.locator(".editor-box"));
    await editor.locator(".editor-box").fill(`${prefix} unsaved`);
    await back();
    await expect(editor).toBeVisible();
    await back();
    await expect(editor).toBeHidden();
    assert.equal((await db("getStatement", "notes", added[0])).notes, `${prefix} edited`);
    checked("native Back closes the keyboard and discards an unsaved edit without changing its record");
    await tap(card().getByRole("button", { name: "Show in the book", exact: true }));
    await expect(page).toHaveURL(new RegExp(`#/epub/${sourceBook.key}`));
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    await back();
    await expect(page).toHaveURL(/#\/manager\/home/);
    checked("the note source opens its existing book and exits with native Back");
    await device.shell(`am force-stop ${appId}`);
    await start();
    await tap(nav("Notes"));
    await expect(page.locator(".android-note-card").filter({ hasText: `${prefix} edited` })).toBeVisible();
    assert.equal((await db("getStatement", "notes", added[0])).notes, `${prefix} edited`);
    checked("edited notes survive process restart");
    await tap(page.locator(".android-note-card").filter({ hasText: `${prefix} edited` }).getByRole("button", { name: "Edit", exact: true }));
    const restoredEditor = page.getByRole("dialog", { name: "Edit", exact: true });
    await expect.poll(() => restoredEditor.locator(".editor-box").inputValue()).toBe(`${prefix} edited`);
    await tap(restoredEditor.getByText("Delete", { exact: true }));
    await expect(restoredEditor).toBeHidden();
    assert.equal(await db("getStatement", "notes", added[0]), null);
    await tap(page.locator(".android-note-tabs").getByRole("button", { name: "Highlights", exact: true }));
    await expect(page).toHaveURL(/#\/manager\/highlight/);
    await back();
    await expect(page).toHaveURL(/#\/manager\/home/);
    checked("deleting the temporary note removes its native row and highlight navigation returns to Home");
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    failure = error;
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "settings-notes-failure.png"), await device.screenshot()).catch(() => {});
  } finally {
    try {
      if (page && !page.isClosed()) {
        for (const key of added) await db("deleteStatement", "notes", key);
        if (fontImported) {
          await native({ channel: "file-command", action: "remove", group: "font", name: `${fontKey}.ttf` });
          await page.evaluate((key) => {
            const fonts = JSON.parse(localStorage.getItem("customFonts") || "{}");
            delete fonts[key];
            localStorage.setItem("customFonts", JSON.stringify(fonts));
            localStorage.setItem("fontList", JSON.stringify(JSON.parse(localStorage.getItem("fontList") || "[]").filter((value) => value !== key)));
          }, fontKey);
        }
        if (sourceBook) await page.evaluate(({ key, position }) => {
          const records = JSON.parse(localStorage.getItem("recordLocation") || "{}");
          if (position === undefined) delete records[key]; else records[key] = position;
          localStorage.setItem("recordLocation", JSON.stringify(records));
          document.dispatchEvent(new Event("visibilitychange"));
        }, { key: sourceBook.key, position: originalPosition });
        if (sourceBook) await expect.poll(async () => JSON.stringify(JSON.parse((await native({ channel: "preferences", action: "read" })).values.recordLocation || "{}")[sourceBook.key])).toBe(JSON.stringify(originalPosition));
        const remaining = await db("getAllStatement", "notes");
        for (const note of baselineNotes) assert.deepEqual(remaining.find((record) => record.key === note.key), note);
        const books = await db("getAllStatement", "books");
        for (const book of baselineBooks) assert.ok(books.some((record) => record.key === book.key));
        assert.ok(!remaining.some((record) => added.includes(record.key)));
        report.cleanup = "temporary records and font removed; original records and books preserved";
        await page.reload();
      }
    } catch (error) {
      report.passed = false;
      report.cleanupError = error.message;
      failure ||= error;
    }
    if (device) await device.shell("rm -f /data/local/tmp/koodo-settings-notes.xml").catch(() => {});
    await fs.writeFile(path.join(output, "settings-notes-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((candidate) => candidate.close()));
  }
  if (failure) throw failure;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
