const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const JSZip = require("jszip");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const dump = "/data/local/tmp/koodo-exports.xml";
const shared = "/sdcard/Download/KoodoReaderCustomTest";
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const device = devices.find((d) => d.serial() === process.env.ANDROID_SERIAL) || devices[0];
  assert.ok(device, "Connect an authorized Android device");
  const report = { passed: false, checks: [], errors: [] };
  const checked = (message) => { report.checks.push(message); console.log(`PASS ${message}`); };
  let page;
  let cancelDocument;
  let addedWordKey;
  const savedPaths = [];
  try {
    await device.shell(`am force-stop ${appId}`);
    await device.shell(`am start -n ${appId}/.MainActivity`);
    page = await (await device.webView({ pkg: appId })).page();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.context().route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "localhost" || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    await expect(page.locator(".android-header")).toBeVisible();
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const records = (dbName) => native({ channel: "database-command", dbName, statement: "getAllStatement" });
    const baseline = { books: await records("books"), notes: await records("notes"), words: await records("words") };
    const originals = [];
    for (const book of baseline.books) {
      const base64 = await native({ channel: "file-command", group: "book", action: "read", name: `${book.key}.${book.format.toLowerCase()}` });
      assert.ok(base64, "Synthetic test library must have all originals");
      originals.push(hash(Buffer.from(base64, "base64")));
    }
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
    const staged = async () => (await device.shell(`run-as ${appId} ls cache/document-exports 2>/dev/null`)).toString().trim().split(/\s+/).filter(Boolean);
    const initialStaged = await staged();
    cancelDocument = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!(await nodes()).some((node) => node.package === "com.google.android.documentsui")) return;
        await device.shell("input keyevent KEYCODE_BACK");
      }
      throw new Error("System picker did not close");
    };
    const booksButton = () => page.locator(".android-data-row").filter({ hasText: "Export all books" }).getByRole("button");
    const idle = () => expect(page.locator(".android-data")).toHaveAttribute("aria-busy", "false");
    const choose = async () => {
      await tapNode((node) => /^(Show roots|显示根目录|显示根位置)$/.test(node["content-desc"] || ""));
      await tapNode((node) => node["resource-id"] === "android:id/title" && /^(Downloads|下载|下载内容)$/.test(node.text || ""));
      await tapNode((node) => node.text === "KoodoReaderCustomTest");
      const name = (await nodes()).find((node) => node.class === "android.widget.EditText").text;
      assert.match(name, /^KoodoReader-[A-Za-z0-9._-]+$/);
      await tapNode((node) => /^(Save|SAVE|保存)$/.test(node.text || "") && node.enabled !== "false");
      await idle();
      const filename = `${shared}/${name}`;
      savedPaths.push(filename);
      await expect.poll(async () => (await device.shell(`test -f ${filename} && echo yes`)).toString().trim()).toBe("yes");
      assert.deepEqual(await staged(), initialStaged);
      return Buffer.from((await device.shell(`base64 ${filename}`)).toString(), "base64");
    };
    const unpackRecords = async (buffer) => {
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return JSON.parse(buffer.toString("utf8"));
      const zip = await JSZip.loadAsync(buffer);
      return JSON.parse(await zip.file("all.json").async("string"));
    };
    await device.shell(`mkdir -p ${shared}`);
    await tap(page.getByRole("button", { name: "Settings", exact: true }));
    await tap(page.getByRole("button", { name: "Data", exact: true }));
    await expect(page.locator(".android-data")).toBeVisible();
    await tap(booksButton());
    await expect.poll(async () => (await nodes()).some((node) => node.package === "com.google.android.documentsui")).toBe(true);
    assert.equal((await staged()).length, initialStaged.length + 1);
    await cancelDocument();
    await idle();
    assert.deepEqual(await staged(), initialStaged);
    await expect(page.getByText("Export successful", { exact: true })).toHaveCount(0);
    checked("system Save As cancellation clears staged bytes without a false success");
    await tap(booksButton());
    const archive = await JSZip.loadAsync(await choose());
    const exported = await Promise.all(Object.values(archive.files).filter((entry) => !entry.dir).map(async (entry) => hash(await entry.async("nodebuffer"))));
    assert.deepEqual(exported.sort(), originals.sort());
    checked("system Save As exports every original book with identical SHA-256 bytes");
    for (const kind of ["notes", "highlights"]) {
      const expected = baseline.notes.filter((note) => kind === "notes" ? note.notes && note.notes !== "annotation" : note.notes === "");
      assert.ok(expected.length);
      await page.getByLabel(kind === "notes" ? "Export all notes" : "Export all highlights", { exact: true }).selectOption("json");
      const data = await unpackRecords(await choose());
      assert.deepEqual(data.map((note) => note.key).sort(), expected.map((note) => note.key).sort());
      for (const note of expected) {
        const item = data.find((record) => record.key === note.key);
        assert.equal(item.text, note.text);
        if (kind === "notes") assert.equal(item.notes, note.notes);
        assert.equal(item.tag, note.tag.join(","));
      }
      checked(`system Save As exports complete UTF-8 ${kind} with quotes, tags and book identity`);
    }
    await page.getByLabel("Export all highlights", { exact: true }).selectOption("pdf");
    const pdfNotes = baseline.notes.filter((note) => note.notes === "");
    const pdfGroups = new Set(pdfNotes.map((note) => baseline.books.find((book) => book.key === note.bookKey)?.name));
    const pdf = await choose();
    const pdfBytes = pdfGroups.size > 1 ? await (await JSZip.loadAsync(pdf)).file("all.pdf").async("nodebuffer") : pdf;
    assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
    checked("offline PDF export saves a readable PDF file through the native document provider");
    addedWordKey = `android-export-word-${Date.now()}`;
    assert.ok(!baseline.words.some((word) => word.key === addedWordKey));
    const word = { key: addedWordKey, bookKey: baseline.books[0].key, date: { year: 2026, month: 11, day: 2 }, word: "阅读", chapter: "Export QA", sentence: "中文查词记录导出验证。" };
    await native({ channel: "database-command", dbName: "words", statement: "saveStatement", data: word });
    await page.getByLabel("Export all dictionary history", { exact: true }).selectOption("json");
    const words = await unpackRecords(await choose());
    assert.equal(words.length, baseline.words.length + 1);
    const exportedWord = words.find((entry) => entry.key === addedWordKey);
    assert.equal(exportedWord.word, word.word);
    assert.equal(exportedWord.sentence, word.sentence);
    assert.equal(exportedWord.bookMd5, baseline.books[0].md5);
    await native({ channel: "database-command", dbName: "words", statement: "deleteStatement", data: addedWordKey });
    addedWordKey = undefined;
    checked("dictionary export preserves UTF-8 words and sentences and removes its temporary test record");
    await fs.writeFile(path.join(output, "exports-data.png"), await device.screenshot());
    assert.deepEqual(await records("books"), baseline.books);
    assert.deepEqual(await records("notes"), baseline.notes);
    assert.deepEqual(await records("words"), baseline.words);
    await tap(page.locator(".android-settings-header").getByRole("button", { name: "Back", exact: true }));
    await device.shell("input keyevent KEYCODE_BACK");
    await expect(page.locator(".android-settings")).toHaveCount(0);
    await expect(page.locator(".android-header")).toBeVisible();
    checked("exporting preserves the original library and annotations and settings Back navigation");
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "exports-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    if (!report.passed && cancelDocument) await cancelDocument().catch(() => {});
    if (addedWordKey && page && !page.isClosed()) await page.evaluate(async (key) => window.Capacitor.Plugins.KoodoStorage.execute({ channel: "database-command", dbName: "words", statement: "deleteStatement", data: key }), addedWordKey).catch(() => {});
    if (report.passed) for (const filename of savedPaths) await device.shell(`rm -f ${filename}`);
    if (device) await device.shell(`rm -f ${dump}`).catch(() => {});
    await fs.writeFile(path.join(output, "exports-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((d) => d.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
