// Start yarn start, then pass an installed Custom executable. Uses an isolated
// profile and a synthetic EPUB; never locks or edits the owner's configuration.
const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { isInside } = require("../src/utils/main/custom/runtime");

async function fixture() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">turn-fixture</dc:identifier><dc:title>Page turn fixture</dc:title><dc:language>en</dc:language></metadata><manifest>' + [1, 2].map(i => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("") + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  zip.file("toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="turn-fixture"/></head><docTitle><text>Fixture</text></docTitle><navMap>' + [1, 2].map(i => `<navPoint id="c${i}" playOrder="${i}"><navLabel><text>Chapter ${i}</text></navLabel><content src="c${i}.xhtml"/></navPoint>`).join("") + '</navMap></ncx>');
  for (const chapter of [1, 2]) zip.file(`c${chapter}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${chapter}</title></head><body>` + Array.from({ length: 180 }, (_, index) => `<p>Chapter ${chapter}, paragraph ${index + 1}. This synthetic EPUB checks wheel and keyboard page turns, progress saves and reopening.</p>`).join("") + '</body></html>');
  return Array.from(await zip.generateAsync({ type: "uint8array" }));
}

async function lockRename(filename) {
  const script = '$stream=[IO.File]::Open($env:KRC_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); [Console]::WriteLine("locked"); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null; $stream.Dispose()';
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, KRC_LOCK_FILE: filename }, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Config lock helper timed out")), 10000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", data => { if (data.toString().includes("locked")) { clearTimeout(timer); resolve(); } });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`Config lock helper exited: ${code}`)); });
  });
  return child;
}

(async () => {
  const executablePath = process.argv[2];
  const packaged = process.argv.includes("--packaged");
  assert.ok(executablePath && path.isAbsolute(executablePath) && fs.existsSync(executablePath), "Pass an installed Custom executable");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-test-page-turn-"));
  const env = { ...process.env, KRC_TEST_PROFILE: root, ELECTRON_IS_DEV: "0" }; delete env.ELECTRON_RUN_AS_NODE;
  let app, locker;
  const output = path.resolve("dist/page-turn-smoke.json"), report = { passed: false, checks: [] };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const checked = value => { report.checks.push(value); console.log(`PASS ${value}`); };
  try {
    app = await electron.launch({ executablePath, env, timeout: 60000 });
    const profile = await app.evaluate(({ app }) => app.getPath("userData"));
    assert.ok(isInside(root, profile));
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners("get-file-data"); ipcMain.on("get-file-data", event => { event.returnValue = ""; }); });
    await app.context().route("**/*", route => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(url.hostname) || ["file:", "data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    const page = await app.firstWindow(), errors = [];
    const baseURL = packaged ? page.url().split("#")[0] : "http://127.0.0.1:3000/";
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:3000/");
    await page.evaluate(async data => {
      const { ConfigService } = await import("/src/assets/lib/kookit-extra-browser.min.js");
      const { default: BookUtil } = await import("/src/utils/file/bookUtil.ts");
      const { default: DatabaseService } = await import("/src/utils/storage/databaseService.ts");
      const bytes = new Uint8Array(data), book = { key: "turn-fixture", name: "Page turn fixture", author: "Test", description: "", md5: "fixture", cover: "", format: "EPUB", publisher: "", size: bytes.length, page: 1, path: "", charset: "utf-8", published: "", modified: "", identifier: "", language: "en", subject: "", rights: "", isbn: "", layout: "" };
      for (const [key, value] of Object.entries({ readerMode: "double", animation: "none", isNavLocked: "no", isSettingLocked: "no", isTouch: "no" })) ConfigService.setReaderConfig(key, value);
      ConfigService.setItem("isFirst", "no"); ConfigService.setItem("isFirstRun", "no");
      await BookUtil.addBook(book.key, "epub", bytes.buffer); await DatabaseService.saveRecord(book, "books");
    }, await fixture());
    // Run the exact main-process helpers from this checkout using the installed
    // Electron/SQLite runtime, without replacing any installed application file.
    if (!packaged) await app.evaluate(({ app, ipcMain }, { source, root }) => {
      const req = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
      const Store = req("electron-store"), { createConfigStore } = req(source + "/src/utils/main/config-store.js");
      const store = createConfigStore(Store, app.getPath("userData"));
      const { createPreferences } = req(source + "/src/utils/main/custom/preferences.js");
      const preferences = createPreferences(store, { testing: true, root }, store.get("rendererPreferences.storageLocation"));
      ipcMain.removeAllListeners("preferences");
      ipcMain.on("preferences", (event, request) => {
        if (globalThis.__denyNextPosition && request.action === "set" && request.key === "recordLocation") {
          globalThis.__denyNextPosition = false; event.returnValue = { ok: false, error: "SYNTHETIC_POSITION_SAVE_FAILED" }; return;
        }
        try { event.returnValue = { ok: true, value: preferences.handle(request) }; }
        catch (error) { event.returnValue = { ok: false, error: error.message }; }
      });
    }, { source: path.resolve("."), root });
    if (packaged) await app.evaluate(({ ipcMain }) => {
      const original = ipcMain.listeners("preferences")[0];
      ipcMain.removeAllListeners("preferences");
      ipcMain.on("preferences", (event, request) => {
        if (globalThis.__denyNextPosition && request.action === "set" && request.key === "recordLocation") {
          globalThis.__denyNextPosition = false; event.returnValue = { ok: false, error: "SYNTHETIC_POSITION_SAVE_FAILED" }; return;
        }
        original(event, request);
      });
    });
    const url = baseURL + "#/epub/turn-fixture?title=Fixture";
    const ready = async () => {
      await page.locator("#page-area iframe").waitFor();
      await page.frameLocator("#page-area > iframe").locator("p").first().waitFor();
      await page.waitForTimeout(1200);
    };
    await page.goto(url); await page.reload(); await ready();
    locker = await lockRename(path.join(profile, "config.json"));
    const position = () => page.evaluate(async packaged => {
      if (packaged) return Number(JSON.parse(localStorage.getItem("recordLocation") || "{}")["turn-fixture"]?.percentage || 0);
      const { useAppStore } = await import("/src/store/useAppStore.ts");
      return Number(useAppStore.getState().reader.htmlBook.rendition.getPosition().percentage);
    }, packaged);
    const wheel = async delta => {
      const box = await page.locator("#page-area").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, delta); await page.waitForTimeout(300);
    };
    for (let index = 0; index < 4; index++) { const before = await position(); await wheel(100); assert.ok(await position() > before); }
    checked("four consecutive real wheel turns save progress while Windows denies config rename");
    const beforeKeys = await position();
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300); assert.ok(await position() > beforeKeys);
    await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(300); assert.equal(await position(), beforeKeys);
    checked("both keyboard directions remain responsive after wheel input");
    await app.evaluate(() => { globalThis.__denyNextPosition = true; });
    await wheel(100); const afterFailedSave = await position();
    await wheel(100); assert.ok(await position() > afterFailedSave);
    assert.ok(errors.includes("SYNTHETIC_POSITION_SAVE_FAILED"));
    assert.ok(errors.every(error => error === "SYNTHETIC_POSITION_SAVE_FAILED"));
    checked("an actual rejected save releases the shared input lock for the following turn");
    const saved = await position();
    await page.reload(); await ready(); assert.equal(await position(), saved);
    checked("cold renderer startup hydrates the saved position while the rename lock remains held");
    await page.goto(baseURL + "#/manager/home"); await page.locator("#page-area").waitFor({ state: "detached" });
    await page.goto(url); await ready(); assert.equal(await position(), saved);
    await wheel(100); assert.ok(await position() > saved);
    checked("exit and reopen shows the EPUB and accepts the next page turn");
    assert.ok(fs.existsSync(path.join(profile, "config.json.recovery")));
    assert.ok(JSON.parse(fs.readFileSync(path.join(profile, "config.json"), "utf8")).rendererPreferences.recordLocation);
    report.passed = true;
  } finally {
    if (locker) { const closed = new Promise(resolve => locker.on("exit", resolve)); locker.stdin.end("\n"); await closed; }
    if (app) await app.close();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("krc-test-page-turn-")) fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
