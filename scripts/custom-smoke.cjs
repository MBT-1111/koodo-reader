// Run only against a built renderer and an installed Electron dependency.
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { isInside } = require("../src/utils/main/custom/runtime");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-test-smoke-"));
  const env = { ...process.env, KRC_TEST_PROFILE: root, ELECTRON_IS_DEV: "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    assert.ok(fs.existsSync(path.resolve("build/index.html")), "Compile Windows renderer resources first");
    app = await electron.launch({ args: [path.resolve(".")], env, timeout: 60000 });
    const locations = await app.evaluate(({ app }) => Object.fromEntries(["userData", "sessionData", "temp", "logs", "crashDumps"].map((name) => [name, app.getPath(name)])));
    assert.ok(Object.values(locations).every((directory) => isInside(root, directory)), "All writable Electron locations must be isolated");
    const page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    await page.waitForFunction(() => !!window.electronAPI);
    await page.locator(".header").waitFor();
    assert.equal(await page.locator(".header .icon-account").count(), 0, "Personal build should hide the account entry");
    assert.equal(await page.locator(".header-report-container").count(), 0, "Personal build should hide Pro promotions");
    const invoke = (channel, data) => page.evaluate(({ channel, data }) => window.electronAPI.invoke(channel, data), { channel, data });
    const update = await page.evaluate(async () => {
      try { await window.electronAPI.invoke("update-win-app", { version: "0.0.0" }); return "ALLOWED"; }
      catch (error) { return String(error.message); }
    });
    assert.match(update, /CUSTOM_OFFICIAL_UPDATE_DISABLED/);
    const storagePath = await page.evaluate(() => window.electronAPI.sendSync("storage-location", "ping"));
    assert.ok(isInside(root, storagePath));
    const fixture = path.join(root, "synthetic.epub"), remote = path.join(root, "remote");
    fs.writeFileSync(fixture, "Synthetic sync fixture; never opened by a reader"); fs.mkdirSync(remote);
    const book = { key: "synthetic-book", name: "Synthetic Book", author: "Test", description: "Fixture", md5: "fixture", cover: "", format: "EPUB", publisher: "", size: fs.statSync(fixture).size, page: 1, path: fixture, charset: "utf-8", published: "", modified: "", identifier: "", language: "en", subject: "", rights: "", isbn: "", layout: "" };
    const note = { key: "synthetic-note", bookKey: book.key, date: { year: 2026, month: 10, day: 31 }, chapter: "Test", chapterIndex: 0, text: "Synthetic highlight", cfi: "{}", range: "[]", notes: "Synthetic note", percentage: "0.5", color: "1", tag: [] };
    for (const [dbName, data] of [["books", book], ["notes", note]]) await invoke("database-command", { statement: "saveStatement", statementType: "string", executeType: "run", dbName, data, storagePath });
    await page.evaluate(() => {
      localStorage.setItem("readingTime", JSON.stringify({ "synthetic-book": 6 }));
      localStorage.setItem("readingStats", JSON.stringify({ "2026-10-31": ["synthetic-book-6"] }));
      localStorage.setItem("recordLocation", JSON.stringify({ "synthetic-book": { percentage: "0.5", cfi: "fixture" } }));
    });
    await invoke("custom-sync", { action: "configure", provider: "folder", namespace: "smoke", autoMinutes: 0, folder: remote });
    await page.locator(".header .icon-sync.setting-icon").click();
    await page.getByText(/^(Personal sync completed|自有同步已完成)$/).waitFor();
    assert.ok(!page.url().includes("/login"), "Header sync should run personal sync directly");
    const folder = path.join(remote, "KoodoReaderCustom-v1-smoke");
    const firstGeneration = fs.readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
    assert.equal(firstGeneration.length, 1);
    await page.locator(".icon-setting.setting-icon").click();
    assert.equal(await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /^(Account|账户)$/ }).count(), 0);
    await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /Sync and backup|同步与备份|同步和备份/ }).click();
    assert.equal(await page.locator(".add-source-card").count(), 0, "Only personal sync should be shown");
    const button = page.locator(".custom-sync").getByRole("button", { name: /^(Sync now|立即同步)$/ });
    await button.click();
    await page.getByText(/^(Everything is up to date|没有需要更新的数据)$/).waitFor();
    await page.waitForTimeout(100);
    assert.deepEqual(fs.readdirSync(folder).filter((name) => name.endsWith(".json")).sort(), firstGeneration, "Unchanged data must not create a new cloud generation");
    assert.ok(fs.readdirSync(folder).some((name) => name.endsWith(".json")), "UI sync should publish a snapshot");
    for (const filename of fs.readdirSync(folder).filter((name) => name.endsWith(".json"))) {
      const text = fs.readFileSync(path.join(folder, filename), "utf8");
      assert.ok(!text.includes(fixture) && !text.includes('"path"') && !text.includes('"apiKey"'), "Snapshot must not contain file paths or credentials");
    }
    const notes = await invoke("database-command", { statement: "getAllStatement", statementType: "string", executeType: "all", dbName: "notes", storagePath });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, note.text);
    const blocked = await page.evaluate(async () => {
      try { await window.electronAPI.invoke("generate-tts", {}); return "ALLOWED"; }
      catch (error) { return String(error.message); }
    });
    assert.match(blocked, /CUSTOM_TEST_NETWORK_BLOCKED/);
    await page.evaluate(() => { window.location.hash = "/login"; });
    await page.waitForFunction(() => window.location.hash.startsWith("#/manager"));
    fs.mkdirSync(path.resolve("dist"), { recursive: true });
    fs.writeFileSync(path.resolve("dist/custom-smoke.json"), JSON.stringify({ passed: true, source: process.env.GITHUB_SHA || "working-tree", platform: process.platform, checks: ["profile-isolation", "official-update-blocked", "real-database-ipc", "personal-sync-ui", "header-personal-sync", "unchanged-sync-no-upload", "official-account-hidden", "login-route-redirect", "immutable-folder-provider", "credential-exclusion", "tts-network-blocked"] }, null, 2));
    console.info("Custom Windows smoke checks passed (synthetic data only).");
  } finally {
    if (app) await app.close();
    // Retain synthetic profile on failure for CI diagnostics; never touch another profile.
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
