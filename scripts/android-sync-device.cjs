const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const ts = require("typescript");
const { server } = require("../e2e/android/mega-fixtures.cjs");
const { fontBook } = require("../e2e/android/font-fixtures.cjs");
const { systemPicker, importNativeFixture } = require("./android-system-picker.cjs");
const locale = require("../src/assets/locales/en.json");
const pkg = "xyz.koodoreader.custom.android.restoreqa", primaryPkg = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sharedRuntime() {
  const root = path.join(output, "sync-runtime");
  for (const name of ["sync/protocol", "sync/contract", "sync/data", "sync/workflow", "backup/dataBackup"]) {
    const source = await fs.readFile(path.join(__dirname, "..", "src", "custom", `${name}.ts`), "utf8");
    const target = path.join(root, `${name}.js`); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
  }
  return { ...require(path.join(root, "sync/protocol.js")), ...require(path.join(root, "sync/workflow.js")), ...require(path.join(root, "sync/data.js")), ...require(path.join(root, "backup/dataBackup.js")) };
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const device = devices.find((item) => item.serial() === process.env.ANDROID_SERIAL) || devices[0]; assert.ok(device);
  const report = { passed: false, checks: [], errors: [] };
  const checked = (text) => { report.checks.push(text); console.log(`PASS ${text}`); };
  const remote = server(true), core = await sharedRuntime();
  let page;
  try {
    const attach = async (target) => {
      await device.shell(`am start -n ${target}/xyz.koodoreader.custom.android.MainActivity`);
      const view = await (await device.webView({ pkg: target })).page(); view.setDefaultTimeout(60000);
      view.on("pageerror", (error) => report.errors.push(error.message));
      await view.context().route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === "localhost" || /^(data|blob):/.test(url.protocol)) return route.continue();
        if (!["g.api.mega.co.nz", "upload.invalid", "download.invalid"].includes(url.hostname)) return route.abort();
        const cors = { "access-control-allow-origin": "https://localhost", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "*" };
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        try {
          const response = await remote.fetch(url, { method: request.method(), body: request.postDataBuffer() || undefined });
          await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors }, body: Buffer.from(await response.arrayBuffer()) });
        } catch { await route.abort("failed"); }
      });
      await expect(view.locator(".android-header")).toBeVisible(); return view;
    };
    const invoke = (view, request) => view.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const rows = async (view) => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async (dbName) => [dbName, await invoke(view, { channel: "database-command", dbName, statement: "getAllStatement" })])));
    const originalPage = await attach(primaryPkg), original = await rows(originalPage);
    page = await attach(pkg);
    assert.equal((await rows(page)).books.length, 0, "Use a fresh isolated QA package");
    const book = await fontBook(); report.fixtureSha256 = hash(book.buffer);
    report.fixtureName = await importNativeFixture(page, device, book);
    await expect(page.locator(".book-list-item")).toHaveCount(1, { timeout: 120000 });
    const imported = (await rows(page)).books[0], sourceValues = (await invoke(page, { channel: "preferences", action: "read" })).values;
    const scope = hash(Buffer.from(JSON.stringify(["mega", "fixture@example.invalid", "android-qa"])));
    const connection = { version: 1, email: "fixture@example.invalid", namespace: "android-qa", autoMinutes: 0, scope,
      session: { key: Buffer.alloc(16, 1).toString("base64url"), sid: "synthetic-session", name: "Fixture", user: "fixture", options: { email: "fixture@example.invalid", keepalive: false } } };
    await invoke(page, { channel: "credential", slot: "mega", action: "write", value: JSON.stringify(connection) });
    const desktopKey = "desktop-book", sourceHash = hash(book.buffer);
    let desktopRaw = core.rawData({ books: [{ ...imported, key: desktopKey, path: "D:\\synthetic.epub", cover: "local-desktop-cover" }],
      notes: [{ key: "desktop-note", bookKey: desktopKey, notes: "Desktop note", text: "A shared quotation", tag: ["sync-qa"], date: { year: 2026, month: 11, day: 3 }, percentage: 0.2 }],
      bookmarks: [{ key: "desktop-bookmark", bookKey: desktopKey, label: "Desktop bookmark", cfi: "chapter-1" }] },
      Object.fromEntries(core.configKeys.map((key) => [key, (sourceValues[key] || "").split(imported.key).join(desktopKey)])));
    desktopRaw.config.recordLocation = JSON.stringify({ [desktopKey]: { percentage: 0.2 } });
    desktopRaw.config.readingTime = JSON.stringify({ [desktopKey]: 100 });
    desktopRaw.config.readingStats = JSON.stringify({ "2026-11-03": [`${desktopKey}-100`] });
    let desktopState = core.freshCheckpoint();
    const desktopSync = async () => {
      const { MegaProvider } = await import("../src/utils/main/custom/megaTransport.mjs");
      const provider = new MegaProvider(await remote.open(), connection.namespace);
      try {
        const job = core.prepareSync(desktopRaw, { [desktopKey]: sourceHash }, desktopState, await provider.read());
        if (job.publish) await provider.append(core.envelope(job.state));
        desktopRaw = job.next; desktopState = job.state;
        desktopRaw.config[core.DATA_STATE_KEY] = core.sharedIdentityState(desktopRaw.config[core.DATA_STATE_KEY], desktopState);
        core.finishSync(desktopState, desktopRaw);
      } finally { await provider.close(); }
    };
    await desktopSync(); remote.reverseTree();
    // Simulate a copied annotation arriving through a portable backup before
    // the phone joins the existing desktop sync space.
    const copiedNote = { ...desktopRaw.tables.notes[0], key: "backup-note-local", bookKey: imported.key };
    await invoke(page, { channel: "database-command", dbName: "notes", statement: "saveStatement", data: copiedNote });
    const portable = await core.createDataBackup(core.rawData({ books: [imported], notes: [copiedNote], bookmarks: [] }, sourceValues), sourceValues, { [imported.key]: sourceHash });
    assert.notEqual(portable.state.mappings.notes[copiedNote.key], desktopState.mappings.notes["desktop-note"]);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: core.DATA_STATE_KEY, value: JSON.stringify(portable.state) });
    const openSettings = async () => {
      const ui = systemPicker(page, device);
      await ui.tap(page.getByRole("button", { name: "Settings", exact: true }));
      await ui.tap(page.locator(".android-settings").getByRole("button", { name: locale["custom.sync.title"], exact: true }));
      await expect(page.locator(".android-sync input[type=email]")).toHaveValue(connection.email);
    };
    const preferences = async () => (await invoke(page, { channel: "preferences", action: "read" })).values;
    const sync = async () => {
      const previous = (await preferences())[`customSyncLast-${scope}`];
      await systemPicker(page, device).tap(page.getByRole("button", { name: locale["custom.sync.now"], exact: true }));
      await expect.poll(async () => (await preferences())[`customSyncLast-${scope}`], { timeout: 120000 }).not.toBe(previous);
      await expect(page.locator(".android-sync")).toHaveAttribute("aria-busy", "false", { timeout: 120000 });
    };
    await openSettings(); await sync();
    let received = await rows(page), values = await preferences();
    assert.equal(received.notes.length, 1); assert.equal(received.bookmarks.length, 1);
    assert.equal(received.notes[0].bookKey, imported.key); assert.equal(received.books[0].path, imported.path);
    assert.equal(JSON.parse(values.recordLocation)[imported.key].percentage, 0.2);
    assert.equal(JSON.parse(values[core.DATA_STATE_KEY]).mappings.notes[copiedNote.key], desktopState.mappings.notes["desktop-note"]);
    checked("Android browser SDK decrypts Windows-format MEGA snapshots and maps progress/annotations to its local original");
    checked("a backup-imported annotation joins the existing cloud identity without duplication");
    const note = { ...received.notes[0], notes: "Phone edit" };
    await invoke(page, { channel: "database-command", dbName: "notes", statement: "updateStatement", data: note });
    await page.evaluate((key) => { localStorage.setItem("recordLocation", JSON.stringify({ [key]: { percentage: 0.5 } })); localStorage.setItem("readingTime", JSON.stringify({ [key]: 130 })); }, imported.key);
    await sync(); await desktopSync();
    assert.equal(desktopRaw.tables.notes[0].notes, "Phone edit");
    assert.equal(JSON.parse(desktopRaw.config.recordLocation)[desktopKey].percentage, 0.5);
    assert.equal(JSON.parse(desktopRaw.config.readingTime)[desktopKey], 130);
    checked("encrypted phone uploads are read by the Windows transport without copying the EPUB or local URI");
    const beforeFailure = JSON.stringify(desktopRaw);
    await page.evaluate((key) => { localStorage.setItem("recordLocation", JSON.stringify({ [key]: { percentage: 0.8 } })); localStorage.setItem("readingTime", JSON.stringify({ [key]: 140 })); }, imported.key);
    remote.failUpload(true);
    await systemPicker(page, device).tap(page.getByRole("button", { name: locale["custom.sync.now"], exact: true }));
    await expect(page.getByText(locale["custom.sync.error.CUSTOM_MEGA_NETWORK_FAILED"], { exact: true })).toBeVisible({ timeout: 120000 });
    await expect(page.locator(".android-sync")).toHaveAttribute("aria-busy", "false");
    assert.equal(JSON.parse((await preferences()).recordLocation)[imported.key].percentage, 0.8);
    assert.equal(JSON.stringify(desktopRaw), beforeFailure);
    remote.failUpload(false); await sync(); await desktopSync();
    assert.equal(JSON.parse(desktopRaw.config.readingTime)[desktopKey], 140);
    assert.equal(JSON.parse(desktopRaw.config.recordLocation)[desktopKey].percentage, 0.8);
    assert.equal(desktopRaw.tables.notes.length, 1);
    checked("failed encrypted uploads retain edits, release busy state and retry without duplicated time or notes");
    await device.shell(`am force-stop ${pkg}`); page = await attach(pkg); await openSettings();
    const uploads = remote.nodes.filter((node) => node.t === 0).length;
    await sync(); assert.equal(remote.nodes.filter((node) => node.t === 0).length, uploads);
    assert.equal((await rows(page)).notes.length, 1);
    checked("Keystore-backed login and sync checkpoints survive restart; unchanged sync creates no new generation");
    await fs.writeFile(path.join(output, "sync-settings.png"), await device.screenshot());
    assert.equal(isDeepStrictEqual(original, await rows(await attach(primaryPkg))), true, "Primary records changed");
    assert.equal(remote.commands.some((command) => command.a === "sml"), false);
    assert.deepEqual(report.errors, []); report.passed = true;
    checked("primary library is unchanged and SDK closure does not invalidate the saved session");
  } catch (error) {
    report.error = error.message;
    await fs.writeFile(path.join(output, "sync-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, "sync-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((item) => item.close()));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
